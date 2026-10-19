#!/usr/bin/env python3
"""ADR<->HK premium + overnight-gap signal job for dual-listed shares.

Computes, per configured pair (US ADR/ADS vs HK ordinary line), the
FX-adjusted premium of the HK leg over the US leg, an overnight-gap proxy,
and a z-score signal against the trailing 30 calendar-day premium history.

Pairs (default config) and price sources — all keyless:

  pair  US leg      HK leg      ADS ratio   price source
  BABA  US.BABA     HK.09988    1 ADS = 8   moomoo OpenD k-line (get_kline.py)
  PONY  US.PONY     HK.02026    1 ADS = 1   moomoo OpenD k-line (get_kline.py)
  WRD   US.WRD      HK.00800    1 ADS = 3   moomoo OpenD k-line (get_kline.py)

  HKDUSD FX: Frankfurter (ECB daily reference rates, https://api.frankfurter.app)

"moomoo-opend" shells out to the moomooapi skill script
`~/.hermes/skills/moomooapi/scripts/quote/get_kline.py` and needs the local
OpenD gateway (127.0.0.1:11111) running — no API key. Per-pair source is the
`source` field of the pair config and is echoed in every JSON pair record and
`runs` audit row. The
`yahoo` provider (keyless Yahoo Finance chart API, closes only) is available
per pair or via `--source` when OpenD is not running. `--fixtures DIR` swaps
both price and FX providers for file-based fixture data (tests / offline).

Formulas (all at session-date granularity, legs aligned by exchange date):

  premium_pct         = (hk_close * ads_ratio * hkdusd / us_close - 1) * 100
  overnight_gap_pct   = ((hk_close/hk_prev_close - 1) - (us_close/us_prev_close - 1)) * 100
  zscore              = (premium_latest - mean(hist)) / stdev(hist)   (ddof=1)
  signal              = hk_rich when z > +threshold (HK expensive vs parity:
                        short HK / long US), hk_cheap when z < -threshold,
                        else none. Threshold compared strictly ("exceeds").

`hist` = premiums of the window `[latest - window_days, latest)` (current
observation excluded), `min_history` observations required, `stdev == 0`
yields zscore null (no standardisation possible). The gap proxy measures each
leg's latest session against its close at the previous *common* session (legs
are aligned by exchange date label; on calendar-divergence days — one market
holiday — a leg's return spans its intervening sessions). FX lookups fall
back to the most recent prior ECB rate and flag `fx_stale`; with no prior rate
at all the row degrades to status `fx_missing` (premium/zscore/signal null)
and the job continues. Prices are raw closes (moomoo `--rehab none`, Yahoo
`close`); corporate actions are absorbed manually in `ads_ratio` —
research-grade proxy.

Pair status ladder: `ok` | `fx_missing` (no FX rate at or before the
session) | `insufficient_history` (fewer than `min_history` history
observations, or zero-variance history: no usable z) | `no_data` (sources
answered but no bars in range, e.g. `--as-of` predates the listing) |
`error` (fetch/parse failure). Only `error` pairs make the job exit 1;
degraded pairs exit 0.

Observations persist to SQLite (`research/adr_premium.db` by default,
upserted per (pair, date)) plus one `runs` audit row per pair per run.

CLI:
  python3 tools/adr_premium.py [--json] [--db PATH] [--config pairs.json]
      [--pairs BABA,PONY,WRD] [--source moomoo-opend|yahoo] [--fixtures DIR]
      [--as-of YYYY-MM-DD] [--fetch-days N] [--window-days N]
      [--z-threshold Z] [--min-history N] [--kline-script PATH]

`--json` prints exactly one JSON document on stdout (progress goes to stderr).
Exit status: 0 = every pair produced a row (possibly degraded), 1 = at least
one pair has status `error`.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

DEFAULT_Z_THRESHOLD = 2.0
DEFAULT_WINDOW_DAYS = 30
DEFAULT_MIN_HISTORY = 10
DEFAULT_FETCH_DAYS = 45
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "research" / "adr_premium.db"
DEFAULT_KLINE_SCRIPT = (
    Path.home() / ".hermes" / "skills" / "moomooapi" / "scripts" / "quote" / "get_kline.py"
)
USER_AGENT = "Mozilla/5.0 (compatible; adr-premium/1.0)"


@dataclass(frozen=True)
class Pair:
    name: str
    us: str  # US symbol, e.g. BABA
    hk: str  # HK symbol, e.g. 9988.HK
    ads_ratio: float  # HK ordinary shares per ADR/ADS
    source: str = "moomoo-opend"  # price provider id (per-pair source)

    @property
    def us_code(self) -> str:
        """moomoo OpenD code for the US leg."""
        return f"US.{self.us}"

    @property
    def hk_code(self) -> str:
        """moomoo OpenD code for the HK leg (5-digit, e.g. HK.09988)."""
        return "HK." + self.hk.split(".")[0].zfill(5)


DEFAULT_PAIRS: list[Pair] = [
    Pair(name="BABA", us="BABA", hk="9988.HK", ads_ratio=8, source="moomoo-opend"),
    Pair(name="PONY", us="PONY", hk="2026.HK", ads_ratio=1, source="moomoo-opend"),
    Pair(name="WRD", us="WRD", hk="0800.HK", ads_ratio=3, source="moomoo-opend"),
]


class FetchError(RuntimeError):
    """A price/FX source failed to deliver data."""


class NoDataError(FetchError):
    """The source answered but holds no bars in the requested range.

    Distinct from a fetch failure: the query is valid, the series is just
    outside the range (e.g. --as-of predates the listing). Pairs report
    status `no_data` and the job still exits 0.
    """


# --------------------------------------------------------------------------
# Pure math
# --------------------------------------------------------------------------

def premium_pct(hk_close: float, us_close: float, hkdusd: float, ads_ratio: float) -> float:
    """FX-adjusted HK-over-US premium in percent."""
    if us_close <= 0 or hk_close <= 0 or hkdusd <= 0 or ads_ratio <= 0:
        raise ValueError("closes, FX rate and ads_ratio must be positive")
    return ((hk_close * ads_ratio * hkdusd) / us_close - 1.0) * 100.0


def overnight_gap_pct(
    us_close: float, us_prev_close: float, hk_close: float, hk_prev_close: float
) -> float:
    """Relative drift between the legs' latest (non-overlapping) sessions.

    Difference of the two legs' latest-session returns, in percentage points.
    """
    if us_prev_close <= 0 or hk_prev_close <= 0:
        raise ValueError("previous closes must be positive")
    return ((hk_close / hk_prev_close - 1.0) - (us_close / us_prev_close - 1.0)) * 100.0


def zscore(value: float, history: list[float]) -> Optional[float]:
    """z of `value` vs sample mean/stdev (ddof=1) of `history`.

    None when history has < 2 observations or zero variance.
    """
    if len(history) < 2:
        return None
    sd = statistics.stdev(history)
    if sd == 0.0:
        return None
    return (value - statistics.mean(history)) / sd


def signal_for(z: Optional[float], threshold: float) -> str:
    """hk_rich (HK expensive vs parity) / hk_cheap / none."""
    if z is None:
        return "none"
    if z > threshold:
        return "hk_rich"
    if z < -threshold:
        return "hk_cheap"
    return "none"


def lookup_fx(fx_rates: dict[date, float], d: date) -> tuple[Optional[float], Optional[date], bool]:
    """(rate, rate_date, stale) for session date `d`.

    Exact date wins; otherwise the most recent prior rate is used with
    stale=True; no prior rate at all -> (None, None, False).
    """
    if d in fx_rates:
        return fx_rates[d], d, False
    prior = [k for k in fx_rates if k <= d]
    if not prior:
        return None, None, False
    k = max(prior)
    return fx_rates[k], k, True


# --------------------------------------------------------------------------
# Price providers (per-pair `source` selects one)
# --------------------------------------------------------------------------

def _moomoo_kline_fetch(symbol: str, start: date, end: date, kline_script: Path) -> dict[date, float]:
    if symbol.endswith(".HK"):
        code = "HK." + symbol.split(".")[0].zfill(5)
    else:
        code = f"US.{symbol}"
    cmd = [
        sys.executable, str(kline_script), code,
        "--ktype", "1d", "--start", start.isoformat(), "--end", end.isoformat(),
        "--rehab", "none", "--json",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FetchError(f"moomoo kline {symbol}: {exc}") from exc
    payload = None
    for line in reversed(proc.stdout.splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            candidate = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict) and ("data" in candidate or "error" in candidate):
            payload = candidate
            break
    if payload is None:
        raise FetchError(f"moomoo kline {symbol}: no JSON in stdout (rc={proc.returncode})")
    doc = payload
    if "error" in doc:
        raise FetchError(f"moomoo kline {symbol}: {doc['error']}")
    bars = {}
    for row in doc.get("data", []):
        try:
            d = date.fromisoformat(str(row["time"])[:10])
            bars[d] = float(row["close"])
        except (KeyError, ValueError, TypeError):
            continue
    if not bars:
        raise NoDataError(f"moomoo kline {symbol}: no bars {start}..{end}")
    return bars


class MoomooKlineProvider:
    """Keyless daily closes via the local moomoo OpenD gateway + skill script."""

    id = "moomoo-opend"

    def __init__(self, kline_script: Path = DEFAULT_KLINE_SCRIPT):
        self.kline_script = Path(kline_script)

    def daily_closes(self, symbol: str, start: date, end: date) -> dict[date, float]:
        return _moomoo_kline_fetch(symbol, start, end, self.kline_script)


class YahooChartProvider:
    """Keyless daily closes via Yahoo Finance chart API."""

    id = "yahoo"

    def daily_closes(self, symbol: str, start: date, end: date) -> dict[date, float]:
        p1 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
        p2 = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400
        url = (
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
            f"?period1={p1}&period2={p2}&interval=1d"
        )
        doc = _http_json(url)
        result = (doc.get("chart") or {}).get("result") or []
        if not result:
            raise FetchError(f"yahoo {symbol}: empty chart result")
        res = result[0]
        stamps = res.get("timestamp") or []
        closes = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
        offset = (res.get("meta") or {}).get("gmtoffset", 0)
        tz = timezone(timedelta(seconds=int(offset)))
        bars: dict[date, float] = {}
        for ts, close in zip(stamps, closes):
            if close is None:
                continue
            d = datetime.fromtimestamp(int(ts), tz=tz).date()
            if start <= d <= end:
                bars[d] = float(close)
        if not bars:
            raise NoDataError(f"yahoo {symbol}: no bars {start}..{end}")
        return bars


class FixtureStore:
    """File-based price + FX provider for tests and offline runs.

    <dir>/<symbol>.json   -> {"bars": [{"date": "YYYY-MM-DD", "close": 1.2}, ...]}
    <dir>/fx_hkdusd.json  -> {"rates": [{"date": "YYYY-MM-DD", "rate": 0.128}, ...]}
    """

    id = "fixture"

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def daily_closes(self, symbol: str, start: date, end: date) -> dict[date, float]:
        path = self.directory / f"{symbol}.json"
        if not path.exists():
            raise FetchError(f"fixture price file missing: {path}")
        doc = _read_json_doc(path, f"fixture {symbol}")
        bars = {}
        for row in doc.get("bars", []):
            try:
                d = date.fromisoformat(row["date"])
                close = float(row["close"])
            except (KeyError, ValueError, TypeError):
                continue
            if start <= d <= end:
                bars[d] = close
        if not bars:
            raise NoDataError(f"fixture {symbol}: no bars {start}..{end}")
        return bars

    def daily_rates(self, start: date, end: date) -> dict[date, float]:
        path = self.directory / "fx_hkdusd.json"
        if not path.exists():
            raise FetchError(f"fixture FX file missing: {path}")
        doc = _read_json_doc(path, "fixture FX")
        rates = {}
        for row in doc.get("rates", []):
            d = date.fromisoformat(row["date"])
            if start <= d <= end:
                rates[d] = float(row["rate"])
        return rates


# --------------------------------------------------------------------------
# FX providers
# --------------------------------------------------------------------------

class FrankfurterFxProvider:
    """Keyless HKD->USD daily ECB reference rates (Frankfurter API)."""

    id = "frankfurter"

    def daily_rates(self, start: date, end: date) -> dict[date, float]:
        url = f"https://api.frankfurter.app/{start.isoformat()}..{end.isoformat()}?from=HKD&to=USD"
        doc = _http_json(url)
        if "rates" not in doc:
            raise FetchError(f"frankfurter {start}..{end}: no 'rates' key in response")
        rates: dict[date, float] = {}
        for day, quote in (doc.get("rates") or {}).items():
            if "USD" in quote:
                try:
                    rates[date.fromisoformat(day)] = float(quote["USD"])
                except (KeyError, ValueError, TypeError):
                    continue
        return rates


def _http_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # URLError / HTTPError / JSONDecodeError
        raise FetchError(f"GET {url}: {exc}") from exc


def _read_json_doc(path: Path, label: str) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise FetchError(f"{label}: cannot read {path}: {exc}") from exc


# --------------------------------------------------------------------------
# Pair computation
# --------------------------------------------------------------------------

@dataclass
class Observation:
    pair: str
    date: str
    us_symbol: str
    hk_symbol: str
    ads_ratio: float
    us_close: Optional[float]
    hk_close: Optional[float]
    fx_hkdusd: Optional[float]
    fx_date: Optional[str]
    fx_stale: bool
    premium_pct: Optional[float]
    overnight_gap_pct: Optional[float]
    zscore: Optional[float]
    signal: str


def compute_pair(
    pair: Pair,
    us_closes: dict[date, float],
    hk_closes: dict[date, float],
    fx_rates: dict[date, float],
    *,
    as_of: date,
    window_days: int = DEFAULT_WINDOW_DAYS,
    min_history: int = DEFAULT_MIN_HISTORY,
    z_threshold: float = DEFAULT_Z_THRESHOLD,
    price_source: str = "?",
    fx_source: str = "?",
) -> tuple[list[Observation], dict]:
    """Compute window observations + the latest summary row for one pair."""
    dates = sorted(d for d in (set(us_closes) & set(hk_closes)) if d <= as_of)
    summary: dict = {
        "pair": pair.name,
        "us_symbol": pair.us,
        "hk_symbol": pair.hk,
        "ads_ratio": pair.ads_ratio,
        "price_source": price_source,
        "fx_source": fx_source,
        "as_of": None,
        "us_close": None,
        "hk_close": None,
        "fx_hkdusd": None,
        "fx_date": None,
        "fx_stale": False,
        "premium_pct": None,
        "overnight_gap_pct": None,
        "zscore": None,
        "history_obs": 0,
        "signal": "none",
        "triggered": False,
        "status": "no_data",
        "error": None,
    }
    if not dates:
        return [], summary

    latest = dates[-1]
    obs_dates = [d for d in dates if d >= latest - timedelta(days=window_days)]
    premium_by_date: dict[date, Optional[float]] = {}
    fx_by_date: dict[date, tuple[Optional[float], Optional[date], bool]] = {}
    for d in obs_dates:
        rate, rate_date, stale = lookup_fx(fx_rates, d)
        fx_by_date[d] = (rate, rate_date, stale)
        if rate is None:
            premium_by_date[d] = None
        else:
            premium_by_date[d] = premium_pct(hk_closes[d], us_closes[d], rate, pair.ads_ratio)

    hist_window_start = latest - timedelta(days=window_days)
    history = [
        p for d, p in premium_by_date.items()
        if hist_window_start <= d < latest and p is not None
    ]
    latest_premium = premium_by_date[latest]
    z = (
        zscore(latest_premium, history)
        if latest_premium is not None and len(history) >= min_history
        else None
    )
    signal = signal_for(z, z_threshold)

    prev_candidates = [d for d in dates if d < latest]
    gap = None
    if prev_candidates:
        prev = prev_candidates[-1]
        gap = overnight_gap_pct(
            us_closes[latest], us_closes[prev], hk_closes[latest], hk_closes[prev]
        )

    observations: list[Observation] = []
    for d in obs_dates:
        rate, rate_date, stale = fx_by_date[d]
        is_latest = d == latest
        observations.append(
            Observation(
                pair=pair.name,
                date=d.isoformat(),
                us_symbol=pair.us,
                hk_symbol=pair.hk,
                ads_ratio=pair.ads_ratio,
                us_close=us_closes[d],
                hk_close=hk_closes[d],
                fx_hkdusd=rate,
                fx_date=rate_date.isoformat() if rate_date else None,
                fx_stale=stale,
                premium_pct=premium_by_date[d],
                overnight_gap_pct=gap if is_latest else None,
                zscore=z if is_latest else None,
                signal=signal if is_latest else "none",
            )
        )

    if latest_premium is None:
        status = "fx_missing"
    elif z is None:
        # history too short for the window gate, or zero-variance history
        status = "insufficient_history"
    else:
        status = "ok"
    summary.update(
        as_of=latest.isoformat(),
        us_close=us_closes[latest],
        hk_close=hk_closes[latest],
        fx_hkdusd=fx_by_date[latest][0],
        fx_date=fx_by_date[latest][1].isoformat() if fx_by_date[latest][1] else None,
        fx_stale=fx_by_date[latest][2],
        premium_pct=latest_premium,
        overnight_gap_pct=gap,
        zscore=z,
        history_obs=len(history),
        signal=signal,
        triggered=signal != "none",
        status=status,
    )
    return observations, summary


# --------------------------------------------------------------------------
# SQLite persistence
# --------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    pair TEXT NOT NULL,
    date TEXT NOT NULL,
    us_symbol TEXT NOT NULL,
    hk_symbol TEXT NOT NULL,
    ads_ratio REAL NOT NULL,
    us_close REAL,
    hk_close REAL,
    fx_hkdusd REAL,
    fx_date TEXT,
    fx_stale INTEGER NOT NULL DEFAULT 0,
    premium_pct REAL,
    overnight_gap_pct REAL,
    zscore REAL,
    signal TEXT NOT NULL DEFAULT 'none',
    PRIMARY KEY (pair, date)
);
CREATE TABLE IF NOT EXISTS runs (
    run_at TEXT NOT NULL,
    pair TEXT NOT NULL,
    as_of TEXT,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    detail TEXT
);
"""


def persist(db_path: Path, observations: list[Observation], runs: list[tuple]) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(_SCHEMA)
        conn.executemany(
            """
            INSERT INTO observations (
                pair, date, us_symbol, hk_symbol, ads_ratio, us_close, hk_close,
                fx_hkdusd, fx_date, fx_stale, premium_pct, overnight_gap_pct,
                zscore, signal
            ) VALUES (
                :pair, :date, :us_symbol, :hk_symbol, :ads_ratio, :us_close, :hk_close,
                :fx_hkdusd, :fx_date, :fx_stale, :premium_pct, :overnight_gap_pct,
                :zscore, :signal
            )
            ON CONFLICT(pair, date) DO UPDATE SET
                us_symbol = excluded.us_symbol,
                hk_symbol = excluded.hk_symbol,
                ads_ratio = excluded.ads_ratio,
                us_close = excluded.us_close,
                hk_close = excluded.hk_close,
                fx_hkdusd = excluded.fx_hkdusd,
                fx_date = excluded.fx_date,
                fx_stale = excluded.fx_stale,
                premium_pct = excluded.premium_pct,
                overnight_gap_pct = excluded.overnight_gap_pct,
                zscore = excluded.zscore,
                signal = excluded.signal
            """,
            [{**asdict(o), "fx_stale": int(o.fx_stale)} for o in observations],
        )
        conn.executemany(
            "INSERT INTO runs (run_at, pair, as_of, status, source, detail) VALUES (?, ?, ?, ?, ?, ?)",
            runs,
        )


# --------------------------------------------------------------------------
# Job orchestration
# --------------------------------------------------------------------------

def load_pairs(config_path: Optional[Path], names: Optional[list[str]]) -> list[Pair]:
    if config_path:
        raw = json.loads(Path(config_path).read_text())
        pairs = [
            Pair(
                name=item["name"],
                us=item["us"],
                hk=item["hk"],
                ads_ratio=float(item["ads_ratio"]),
                source=item.get("source", "moomoo-opend"),
            )
            for item in raw
        ]
    else:
        pairs = list(DEFAULT_PAIRS)
    if names:
        wanted = {n.strip() for n in names}
        pairs = [p for p in pairs if p.name in wanted]
        missing = wanted - {p.name for p in pairs}
        if missing:
            raise SystemExit(f"unknown pair(s): {', '.join(sorted(missing))}")
    return pairs


def _fallback_summary(pair: Pair, price_source: str, fx_source: str,
                      status: str, exc: Exception) -> dict:
    """Summary row for a pair that produced no observations."""
    return {
        "pair": pair.name, "us_symbol": pair.us, "hk_symbol": pair.hk,
        "ads_ratio": pair.ads_ratio,
        "price_source": price_source, "fx_source": fx_source,
        "as_of": None, "us_close": None, "hk_close": None,
        "fx_hkdusd": None, "fx_date": None, "fx_stale": False,
        "premium_pct": None, "overnight_gap_pct": None,
        "zscore": None, "history_obs": 0,
        "signal": "none", "triggered": False,
        "status": status, "error": f"{type(exc).__name__}: {exc}",
    }


def run_job(
    pairs: list[Pair],
    *,
    as_of: date,
    fetch_days: int,
    window_days: int,
    min_history: int,
    z_threshold: float,
    price_provider_for: Callable[[Pair], object],
    fx_provider: object,
    db_path: Optional[Path],
    fx_source: str,
) -> dict:
    start = as_of - timedelta(days=fetch_days)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    all_obs: list[Observation] = []
    runs: list[tuple] = []
    summaries: list[dict] = []

    for pair in pairs:
        provider = price_provider_for(pair)
        source = getattr(provider, "id", "?")
        try:
            us_closes = provider.daily_closes(pair.us, start, as_of)
            hk_closes = provider.daily_closes(pair.hk, start, as_of)
            fx_rates = fx_provider.daily_rates(start, as_of)
            obs, summary = compute_pair(
                pair, us_closes, hk_closes, fx_rates,
                as_of=as_of, window_days=window_days, min_history=min_history,
                z_threshold=z_threshold,
                price_source=source,
                fx_source=fx_source,
            )
        except NoDataError as exc:
            summary = _fallback_summary(pair, source, fx_source, "no_data", exc)
            summaries.append(summary)
            runs.append((generated_at, pair.name, None, "no_data", source, summary["error"]))
            _log(f"{pair.name}: no_data {summary['error']}")
            continue
        except FetchError as exc:
            summary = _fallback_summary(pair, source, fx_source, "error", exc)
            summaries.append(summary)
            runs.append((generated_at, pair.name, None, "error", source, summary["error"]))
            _log(f"{pair.name}: ERROR {summary['error']}")
            continue
        except Exception as exc:  # corrupt rows/inputs must not kill the job
            summary = _fallback_summary(pair, source, fx_source, "error", exc)
            summaries.append(summary)
            runs.append((generated_at, pair.name, None, "error", source, summary["error"]))
            _log(f"{pair.name}: ERROR {summary['error']}")
            continue

        all_obs.extend(obs)
        summaries.append(summary)
        runs.append((
            generated_at, pair.name, summary["as_of"], summary["status"],
            source,
            f"premium={summary['premium_pct']} z={summary['zscore']} signal={summary['signal']}",
        ))
        _log(
            f"{pair.name}: status={summary['status']} as_of={summary['as_of']} "
            f"premium={summary['premium_pct']} gap={summary['overnight_gap_pct']} "
            f"z={summary['zscore']} signal={summary['signal']}"
        )

    if db_path is not None:
        persist(db_path, all_obs, runs)

    return {
        "job": "adr_premium",
        "generated_at": generated_at,
        "as_of": as_of.isoformat(),
        "window_days": window_days,
        "z_threshold": z_threshold,
        "min_history": min_history,
        "fx_source": fx_source,
        "db": str(db_path) if db_path is not None else None,
        "pairs": summaries,
    }


def _log(msg: str) -> None:
    print(f"[adr_premium] {msg}", file=sys.stderr)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _fmt(value, nd: int = 4) -> str:
    return "-" if value is None else f"{value:.{nd}f}"


def _parse_date(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"not a YYYY-MM-DD date: {text!r}") from exc


def print_human(result: dict) -> None:
    header = (
        f"ADR/HK premium {result['as_of']}  window={result['window_days']}d "
        f"z>{result['z_threshold']}  fx={result['fx_source']}"
    )
    print(header)
    for s in result["pairs"]:
        print(
            f"  {s['pair']:<5} {s['hk_symbol']:<8} src={s['price_source']:<12} "
            f"status={s['status']:<20} premium={_fmt(s['premium_pct'], 3):>8} "
            f"gap={_fmt(s['overnight_gap_pct'], 3):>8} z={_fmt(s['zscore'], 2):>7} "
            f"signal={s['signal']}"
        )
        if s["error"]:
            print(f"        error: {s['error']}")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="ADR<->HK premium + overnight-gap signal job")
    p.add_argument("--json", action="store_true", help="print one JSON document on stdout")
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite path (default {DEFAULT_DB})")
    p.add_argument("--config", type=Path, default=None, help="pair list JSON (overrides defaults)")
    p.add_argument("--pairs", type=str, default=None, help="comma-separated pair names to run")
    p.add_argument("--source", choices=["moomoo-opend", "yahoo"], default=None,
                   help="force one price provider for all pairs")
    p.add_argument("--fixtures", type=Path, default=None,
                   help="fixture dir for prices + FX (offline runs and tests)")
    p.add_argument("--as-of", type=_parse_date, default=None,
                   help="reference date YYYY-MM-DD (default: today)")
    p.add_argument("--fetch-days", type=int, default=DEFAULT_FETCH_DAYS)
    p.add_argument("--window-days", type=int, default=DEFAULT_WINDOW_DAYS)
    p.add_argument("--z-threshold", type=float, default=DEFAULT_Z_THRESHOLD)
    p.add_argument("--min-history", type=int, default=DEFAULT_MIN_HISTORY)
    p.add_argument("--kline-script", type=Path, default=DEFAULT_KLINE_SCRIPT,
                   help="moomooapi get_kline.py path (moomoo-opend provider)")
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    as_of = args.as_of if args.as_of else datetime.now(timezone.utc).date()
    names = [n for n in (args.pairs or "").split(",") if n.strip()] or None
    pairs = load_pairs(args.config, names)

    if args.fixtures:
        store = FixtureStore(args.fixtures)
        price_provider_for = lambda pair: store  # noqa: E731
        fx_provider = store
        fx_source = "fixture"
    else:
        kline_script = Path(args.kline_script)
        providers = {
            "moomoo-opend": lambda: MoomooKlineProvider(kline_script),
            "yahoo": lambda: YahooChartProvider(),
        }

        def price_provider_for(pair: Pair):
            return providers[args.source or pair.source]()

        fx_provider = FrankfurterFxProvider()
        fx_source = fx_provider.id

    result = run_job(
        pairs,
        as_of=as_of,
        fetch_days=args.fetch_days,
        window_days=args.window_days,
        min_history=args.min_history,
        z_threshold=args.z_threshold,
        price_provider_for=price_provider_for,
        fx_provider=fx_provider,
        db_path=args.db,
        fx_source=fx_source,
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print_human(result)

    return 1 if any(s["status"] == "error" for s in result["pairs"]) else 0


if __name__ == "__main__":
    sys.exit(main())
