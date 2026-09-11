---
name: "test-debt-and-db-lean-down"
description: "Governance direct-apply + PENDING_EXPENSE_APPROVAL retirement re-pin map (clusters A-E with efforts), DB lean-down shipped decisions and the do-NOT-drop keep-list, trips split state"
folder: "features"
tags: ["test-debt", "governance", "db-lean-down", "trips-split", "state"]
updatedAt: "2026-09-09T18:09:50.683Z"
author: "AI Engineer"
---

# Backend test debt & DB lean-down (migrated from BACKLOG.md, 2026-09-10)

## Architecture (governance contract change)

Backend tests from the intentional refactors still assert OLD contracts; each needs a one-off **re-pin** (no production change):
- `d3599b0b` (2026-09-05): governance queue → **direct-apply** (MANAGER writes apply immediately + APPROVED audit row in `governanceActions`; no more PENDING_CHECK two-step). Re-pin template: `backend/src/tests/config-material-update-governance.test.ts`.
- `7eb62387`: customer `isCarrier` + maker-checker removal.
- `4651f8f2` / `efc94827`: **PENDING_EXPENSE_APPROVAL retired** — status chain is now `IN_TRANSIT → COMPLETED` directly; legacy 'DELIVERED' reads as IN_TRANSIT (DB text value stays as documented ghost).

## State: outstanding re-pin clusters (as of 2026-09-10)

- **A-1** `q15-price-config-governance.test.ts` (8 ✖) — replace check/approve helpers with audit-row queries. 60–90 min.
- **A-2** `q23-config-crud-idempotency.test.ts` (3 ✖) — 30 min. **A-3** `q12-q13-no-invoice-boundary-routes.test.ts` (1 ✖) — 15 min. **A-4** `q23-singleton-config-routes.test.ts` (1 ✖) — 15 min. **A-5** `final-q01-q02-q07-q08-coverage.test.ts` (1 ✖, `approvePendingAction` helper assumes old queue) — 20 min. **A-6** `q15-governance-foundation.test.ts` — likely already passing, verify first.
- **B-1** `shipment-accounting-lock.test.ts` — re-pin `PENDING_EXPENSE_APPROVAL` → `COMPLETED`. 20 min.
- **C-1** `advance-settlement-reads.test.ts:162` — seed/threshold fixture tuning only (`PENDING` amount below `>= 1_500_000`). 5 min.
- **D** dispatch zone/port-zone/date-defaults: `dispatch-detail-plan.test.ts` (~3 ✖; seeded `LACH_HUYEN` zone left inactive by test interactions — reset `isActive=true` in `before` or seed own zone), `dispatch-zone-crud.test.ts` (1 ✖), `ports-dispatch-zone-contract.test.ts` (1 ✖; admin lifecycle API non-2xx on 2nd step).
- **E** misc: `customer-portal-routes.test.ts` (portal event fires on IN_TRANSIT→COMPLETED now), `M3.3 — deriveMilestoneFromTripStatus.test.ts` (milestone chain direct), `dispatcher-catalog-create-authz.test.ts` (stale RBAC gate), `casbin-config-gate.test.ts` (ADMIN applies directly, no casbin config gate), `seed-bootstrap-app-owned-idempotency.test.ts` (data-state: stale `_normalized_variants` rows).
- Sequencing for green-at-each-step: A-1 → A-2..A-5 → E-3 re-run (after D-3 fix) → D → E-1/E-2/E-6 → C. Expected ≤90 min/cluster; goal 0 ✖.

## Decisions: DB lean-down wave (2026-09-06, SHIPPED — do not re-litigate)

Removed end-to-end: AI assistant feature (4 pgvector tables + services/UI, `4355205d`); GPS/telemetry tables + journey-map UI (`127eb002`, user directive: remove all live-GPS features; `photo_geotags` + map4d place-search kept); retention jobs (notifications 30d-read/180d-any, scheduler_run_logs 30d, durable_effect_jobs SUCCEEDED 30d, master_import_row_results 90d; audit_logs + idempotency_keys never purged); PENDING_EXPENSE_APPROVAL vocabulary; dead tables `delete_requests`, `fuel_surcharge_configs`; 1:1 merges `trip_instructions`→trips columns, `shipment_container_charge_facts`→`shipment_containers`; dead columns `customers.freight_payment_term_days` (FE edits were silently discarded), `trips.storage_fee_revenue`, `trips.driver_order_accepted_at`.

**Explicitly KEPT (do NOT re-propose dropping):**
- `drivers.assigned_truck_id` — live primary-slot source (dispatch planning + FleetPage).
- `trip_containers.seal_number` — back-compat mirror read by forwarder flows + written by dispatch snapshot/OCR; drop only after multi-seal migration completes.
- `fuel_config` (live reader in trip-create), `routes.default_legs` (live template), `pricing_tables` (rate cards pending), `governance_actions` (audit history), `scheduler_run_logs` (raw-SQL writer), `salesperson_assignments` (reader exists).
- Index `scheduler_run_logs_job_started_idx` — EXPLAIN-proven load-bearing on prod.

**Trips split (SHIPPED 2026-09-06):** `trips` 99→47 ops columns; financial block → `trip_financial_state` (44 cols), carrier block → `trip_carrier_info` (8 cols), both 1:1 by tripId; `trips_composite` view preserves full-row read shape (migrations 0054–0056; 268/268 byte-identical probe across cutover).

## Pitfalls

- Shared test DB: tests that deactivate seeded rows (dispatch zones) poison later test runs — reset seeded state in `before` blocks.
- QuyTrinhO2C Confluence page needed the same state-machine update as the repo doc (2026-09-06).
- Remaining open follow-up: complete multi-seal migration → then drop `trip_containers.seal_number` mirror.
