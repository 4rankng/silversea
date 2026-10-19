"""Fixture data builders for the adr_premium test suite.

Fixture price/FX series use the FixtureStore schema:
  <dir>/<symbol>.json   -> {"bars": [{"date": "YYYY-MM-DD", "close": ...}, ...]}
  <dir>/fx_hkdusd.json  -> {"rates": [{"date": "YYYY-MM-DD", "rate": ...}, ...]}
"""
import json
from datetime import date, timedelta
from pathlib import Path

AS_OF = date(2026, 3, 20)  # Friday; latest common session for the fixtures
FX_RATE = 0.128
US_CLOSE = 10.0
ADS_RATIO = 1.0


def weekdays_ending(end: date, n: int) -> list[date]:
    """Last n weekdays (Mon-Fri) ending at `end`, ascending."""
    days = []
    d = end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    return sorted(days)


def hk_close_for_premium(premium: float, *, us_close: float = US_CLOSE,
                         ratio: float = ADS_RATIO, fx: float = FX_RATE) -> float:
    """HK close that produces exactly `premium` percent given the other legs."""
    return us_close * (1.0 + premium / 100.0) / (ratio * fx)


def write_price_file(directory: Path, symbol: str, closes: dict[date, float]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "bars": [
            {"date": d.isoformat(), "close": closes[d]}
            for d in sorted(closes)
        ]
    }
    (directory / f"{symbol}.json").write_text(json.dumps(payload))


def write_fx_file(directory: Path, rates: dict[date, float]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    payload = {
        "rates": [
            {"date": d.isoformat(), "rate": rates[d]}
            for d in sorted(rates)
        ]
    }
    (directory / "fx_hkdusd.json").write_text(json.dumps(payload))
