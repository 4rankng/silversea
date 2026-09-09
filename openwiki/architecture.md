---
type: Reference
title: "Architecture and Codebase Map"
description: "System-level map of SilverSea's backend, frontend, shared contracts, persistence, QA, and operational boundaries. Traces dispatch planning (multi-day allocation, external-trip staff close), the CUS workspace, and fuel-surcharge pricing through validated APIs and transactional services. Reflects the origin/prod → main merge at commit 468bd371 plus the 2026-09-09 FROZEN_MAX_LOC contract bump."
tags: [architecture, dispatch, contracts, testing, operations]
verified:
  - by: openwiki/0.5.0
    at: 2026-09-09T05:48:17.279Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-7633dc761224043313afe6c1
    resource: repo://backend/src/routes/shipments/dispatch-planning.routes.ts
  - id: openwiki-source-137a747b8b837eb52cb71981
    resource: repo://backend/src/routes/trips/status.ts
  - id: openwiki-source-a08d0826dadf2aa659264512
    resource: repo://backend/src/services/aging.service.ts
  - id: openwiki-source-07d8d0b4bd1aa611aec4651d
    resource: repo://backend/src/services/dispatch-task-tags.service.ts
  - id: openwiki-source-3aa37080f2fc30dc35478ecb
    resource: repo://backend/src/services/pricing.service.ts
  - id: openwiki-source-277912ce7743608f9e00b0cf
    resource: repo://backend/src/services/shipment-containers.service.ts
  - id: openwiki-source-4afb35865261980e32bf269a
    resource: repo://backend/src/services/trip-create.service.ts
  - id: openwiki-source-69663e0b3d165a9d5d1ceca1
    resource: repo://backend/src/services/trip-external-close.service.ts
  - id: openwiki-source-15eb9c2bd185a2889b65874f
    resource: repo://backend/src/tests/dispatch-detail-plan.test.ts
  - id: openwiki-source-22f3807e21b8281a0a2994f6
    resource: repo://backend/src/tests/dispatch-task-tags.service.test.ts
  - id: openwiki-source-1047363cf615000e4c9bb694
    resource: repo://frontend/package.json
  - id: openwiki-source-589fae43514a21e0b98492f6
    resource: repo://frontend/src/features/dispatch/components/DispatchIssueStatus.tsx
  - id: openwiki-source-c2b24497935143d8246afc05
    resource: repo://frontend/src/features/dispatch/master-plan/allocationDayHelpers.ts
  - id: openwiki-source-564940d299e8b46bece798bc
    resource: repo://frontend/src/features/dispatch/master-plan/DispatchAllocationDaySection.tsx
  - id: openwiki-source-38dccf151d65378ca3cdc49f
    resource: repo://frontend/src/features/dispatch/master-plan/DispatchAllocationPopover.tsx
  - id: openwiki-source-a39f35618da371aac500abf1
    resource: repo://frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx
  - id: openwiki-source-2df1e682c7dcb9ba56509847
    resource: repo://frontend/src/styles/font-family-contract.test.ts
  - id: openwiki-source-316dfb4c2b43d4800b46fd34
    resource: repo://frontend/src/tests/structure.guard.test.ts
  - id: openwiki-source-15e64fbca55f9b222f340423
    resource: repo://scripts/githooks/pre-commit
  - id: openwiki-source-592889025dfa2f31c9e5bba0
    resource: repo://shared/package.json
  - id: openwiki-source-b2fbadbe08a5df4d9cfca2ed
    resource: repo://shared/src/calculations/fuelSurcharge.ts
  - id: openwiki-source-5fdaee04264279630f2bb947
    resource: repo://shared/src/calculations/round.ts
  - id: openwiki-source-f7fd2de8ba29e8649d8291fb
    resource: repo://shared/src/calculations/tripTotals.ts
  - id: openwiki-source-ff09d8d8bdd90f494973e136
    resource: repo://shared/src/schemas/cus-shipment-workspace.ts
  - id: openwiki-source-b650eeedb63cbb73aa890ab2
    resource: repo://shared/src/schemas/index.ts
generated: { by: "opencode", at: "2026-09-09T05:48:17.279Z" }
---

# Architecture and Codebase Map

> Related: [Overview](overview.md) · [Quickstart](quickstart.md) · Roles: `AGENTS.md` · Domain flows: `docs/prd/QuyTrinhO2C.md`

## System boundaries

SilverSea is a pnpm monorepo: `backend/` (Express + TypeScript), `frontend/` (React + Vite), `shared/` (`@tingting/shared`), plus `testplan/` (role-based QA flows), `docs/prd/` (canonical product specs), and `openwiki/` (generated repository knowledge). The local runtime uses Postgres and Redis; the production application is reached through the deployment files rather than through the development stack.

- **Backend** owns authenticated HTTP routes, role checks, business services, persistence, and integration tests. Drizzle ORM is the database access boundary; services compose queries and write commands rather than exposing database details to the frontend.
- **Frontend** owns route screens and feature modules. Dispatch is split into master-plan and detailed-plan surfaces, with API clients and React Query hooks between the screens and the HTTP API.
- **Shared** owns Zod contracts, shared enums, navigation vocabulary, and financial calculations. Cross-package schema changes require rebuilding `shared/` before backend tests that import its compiled package.
- **QA and product contracts** are first-class boundaries: `testplan/` contains role-based acceptance cases, `docs/prd/` contains current business rules, and focused unit/integration tests pin the contracts at the package that owns them.

## Dispatch planning flow

The dispatch UI has two complementary read models. The master plan groups shipment rows for operational allocation; the detailed plan exposes one row per fulfillment for filtering and editing. Both consume the dispatch planning client and backend route family, while the backend services build the authoritative view from shipments, fulfillments, appointments, ports, trips, and active pairs.

1. The master-plan grid renders one schedule block per container appointment and can restrict blocks to a selected business date. Its port columns aggregate container-type counts by pickup/dropoff pair so per-day appointment splits do not produce duplicate demand lines. When appointment groups are unavailable, the grid uses the shipment-level fallback fields.
2. The detailed-plan client requests paginated rows with direction, assignment, port, delivery-point, hour, and dispatch-zone filters. The backend validates IDs, time formats, zone length, and allowed enum values before the service builds a stable priority order and applies the same filters to rows and totals. The detail-plan row carries a `taskStatus` of `'READY' | 'DISPATCHED' | 'COMPLETED'`, so the grid can render a finished chip the moment a trip's external-carrier staff close fires.
3. Single-save edits flow through the atomic plan endpoint: carrier, vehicle, estimates, classification, and the optional driver note commit together or not at all, guarded by both row versions. The dispatcher-owned classification is persisted while the lot-level combined flag is CUS-owned and stripped at the route.
4. The detailed-plan editor mounts a shared note composer that drives a global tag pool (`listDispatchTaskTags` / `createDispatchTaskTag` / `updateDispatchTaskTag` / `deactivateDispatchTaskTag` in `dispatchPlanningClient.ts`), validates labels (length, separator safety, NFC normalization), and exposes soft-delete with an active/inactive re-resurrection path so historical notes keep their text.
5. Carrier-allocation edits in the master plan split demand by packing/return day (`DispatchAllocationDaySection` + `allocationDayHelpers`), validate against the per-day demand, and save through a partial-save endpoint that echoes the persisted row back to the grid. The dialog rebuild groups rows by day, surfaces per-day totals, and the inline edit dropdown collapses back to a compact view when the user dismisses the popover.
6. External-carrier staff close (`completeDispatchExternalTrip` in `dispatchPlanningClient.ts`, served by `trip-external-close.service.ts`): when an external driver does not run the driver app, dispatch or CUS confirm completion from the detail-plan row. The row flips `taskStatus` to `'COMPLETED'` and the same `transitionTripStatus` machinery used by the driver close fires, so revenue/AP/AR post and ledger snapshots stay consistent.
7. A partially-dispatched lot keeps its remaining `READY` rows re-assignable in both the carrier-fleet reassign path and the detail-plan save path; only terminal statuses (`COMPLETED`, `CANCELED`) block further carrier changes. This mirrors the issuance-side fix that flips a lot to `DISPATCHED` on the first issued container, so dispatch can plan the rest of the lot without stranding it.
8. Long operational notes in the master plan render with truncation plus a `MasterPlanNoteModal` popup so a dense row never overflows its cell. The modal preserves the existing edit affordance and is keyboard-accessible.

## CUS workspace read model

The CUS workspace exposes two complementary views of the same shipment list. The overview endpoint projects the document- and customer-centric columns the CUS workboard needs; the container endpoint adds the per-container schedule and dispatch state used by the detail screen.

- Both endpoints reject filters the other endpoint owns (a detail-only `dispatchStatus` filter is rejected on the overview), so a stale or misrouted filter cannot silently no-op.
- The list item contract carries `effectiveFactoryNames`, `appointmentGroups`, and per-container port groups so downstream surfaces can render multi-factory lots, per-day schedules, and per-day port demand without an extra round trip.
- The CUS dispatch-status chip vocabulary is now a five-state taxonomy (`AWAITING_VEHICLE`, `PLANNED`, `CREATED`, `IN_TRANSIT`, `COMPLETED`); the legacy coarse `ASSIGNED`/`UNASSIGNED` aliases remain accepted by the container endpoint so older links keep filtering.
- A CUS ledger container row stays at `PENDING_DATE` until every container in the FCL lot has its own `customerAppointmentAt`; clearing the last appointment of a lot that already moved to `READY_FOR_DISPATCH` is rejected with 409 so the workboard's "Chưa chốt ngày" warning can never silently clear.
- The shared contract is the single source of truth for filter shapes, sort keys, and the chip vocabulary; backend services and frontend hooks both import from the same package.
- The detail-screen container ledger has inline per-row `Xác nhận` (confirm) and `Revert` actions, with success/error toasts and Enter/Escape handling, so the user no longer has to press Enter or hunt for the header "Hoàn tất" button after typing a container appointment. Inline draft editors dismiss via `useClickOutside` so the row state stays consistent on accidental focus loss.
- The detail-screen schedule editor accepts the appointment in a `giờ`-first layout with 24-hour inputs (`ShipmentContainerScheduleEditor`), so the user enters the time the same way it is read on the workboard and the typed value can be parsed back deterministically.

## Pricing and fuel surcharge

The pricing service composes freight, fuel surcharge, and shared financial calculations into one transaction-aware surface. The fuel-surcharge path delegates the math to `@tingting/shared`.

- The shared `computeFuelSurcharge` returns 0 when the base price is unset, when the share percent is non-positive, when quota liters are non-positive, or when the current price does not exceed the base; otherwise the surcharge is `roundInt(round2dp(delta × quotaLiters × sharePct/100))`. Each trip creation snapshots the inputs (`currentFuelPrice`, `baseFuelPrice`, `quotaLiters`, `customerSharePct`) so future price changes do not retroactively rewrite cước đã phát hành.
- The pricing service is the only place that resolves per-customer share percent and per-config base price; trips persist the resolved numbers so downstream ledger reads never re-resolve.
- Shared schema changes require rebuilding `@tingting/shared` before backend tests that import its compiled package — the shared/dist staleness is the most common cause of "does not provide an export named ..." import errors.

## Persistence and migration discipline

Drizzle is the only ORM in active use; the migration journal is the source of truth for schema history. Generated SQL stays in `backend/drizzle/` and every schema edit must be paired with a `make generate` run followed by a pre-commit typecheck. The `db-drift-check` make target asserts that a fresh generate is a no-op on a clean tree, catching the "schema edit has no migration" regression class.

- A portable mkdir lock serializes `make generate` so two concurrent agents cannot both claim the next journal index.
- The pre-migrate `db-backup` gate fails closed: a backup under 1 KB aborts the migration rather than silently continuing.
- Integration tests that touch Redis must close their connection (see `dispatch-fulfillment.test.ts`); an open handle at exit crashes the worker.

## Cross-cutting contracts

- **RBAC** is enforced at the route boundary through Casbin; accountants are excluded from operational writes even when the underlying service supports them. The dispatch plan routes strip the dispatcher from `isCombined`, the external-trip close routes guard the dispatcher/CUS/ADMIN/MANAGER roles, and the note composer route mirrors the read mask on the plan.
- **Idempotency** keys travel with every material write through `runShipmentWrite`; the dispatch plan save, the carrier-fleet vehicle endpoints, and the trip status commands require an `Idempotency-Key` header and replay deterministically. Plan-save conflicts surface the backend's 409 message verbatim so the UI can echo "Lô hàng đã có thay đổi khác, vui lòng tải lại" without re-deriving it.
- **Material write registry** enumerates every material write endpoint so the pre-commit gate can guard completeness; the test suite asserts no out-of-registry writes slip in.
- **Local date formatters** live in `lib/format`; the structure guard bans bespoke formatters outside an allowlist and names every documented exception.

## Mechanical gates and enforcement

- The pre-commit hook typechecks the touched project and runs the frontend structure guard so a tree that does not typecheck or a file past its frozen ceiling cannot reach the commit boundary. Bypass is `git commit --no-verify` with a stated reason in the commit body.
- The backend SIZE_BASELINE and the frontend `FROZEN_MAX_LOC` only shrink: a file that grew needs a justified entry review. When two branches independently grow the same file, the ceiling is bumped to the actual merged line count with either a per-line comment naming both feature sets or, for bulk post-merge sweeps, a single global contract-change rationale in the file header. The 2026-09-09 origin/prod → main merge swept 48 entries by +1..+8 lines and is documented as one such contract change in `structure.guard.test.ts`.
- The font-family contract bans `font-variant-numeric: tabular-nums` and the JetBrains Mono fallback: Be Vietnam Pro uses proportional figures, so right-aligned numerics rely on `text-align: right` instead of a no-op tabular-numeral declaration. The allocation summary, schedule editor, and ledger rows all honor this contract.
- The QA gate table in `AGENTS.md` is mandatory for every change; a touched gate is not optional. Shared contract, Drizzle schema, financial-calculation, and RBAC changes require the full set including the e2e runner. Testplan ships a reusable harness (`testplan/qa/scripts/run-all.mjs`, `run-case.mjs`, `smoke.mjs`, `lib/{env,harness,selectors}.mjs`) and stores evidence under `testplan/qa/evidence/<date>_<scope>/`; the root `qa/` directory remains the cross-project evidence sink per `AGENTS.md`.

## Related pages

- [Overview](overview.md) — SilverSea at a glance, ports, removed features.
- [Quickstart](quickstart.md) — first-run setup, scripts entry points, validation commands.
- `AGENTS.md` — repo contracts, role table, QA gate table, knowledge-base notes.
