"""adr_premium regression cases (see testplan/2026-10-18-adr-premium-signal-job.md).

AP-01 FX-adjusted premium math        AP-06 FX absent -> fx_missing degrade
AP-02 overnight-gap proxy math        AP-07 insufficient history -> no signal
AP-03 z-score signal both directions  AP-08 --json pure stdout + SQLite upsert
AP-04 strict threshold boundary       AP-09 custom config pair list
AP-05 FX missing date -> stale flag   AP-10 fetch error -> exit 1
"""
import json
import sqlite3
import statistics

import pytest

import adr_premium as ap
from fixture_data import AS_OF, FX_RATE, weekdays_ending


# ---------------------------------------------------------------- pure math

def test_ap01_premium_pct_fx_adjusted():
    # HK 80 HKD x 8 ordinary shares/ADR = 81.92 USD vs US 85 USD
    assert ap.premium_pct(80.0, 85.0, 0.128, 8) == pytest.approx(-3.6235294, rel=1e-6)
    assert ap.premium_pct(80.0, 81.92, 0.128, 8) == pytest.approx(0.0, abs=1e-12)


def test_ap01_premium_pct_rejects_nonpositive():
    with pytest.raises(ValueError):
        ap.premium_pct(0.0, 85.0, 0.128, 8)
    with pytest.raises(ValueError):
        ap.premium_pct(80.0, -1.0, 0.128, 8)
    with pytest.raises(ValueError):
        ap.premium_pct(80.0, 85.0, 0.0, 8)


def test_ap02_overnight_gap_pct():
    # US +10% session, HK +2% session -> relative drift -8 percentage points
    assert ap.overnight_gap_pct(11.0, 10.0, 20.4, 20.0) == pytest.approx(-8.0)
    assert ap.overnight_gap_pct(10.0, 10.0, 20.0, 20.0) == pytest.approx(0.0)


def test_ap03_zscore_sample_statistics():
    history = [1.0, 2.0, 3.0, 4.0]  # mean 2.5, sample sd sqrt(5/3)
    assert ap.zscore(5.0, history) == pytest.approx(1.9364917, rel=1e-6)
    assert ap.zscore(6.0, history) == pytest.approx(2.7110883, rel=1e-6)
    assert ap.zscore(0.0, history) == pytest.approx(-1.9364917, rel=1e-6)


def test_ap03_zscore_degenerate_history():
    assert ap.zscore(2.0, [2.0]) is None       # fewer than 2 observations
    assert ap.zscore(2.0, []) is None
    assert ap.zscore(2.0, [2.0, 2.0, 2.0]) is None  # zero variance


def test_ap04_signal_threshold_is_strict():
    # history [1,2,3]: mean 2, sample sd 1 -> z(4) == 2.0 exactly
    assert ap.signal_for(ap.zscore(4.0, [1.0, 2.0, 3.0]), 2.0) == "none"
    assert ap.signal_for(ap.zscore(0.0, [1.0, 2.0, 3.0]), 2.0) == "none"
    assert ap.signal_for(ap.zscore(5.0, [1.0, 2.0, 3.0]), 2.0) == "hk_rich"
    assert ap.signal_for(ap.zscore(-1.0, [1.0, 2.0, 3.0]), 2.0) == "hk_cheap"
    assert ap.signal_for(None, 2.0) == "none"


def test_ap05_lookup_fx_exact_stale_missing():
    day = AS_OF
    prev = weekdays_ending(AS_OF, 2)[0]
    assert ap.lookup_fx({day: 0.128}, day) == (0.128, day, False)
    assert ap.lookup_fx({prev: 0.127}, day) == (0.127, prev, True)
    assert ap.lookup_fx({}, day) == (None, None, False)
    # no rate at or before the queried date
    assert ap.lookup_fx({day: 0.128}, prev) == (None, None, False)


def test_pair_code_derivation():
    pair = ap.Pair(name="BABA", us="BABA", hk="9988.HK", ads_ratio=8)
    assert pair.us_code == "US.BABA"
    assert pair.hk_code == "HK.09988"
    assert ap.Pair(name="WRD", us="WRD", hk="0800.HK", ads_ratio=3).hk_code == "HK.00800"


# ------------------------------------------------------------- end-to-end

SPIKE_PREMIUMS = [-0.1, 0.1] * 11 + [3.0]  # 23 sessions, last one rich
DIP_PREMIUMS = [-0.1, 0.1] * 11 + [-3.0]   # 23 sessions, last one cheap


def _run(args, capsys):
    rc = ap.main(args)
    out = capsys.readouterr().out
    return rc, out


def test_ap08_signal_json_stdout_purity_and_sqlite(make_fixtures, write_config, tmp_path, capsys):
    fixtures = make_fixtures("spike", SPIKE_PREMIUMS, us="UPU", hk="UP.HK")
    config = write_config("up", [{"name": "UP", "us": "UPU", "hk": "UP.HK",
                                  "ads_ratio": 1.0, "source": "fixture"}])
    db = tmp_path / "research" / "adr_premium.db"

    rc, out = _run(["--json", "--db", str(db), "--config", str(config),
                    "--fixtures", str(fixtures), "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 0
    doc = json.loads(out)  # pure stdout: exactly one parseable JSON document
    assert doc["job"] == "adr_premium"
    (summary,) = doc["pairs"]
    assert summary["pair"] == "UP"
    assert summary["status"] == "ok"
    assert summary["as_of"] == AS_OF.isoformat()
    assert summary["price_source"] == "fixture"
    assert summary["fx_source"] == "fixture"
    assert summary["premium_pct"] == pytest.approx(3.0, abs=1e-9)
    assert summary["overnight_gap_pct"] is not None
    assert summary["zscore"] > 2.0
    assert summary["signal"] == "hk_rich"
    assert summary["triggered"] is True
    assert summary["history_obs"] == 22

    with sqlite3.connect(db) as conn:
        rows = conn.execute(
            "SELECT date, premium_pct, zscore, signal FROM observations WHERE pair='UP' ORDER BY date"
        ).fetchall()
    assert len(rows) == 23
    assert rows[-1][0] == AS_OF.isoformat()
    assert rows[-1][1] == pytest.approx(3.0, abs=1e-9)
    assert rows[-1][3] == "hk_rich"


def test_ap03_end_to_end_signal_directions(make_fixtures, write_config, tmp_path, capsys):
    up = make_fixtures("up", SPIKE_PREMIUMS, us="UPU", hk="UP.HK")
    dn = make_fixtures("dn", DIP_PREMIUMS, us="DNU", hk="DN.HK")
    config = write_config("both", [
        {"name": "UP", "us": "UPU", "hk": "UP.HK", "ads_ratio": 1.0, "source": "fixture"},
        {"name": "DN", "us": "DNU", "hk": "DN.HK", "ads_ratio": 1.0, "source": "fixture"},
    ])
    # config pairs need one fixture dir; merge both symbols into `up`
    (up / "DNU.json").write_bytes((dn / "DNU.json").read_bytes())
    (up / "DN.HK.json").write_bytes((dn / "DN.HK.json").read_bytes())

    rc, out = _run(["--json", "--db", str(tmp_path / "both.db"), "--config", str(config),
                    "--fixtures", str(up), "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 0
    by_name = {p["pair"]: p for p in json.loads(out)["pairs"]}
    assert by_name["UP"]["signal"] == "hk_rich"
    assert by_name["UP"]["zscore"] > 2.0
    assert by_name["DN"]["signal"] == "hk_cheap"
    assert by_name["DN"]["zscore"] < -2.0
    assert by_name["DN"]["premium_pct"] == pytest.approx(-3.0, abs=1e-9)


def test_ap09_pairs_filter_selects_subset(make_fixtures, write_config, tmp_path, capsys):
    fixtures = make_fixtures("multi", SPIKE_PREMIUMS, us="UPU", hk="UP.HK")
    config = write_config("cfg9", [
        {"name": "UP", "us": "UPU", "hk": "UP.HK", "ads_ratio": 1.0, "source": "fixture"},
        {"name": "OTHER", "us": "NOPE", "hk": "NOPE.HK", "ads_ratio": 1.0, "source": "fixture"},
    ])
    rc, out = _run(["--json", "--db", str(tmp_path / "filter.db"), "--pairs", "UP",
                    "--config", str(config), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)
    assert rc == 0
    assert [p["pair"] for p in json.loads(out)["pairs"]] == ["UP"]


def test_ap05_fx_missing_date_degrades_to_stale_rate(make_fixtures, capsys, tmp_path):
    days = weekdays_ending(AS_OF, 23)
    fx_without_latest = {d: FX_RATE for d in days[:-1]}  # latest session has no ECB print
    fixtures = make_fixtures("fxgap", SPIKE_PREMIUMS, us="UPU", hk="UP.HK",
                             fx_rates=fx_without_latest)
    db = tmp_path / "gap.db"
    rc, out = _run(["--json", "--db", str(db), "--pairs", "UP",
                    "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 0
    (summary,) = json.loads(out)["pairs"]
    assert summary["status"] == "ok"
    assert summary["fx_stale"] is True
    assert summary["fx_date"] == days[-2].isoformat()
    assert summary["premium_pct"] == pytest.approx(3.0, abs=1e-9)
    assert summary["signal"] == "hk_rich"


def test_ap06_fx_absent_degrades_without_premium(make_fixtures, capsys, tmp_path):
    fixtures = make_fixtures("fxnone", SPIKE_PREMIUMS, us="UPU", hk="UP.HK", fx_rates={})
    rc, out = _run(["--json", "--db", str(tmp_path / "fxnone.db"), "--pairs", "UP",
                    "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 0  # degrade, not crash
    (summary,) = json.loads(out)["pairs"]
    assert summary["status"] == "fx_missing"
    assert summary["premium_pct"] is None
    assert summary["zscore"] is None
    assert summary["signal"] == "none"
    assert summary["triggered"] is False


def test_ap07_insufficient_history_blocks_signal(make_fixtures, capsys, tmp_path):
    short = [-0.1, 0.1, -0.1, 0.1, -0.1, 3.0]  # 6 sessions < min_history 10
    fixtures = make_fixtures("short", short, us="UPU", hk="UP.HK")
    rc, out = _run(["--json", "--db", str(tmp_path / "short.db"), "--pairs", "UP",
                    "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 0
    (summary,) = json.loads(out)["pairs"]
    assert summary["status"] == "insufficient_history"
    assert summary["premium_pct"] == pytest.approx(3.0, abs=1e-9)  # premium still computed
    assert summary["zscore"] is None
    assert summary["signal"] == "none"


def test_ap10_fetch_error_marks_pair_and_exits_1(make_fixtures, capsys, tmp_path):
    fixtures = make_fixtures("broken", SPIKE_PREMIUMS, us="UPU", hk="UP.HK", skip_hk=True)
    rc, out = _run(["--json", "--db", str(tmp_path / "broken.db"), "--pairs", "UP",
                    "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)

    assert rc == 1
    (summary,) = json.loads(out)["pairs"]
    assert summary["status"] == "error"
    assert "UP.HK.json" in summary["error"]


def test_ap08_sqlite_upsert_is_idempotent(make_fixtures, capsys, tmp_path):
    fixtures = make_fixtures("idem", SPIKE_PREMIUMS, us="UPU", hk="UP.HK")
    db = tmp_path / "idem.db"
    args = ["--json", "--db", str(db), "--pairs", "UP",
            "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
            "--as-of", AS_OF.isoformat()]
    _run(args, capsys)
    _run(args, capsys)

    with sqlite3.connect(db) as conn:
        obs = conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        runs = conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    assert obs == 23  # upserted, not duplicated
    assert runs == 2  # one audit row per run


def test_human_mode_table(make_fixtures, capsys, tmp_path):
    fixtures = make_fixtures("human", SPIKE_PREMIUMS, us="UPU", hk="UP.HK")
    rc, out = _run(["--db", str(tmp_path / "human.db"), "--pairs", "UP",
                    "--config", str(_pair_config(tmp_path)), "--fixtures", str(fixtures),
                    "--as-of", AS_OF.isoformat()], capsys)
    assert rc == 0
    assert "UP" in out
    assert "signal=hk_rich" in out


def _pair_config(tmp_path):
    path = tmp_path / "pair.json"
    path.write_text(json.dumps([
        {"name": "UP", "us": "UPU", "hk": "UP.HK", "ads_ratio": 1.0, "source": "fixture"},
    ]))
    return path
