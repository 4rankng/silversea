# testplan/qa

> **Requirements precedence (2026-09-17):** historical cycle specifications and artifacts below record what was tested then. Any retained-approval/maker-checker exception in a dated record is superseded by current PRDs and [NO-APP regression cases](../2026-09-17-no-approval-workflows.md). Do not execute old approve/reject steps as current requirements or treat their PASS as proof. Preserve dated screenshots, logs and raw evidence unchanged; deployment/code-review permission is process terminology, not a product workflow.

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
│   └── chungtu-regression/
│       ├── index.mjs          # list of cases for run-all
│       ├── factory-display.mjs
│       ├── TC-CUS-CREATE-021.mjs   # Nhà máy X clear
│       ├── TC-CUS-CREATE-022.mjs   # Tuyến đường X clear
│       ├── TC-CUS-CREATE-023.mjs   # Cảng nâng/hạ X clear
│       ├── TC-CUS-CREATE-026.mjs   # Duplicate BL guard
│       └── TC-CUS-CREATE-028.mjs   # Overview ↔ detail sync
└── evidence/
    ├── _legacy/               # all pre-consolidation artifacts (date-prefixed)
    └── <timestamp>_<pid>_<topic>/  # one unique folder per attempt
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
  `evidence/<timestamp>_<pid>_<topic>/` folder. Never edit a previous run's artifacts —
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
  testplan/qa/cases/chungtu-regression/TC-CUS-CREATE-021.mjs

# 3. Whole topic set (uses cases/<topic>/index.mjs)
STAGING_URL=https://vantai.tingting.vip \
  node testplan/qa/scripts/run-all.mjs chungtu-regression
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
The topic exits0 only when every planned case is PASS. FAIL, ERROR, BLOCKED,
SKIP, INCONCLUSIVE, missing verdicts and empty topics all return nonzero; they
must not be reported as a verified suite. `node --test testplan/qa/lib/*.test.mjs`
checks this reporting contract.

For a local installation with different account aliases or browser location,
set `BASE_URL`, `API_URL`, `QA_USER_CUS` (or another role suffix), `PASSWORD` and
optionally `BROWSER_EXECUTABLE_PATH` in the process environment. Do not commit
credentials or use a staging URL for local fixture mutations.

For failures, the structured payload in `results.json` includes the failing
state (`factoryCellText`, `before`/`after`, `inlineWarnings`, etc.) so the
report can be regenerated without re-running.

## Regression specs (per-ticket per-cycle)

Cycle-scoped regression specs (one per ticket per cycle, e.g. `2026-09-10_dispatch-detailed-plan.md`)
follow a single shared header so the per-cycle context QA loads stays small.

- **Template:** `_TEMPLATE.md` (sibling of this README) — the source for the
  Environment / Accounts / Verification protocol / Evidence bundle / Pass
  criteria / QA gates / Anti-lying guardrails / What is NOT covered blocks.
- **Each spec carries only the ticket-specific parts:** the **Goal**,
  **Out of scope**, **Acceptance criteria (TC-…)**, and **Linked artifacts**.
- **Do not duplicate** the shared header blocks inside the per-ticket spec —
  the QA harness and any agent reading the file already know them.
- **Naming:** `testplan/qa/<YYYY-MM-DD>_<ticket-slug>.md`. The date is the
  cycle date; the slug is the kanban ticket id or a short kebab name.
- **Lifecycle:** `PREP` while waiting on the implementer; flip to `READY` /
  `RUNNING` / `DONE` in the status line as the cycle progresses.
