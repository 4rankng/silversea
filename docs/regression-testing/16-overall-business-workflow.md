# Overall Business Workflow - Executable Regression Contract

> Source authority: `plans/260803-1814-overall-business-workflow/research/source-requirement-index.md`,
> `docs/prd/O2C dev-rev1.md`, `docs/prd/O2C Flow.md`,
> `docs/prd/business-logic-qa-proposals.md`, `plans/260803-1814-overall-business-workflow/plan.md`,
> `plans/260803-1814-overall-business-workflow/phase-01-authority-and-delta-contract.md`, and
> `plans/260803-1814-overall-business-workflow/phase-07-closed-loop-integration-and-rollout.md`.

## 1. Execution contract

- This pack is the Phase 1 regression authority for `OVR-001` through `OVR-027`.
- Routine completion must prove three distinct actors:
  `DRIVER`/`FORWARDER` submit evidence, `CLERK`/CUS checks recovered POD and cost dossier,
  `ACCOUNTANT` performs final completion.
- `MANAGER` and `ADMIN` are not routine substitutes. They may complete only through
  a governed exception path with explicit reason, scope, and audit trail.
- Every completion entry point is fail-closed for AR/AP capture. If AR or AP
  posting fails, shipment/trip state, postings, snapshots, and visible UI state
  must roll back to the pre-completion state.
- Missing exact-role fixtures, dedicated staging data, mutation approval, failure
  injection capability, or migration sandbox access are `BLOCKED`, not `PASS`,
  and never justify using `ADMIN` as a stand-in.
- Deployment remains separately authorized. This contract covers verification only.

### Status rules

| Verdict | Meaning |
| --- | --- |
| `PASS` | Exact role, exact viewport, exact fixture, expected result, and saved evidence all match this contract. |
| `FAIL` | Behavior, authority, state, money, or evidence diverges from this contract. |
| `BLOCKED` | Prerequisite is unavailable and is named explicitly in the artifact and report. |

## 2. Required role fixtures

Role truth must be verified after login from UI profile or `/api/auth/me`.

| Runtime role | Local default | Staging default | Required proof |
| --- | --- | --- | --- |
| `ADMIN` | `admin` | `admin` | Support-only or governed exception path; never routine O2C substitute |
| `MANAGER` | `giamdoc` | `giamdoc` | Supervisory read and governed exception path only |
| `ACCOUNTANT` | `ketoan` | `ketoan` | Cost approval, VAT choice, completion, Debit Note, AR/AP, treasury, salary close |
| `CLERK` | `cus` | dedicated fixture required | Shipment intake, POD-and-cost checking, scope-limited edits |
| `DISPATCHER` | `dieuvan` | dedicated fixture required | Dispatch queue, pairing, truck/driver assignment, order issue |
| `FORWARDER` | `giaonhan` | `giaonhan` | Advance request, lift/disbursement entry, hard-copy handoff |
| `DRIVER` | `laixe` plus `thu`/`pho`/`quyet` for multi-driver cases | `laixe`; additional drivers unconfirmed | Order acknowledgement, milestones, toll/fuel/POD evidence |
| `CUSTOMER` | `customer` | `khachhang` | Tenant-scoped portal status, Debit Note, statement, acknowledgement |

### Exact-role caveats in current automation

- `e2e/helpers.py` does not provide a `DISPATCHER` fixture. Existing API/browser
  smoke in `e2e/test_16_dispatch_workflow.py` still logs in as `manager` for
  dispatch coverage. That run is supportive only; it is not authoritative proof
  for `OVR-008` or `OVR-011`.
- `e2e/test_14_smoke_closed_loop.py` runs as `ADMIN` only. Treat it as chain
  smoke, not role-authority proof.
- Local `CUSTOMER` auto-provisioning exists only on localhost. Staging requires
  an already-approved dedicated customer account and scope.

If a role exists but authenticates into the wrong home route or lacks the
required actions, record `BLOCKED_ROLE_FIXTURE` and stop the affected scenario.

## 3. Environments and exact commands

### Local baseline

```bash
make dev
curl -fsS http://localhost:3001/api/health
cd e2e && ./run_all.sh 11 13 14 15 16 17
cd e2e && python3 visual/run_section.py s00_cross_cutting
cd e2e && python3 visual/run_section.py s01_overview_dispatch
cd e2e && python3 visual/run_section.py s02_pricing_revenue
cd e2e && python3 visual/run_section.py s03_cus
cd e2e && python3 visual/run_section.py s04_disbursement
cd e2e && python3 visual/run_section.py s05_ar
cd e2e && python3 visual/run_section.py s05_ar_workflow
cd e2e && python3 visual/run_section.py s06_ap
cd e2e && python3 visual/run_section.py s07_payroll
cd e2e && python3 visual/run_section.py s07_payroll_workflow
cd e2e && python3 visual/run_section.py s08_driver_app
cd e2e && python3 visual/run_section.py s09_field_app
cd e2e && python3 visual/run_section.py s10_clerk_app
cd e2e && python3 visual/run_section.py s11_finance_pnl
cd e2e && python3 visual/run_section.py s12_fuel
cd e2e && python3 visual/run_section.py s98_export_workflow
cd e2e && python3 visual/run_section.py s99_business_rules_workflow
```

### Staging read-only or approved-mutation run

Use only after dedicated staging data and mutation approval are granted.

```bash
cd e2e && \
VISUAL_URL=https://vantai.tingting.vip \
VISUAL_API=https://vantai.tingting.vip \
VISUAL_PASSWORD='<approved-secret>' \
VISUAL_CLERK_IDENTIFIER=cus \
python3 visual/run_section.py s00_cross_cutting
```

Repeat the same environment prefix for each required `visual/run_section.py`
command. For API suites that need the customer fixture on staging, set
`NEPO_CUSTOMER_USERNAME=khachhang` and the approved password; do not rely on
localhost auto-provisioning.

### Mandatory broad gates once implementation claims affect shared contracts

```bash
pnpm lint
cd backend && npx tsc --noEmit
cd backend && pnpm test
cd frontend && npx tsc -b
cd frontend && pnpm test
make build
cd e2e && ./run_all.sh
```

## 4. Viewports, accessibility, and volume

| Surface | Exact setting | Required result |
| --- | --- | --- |
| Desktop | `1440x900` | Dense workspace, no hidden primary action, bounded scrolling panes |
| Tablet | `768x1024` | Drawer/table/filter layout remains usable |
| Mobile | `390x844` | No horizontal overflow, touch targets >= 44px |
| Narrow + large text | `320x720` plus browser zoom `200%` or OS large-font equivalent | No clipped labels, focus visible, modals actionable |

Volume drill:

- Dispatch, trips, shipment lists, AR/AP, dashboard/reporting, and portal lists
  must be exercised with `55` active vehicles and `500+` orders.
- Evidence must prove bounded panes, server-side or real pagination/windowing,
  and no giant unbounded page render.
- Missing volume fixtures are `BLOCKED_VOLUME_FIXTURE`.

## 5. Financial invariants

These equalities must be checked in every pass that reaches the relevant chain.

| Chain | Required invariant |
| --- | --- |
| Shipment completion | Exactly one terminal `COMPLETED` transition and one active financial posting version |
| AR handoff | `issued obligations - allocations - valid reversals = receivable balance` |
| AP handoff | `carrier/vendor/fuel obligations - payments - valid offsets = payable balance` |
| Advances | `issued - approved offsets - repayments = employee advance balance` |
| Salary | `completed eligible trips + governed adjustments - governed deductions = payslip and salary ledger` |
| P&L | `source-linked revenue - variable cost - allocated fixed cost = reported result` |
| Snapshot drift | Post-completion cost change never silently overwrites AR/AP/P&L; it sets a reconciliation flag |

## 6. OVR coverage map

Each row is required. The `How to execute` column names the primary command or
manual pack to run; save evidence even when the command already returns pass.

| OVR | Scenario ID | How to execute | Roles | Pass evidence | Fail or blocked trigger |
| --- | --- | --- | --- | --- | --- |
| `OVR-001` | `TC-OVR-001` | `./run_all.sh 14 17` plus full manual chain from [`14-order-to-cash-workflow.md`](./14-order-to-cash-workflow.md) and staging guide | all 8 | one shipment ID, trip IDs, Debit Note, AR/AP rows, and P&L/report rows reconcile without re-entry | any downstream module needs duplicate data entry or chain IDs diverge |
| `OVR-002` | `TC-OVR-002` | `python3 visual/run_section.py s02_pricing_revenue` plus manual FCL/LCL creation from O2C step 1 | `CLERK`, `ACCOUNTANT` | freight and fuel surcharge auto-calculate from customer/route/oil inputs; no manual price entry | manual override required, wrong formula, or missing recalculation |
| `OVR-003` | `TC-OVR-003` | `./run_all.sh 16 17` plus manual paired-trip dispatch | `DISPATCHER`, `DRIVER`, `ACCOUNTANT` | two-way pair removes one toll allowance, adds configured supplement, and keeps independent trip identity | duplicate toll, missing supplement, or pair state corrupts separate trips |
| `OVR-004` | `TC-OVR-004` | `python3 visual/run_section.py s12_fuel` plus driver evidence upload | `DRIVER`, `ACCOUNTANT`, `MANAGER` | fuel photo/evidence reaches anomaly-review surface without auto-approving or replacing human review | anomaly flow absent, auto-finalized, or evidence unreadable |
| `OVR-005` | `TC-OVR-005` | `python3 visual/run_section.py s04_disbursement` plus approval-to-offset trace | `FORWARDER`, `DRIVER`, `ACCOUNTANT` | approved disbursement reduces the correct person's advance balance exactly once | offset occurs twice, on wrong person, or only at completion |
| `OVR-006` | `TC-OVR-006` | manual complete then post-completion cost edit; verify AR/AP/P&L | `CLERK`, `ACCOUNTANT`, `MANAGER` | completion creates snapshot; later cost edit leaves shipment editable and marks reconciliation warning | silent overwrite, no warning, or completion locks cost edits |
| `OVR-007` | `TC-OVR-007` | master-data read/write smoke in O2C step 0 plus `s02_pricing_revenue`, `s06_ap`, `s12_fuel` | `ADMIN`, `MANAGER`, `ACCOUNTANT`, `CLERK` | dual payment terms, tariffs, lift matrix, and own/external vehicles all exist and drive downstream behavior | missing master field, single-term coercion, or vehicle origin lost downstream |
| `OVR-008` | `TC-OVR-008` | `python3 visual/run_section.py s00_cross_cutting` plus role-by-role direct URL tests | all 8 | create/edit/delete/approve/view scope matches runtime role and session-delete rule | unauthorized route/action succeeds or wrong role fixture used |
| `OVR-009` | `TC-OVR-009` | manual approved-expense and approved-document deletion attempts | `CLERK`, `FORWARDER`, `ACCOUNTANT`, `MANAGER`, `ADMIN` | approved expenses/documents are undeletable except governed director/admin handling | direct delete succeeds or lacks audited exception path |
| `OVR-010` | `TC-OVR-010` | O2C step 1 in [`14-order-to-cash-workflow.md`](./14-order-to-cash-workflow.md) | `CLERK` | FCL and LCL shipment creation reaches `NEW`, uses governed pricing, and keeps scope-limited edits | creation needs wrong role, wrong state, or manual pricing bypass |
| `OVR-011` | `TC-OVR-011` | `./run_all.sh 16 17` plus manual dispatch with exact `DISPATCHER` account | `DISPATCHER`, `DRIVER` | dispatcher plans, pairs, issues order, and moves shipment to `DISPATCHED` | only manager can dispatch, order issue fails, or wrong role proof |
| `OVR-012` | `TC-OVR-012` | `./run_all.sh 13 17` plus forwarder trip/disbursement workflow | `FORWARDER`, `ACCOUNTANT` | advance request, governed port/container lift cost, and hard-copy handoff all persist to the shipment/trip chain | manual amount entry bypasses tariff, no hard-copy handoff state, or advance uncoupled |
| `OVR-013` | `TC-OVR-013` | `./run_all.sh 11 17` plus driver milestone and POD flow | `DRIVER`, `FORWARDER` | driver acknowledges order, records times/tolls/fuel/POD, and submits completion evidence | milestones duplicate, evidence missing, or wrong trip accepted |
| `OVR-014` | `TC-OVR-014` | end-to-end shipment/trip trace via `./run_all.sh 17` | `DISPATCHER`, `FORWARDER`, `DRIVER`, `ACCOUNTANT` | operational facts aggregate by shipment/trip and status moves `IN_TRANSIT -> PENDING_EXPENSE_APPROVAL` correctly | orphan costs, mixed trip facts, or wrong state machine |
| `OVR-015` | `TC-OVR-015` | manual accountant review plus `s04_disbursement` and `s05_ar_workflow` | `ACCOUNTANT` | accountant reviews invoice/no-invoice costs by cycle and VAT; maker/checker preserved | same actor self-approves, cycle/VAT missing, or review surface wrong |
| `OVR-016` | `TC-OVR-016` | manual completion block before POD recovered; upload and retry | `CLERK`, `ACCOUNTANT`, `DRIVER` | completion stays blocked until recovered original POD is explicitly confirmed | completion succeeds with missing POD or stale evidence |
| `OVR-017` | `TC-OVR-017` | manual completion and downstream handoff; see also `TC-WB-901..903` | `CLERK`, `ACCOUNTANT`, `MANAGER`, `ADMIN` | terminal `COMPLETED` plus AR/AP handoff occurs once, with routine checker/completer split | same-account complete, no AR/AP, duplicate posting, or no exception audit |
| `OVR-018` | `TC-OVR-018` | `python3 visual/run_section.py s05_ar_workflow` plus reminder artifact review | `ACCOUNTANT`, `MANAGER`, `CUSTOMER` | Debit Note/AR created and reminders follow accepted cadence `T-3`, due date, `T+3`, then every 7 days | old T-5-only logic, missing quiet-hours/holiday rules, or legal invoice assumptions |
| `OVR-019` | `TC-OVR-019` | `python3 visual/run_section.py s06_ap` plus payable schedule trace | `ACCOUNTANT`, `MANAGER` | external carrier, supplier, and port AP aggregate by payment schedule with no duplication | AP missing source rows, mixed vendors, or wrong schedule grouping |
| `OVR-020` | `TC-OVR-020` | `python3 visual/run_section.py s12_fuel` plus monthly reconciliation sample | `ACCOUNTANT` | monthly fuel supplier invoice reconciles only to valid trip fuel records | unlinked fuel accepted, duplicate allocation, or equal-split fallback |
| `OVR-021` | `TC-OVR-021` | treasury/read-model review plus source-linked receipt/payment checks | `ACCOUNTANT`, `MANAGER`, `ADMIN` | advances, receipts, payments, allocations, and governed offsets work without implying a company cash authority | UI claims treasury balance beyond book scope or allows unrelated mutation |
| `OVR-022` | `TC-OVR-022` | `python3 visual/run_section.py s05_ar s06_ap s98_export_workflow` | `ACCOUNTANT`, `MANAGER`, `CUSTOMER` | transport detail, monthly AR/AP, customer aging, and payment history export with matching totals | report filters diverge from source, export mismatch, or scope leak |
| `OVR-023` | `TC-OVR-023` | `python3 visual/run_section.py s07_payroll s07_payroll_workflow` plus paired-trip salary sample | `ACCOUNTANT`, `MANAGER`, `DRIVER` | salary, pair supplement, and governed fuel-variance discipline derive from canonical trip facts | salary closes from stale facts, duplicate supplement, or wrong discipline source |
| `OVR-024` | `TC-OVR-024` | `./run_all.sh 16` plus fleet and reminder review | `ADMIN`, `MANAGER`, `ACCOUNTANT` | maintenance/inspection reminders and depreciation/fixed-cost allocation render from configured vehicle data | reminder gaps, fixed-cost omission, or wrong vehicle source |
| `OVR-025` | `TC-OVR-025` | `python3 visual/run_section.py s11_finance_pnl` plus dashboard low-margin sample | `MANAGER`, `ACCOUNTANT`, `ADMIN` | source-linked net P&L splits own fleet vs external carrier and low-margin alert is configuration-driven | hard-coded threshold, merged fleet classes, or invented attribution |
| `OVR-026` | `TC-OVR-026` | `python3 visual/run_section.py s11_finance_pnl s98_export_workflow` | `MANAGER`, `ACCOUNTANT`, `ADMIN` | daily, monthly, shipment, and trip P&L reports reconcile and expose honest attribution | totals drift across screens or missing source trace |
| `OVR-027` | `TC-OVR-027` | `./run_all.sh 15` plus `python3 visual/run_section.py s03_cus` and portal manual sweep | `CUSTOMER`, `ACCOUNTANT`, `CLERK` | portal shows only own shipment status, POD scans, Debit Notes, statements, and acknowledgements/downloads | foreign-customer leak, office mutation, or chat/office-only surface exposed |

## 7. Cross-cutting mandatory scenarios

These scenarios are additional gates. They are not optional if the related OVR
row passes.

### `TC-WB-901` Routine completion actor separation

- Execute one full close where:
  `DRIVER`/`FORWARDER` finish evidence,
  `CLERK`/`cus` confirms recovered POD and cost dossier,
  `ACCOUNTANT`/`ketoan` completes.
- Pass:
  the checker and completer account IDs are different and auditable.
- Fail:
  one account performs both routine check and completion.

### `TC-WB-902` Governed `MANAGER` or `ADMIN` exception close

- Trigger only on a dedicated exception fixture.
- Pass:
  exception path demands reason, scope, and audit entry, and does not redefine
  routine authority.
- Blocked:
  no approved exception fixture or no safe environment.

### `TC-WB-903` Fail-closed AR/AP capture on every completion entry point

Run each available completion entry point:

- shipment detail completion button;
- any batch or list completion action;
- retry/replay path after a failed completion;
- governed supervisory exception path, if present;
- direct API call used by automation or back-office tooling.

Pass:

- forced AR failure rolls back completion;
- forced AP failure rolls back completion;
- no `COMPLETED` state, posting, snapshot, or report row becomes visible after
  a failed capture;
- retry after the failure succeeds exactly once.

Blocked:

- failure injection cannot be exercised safely in the chosen environment.

### `TC-WB-904` Duplicate, retry, and concurrency

Minimum cases:

- same `Idempotency-Key` replay on create, approve, complete, pay, refund, and
  salary close;
- concurrent edit on shipment/cost/debt with stale version;
- concurrent approve where first valid approve wins and later attempts reject;
- duplicate dispatch pair/complete requests;
- repeated portal acknowledgement.

Pass:

- one valid result only;
- later attempts return coherent conflict or replay responses;
- audit trail records rejected attempts.

### `TC-WB-905` Crash and recovery windows

Minimum crash points:

- after POD upload session creation;
- after object upload but before metadata attach;
- after metadata commit but before completion submit;
- during replacement cleanup;
- during completion after posting begins but before AR/AP succeeds.

Pass:

- no orphaned approved evidence;
- no unreadable evidence can satisfy POD gate;
- recovery or sweep logic preserves one consistent visible state.

### `TC-WB-906` Migration rehearsal

Use disposable databases only. Do not run deployment commands without release
approval.

Run and capture:

```bash
make infra
make migrate
make seed
make build
cd backend && pnpm db:migrate
```

Then verify the exact release-order compatibility matrix against the repo's
current cutover mechanics in `make demo` and `make demo-deploy`, without
executing them unless separately approved.

Pass:

- empty-db bootstrap succeeds;
- production-like copy rehearse succeeds;
- rerun is idempotent;
- old/new binary compatibility and backout commands are documented for the
  tested migration set;
- failure leaves the database in a resumable state.

Blocked:

- no disposable production-like copy or no migration sandbox access.

### `TC-WB-907` Responsive and volume acceptance

- Run every supported action for all eight roles at `1440x900`, `768x1024`,
  `390x844`, and `320x720` with large text.
- Exercise dispatch, shipment, AR/AP, reporting, and portal lists at `55`
  vehicles and `500+` orders.

Pass:

- no horizontal overflow;
- touch targets are usable;
- focus is visible;
- sidebars/drawers do not cover primary actions;
- panes are independently scrollable and bounded;
- pagination/windowing is real, not one long rendered page.

### `TC-WB-908` Evidence redaction and artifact audit

- Do not capture passwords, bearer tokens, raw cookies, personal phone numbers,
  customer email addresses, full bank account numbers, or unrestricted signed
  document contents when the field is not necessary for the finding.
- For finance evidence, keep only the values needed to prove the invariant.
- For POD or invoice evidence, crop or redact unrelated customer or signer data.

Pass:

- artifacts remain auditable while exposing only the minimum required data.

## 8. QA artifact names

Use one artifact per gate and keep failures plus reruns.

### Command-output artifacts

```text
qa/<YYYY-MM-DD>_overall-workflow_lint.txt
qa/<YYYY-MM-DD>_overall-workflow_typecheck-backend.txt
qa/<YYYY-MM-DD>_overall-workflow_backend-test.log
qa/<YYYY-MM-DD>_overall-workflow_typecheck-frontend.txt
qa/<YYYY-MM-DD>_overall-workflow_frontend-test.log
qa/<YYYY-MM-DD>_overall-workflow_build.log
qa/<YYYY-MM-DD>_overall-workflow_e2e.log
qa/<YYYY-MM-DD>_overall-workflow_migration.log
qa/<YYYY-MM-DD>_overall-workflow_review.md
qa/<YYYY-MM-DD>_overall-workflow_verify.md
```

### Manual and visual evidence

```text
qa/<YYYY-MM-DD>_overall-workflow_manual_TC-OVR-010_CLERK_390x844.png
qa/<YYYY-MM-DD>_overall-workflow_manual_TC-OVR-017_ACCOUNTANT_1440x900.png
qa/<YYYY-MM-DD>_overall-workflow_manual_TC-WB-901_checker-vs-completer.png
qa/<YYYY-MM-DD>_overall-workflow_manual_TC-WB-903_ap-fail-rollback.png
qa/<YYYY-MM-DD>_overall-workflow_manual_TC-WB-907_55-vehicles_500-orders.png
```

### Failure then rerun

```text
qa/<YYYY-MM-DD>_overall-workflow_e2e.log
qa/<YYYY-MM-DD>_overall-workflow_e2e.rerun.log
qa/<YYYY-MM-DD>_overall-workflow_migration.log
qa/<YYYY-MM-DD>_overall-workflow_migration.rerun.log
```

## 9. Exit criteria

The overall workflow regression is green only when all items below are true:

- every `OVR-001..027` row has `PASS`, `FAIL`, or `BLOCKED` evidence;
- routine completion proves `CLERK` checker and distinct `ACCOUNTANT` completer;
- governed `MANAGER`/`ADMIN` exception stays exceptional and audited;
- every completion entry point proves fail-closed AR/AP capture;
- role, viewport, and volume acceptance is green or explicitly `BLOCKED`;
- migration rehearsal is green or explicitly `BLOCKED` with owner and reason;
- artifacts are saved under `qa/` with redaction and rerun discipline;
- no pass is claimed from `ADMIN` substitution, fake data shortcuts, skipped
  mutations, or undocumented environment assumptions.
