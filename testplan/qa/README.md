# testplan/qa

Reusable browser/API QA harness for Silversea (TingTing). Owns:
- every test script (one file per case)
- every screenshot / log / DOM-text snapshot produced by a run

Replaces the previous top-level `qa/` and `qa_automation/` folders. The old
artifacts now live under `evidence/_legacy/` (preserved via `git mv`).

## Layout

```
testplan/qa/
├── README.md                  # this file
├── package.json               # { type: module } — see "Running" below
├── lib/                       # reusable harness library — never per-run
│   ├── env.mjs                # parses testplan/testaccounts.txt; env detection
│   ├── selectors.mjs          # single source of truth for DOM selectors + JS helpers
│   └── harness.mjs            # createSession, ctx (pickCustomer, screenshot, apiGet…)
├── scripts/                   # CLI entry points
│   ├── smoke.mjs              # health probe + role-by-role login check
│   ├── run-case.mjs           # run a single case file
│   ├── run-all.mjs            # run a topic set (cases/<topic>/index.mjs)
│   └── _legacy/               # archived scripts (e.g. qa_automation/test_staging.py)
├── cases/                     # one .mjs file per TC; small + declarative
│   └── customer-regression/
│       ├── index.mjs          # list of cases for run-all
│       ├── factory-display.mjs
│       ├── TC-CUS-CREATE-021.mjs   # Nhà máy X clear
│       ├── TC-CUS-CREATE-022.mjs   # Tuyến đường X clear
│       ├── TC-CUS-CREATE-023.mjs   # Cảng nâng/hạ X clear
│       ├── TC-CUS-CREATE-026.mjs   # Duplicate BL guard
│       └── TC-CUS-CREATE-028.mjs   # Overview ↔ detail sync
└── evidence/
    ├── _legacy/               # all pre-consolidation artifacts (date-prefixed)
    └── <YYYY-MM-DD>_<topic>/  # one folder per run: results.json + 01_*.png, 02_*.png, ...
```

## Conventions

- **Case files are small and declarative.** A case imports `ctx` from the harness
  and calls domain methods (`pickCombobox`, `clearCombobox`, `pickHinhThucNhapKhau`,
  `screenshot`, `apiGet`). Raw `page.evaluate` belongs in `lib/selectors.mjs`,
  not in cases.
- **Selections live in `lib/selectors.mjs`.** When the app's DOM changes, edit
  one file — not 20 case files. Per AGENTS.md "Stable Code Artifacts".
- **No raw SQL.** All DB facts go through `/api/...` endpoints (the same ones
  the UI uses).
- **Evidence is dated and append-only.** New runs go in a new
  `evidence/<date>_<topic>/` folder. Never edit a previous run's artifacts —
  re-run instead.
- **Role is the only thing cases hardcode.** Username is picked by the harness
  from `testplan/testaccounts.txt` for the active env. A case declares its
  `role` and the harness picks the right user.

## Running

```sh
# 1. Smoke probe — health + role-by-role login
STAGING_URL=https://vantai.tingting.vip \
  node testplan/qa/scripts/smoke.mjs

# 2. One case (pass file path)
STAGING_URL=https://vantai.tingting.vip \
  node testplan/qa/scripts/run-case.mjs \
  testplan/qa/cases/customer-regression/TC-CUS-CREATE-021.mjs

# 3. Whole topic set (uses cases/<topic>/index.mjs)
STAGING_URL=https://vantai.tingting.vip \
  node testplan/qa/scripts/run-all.mjs customer-regression
```

Each run writes to `testplan/qa/evidence/<date>_<topic>/`:
- `results.json` — per-case verdict + structured evidence payload
- `01_<label>.png`, `02_<label>.png`, … — screenshots in click order
- The runner also auto-captures every POST/PUT/PATCH/DELETE response on the
  page (see `ctx.apiCalls`) — accessible via the `apiCalls` field in `results.json`
  if a case returns it.

## Adding a new case

1. Create `testplan/qa/cases/<topic>/TC-<role>-<flow>-<NNN>.mjs`.
2. Export `caseId`, `role`, and a default async function `(ctx) => { ... }`.
3. The case body uses `ctx` (no raw puppeteer).
4. Add the case to `cases/<topic>/index.mjs`.
5. Re-run `run-all.mjs <topic>` to capture evidence.

## Adding a new topic

1. Create `testplan/qa/cases/<topic>/`.
2. Add case files + `index.mjs`.
3. Add a new topic entry to whichever runbook / wiki links to it.
4. The harness picks it up automatically — no registration step.

## Evidence interpretation

Each case's verdict follows AGENTS.md §5 cross-cutting rule PASS / FAIL / BLOCKED.
For failures, the structured payload in `results.json` includes the failing
state (`factoryCellText`, `before`/`after`, `inlineWarnings`, etc.) so the
report can be regenerated without re-running.
