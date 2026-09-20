# BACKLOG — Silversea test debt from recent intentional refactors

> **Scope (2026-09-06, superseded 2026-09-20 — see purge note below)**: these tests asserted the OLD governance queue / dispatch / config-write contracts. The corresponding production code is intentional per its commit messages (`d3599b0b` governance direct-apply, `7eb62387` customer `isCarrier` + maker-checker removal, `4651f8f2` PENDING_EXPENSE_APPROVAL retirement). Each test here needs a one-off re-pin to the new contract — no production code change is required.

Each line is one fix: scope = the test file (read + targeted edit), expected-effort = minutes.

> **2026-09-20 approval-language purge (card 20260920_33, decision B3 of _27):** every
> approval-shaped item below was re-verified against the current tree and CLOSED — the
> queue contract they described was already re-pinned or removed by earlier commits
> (`42b50f8b` cluster-A direct-apply re-pin, `7d98d71f` governance_actions drop). The
> approval-shaped q23 test was deleted back in `42b50f8b`, before this card; per-item
> status + evidence are inline. Historical sections below the line stay read-only.

---

## Cluster A — Governance queue → direct-apply (commit `d3599b0b`, 2026-09-05) — ALL ITEMS CLOSED 2026-09-20

> The queue was removed with the internal-approval ruling (2026-09-15); the recipe below
> is kept only as the historical record of how these files were re-pinned. Every item in
> this cluster verifies green against the current tree — do NOT re-apply these steps.

The pattern was uniform across these files. `backend/src/tests/config-material-update-governance.test.ts` was the template — re-pinned in the same commit to the new contract for `MANAGER` writes (direct apply + APPROVED audit row).

Common fix steps (per test in cluster A) — HISTORICAL, approval removed 2026-09-15:
1. Replace `expectPendingAction(201, 'PENDING_CHECK')` with `expectDirectApply(200)` + a follow-up `db.select` for the matching APPROVED audit row in `governanceActions`.
2. Remove the `checkAction` → `approveAction` two-step when a test asserts the row only after approval. The row is now applied on the first PUT/POST.
3. Drop `'PENDING' in body` / `body.status === 'PENDING_CHECK'` assertions.

### A-1 — `backend/src/tests/q15-price-config-governance.test.ts` (8 ✖) — CLOSED 2026-09-20: already re-pinned to direct-apply by `42b50f8b`. The remaining `PENDING_CHECK` strings are NEGATIVE assertions (`assert.notEqual(status, 'PENDING_CHECK', 'direct ... must not create governance action')`) — they pin the absence of the queue. No edit needed.
Historical failure list (all resolved; test names kept as record — the approval-shaped ones were deleted, the rest re-pinned to direct-apply):
- `lets Admin directly approve a legacy pending price-config request they created` — DELETED (approval removed 2026-09-15)
- `serializes duplicate governed requests even with different idempotency keys` — re-pinned, green
- `submits all financially material generated config resources for maker/checker/approver review before any DB effect` — DELETED (approval removed 2026-09-15)
- `replays identical pending requests, rejects viewers, blocks checker self-approval, and prevents stale approval on the shared config path` — DELETED/superseded by the direct-apply replay pins
- `keeps governed rows unchanged when returned for evidence or rejected` — re-pinned, green
- `applies ADMIN price-config writes immediately even when a pending request exists` — re-pinned, green
- `keeps ordinary customer edits direct while debt-authority fields require governance` — re-pinned, green
- Effort line obsolete: the two-step `check/approve` helpers no longer exist anywhere in the file.

### A-2 — `backend/src/tests/q23-config-crud-idempotency.test.ts` (3 ✖) — CLOSED 2026-09-20: the approval test `keeps an accountant fuel-surcharge share update pending and unchanged until independent approval` was already DELETED by `42b50f8b` (no separate deletion commit needed — nothing to delete on this tree). The two idempotency tests (`replays a financial-authority create exactly...`, `commits the existing customer partner hook...`) are kept and green; full file passes 1/1 on the isolated runner (2026-09-20).

### A-3 — `backend/src/tests/q12-q13-no-invoice-boundary-routes.test.ts` (1 ✖) — CLOSED 2026-09-20: the approval-titles test no longer exists; the file's config-CRUD test asserts direct apply ("the update applies directly (200 + applied row, no approval flow)"). Nothing to re-pin.

### A-4 — `backend/src/tests/q23-singleton-config-routes.test.ts` (1 ✖)
- "road/fuel/company routes enforce RBAC, replay exactly, reject drift, and require current version on existing data"
- Effort: 15 min.

### A-5 — `backend/src/tests/final-q01-q02-q07-q08-coverage.test.ts` (1 ✖) — CLOSED 2026-09-20: the `approvePendingAction` queue helper is gone from the file; current assertions pin direct apply ("Direct apply: 200 with the updated row, no approval step") plus the APPROVED audit row. Nothing to re-pin.

### A-6 — `backend/src/tests/q15-governance-foundation.test.ts` (foundation tests)
- Likely already PASS (re-verifying): the file tests schema-level concerns, not queue behaviour. Run `pnpm test -- src/tests/q15-governance-foundation.test.ts` to confirm before touching.

---

## Cluster B — PENDING_EXPENSE_APPROVAL retirement (commit `4651f8f2`) — CLOSED 2026-09-20

The retired stage left the vocabulary entirely (`7dd66d05`); no test file references it anymore (the remaining outliers listed below were re-pinned by `efc94827` and verified clean 2026-09-20):

### B-1 — `backend/src/tests/shipment-accounting-lock.test.ts` — CLOSED 2026-09-20: zero `PENDING_EXPENSE_APPROVAL` references remain in the file; the lock tests pin the direct `COMPLETED` close. Nothing to re-pin.

---

## Cluster C — `paginated listing returns SQL pagination + full-set aggregates` (data-state)

### C-1 — `backend/src/tests/advance-settlement-reads.test.ts:162`
- Assertion `assert.ok(page.statusAmounts['PENDING'] >= 1_500_000)` fails — the seeded PENDING amount is below the threshold.
- **Fix**: bump the seeded loan-amount in the `before` block of this test or relax the comparison to `>= 1_000_000`.
- Effort: 5 min. **Not production** — pure test-fixture tuning.

---

## Cluster D — Dispatch zones / port-zones / date defaults

### D-1 — `backend/src/tests/dispatch-detail-plan.test.ts` (~3 ✖)
- "zone filter narrows rows to a zone's ports (either side)"
- "returns trucks with D-1 drop and D+1 pickup evidence; canceled lots excluded"
- "missing date defaults to today (Asia/Ho_Chi_Minh)"
- Diagnostic: tests use `zone=LACH_HUYEN` and get a 400 (`Khu vực điều phối không hợp lệ`). Look at `dispatch-planning-detail-plan.service.ts:1166` `requireDispatchZone`. The seeded `LACH_HUYEN` zone has `isActive=true` (default), but a previous test run that ran dispatch-zone-crud may have left the row in an inconsistent state (e.g. test-zone `zc` deactivated, then later re-activated; the LACH_HUYEN test interaction).
- **Fix**: ensure the seeded `LACH_HUYEN` zone is reset to `isActive=true` in the `before` block; OR rework the test to seed its own zone and pass that.
- Effort: 30 min.

### D-2 — `backend/src/tests/dispatch-zone-crud.test.ts` (1 ✖)
- "deactivating a referenced zone is blocked; an unreferenced one deactivates" — the second assertion (deactivate the test zone) fails.
- Likely a seed-data interaction with tests sharing DB.
- Effort: 15 min.

### D-3 — `backend/src/tests/ports-dispatch-zone-contract.test.ts` (1 ✖)
- "admin can create and clear a port zone" — admin lifecycle API returns non-2xx on the second step.
- Effort: 15 min.

---

## Cluster E — Misc single-test failures

### E-1 — `backend/src/tests/customer-portal-routes.test.ts` — CLOSED 2026-09-20: zero `PENDING_EXPENSE_APPROVAL` references remain; the portal-event tests pin emission on the direct `COMPLETED` transition. Nothing to re-pin.

### E-2 — `backend/src/tests/M3.3 — deriveMilestoneFromTripStatus.test.ts` (1 ✖) — CLOSED 2026-09-20 (obsolete): the standalone M3.3 test file was removed in the status-vocabulary wave; milestone derivation now lives in `milestone.service.ts` / `trip-status-machine.service.ts` and its `IN_TRANSIT → COMPLETED` chain is pinned by the trip-status-machine suite. Nothing to re-pin.

### E-3 — `backend/src/tests/dispatcher-catalog-create-authz.test.ts:1:3932` (depends on D-3 fix above)
- Once the customer-intake service is fixed (commit `efc94827`), this should pass. Re-run after merge.

### E-4 — `backend/src/tests/casbin-config-gate.test.ts` (1 ✖)
- Indirectly affected by `d3599b0b`: ADMIN routes now apply directly, not via casbin `config` gate.
- Effort: 15 min.

### E-5 — `backend/src/tests/dispatcher-catalog-create-authz.test.ts` (catalog create authz)
- One sub-test asserts a specific RBAC gate that's no longer used (the queue is gone). 
- Effort: 10 min.

### E-6 — `backend/src/tests/seed-bootstrap-app-owned-idempotency.test.ts`
- "full seed does not resurrect stale normalized variants and creates canonical demo users separately"
- Diagnostic needed — may be data-state dependent on the prior test runs leaving `_normalized_variants` rows.
- Effort: 30 min.

---

## Sequencing recommendation

Run in this order to maximize green-at-each-step:

1. Cluster A-1 (q15) → Cluster A-2/A-3/A-4/A-5 (smaller governance files) — gives the biggest single batch of greens.
2. Cluster E-3 re-run (depend on D-3 production fix from `efc94827`).
3. Cluster D, then Cluster E-1, E-2, E-6 (independent).
4. Cluster C as needed.

**Expected outcome**: each cluster as scripted takes ≤90 minutes. After all are done the next `pnpm test` should report 0 ✖.


---

## Lean-down wave (2026-09-06) — SHIPPED

DB lean-down vs `docs/prd/` + `testplan/` audit; every change prod-preflight-verified (read-only counts) before drop.

- `4355205d` AI assistant feature removed end-to-end (4 pgvector tables + services/UI).
- `127eb002` GPS/telemetry tables + journey-map UI dropped (user directive: "any feature requires live GPS tracking please remove all"). `photo_geotags` + map4d place-search kept.
- `2195d35e` Retention jobs: notifications 30d-read/180d-any, scheduler_run_logs 30d, durable_effect_jobs SUCCEEDED 30d, master_import_row_results 90d; audit_logs + idempotency_keys never purged.
- `7dd66d05` PENDING_EXPENSE_APPROVAL removed from the status vocabulary (3 layers + seed); legacy 'DELIVERED' reads as IN_TRANSIT; DB text value stays as documented ghost.
- `b0cf80d8` Dead tables dropped: `delete_requests`, `fuel_surcharge_configs` (zero refs, zero prod rows).
- `e2c493ec` / `cfa9ac72` 1:1 merges: `trip_instructions` → trips columns; `shipment_container_charge_facts` → `shipment_containers` charge columns.
- Dead columns dropped: `customers.freight_payment_term_days` (FE edits were silently discarded — bug removed with the field), `trips.storage_fee_revenue`, `trips.driver_order_accepted_at`.

### Explicitly kept (do NOT re-propose dropping)
- `drivers.assigned_truck_id` — live primary-slot source (dispatch planning + FleetPage); audit's "redundant mirror" call was wrong.
- `trip_containers.seal_number` — back-compat mirror still read by forwarder flows + written by dispatch snapshot/OCR; requires finishing the multi-seal migration first.
- `fuel_config` (live reader in trip-create), `routes.default_legs` (live template), `pricing_tables` (rate cards pending), `governance_actions` (audit history), `scheduler_run_logs` (raw-SQL writer), `salesperson_assignments` (reader exists; no writer is a data-entry question).
- Index trim: no-op with evidence — `scheduler_run_logs_job_started_idx` EXPLAIN-proven load-bearing on prod.

### Open follow-ups
- **Trips split — SHIPPED 2026-09-06** (stages B/C/D same day): `trips` 99→47 ops columns; financial block → `trip_financial_state` (44 cols), carrier block → `trip_carrier_info` (8 cols), both 1:1 by tripId; `trips_composite` view preserves the full-row read shape (migrations 0054–0056; 268/268 byte-identical value probe across the cutover). Deploy = single shot per plans/260906-1032-db-lean-down/prod-deploy-plan.md.
- Multi-seal migration completion → then drop `trip_containers.seal_number` mirror.
- QuyTrinhO2C Confluence page needs the same state-machine update (this repo doc updated 2026-09-06).
