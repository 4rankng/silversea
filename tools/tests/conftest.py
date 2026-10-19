"""Pytest fixtures for the adr_premium test suite (see fixture_data.py)."""
import json
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import adr_premium as ap  # noqa: E402

from fixture_data import (  # noqa: E402
    ADS_RATIO,
    AS_OF,
    FX_RATE,
    US_CLOSE,
    hk_close_for_premium,
    weekdays_ending,
    write_fx_file,
    write_price_file,
)


@pytest.fixture(autouse=True)
def _isolate_default_db(tmp_path, monkeypatch):
    """A test that forgets --db writes to tmp, never the repo research DB."""
    monkeypatch.setattr(ap, "DEFAULT_DB", tmp_path / "forgotten-db-flag.db")


@pytest.fixture
def make_fixtures(tmp_path):
    """Factory writing a fixture dir from a list of target premium values.

    `premiums[i]` is the intended premium (percent) of session i; the HK close
    is derived so `premium_pct` reproduces it exactly. `fx_rates` overrides the
    default FX series (e.g. drop the latest date to exercise stale fallback).
    """

    def _make(tag: str, premiums: list[float], *, us: str = "TESTA", hk: str = "TEST.HK",
              ratio: float = ADS_RATIO, fx_rates: dict[date, float] | None = None,
              us_close: float = US_CLOSE, skip_hk: bool = False) -> Path:
        directory = tmp_path / tag
        days = weekdays_ending(AS_OF, len(premiums))
        closes_us = {d: us_close for d in days}
        closes_hk = {
            d: hk_close_for_premium(p, us_close=us_close, ratio=ratio)
            for d, p in zip(days, premiums)
        }
        write_price_file(directory, us, closes_us)
        if not skip_hk:
            write_price_file(directory, hk, closes_hk)
        write_fx_file(
            directory,
            fx_rates if fx_rates is not None else {d: FX_RATE for d in days},
        )
        return directory

    return _make


@pytest.fixture
def write_config(tmp_path):
    def _write(tag: str, pairs: list[dict]) -> Path:
        path = tmp_path / f"{tag}.json"
        path.write_text(json.dumps(pairs))
        return path

    return _write
