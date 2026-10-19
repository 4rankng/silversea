#!/usr/bin/env python3
"""Prediction-market signal layer on the free public Polymarket Gamma/CLOB APIs (no API key).

What it does
------------
1. Fetches markets by exact slug (Gamma ``/markets?slug=``) and by text search
   (Gamma ``/public-search``), with built-in topic presets covering FOMC odds,
   earnings markets, AI leaderboards and geopolitics.
2. Snapshots every outcome's odds to
   ``research/_polymarket-snapshot-YYYY-MM-DD.md`` and to the SQLite database
   ``research/polymarket.db``.
3. Emits delta alerts only when an outcome moved by >= 5.0 percentage points
   versus the previous snapshot stored in the database.
4. Flags CME FedWatch divergence when computable, i.e. when a FedWatch
   probability source is supplied via ``--fedwatch`` and one of its entries
   matches a fetched market. There is no free public FedWatch API, so the tool
   never scrapes CME; it consumes a small JSON file you export from the CME
   FedWatch tool (see ``--fedwatch``).
5. ``--json`` prints a single JSON document to stdout and nothing else; the
   human-mode report (including error lines) goes to stdout.

The tool has no third-party dependencies (stdlib urllib + sqlite3) and never
requires credentials: Gamma and CLOB are public read-only endpoints.

Usage
-----
    python3 tools/polymarket.py                          # all four topics
    python3 tools/polymarket.py --topic fomc --topic ai  # selected topics
    python3 tools/polymarket.py --slug fed-decision-in-december
    python3 tools/polymarket.py --search "ai leaderboard" --json
    python3 tools/polymarket.py --fedwatch research/fedwatch.json

Exit codes
----------
    0  run completed (per-target failures are reported under "errors")
    1  every fetch target failed (no data fetched)
    2  usage/configuration/local persistence error (argparse, bad --fedwatch
       file, unwritable db/out-dir)

An empty-but-successful API response is NOT a failure: it writes an empty
snapshot and exits 0. When nothing was fetched and at least one request
failed, the previous same-day snapshot file is left untouched.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
USER_AGENT = "polymarket-signal-layer/1.0 (research; public API)"
#: Response bodies are read with this cap so a misbehaving endpoint cannot
#: balloon memory.
MAX_BODY_BYTES = 1_000_000

#: Delta alerts fire only at or beyond this absolute move vs the previous
#: snapshot (percentage points). Spec constant — not configurable.
DEFAULT_DELTA_THRESHOLD_PP = 5.0
#: CME FedWatch divergence flag threshold; same spec constant.
FEDWATCH_DIVERGENCE_THRESHOLD_PP = DEFAULT_DELTA_THRESHOLD_PP

#: Upper bound of CLOB midpoint calls per run (one per outcome token).
CLOB_MAX_CALLS = 24

#: Topic preset -> Gamma search queries. One search HTTP call per query.
TOPICS: dict[str, tuple[str, ...]] = {
    "fomc": ("fomc decision", "fed rate decision"),
    "earnings": ("earnings",),
    "ai": ("ai leaderboard",),
    "geopolitics": ("geopolitics",),
}


# --------------------------------------------------------------------------
# models
# --------------------------------------------------------------------------


@dataclass
class Target:
    """One fetch target: an exact market slug or a free-text search query."""

    kind: str  # "slug" | "search"
    value: str
    topic: str  # preset name or "custom"


@dataclass
class OutcomeOdds:
    outcome: str
    price: float | None = None
    clob_token_id: str | None = None
    clob_midpoint: float | None = None


@dataclass
class Market:
    market_id: str
    slug: str
    question: str
    topic: str
    query: str
    end_date: str | None
    best_bid: float | None
    best_ask: float | None
    volume24hr: float | None
    outcomes: list[OutcomeOdds] = field(default_factory=list)


@dataclass
class FedwatchSource:
    """CME FedWatch probabilities exported to JSON and passed via --fedwatch."""

    source: str
    as_of: str | None
    probabilities: dict[str, dict]
    match: dict[str, str]  # market slug -> probability key


# --------------------------------------------------------------------------
# parsing helpers
# --------------------------------------------------------------------------


def _json_list(value) -> list:
    """Gamma returns list-valued fields as JSON-encoded strings; accept both."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _float_or_none(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _str_or_none(value) -> str | None:
    """Stringify scalars; non-scalar shape drift degrades to None."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _short(value, limit: int = 120) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def parse_gamma_market(raw, *, topic: str, query: str) -> Market | None:
    """Normalize one Gamma market object into :class:`Market`.

    Returns None for unusable rows (not a dict, missing identity, or no
    parseable outcomes). Tolerates shape drift: list fields may arrive as
    lists instead of JSON strings, and prices may be absent.
    """
    if not isinstance(raw, dict):
        return None
    slug = raw.get("slug")
    question = raw.get("question")
    if not slug or not question:
        return None
    outcomes = [str(o) for o in _json_list(raw.get("outcomes"))]
    if not outcomes:
        return None
    prices = _json_list(raw.get("outcomePrices"))
    tokens = _json_list(raw.get("clobTokenIds"))
    odds = []
    for i, name in enumerate(outcomes):
        odds.append(
            OutcomeOdds(
                outcome=name,
                price=_float_or_none(prices[i]) if i < len(prices) else None,
                clob_token_id=(
                    str(tokens[i]) if i < len(tokens) and tokens[i] is not None else None
                ),
            )
        )
    return Market(
        market_id=str(raw.get("id") or raw.get("conditionId") or slug),
        slug=str(slug),
        question=str(question),
        topic=topic,
        query=query,
        end_date=_str_or_none(raw.get("endDate")),
        best_bid=_float_or_none(raw.get("bestBid")),
        best_ask=_float_or_none(raw.get("bestAsk")),
        volume24hr=_float_or_none(raw.get("volume24hr")),
        outcomes=odds,
    )


def iter_market_dicts(payload) -> list:
    """Extract raw market objects from any known Gamma response shape."""
    if isinstance(payload, list):
        return [m for m in payload if isinstance(m, dict)]
    if isinstance(payload, dict):
        found = []
        for key in ("markets", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                found.extend(m for m in value if isinstance(m, dict))
        events = payload.get("events")
        if isinstance(events, list):
            for event in events:
                if isinstance(event, dict) and isinstance(event.get("markets"), list):
                    found.extend(m for m in event["markets"] if isinstance(m, dict))
        return found
    return []


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


def request_json(url: str, *, timeout: float = 20.0) -> tuple[int | None, object]:
    """GET ``url`` and parse JSON.

    Returns ``(status, payload)``: HTTP responses (including 429) come back
    with their status and best-effort parsed body; transport failures return
    ``(None, detail)``. Never raises for network problems so callers can
    record the failure and continue with other targets.
    """
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(MAX_BODY_BYTES).decode("utf-8", "replace")
            status = getattr(response, "status", None) or 200
    except urllib.error.HTTPError as exc:
        body = exc.read(MAX_BODY_BYTES).decode("utf-8", "replace")
        try:
            return exc.code, json.loads(body)
        except ValueError:
            return exc.code, body[:200]
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return None, f"{type(exc).__name__}: {exc}"
    try:
        return status, json.loads(body)
    except ValueError:
        return status, body[:200]


# --------------------------------------------------------------------------
# collection
# --------------------------------------------------------------------------


def build_targets(
    topics: list[str] | None, slugs: list[str] | None, searches: list[str] | None
) -> list[Target]:
    if not (topics or slugs or searches):
        topics = list(TOPICS)
    targets: list[Target] = []
    for topic in topics or []:
        for query in TOPICS[topic]:
            targets.append(Target("search", query, topic))
    for slug in slugs or []:
        targets.append(Target("slug", slug, "custom"))
    for query in searches or []:
        targets.append(Target("search", query, "custom"))
    return targets


def collect_markets(
    targets: list[Target], *, fetch=None, timeout: float = 20.0, limit: int = 6
) -> tuple[list[Market], list[dict]]:
    """Fetch every target; first-seen market wins on slug collisions.

    Per-target failures (429, transport, bad payload) are recorded in the
    returned error list and never abort the rest of the run.
    """
    fetch = fetch or request_json
    by_slug: dict[str, Market] = {}
    errors: list[dict] = []
    for target in targets:
        if target.kind == "slug":
            url = f"{GAMMA_BASE}/markets?slug={urllib.parse.quote(target.value, safe='')}"
            kind = "gamma_slug"
        else:
            url = (
                f"{GAMMA_BASE}/public-search?q={urllib.parse.quote(target.value, safe='')}"
                f"&limit_per_type={int(limit)}"
            )
            kind = "gamma_search"
        status, payload = fetch(url, timeout=timeout)
        if status != 200:
            errors.append(
                {
                    "kind": kind,
                    "target": target.value,
                    "status": status,
                    "detail": _short(payload),
                }
            )
            continue
        if not isinstance(payload, (list, dict)):
            errors.append(
                {
                    "kind": kind,
                    "target": target.value,
                    "status": status,
                    "detail": f"unparseable payload: {_short(payload)}",
                }
            )
            continue
        for raw in iter_market_dicts(payload):
            market = parse_gamma_market(raw, topic=target.topic, query=target.value)
            if market is not None and market.slug not in by_slug:
                by_slug[market.slug] = market
    return list(by_slug.values()), errors


def enrich_clob_midpoints(
    markets: list[Market], *, fetch=None, timeout: float = 20.0
) -> tuple[list[dict], int, bool]:
    """Fill outcome midpoints from CLOB ``/midpoint`` (best-effort, capped).

    429s and other failures degrade to ``clob_midpoint=None`` for that token
    and are recorded; the Gamma-derived price is kept regardless. Returns
    ``(errors, calls, truncated)``; ``truncated`` is True when the
    ``CLOB_MAX_CALLS`` budget stopped the sweep early.
    """
    fetch = fetch or request_json
    errors: list[dict] = []
    calls = 0
    for market in markets:
        for outcome in market.outcomes:
            if calls >= CLOB_MAX_CALLS:
                return errors, calls, True
            if not outcome.clob_token_id:
                continue
            calls += 1
            url = (
                f"{CLOB_BASE}/midpoint?token_id="
                f"{urllib.parse.quote(outcome.clob_token_id, safe='')}"
            )
            status, payload = fetch(url, timeout=timeout)
            if status == 200 and isinstance(payload, dict):
                outcome.clob_midpoint = _float_or_none(payload.get("mid"))
            else:
                errors.append(
                    {
                        "kind": "clob_midpoint",
                        "target": outcome.clob_token_id,
                        "status": status,
                        "detail": _short(payload),
                    }
                )
    return errors, calls, False


# --------------------------------------------------------------------------
# FedWatch
# --------------------------------------------------------------------------


def load_fedwatch(path: Path) -> FedwatchSource:
    """Load a CME FedWatch export.

    Expected JSON shape::

        {
          "source": "CME FedWatch Tool",
          "as_of": "2026-10-18",
          "probabilities": {
            "25bp-cut": {"prob": 0.42, "meeting": "2026-12-10",
                         "outcome": "Yes", "label": "25 bp cut"}
          },
          "match": {"fed-decision-in-december": "25bp-cut"}
        }

    ``match`` maps market slug -> probability key; the compared price is the
    market outcome named by that entry's ``outcome`` field ("Yes" by default).
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("fedwatch file must contain a JSON object")
    probabilities = payload.get("probabilities") or {}
    match = payload.get("match") or {}
    if not isinstance(probabilities, dict) or not isinstance(match, dict):
        raise ValueError("fedwatch probabilities/match must be JSON objects")
    for key, entry in probabilities.items():
        if not isinstance(entry, dict):
            raise ValueError(f"fedwatch probabilities[{key!r}] must be an object")
        if "prob" in entry:
            prob = _float_or_none(entry.get("prob"))
            if prob is None or not 0.0 <= prob <= 1.0:
                raise ValueError(
                    f"fedwatch probabilities[{key!r}].prob must be a probability in [0, 1]"
                )
    return FedwatchSource(
        source=str(payload.get("source") or "CME FedWatch"),
        as_of=payload.get("as_of"),
        probabilities=probabilities,
        match={str(k): str(v) for k, v in match.items()},
    )


def apply_fedwatch(
    rows: list[dict], fedwatch: FedwatchSource | None, *, threshold_pp: float
) -> str:
    """Annotate outcome rows with FedWatch comparison; return run status.

    Status is ``"computed"`` when at least one market matched a FedWatch
    probability, otherwise ``"not_computable"`` — divergence is only flagged
    when the comparison can actually be made.
    """
    if fedwatch is None:
        return "not_computable"
    matched = 0
    for row in rows:
        row.setdefault("fedwatch_prob", None)
        row.setdefault("fedwatch_delta_pp", None)
        row.setdefault("fedwatch_flag", False)
        key = fedwatch.match.get(row["slug"])
        entry = fedwatch.probabilities.get(key) if key else None
        prob = _float_or_none(entry.get("prob")) if isinstance(entry, dict) else None
        if prob is None:
            continue
        outcome_name = str((entry or {}).get("outcome") or "Yes")
        if row["outcome"] != outcome_name or row["price"] is None:
            continue
        matched += 1
        delta_raw = (row["price"] - prob) * 100.0
        row["fedwatch_prob"] = prob
        row["fedwatch_delta_pp"] = round(delta_raw, 2)
        row["fedwatch_flag"] = abs(delta_raw) >= threshold_pp - 1e-9
    return "computed" if matched else "not_computable"


# --------------------------------------------------------------------------
# persistence + reporting
# --------------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL,
    run_date TEXT NOT NULL,
    targets TEXT NOT NULL,
    market_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS odds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES runs(id),
    slug TEXT NOT NULL,
    market_id TEXT NOT NULL,
    question TEXT NOT NULL,
    topic TEXT NOT NULL,
    query TEXT NOT NULL,
    outcome TEXT NOT NULL,
    price REAL,
    best_bid REAL,
    best_ask REAL,
    clob_midpoint REAL,
    end_date TEXT,
    prev_price REAL,
    delta_pp REAL,
    alert INTEGER NOT NULL DEFAULT 0,
    fedwatch_prob REAL,
    fedwatch_delta_pp REAL,
    fedwatch_flag INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS odds_slug_outcome ON odds(slug, outcome);
CREATE INDEX IF NOT EXISTS odds_run ON odds(run_id);
"""


def _connect_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript(_SCHEMA)
    return conn


def _prev_prices(db_path: Path, rows: list[dict]) -> dict:
    """Latest stored price per (slug, outcome) from all runs before this one.

    Must be called before :func:`_persist` inserts the current run's rows.
    """
    conn = _connect_db(db_path)
    try:
        prev: dict[tuple[str, str], float] = {}
        for row in rows:
            key = (row["slug"], row["outcome"])
            if key in prev:
                continue
            got = conn.execute(
                "SELECT price FROM odds"
                " WHERE slug = ? AND outcome = ? AND price IS NOT NULL"
                " ORDER BY run_id DESC, id DESC LIMIT 1",
                (row["slug"], row["outcome"]),
            ).fetchone()
            if got is not None:
                prev[key] = got[0]
        return prev
    finally:
        conn.close()


def _apply_deltas(rows: list[dict], prev: dict) -> None:
    """Fill ``prev_price``/``delta_pp``/``alert`` on each row.

    The alert gate compares the raw delta against
    ``DEFAULT_DELTA_THRESHOLD_PP`` (minus float epsilon); ``delta_pp`` keeps
    two decimals for display/storage only.
    """
    for row in rows:
        price = row["price"]
        prev_price = prev.get((row["slug"], row["outcome"]))
        if prev_price is not None:
            row["prev_price"] = prev_price
        if price is None or prev_price is None:
            continue
        delta_raw = (price - prev_price) * 100.0
        row["prev_price"] = prev_price
        row["delta_pp"] = round(delta_raw, 2)
        row["alert"] = abs(delta_raw) >= DEFAULT_DELTA_THRESHOLD_PP - 1e-9


def _persist(db_path: Path, run: dict, rows: list[dict]) -> int:
    """Insert the run row and its odds rows; returns the new run id."""
    conn = _connect_db(db_path)
    try:
        cur = conn.execute(
            "INSERT INTO runs (taken_at, run_date, targets, market_count) VALUES (?, ?, ?, ?)",
            (
                run["taken_at"],
                run["run_date"],
                json.dumps(run["targets"]),
                run["market_count"],
            ),
        )
        run_id = int(cur.lastrowid)
        for row in rows:
            conn.execute(
                "INSERT INTO odds (run_id, slug, market_id, question, topic, query,"
                " outcome, price, best_bid, best_ask, clob_midpoint, end_date,"
                " prev_price, delta_pp, alert, fedwatch_prob, fedwatch_delta_pp,"
                " fedwatch_flag) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    run_id,
                    row["slug"],
                    row["market_id"],
                    row["question"],
                    row["topic"],
                    row["query"],
                    row["outcome"],
                    row["price"],
                    row["best_bid"],
                    row["best_ask"],
                    row["clob_midpoint"],
                    row["end_date"],
                    row["prev_price"],
                    row["delta_pp"],
                    1 if row["alert"] else 0,
                    row["fedwatch_prob"],
                    row["fedwatch_delta_pp"],
                    1 if row["fedwatch_flag"] else 0,
                ),
            )
        conn.commit()
        return run_id
    finally:
        conn.close()


def _fmt_price(value: float | None) -> str:
    return "—" if value is None else f"{value:.3f}"


def _cell(value: str) -> str:
    """Make a value safe for a markdown table cell / list item."""
    return value.replace("|", "/").replace("\n", " ")


def _fmt_delta(value: float | None, alert: bool = False) -> str:
    if value is None:
        return "—"
    sign = "+" if value >= 0 else ""
    return f"{sign}{value:.1f}pp" + (" ALERT" if alert else "")


def render_markdown(run: dict, rows: list[dict], fedwatch_status: str) -> str:
    lines = [
        f"# Polymarket snapshot — {run['run_date']}",
        "",
        f"Run: {run['taken_at']} · markets: {run['market_count']} · "
        f"outcomes: {len(rows)} · targets: {len(run['targets'])}",
        "",
        "| Market | Slug | Outcome | Price | Prev | Δ pp | CLOB mid |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        lines.append(
            "| {question} | {slug} | {outcome} | {price} | {prev} | {delta} | {mid} |".format(
                question=_cell(row["question"]),
                slug=row["slug"],
                outcome=_cell(row["outcome"]),
                price=_fmt_price(row["price"]),
                prev=_fmt_price(row["prev_price"]),
                delta=_fmt_delta(row["delta_pp"], row["alert"]),
                mid=_fmt_price(row["clob_midpoint"]),
            )
        )
    alerts = [row for row in rows if row["alert"]]
    lines += ["", f"## Delta alerts (≥{DEFAULT_DELTA_THRESHOLD_PP:.1f}pp vs previous snapshot)", ""]
    if alerts:
        for row in alerts:
            lines.append(
                f"- {_fmt_delta(row['delta_pp'], True)} — {_cell(row['question'])} / "
                f"{_cell(row['outcome'])}: {_fmt_price(row['prev_price'])} → {_fmt_price(row['price'])}"
            )
    else:
        lines.append("- None.")
    lines += ["", "## CME FedWatch divergence", ""]
    if fedwatch_status == "not_computable":
        lines.append("- not computable (no matching FedWatch source; pass `--fedwatch`)")
    else:
        flagged = [row for row in rows if row["fedwatch_flag"]]
        if flagged:
            for row in flagged:
                lines.append(
                    f"- FLAG {_fmt_delta(row['fedwatch_delta_pp'])} — {_cell(row['question'])} / "
                    f"{_cell(row['outcome'])}: polymarket {_fmt_price(row['price'])} vs "
                    f"fedwatch {_fmt_price(row['fedwatch_prob'])}"
                )
        else:
            lines.append("- computed; no divergence beyond threshold.")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------


def run(
    args: argparse.Namespace,
    *,
    fetch=None,
    now: datetime | None = None,
) -> dict:
    """Execute one snapshot run; returns the JSON-ready report dict."""
    now = now or datetime.now(timezone.utc)
    taken_at = now.replace(microsecond=0).isoformat().replace("+00:00", "Z")
    run_date = args.date or now.date().isoformat()
    out_dir = Path(args.out_dir)
    db_path = Path(args.db) if args.db else out_dir / "polymarket.db"
    snapshot_path = out_dir / f"_polymarket-snapshot-{run_date}.md"

    targets = build_targets(args.topic, args.slug, args.search)
    markets, errors = collect_markets(
        targets, fetch=fetch, timeout=args.timeout, limit=args.limit
    )
    clob_calls = 0
    clob_truncated = False
    if not args.no_clob and markets:
        clob_errors, clob_calls, clob_truncated = enrich_clob_midpoints(
            markets, fetch=fetch, timeout=args.timeout
        )
        errors.extend(clob_errors)

    fedwatch = None
    if args.fedwatch:
        fedwatch = load_fedwatch(Path(args.fedwatch))

    rows: list[dict] = []
    for market in markets:
        for outcome in market.outcomes:
            rows.append(
                {
                    "slug": market.slug,
                    "market_id": market.market_id,
                    "question": market.question,
                    "topic": market.topic,
                    "query": market.query,
                    "outcome": outcome.outcome,
                    "price": outcome.price,
                    "best_bid": market.best_bid,
                    "best_ask": market.best_ask,
                    "clob_midpoint": outcome.clob_midpoint,
                    "end_date": market.end_date,
                    "prev_price": None,
                    "delta_pp": None,
                    "alert": False,
                    "fedwatch_prob": None,
                    "fedwatch_delta_pp": None,
                    "fedwatch_flag": False,
                }
            )
    fedwatch_status = apply_fedwatch(
        rows, fedwatch, threshold_pp=FEDWATCH_DIVERGENCE_THRESHOLD_PP
    )

    run_meta = {
        "taken_at": taken_at,
        "run_date": run_date,
        "targets": [{"kind": t.kind, "value": t.value, "topic": t.topic} for t in targets],
        "market_count": len(markets),
    }
    _apply_deltas(rows, _prev_prices(db_path, rows))
    _persist(db_path, run_meta, rows)

    gamma_failures = sum(
        1 for e in errors if e["kind"] in ("gamma_slug", "gamma_search")
    )
    all_targets_failed = bool(targets) and gamma_failures == len(targets)
    # Nothing fetched plus at least one failure keeps any earlier same-day
    # snapshot instead of clobbering it with an empty one.
    wrote_snapshot = not (not markets and errors)
    if wrote_snapshot:
        out_dir.mkdir(parents=True, exist_ok=True)
        snapshot_path.write_text(
            render_markdown(run_meta, rows, fedwatch_status), encoding="utf-8"
        )

    by_slug: dict[str, dict] = {}
    for row in rows:
        entry = by_slug.setdefault(
            row["slug"],
            {
                "slug": row["slug"],
                "market_id": row["market_id"],
                "question": row["question"],
                "topic": row["topic"],
                "query": row["query"],
                "end_date": row["end_date"],
                "outcomes": [],
            },
        )
        entry["outcomes"].append(
            {
                "outcome": row["outcome"],
                "price": row["price"],
                "prev_price": row["prev_price"],
                "delta_pp": row["delta_pp"],
                "alert": row["alert"],
                "clob_midpoint": row["clob_midpoint"],
                "fedwatch_prob": row["fedwatch_prob"],
                "fedwatch_delta_pp": row["fedwatch_delta_pp"],
                "fedwatch_flag": row["fedwatch_flag"],
            }
        )
    alerts = [
        {
            "slug": row["slug"],
            "question": row["question"],
            "outcome": row["outcome"],
            "prev_price": row["prev_price"],
            "price": row["price"],
            "delta_pp": row["delta_pp"],
        }
        for row in rows
        if row["alert"]
    ]
    return {
        "run": {
            "taken_at": taken_at,
            "run_date": run_date,
            "targets": run_meta["targets"],
            "market_count": len(markets),
            "outcome_count": len(rows),
            "db": str(db_path),
            "snapshot_file": str(snapshot_path) if wrote_snapshot else None,
            "clob_calls": clob_calls,
            "clob_truncated": clob_truncated,
            "all_targets_failed": all_targets_failed,
        },
        "markets": list(by_slug.values()),
        "alerts": alerts,
        "fedwatch": {
            "status": fedwatch_status,
            "source": fedwatch.source if fedwatch else None,
            "as_of": fedwatch.as_of if fedwatch else None,
            "threshold_pp": FEDWATCH_DIVERGENCE_THRESHOLD_PP,
        },
        "errors": errors,
    }


def _print_human(report: dict) -> None:
    run_info = report["run"]
    print(
        f"polymarket snapshot {run_info['run_date']} — {run_info['market_count']} markets, "
        f"{run_info['outcome_count']} outcomes, {len(run_info['targets'])} targets"
    )
    for market in report["markets"]:
        print(f"  {market['slug']}  “{market['question']}”")
        for outcome in market["outcomes"]:
            flags = []
            if outcome["alert"]:
                flags.append("ALERT")
            if outcome["fedwatch_flag"]:
                flags.append("FEDWATCH-DIVERGENCE")
            suffix = f" [{' '.join(flags)}]" if flags else ""
            print(
                f"    {outcome['outcome']:<5} {_fmt_price(outcome['price'])} "
                f"(prev {_fmt_price(outcome['prev_price'])}, "
                f"{_fmt_delta(outcome['delta_pp'])}){suffix}"
            )
    print(
        f"delta alerts (≥{DEFAULT_DELTA_THRESHOLD_PP:.1f}pp): {len(report['alerts'])}"
    )
    fed = report["fedwatch"]
    if fed["status"] == "computed":
        print(f"fedwatch: computed ({fed['source']}, as_of {fed['as_of']})")
    else:
        print("fedwatch: not computable (no matching FedWatch source; pass --fedwatch)")
    if report["errors"]:
        print(f"errors: {len(report['errors'])}")
        for err in report["errors"]:
            print(f"  {err['kind']} {err['target']}: status {err['status']} — {err['detail']}")
    if report["run"]["clob_truncated"]:
        print(
            f"clob: midpoint enrichment truncated at {report['run']['clob_calls']} calls"
        )
    if report["run"]["snapshot_file"]:
        print(f"wrote {report['run']['snapshot_file']}")
    print(f"wrote {report['run']['db']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="polymarket.py",
        description="Snapshot Polymarket odds (free Gamma/CLOB APIs, no key) with "
        "delta alerts and CME FedWatch divergence flags.",
    )
    parser.add_argument(
        "--topic",
        action="append",
        choices=sorted(TOPICS),
        help="topic preset (repeatable; default: all topics when no target given)",
    )
    parser.add_argument(
        "--slug", action="append", metavar="SLUG", help="fetch market by exact slug (repeatable)"
    )
    parser.add_argument(
        "--search", action="append", metavar="QUERY", help="free-text market search (repeatable)"
    )
    parser.add_argument(
        "--json", action="store_true", help="print a single JSON report to stdout (nothing else)"
    )
    parser.add_argument(
        "--out-dir", default="research", help="snapshot directory (default: research)"
    )
    parser.add_argument(
        "--db", default=None, help="SQLite path (default: <out-dir>/polymarket.db)"
    )
    parser.add_argument(
        "--fedwatch",
        metavar="PATH",
        help="CME FedWatch probabilities JSON export for divergence flagging",
    )
    parser.add_argument(
        "--limit", type=int, default=6, help="max events per search query (default: 6)"
    )
    parser.add_argument(
        "--timeout", type=float, default=20.0, help="per-request timeout seconds (default: 20)"
    )
    parser.add_argument(
        "--no-clob", action="store_true", help="skip CLOB midpoint enrichment"
    )
    parser.add_argument(
        "--date", metavar="YYYY-MM-DD", default=None,
        help="override the snapshot date used in the file name (default: UTC today)",
    )
    args = parser.parse_args(argv)
    if args.date:
        try:
            parsed_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            parsed_date = None
        if parsed_date is None or parsed_date.isoformat() != args.date:
            parser.error("--date must be YYYY-MM-DD (zero-padded)")
    if args.limit < 1:
        parser.error("--limit must be >= 1")

    try:
        report = run(args)
    except (ValueError, OSError, sqlite3.Error) as exc:
        print(f"polymarket.py: error: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_human(report)
    return 1 if report["run"]["all_targets_failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
