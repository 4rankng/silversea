# Testplan — ADR↔HK premium + overnight-gap signal job (`tools/adr_premium.py`)

Date: 2026-10-18. Scope: new research job only; no product surface touched.
Regression cases run by `python3 -m pytest tools/tests` (gate artifact:
`qa/2026-10-18_adr-premium_pytest.log`).

## Cases

| ID | Case | Reproduction | Expected |
|---|---|---|---|
| AP-01 | FX-adjusted premium math | HK 80 × ratio 8 × HKDUSD 0.128 vs US 85 | premium = −3.6235 %; rejects non-positive inputs |
| AP-02 | Overnight-gap proxy | US +10 % session vs HK +2 % session | gap = −8.0 pp; equal returns → 0 |
| AP-03 | z-score signal both directions | history [1,2,3,4], value 5/6/0; end-to-end ±3 pp spike vs flat history | z matches ddof=1 formula; `hk_rich` / `hk_cheap` on ±spike |
| AP-04 | Strict threshold boundary | history [1,2,3] (sd 1), value 4 → z = 2.0 exactly | signal `none` at exactly ±2.0, triggers only when z exceeds |
| AP-05 | FX missing on latest date | FX series stops one session before latest | falls back to last prior ECB rate, `fx_stale=true`, `fx_date` = prior rate date, premium computed |
| AP-06 | FX absent entirely | FX series empty | status `fx_missing`, premium/z/signal null, exit 0 (degrade, not crash) |
| AP-07 | Insufficient history | 6-session series vs `min-history` 10 | premium computed, z null, signal `none`, status `insufficient_history` |
| AP-08 | `--json` purity + SQLite | run with `--json --db …` on fixtures | stdout parses as exactly one JSON doc; `research/…db` rows upserted per (pair, date); rerun does not duplicate rows |
| AP-09 | Config pair list | `--config` custom pairs + `--pairs` filter | only selected pairs run; per-pair `price_source` recorded |
| AP-10 | Fetch failure | missing HK fixture file | pair status `error` with message, exit 1 |
| AP-11 | `--as-of` before any data | query as-of 2020 against 2026 fixtures | status `no_data` (source answered, series out of range), premium null, exit 0 — not `error` |
| AP-12 | Upsert updates columns | run, then rerun with changed `ads_ratio` in config | same (pair, date) row: `ads_ratio` and `premium_pct` both updated, no duplicate row |
| AP-13 | `as_of` = latest session, not CLI echo | `--as-of 2026-03-21` (weekend) against fixtures ending Fri 2026-03-20 | summary `as_of` = `2026-03-20` |
| AP-14 | Corrupt input does not crash the job | fixture with a zero close for one pair, second pair healthy | bad pair `status=error`, healthy pair computed, one JSON document, exit 1 |
| AP-15 | Non-positive `ads_ratio` rejected | `premium_pct(..., ads_ratio=0)` / negative | `ValueError` (guards config typos) |

## Formula pins (research semantics)

- `premium_pct = (hk_close × ads_ratio × hkdusd / us_close − 1) × 100`
- `overnight_gap_pct = (hk_ret − us_ret) × 100`, each leg measured against its
  close at the previous **common** session (legs aligned by exchange date; on
  calendar-divergence days a leg's return spans its intervening sessions).
- `zscore` = current premium vs mean/sample-stdev (ddof=1) of trailing 30-calendar-day
  premiums excluding the current observation; `min-history` 10 observations required;
  zero variance → z null.
- ADS ratios pinned from issuer docs: BABA 1 ADS = 8 ordinary; PONY 1 ADS = 1;
  WRD 1 ADS = 3. HK moomoo codes: HK.09988 / HK.02026 / HK.00800.

## Not covered

- Live-network providers (moomoo OpenD `get_kline.py`, Yahoo chart, Frankfurter)
  exercised by manual smoke run only (`qa/2026-10-18_adr-premium_smoke.log`),
  not by the offline pytest suite.
- Split/ADR-ratio change handling: ads_ratio is manual config; research-grade.
