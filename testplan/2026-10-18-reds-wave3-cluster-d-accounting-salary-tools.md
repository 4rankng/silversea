# Red-at-base wave 3 — Cluster D accounting/salary/tools (regression case)

Case ID: TC-REDSW3-D1 (quotation fuel envelope) / TC-REDSW3-D2 (Q15 payroll-unit
scope) / TC-REDSW3-D3 (reset-seed + import-inert pins) / TC-REDSW3-D4
(concurrency-sensitive parity pins).
Feature: backend suite health at base `0cd8b562` — cluster D scoped to
`quotation-entity.test.ts` (fuel-pinned cells), `q15-salary-period-routes.test.ts`
(multi-minute readiness sweep), `q10-salary-exclusion-routes.test.ts`,
`q20-official-reporting-periods.test.ts`, `penalties-list.test.ts` (insights
golden parity), `reset-seed-tool.test.ts` + `tool-executables-import-inert.test.ts`.

## Diagnosis

### TC-REDSW3-D1 — quotation-entity.test.ts (CRUD roundtrip, A4, A4+A5, A6)
Verified, not inferred: `fuel_price_periods` on the shared dev DB holds a stray
row `30000.00 @ 2026-09-09` (id 207). The grid engine resolves fuel as the
LATEST period ≤ the quotation's `effectiveDate`
(`quotation.service.ts` `buildGrid` → `resolveFreightRate({ transportDate:
effectiveDate })`), so the suite's own `29940.00 @ 2026-09-01` fixture period
never governs: every surcharge pin moves by +60đ/ℓ (1.25T: 243148 vs the
pinned 241948). The sibling suites `heso-surcharge.test.ts` (card _59) and
`surcharge-rounding.test.ts` (card _60) already document this exact leftover
and own an unoccupied far-future fuel-period window instead of fixed 2026-09
dates (the fuel-period-envelope pattern). Card _66's suite was never migrated
— its header even claimed an "isolated DB (throwaway quotation_w66)" that does
not exist in code.

Fix: apply the same envelope pattern to `quotation-entity.test.ts` — pick an
unoccupied far-future window P..P+15, set FUEL_FROM=P, EFFECTIVE_DATE=P+10,
CRUD_DATE=P+15 (the heSo=2 frame stays strictly in the future of the heSo=1
assertions). Worked numbers unchanged; calendar only.

### TC-REDSW3-D2 — q15-salary-period-routes.test.ts (161s + red)
Verified: the shared dev DB holds 2128 active drivers and
`salary.payroll_business_unit_id` is EMPTY, so
`buildSalaryPeriodReadinessSummary` runs in COMPANY scope and returns every
active driver. The suite's isolation loop then calls
`createSalaryPeriodExclusion` once per unrelated PENDING driver — over two
thousand governed transactions per run. That is the 161s runtime and the
extraordinary write pressure (amplified N-fold when several wave agents run
their suites against the same DB concurrently). The sibling suite
`q10-salary-exclusion-routes.test.ts` already solves this class with a hermetic
payroll-unit scope: save the setting, pin it to a fixture business unit, link
fixture driver users to that unit, restore in after().

Fix: apply the q10 pattern to q15-salary-period-routes (fixture unit +
user links + setting save/restore, insert-or-update aware). The
isolation-exclusion loop then sees only suite drivers and no-ops; the close /
reopen / adjustment / issue / post governance pins are unchanged.

### TC-REDSW3-D3 — reset-seed + import-inert pins
The tools themselves are correct (8/8 green in isolation at base). The red
class is the invariants' SHAPE: both suites pinned global row counts
(users count across two dry runs; a six-table fingerprint across a child
import) on a dev DB that other suites write concurrently — the wave run
reddened them with foreign writes (`user count unchanged: 10479 !== 10481`),
not with any wipe. Fix keeps full detection power with suite-owned sentinels:
the wipe plan deletes ALL users/customers/routes, so a dry run or bare import
that actually wiped anything takes the sentinels with it, while foreign
inserts no longer move the pin. All stdout pins (plan printed, disclaimer, no
`  wiped ` lines, guard silence on import) unchanged.

### TC-REDSW3-D4 — Q20 dashboard global counters (and the concurrency envelope)
Q20 test 1 reddened at base in the wave run on
`dashboard total must equal the independently decoded live truck count
(985 !== 987)`: the dashboard aggregates GLOBAL company state, and a live
truck count taken at one instant drifts by foreign inserts from another
suite. The decode pins that are internal to one dashboard response (number
types, `totalTrucks === fleetStatus sum`) stay strict; the live-parity pin is
now bracketed (live count taken before and after the dashboard call — strict
equality on a quiet DB), and the global tripCount/inTransit deltas are floored
at `before + 1` with the attribution contract carried by the suite-scoped
P&L / fuel-variance / distribution membership pins (exact, hermetic).
Q10 / penalties-insights needed no change: both are green in isolation AND
green in the wave full-suite run (see artifacts).

## Verification evidence
- Red-at-base full-suite run (this worktree, 4 wave suites running
  concurrently): `qa/2026-10-18_reds-wave3-cluster-d_full-suite-baseline.log`
  — cluster D reds: Q20 test 1 (truck parity), reset-seed `--dry-run` count
  invariant. Cluster D greens IN THE SAME RUN with the fixes already loaded:
  quotation entity 7/7, Q15 salary-period routes 6/6 in 0.44s (was 161s),
  Q10 2/2, penalties insights 3/3, tool-executables 2/2. All other reds in
  that log belong to other clusters (dispatch/E2E, QA-AUDIT-PHOI-11, trip
  photo OPS, Q23 fuel evidence).
- Post-fix scoped run (all 7 cluster files, foreign suites still active):
  `qa/2026-10-19_reds-wave3-cluster-d_scoped-suites.log` — 37/37 pass, 0 fail.
- `qa/2026-10-19_reds-wave3-cluster-d_be-tsc.txt` — 0 errors.
- `qa/2026-10-19_reds-wave3-cluster-d_lint.txt` — 0 errors.


## Regression pins
- `quotation-entity.test.ts` keeps the card _66 worked numbers while owning its
  fuel window (envelope pattern) — guards against any future stray period
  inside the suite's own window.
- `q15-salary-period-routes.test.ts` keeps every governance pin and now cannot
  sweep the global driver roster.

## Not covered
- Other roles / mobile viewport: N/A (backend test-only change).
- Staging env: local shared dev DB only.
- Rollback path: revert the single commit; no schema, route, or
  shared-contract change.
- A quiet-DB (single-runner) full-suite rerun was not repeated end-to-end
  after the final edits; the scoped 37/37 run plus the mid-wave full-suite
  log cover the changed files, and the two contention fixes (sentinels,
  brackets) are exercised under LIVE foreign-suite writes, a strictly harsher
  condition than solo.
- Cross-suite contention while several wave agents run concurrently is
  accommodated test-side; full-suite runs over one shared dev DB should still
  be serialized (orchestrator policy).
