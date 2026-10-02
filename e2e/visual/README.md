# Visual Regression Runner — Silversea PRD

> Automated Playwright visual-regression tests for `docs/regression-testing/`.
> One screenshot per test case, fail-fast, section-by-section. Output goes to
> `qa/visual/` and is summarized in `qa/visual/SUMMARY.md`.

## Quick start

```bash
# 1. Make sure localhost stack is up
make dev

# 2. Run one section
cd e2e
python3 visual/run_section.py s00_cross_cutting
python3 visual/run_section.py s01_overview_dispatch
python3 visual/run_section.py s03_cus

# 3. See aggregated results
cat ../qa/visual/SUMMARY.md
```

## Commands

```bash
python3 visual/run_section.py --list               # list available sections
python3 visual/run_section.py s00_cross_cutting     # run a section
python3 visual/run_section.py s01 --limit 3         # smoke a few TCs
python3 visual/run_section.py s03 --only TC-M03-06-01b  # re-run specific TCs
python3 visual/run_section.py --refresh-summary     # rebuild SUMMARY.md
```

## Section status

| # | Section | TCs | Status |
|---|---------|-----|--------|
| 1 | `s00_cross_cutting` (HT-01..HT-12) | 16 | ✅ built & passing |
| 2 | `s01_overview_dispatch` (M01) | 20 | ✅ built & passing |
| 3 | `s02_pricing_revenue` (M02) | — | ⏳ pending next session |
| 4 | `s03_cus` (M03 — customer portal) | 17 | ✅ built & passing |
| 5–13 | `s04`–`s12` | — | ⏳ pending future sessions |

Each section is self-contained — build + run independently in any order.

## Output layout

```
qa/visual/
├── SUMMARY.md                              ← top-level dashboard, refresh after each session
├── <YYYY-MM-DD_HHMMSS>_s<NN>_*/             ← one dir per section run
│   ├── results.json                         ← structured per-TC result
│   ├── report.md                            ← human-readable per-section report
│   ├── TC-*.png                             ← one screenshot per TC (passing)
│   └── TC-*.fail.png + .dom.html + .console.log  ← failure evidence
```

## What each TC does

1. Logs in via API (fast) → sets `localStorage.token` → reloads the SPA.
2. Navigates to the TC's URL.
3. Runs assertions (text visible, element present, URL contains, etc.).
4. Captures one full-page screenshot.
5. On failure: captures `.fail.png` + DOM dump + console log.

## Adding a new section

1. Read the matching regression doc in `docs/regression-testing/`.
2. Create `e2e/visual/sections/s<NN>_<name>.py`.
3. Import the runner primitives:
   ```python
   from visual.lib.runner import tc, VisualTestContext
   ```
4. Write one `@tc(...)` function per test case.
5. Run it:
   ```bash
   python3 visual/run_section.py s<NN>_<name>
   ```

## Conventions

- **Black-box:** no JS injection with side effects, no DOM mutation, no
  URL construction to bypass guards. Per the `web-gui-tester` skill.
- **One screenshot per TC** by default. For TCs visiting multiple pages,
  use `ctx.capture(suffix="01-dashboard")` for per-step evidence.
- **BLOCKED vs FAIL:** raise `AssertionError("BLOCKED: <reason>")` when the
  environment is missing (no seed data, env down). The runner records
  this as `BLOCKED`, not `FAIL`. A blocked, skipped or empty run exits nonzero
  because coverage is incomplete; it is not reported as a product failure.
- **Vietnamese-aware:** assertions look for Vietnamese labels first
  (Doanh thu, Chi phí, ...), English fallback (where the app mixes).

## Switching to staging

Set env vars and re-run:

```bash
VISUAL_URL=https://vantai.tingting.vip \
VISUAL_API=https://vantai.tingting.vip \
python3 visual/run_section.py s00_cross_cutting
```

(Accounts and passwords: see the canonical
[`testplan/testaccounts.txt`](../../testplan/testaccounts.txt). If a run
fails to authenticate, sync `e2e/visual/lib/accounts.py` from that file.)
