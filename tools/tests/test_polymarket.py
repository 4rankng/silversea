"""Fixture-driven tests for tools/polymarket.py — no network access.

Covers: Gamma payload normalization (incl. shape drift), empty responses,
HTTP 429 degradation on both Gamma and CLOB paths, transport failures,
delta-alert thresholds, FedWatch divergence flagging, --json purity,
and SQLite/markdown snapshot persistence.
"""

from __future__ import annotations

import copy
import io
import json
import sqlite3
import urllib.error
from pathlib import Path

import pytest

import polymarket

FIXTURES = Path(__file__).resolve().parent / "fixtures"
RUN_DATE = "2026-10-18"


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeHttp:
    """URL-substring-routed stand-in for polymarket.request_json.

    Routes map a URL substring to either a ``(status, payload)`` tuple or an
    exception instance (simulating a misbehaving transport). Unmatched URLs get
    (404, None).
    """

    def __init__(self, routes):
        self.routes = list(routes)
        self.calls: list[str] = []

    def __call__(self, url: str, *, timeout: float | None = None):
        self.calls.append(url)
        for needle, response in self.routes:
            if needle in url:
                if isinstance(response, Exception):
                    raise response
                status, payload = response
                return status, payload
        return 404, None


def fomc_market(yes_price: float) -> list:
    """The FOMC fixture market with its Yes/No prices replaced."""
    market = copy.deepcopy(load_fixture("gamma_markets_fomc.json")[0])
    market["outcomePrices"] = json.dumps([str(yes_price), str(round(1 - yes_price, 4))])
    return [market]


def run_main(monkeypatch, tmp_path, fake, *extra, clob: bool = False) -> int:
    monkeypatch.setattr(polymarket, "request_json", fake)
    args = ["--out-dir", str(tmp_path), "--date", RUN_DATE]
    if not clob:
        args.append("--no-clob")
    return polymarket.main(args + list(extra))


def run_json(monkeypatch, tmp_path, capsys, fake, *extra, clob: bool = False):
    code = run_main(monkeypatch, tmp_path, fake, *extra, clob=clob)
    captured = capsys.readouterr()
    return code, json.loads(captured.out), captured.err


# ---------------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------------


def test_parse_gamma_market_json_string_fields():
    raw = load_fixture("gamma_markets_fomc.json")[0]
    market = polymarket.parse_gamma_market(raw, topic="fomc", query="fomc decision")
    assert market is not None
    assert market.slug == "fed-decision-in-december"
    assert market.market_id == "501234"
    assert [o.outcome for o in market.outcomes] == ["Yes", "No"]
    assert [o.price for o in market.outcomes] == [0.47, 0.53]
    assert all(len(o.clob_token_id) == 77 for o in market.outcomes)
    assert market.best_bid == 0.46
    assert market.end_date == "2026-12-10T19:00:00Z"


def test_parse_gamma_market_shape_drift_and_invalid_rows():
    # list-typed fields instead of JSON strings; shorter price list
    raw = {
        "question": "Q?",
        "slug": "q-market",
        "outcomes": ["Yes", "No"],
        "outcomePrices": ["0.4"],
        "clobTokenIds": ["tok-1"],
    }
    market = polymarket.parse_gamma_market(raw, topic="custom", query="q")
    assert market.outcomes[0].price == 0.4
    assert market.outcomes[1].price is None
    assert market.outcomes[1].clob_token_id is None

    # unparseable price strings degrade to None, not an exception
    raw_bad_prices = dict(raw, outcomePrices="not-json")
    market = polymarket.parse_gamma_market(raw_bad_prices, topic="custom", query="q")
    assert [o.price for o in market.outcomes] == [None, None]

    # unusable rows are dropped
    assert polymarket.parse_gamma_market({"slug": "s"}, topic="t", query="q") is None
    assert polymarket.parse_gamma_market({"question": "Q?"}, topic="t", query="q") is None
    assert (
        polymarket.parse_gamma_market(
            {"question": "Q?", "slug": "s", "outcomes": "not-json"}, topic="t", query="q"
        )
        is None
    )
    assert polymarket.parse_gamma_market("not-a-dict", topic="t", query="q") is None


def test_build_targets_defaults_to_all_topics():
    targets = polymarket.build_targets(None, None, None)
    assert all(t.kind == "search" for t in targets)
    assert {t.topic for t in targets} == set(polymarket.TOPICS)
    # one target per configured query
    assert len(targets) == sum(len(q) for q in polymarket.TOPICS.values())

    mixed = polymarket.build_targets(["fomc"], ["my-slug"], ["custom query"])
    assert [(t.kind, t.value, t.topic) for t in mixed][-2:] == [
        ("slug", "my-slug", "custom"),
        ("search", "custom query", "custom"),
    ]


# ---------------------------------------------------------------------------
# fetch paths: empty, 429, transport failure
# ---------------------------------------------------------------------------


def test_slug_lookup_empty_is_success_without_errors():
    fake = FakeHttp([("markets?slug=", (200, load_fixture("gamma_markets_empty.json")))])
    markets, errors = polymarket.collect_markets(
        [polymarket.Target("slug", "does-not-exist", "custom")], fetch=fake
    )
    assert markets == []
    assert errors == []


def test_search_flattens_event_markets_and_dedupes():
    payload = load_fixture("public_search_ai.json")
    fake = FakeHttp([("public-search?q=", (200, payload))])
    markets, errors = polymarket.collect_markets(
        [
            polymarket.Target("search", "ai leaderboard", "ai"),
            polymarket.Target("search", "ai models", "ai"),
        ],
        fetch=fake,
    )
    assert errors == []
    # 3 event markets total; the second query hits the same payload and must dedupe
    assert [m.slug for m in markets] == [
        "ai-leaderboard-2026-gpt6",
        "ai-leaderboard-2026-gemini",
        "ai-leaderboard-2026-open-weight",
    ]
    assert markets[0].topic == "ai"


def test_429_on_one_target_continues_and_json_stays_pure(
    monkeypatch, tmp_path, capsys
):
    fake = FakeHttp(
        [
            ("q=fomc%20decision", (429, load_fixture("http_429.json"))),
            ("q=fed%20rate%20decision", (200, load_fixture("gamma_markets_fomc.json"))),
        ]
    )
    code, report, err = run_json(
        monkeypatch, tmp_path, capsys, fake, "--topic", "fomc", "--json"
    )
    assert code == 0
    assert err == ""  # --json: stdout is exactly one JSON doc, nothing on stderr
    assert len(report["errors"]) == 1
    assert report["errors"][0] == {
        "kind": "gamma_search",
        "target": "fomc decision",
        "status": 429,
        "detail": json.dumps(load_fixture("http_429.json")),
    }
    assert report["run"]["market_count"] == 2
    assert report["run"]["snapshot_file"] is not None
    assert (tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md").exists()


def test_all_targets_fail_exit_1_and_preserves_prior_snapshot(
    monkeypatch, tmp_path, capsys
):
    ok = FakeHttp([("markets?slug=", (200, fomc_market(0.47)))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, ok, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 0
    snapshot = tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md"
    first_text = snapshot.read_text(encoding="utf-8")

    down = FakeHttp([("", (429, load_fixture("http_429.json")))])
    monkeypatch.setattr(polymarket, "request_json", down)
    code = polymarket.main(
        ["--out-dir", str(tmp_path), "--date", RUN_DATE, "--no-clob",
         "--slug", "fed-decision-in-december", "--json"]
    )
    captured = capsys.readouterr()
    report = json.loads(captured.out)
    assert code == 1  # every fetch target failed and nothing was fetched
    assert report["markets"] == []
    assert report["run"]["all_targets_failed"] is True
    assert report["run"]["snapshot_file"] is None
    # the good same-day snapshot was not clobbered by the failed run
    assert snapshot.read_text(encoding="utf-8") == first_text


def test_empty_success_writes_empty_snapshot_and_exits_0(
    monkeypatch, tmp_path, capsys
):
    fake = FakeHttp([("markets?slug=", (200, load_fixture("gamma_markets_empty.json")))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--slug", "nothing-here", "--json"
    )
    assert code == 0
    assert report["markets"] == []
    assert report["errors"] == []
    text = (tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md").read_text(encoding="utf-8")
    assert "markets: 0" in text
    assert "- None." in text


def test_transport_error_recorded_with_null_status(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("markets?slug=", (None, "URLError: timed out"))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 1
    assert report["errors"][0]["status"] is None
    assert "URLError" in report["errors"][0]["detail"]


def test_clob_midpoint_429_degrades_gracefully(monkeypatch, tmp_path, capsys):
    fake = FakeHttp(
        [
            ("markets?slug=", (200, fomc_market(0.47))),
            ("clob.polymarket.com/midpoint", (429, load_fixture("http_429.json"))),
        ]
    )
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake,
        "--slug", "fed-decision-in-december", "--json", clob=True,
    )
    assert code == 0
    errors = [e for e in report["errors"] if e["kind"] == "clob_midpoint"]
    assert errors and all(e["status"] == 429 for e in errors)
    outcomes = report["markets"][0]["outcomes"]
    assert [o["price"] for o in outcomes] == [0.47, 0.53]  # Gamma odds survive
    assert all(o["clob_midpoint"] is None for o in outcomes)
    assert report["run"]["clob_calls"] == 2  # one call per outcome token
    assert report["run"]["clob_truncated"] is False


# ---------------------------------------------------------------------------
# persistence + delta alerts
# ---------------------------------------------------------------------------


def test_snapshot_persists_sqlite_and_markdown(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("public-search?q=", (200, load_fixture("gamma_markets_fomc.json")))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--topic", "fomc", "--json"
    )
    assert code == 0
    assert report["run"]["market_count"] == 2

    db = tmp_path / "polymarket.db"
    conn = sqlite3.connect(db)
    try:
        run_rows = conn.execute(
            "SELECT taken_at, run_date, market_count FROM runs"
        ).fetchall()
        assert run_rows == [(report["run"]["taken_at"], RUN_DATE, 2)]
        odds = conn.execute(
            "SELECT slug, outcome, price, prev_price, alert FROM odds"
            " ORDER BY slug, outcome"
        ).fetchall()
    finally:
        conn.close()
    assert odds == [
        ("fed-decision-in-december", "No", 0.53, None, 0),
        ("fed-decision-in-december", "Yes", 0.47, None, 0),
        ("fed-decision-in-december-50bp", "No", 0.95, None, 0),
        ("fed-decision-in-december-50bp", "Yes", 0.05, None, 0),
    ]

    text = (tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md").read_text(encoding="utf-8")
    assert f"# Polymarket snapshot — {RUN_DATE}" in text
    assert "Will the Fed cut rates at the December 2026 meeting?" in text
    assert "| Yes | 0.470 |" in text
    assert "## Delta alerts" in text


def test_delta_alert_boundary_and_subthreshold(monkeypatch, tmp_path, capsys):
    def snap(yes_price: float):
        fake = FakeHttp([("markets?slug=", (200, fomc_market(yes_price)))])
        code, report, _ = run_json(
            monkeypatch, tmp_path, capsys, fake,
            "--slug", "fed-decision-in-december", "--json",
        )
        assert code == 0
        return report

    first = snap(0.40)
    assert first["alerts"] == []  # no previous snapshot -> no alerts, ever

    second = snap(0.45)
    by_outcome = {a["outcome"]: a for a in second["alerts"]}
    assert set(by_outcome) == {"Yes", "No"}
    assert by_outcome["Yes"]["prev_price"] == 0.4
    assert by_outcome["Yes"]["delta_pp"] == 5.0  # boundary: >= 5.0pp fires
    assert by_outcome["No"]["delta_pp"] == -5.0

    third = snap(0.485)
    assert third["alerts"] == []  # +3.5pp is below the 5.0pp threshold


# ---------------------------------------------------------------------------
# FedWatch divergence
# ---------------------------------------------------------------------------


def test_fedwatch_divergence_flagged_when_computable(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("markets?slug=", (200, load_fixture("gamma_markets_fomc.json")))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake,
        "--slug", "fed-decision-in-december",
        "--slug", "fed-decision-in-december-50bp",
        "--fedwatch", str(FIXTURES / "fedwatch_december.json"),
        "--json",
    )
    assert code == 0
    assert report["fedwatch"] == {
        "status": "computed",
        "source": "CME FedWatch Tool",
        "as_of": RUN_DATE,
        "threshold_pp": 5.0,
    }
    markets = {m["slug"]: m for m in report["markets"]}
    matched = {o["outcome"]: o for o in markets["fed-decision-in-december"]["outcomes"]}
    assert matched["Yes"]["fedwatch_prob"] == 0.42
    assert matched["Yes"]["fedwatch_delta_pp"] == 5.0  # 0.47 vs FedWatch 0.42
    assert matched["Yes"]["fedwatch_flag"] is True
    assert matched["No"]["fedwatch_flag"] is False

    # no FedWatch entry matches this market -> nothing to compare
    unmatched = markets["fed-decision-in-december-50bp"]["outcomes"]
    assert all(o["fedwatch_prob"] is None and not o["fedwatch_flag"] for o in unmatched)

    text = (tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md").read_text(encoding="utf-8")
    assert "## CME FedWatch divergence" in text
    assert "FLAG" in text


def test_fedwatch_not_computable_without_source(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("markets?slug=", (200, fomc_market(0.47)))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 0
    assert report["fedwatch"]["status"] == "not_computable"
    text = (tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md").read_text(encoding="utf-8")
    assert "not computable" in text


def test_apply_fedwatch_divergence_math():
    fedwatch = polymarket.FedwatchSource(
        source="CME FedWatch Tool",
        as_of=RUN_DATE,
        probabilities={"cut": {"prob": 0.30, "outcome": "Yes"}},
        match={"fed-decision": "cut"},
    )
    rows = [
        {"slug": "fed-decision", "outcome": "Yes", "price": 0.95},
        {"slug": "fed-decision", "outcome": "No", "price": 0.05},
        {"slug": "other-market", "outcome": "Yes", "price": 0.50},
    ]
    status = polymarket.apply_fedwatch(rows, fedwatch, threshold_pp=5.0)
    assert status == "computed"
    assert rows[0]["fedwatch_prob"] == 0.30
    assert rows[0]["fedwatch_delta_pp"] == 65.0
    assert rows[0]["fedwatch_flag"] is True
    assert rows[1]["fedwatch_flag"] is False  # outcome not compared
    assert rows[2]["fedwatch_prob"] is None  # unmatched market

    assert polymarket.apply_fedwatch(rows, None, threshold_pp=5.0) == "not_computable"


# ---------------------------------------------------------------------------
# review regressions: error branches, partial failure, config errors
# ---------------------------------------------------------------------------


def test_unparseable_200_body_recorded_as_error(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("markets?slug=", (200, "<html>gateway error</html>"))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 1  # the single target produced no data and errored
    assert report["run"]["all_targets_failed"] is True
    assert report["errors"][0]["status"] == 200
    assert "unparseable payload" in report["errors"][0]["detail"]
    assert report["run"]["snapshot_file"] is None


def test_mixed_partial_failure_exits_0_and_preserves_prior_snapshot(
    monkeypatch, tmp_path, capsys
):
    ok = FakeHttp([("markets?slug=", (200, fomc_market(0.47)))])
    code, _, _ = run_json(
        monkeypatch, tmp_path, capsys, ok, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 0
    snapshot = tmp_path / f"_polymarket-snapshot-{RUN_DATE}.md"
    first_text = snapshot.read_text(encoding="utf-8")

    mixed = FakeHttp(
        [
            ("markets?slug=good-slug", (200, load_fixture("gamma_markets_empty.json"))),
            ("markets?slug=bad-slug", (429, load_fixture("http_429.json"))),
        ]
    )
    monkeypatch.setattr(polymarket, "request_json", mixed)
    code = polymarket.main(
        ["--out-dir", str(tmp_path), "--date", RUN_DATE, "--no-clob",
         "--slug", "good-slug", "--slug", "bad-slug", "--json"]
    )
    report = json.loads(capsys.readouterr().out)
    assert code == 0  # not every target failed: empty-but-successful stays 0
    assert report["run"]["all_targets_failed"] is False
    assert [e["status"] for e in report["errors"]] == [429]
    # nothing fetched + a failure: the prior same-day snapshot stays untouched
    assert report["run"]["snapshot_file"] is None
    assert snapshot.read_text(encoding="utf-8") == first_text


def test_end_date_shape_drift_tolerated(monkeypatch, tmp_path, capsys):
    market = fomc_market(0.47)[0]
    market["endDate"] = {"unexpected": "shape drift"}
    fake = FakeHttp([("markets?slug=", (200, [market]))])
    code, report, _ = run_json(
        monkeypatch, tmp_path, capsys, fake, "--slug", "fed-decision-in-december", "--json"
    )
    assert code == 0
    assert report["markets"][0]["end_date"] is None
    conn = sqlite3.connect(tmp_path / "polymarket.db")
    try:
        stored = {row[0] for row in conn.execute("SELECT DISTINCT end_date FROM odds")}
    finally:
        conn.close()
    assert stored == {None}


def test_fedwatch_config_errors_exit_2(monkeypatch, tmp_path, capsys):
    fake = FakeHttp([("markets?slug=", (200, fomc_market(0.47)))])
    monkeypatch.setattr(polymarket, "request_json", fake)
    common = [
        "--out-dir", str(tmp_path), "--date", RUN_DATE, "--no-clob",
        "--slug", "fed-decision-in-december", "--json",
    ]

    bad = tmp_path / "fedwatch-bad.json"
    bad.write_text(
        json.dumps(
            {
                "source": "CME FedWatch Tool",
                "probabilities": {"cut": {"prob": 42.0}},
                "match": {"fed-decision-in-december": "cut"},
            }
        ),
        encoding="utf-8",
    )
    code = polymarket.main(common + ["--fedwatch", str(bad)])
    captured = capsys.readouterr()
    assert code == 2
    assert captured.out == ""  # --json purity holds on error paths too
    assert "prob" in captured.err

    code = polymarket.main(common + ["--fedwatch", str(tmp_path / "missing.json")])
    captured = capsys.readouterr()
    assert code == 2
    assert captured.out == ""
    assert "error" in captured.err


def test_request_json_error_and_fallback_branches(monkeypatch):
    class FakeResponse:
        def __init__(self, body: bytes):
            self._body = body
            self.status = 200

        def read(self, n: int = -1) -> bytes:
            return self._body if n < 0 else self._body[:n]

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(
        polymarket.urllib.request,
        "urlopen",
        lambda request, timeout=None: FakeResponse(b'{"mid": "0.5"}'),
    )
    assert polymarket.request_json("https://x.test/midpoint") == (200, {"mid": "0.5"})

    def raise_http_error(request, timeout=None):
        raise urllib.error.HTTPError(
            request.full_url, 429, "Too Many Requests", hdrs=None,
            fp=io.BytesIO(b'{"error": "rate_limit"}'),
        )

    monkeypatch.setattr(polymarket.urllib.request, "urlopen", raise_http_error)
    assert polymarket.request_json("https://x.test/midpoint") == (429, {"error": "rate_limit"})

    def raise_transport_error(request, timeout=None):
        raise urllib.error.URLError("timed out")

    monkeypatch.setattr(polymarket.urllib.request, "urlopen", raise_transport_error)
    status, payload = polymarket.request_json("https://x.test/midpoint")
    assert status is None
    assert "URLError" in payload

    monkeypatch.setattr(
        polymarket.urllib.request,
        "urlopen",
        lambda request, timeout=None: FakeResponse(b"<html>gateway error</html>"),
    )
    status, payload = polymarket.request_json("https://x.test/midpoint")
    assert status == 200
    assert isinstance(payload, str) and "gateway error" in payload
