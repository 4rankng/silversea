---
phase: 1
title: "Wave 0 — Foundation: Shipment entity + Scheduler"
status: pending
priority: P1
dependencies: []
---

# Phase 1: Wave 0 — Foundation

## Overview

Introduce the two missing pieces of infrastructure that every later wave depends on:

1. A first-class **`shipments` (lô hàng) entity** with its documents, containers, and
   declarations — the keystone for M3, M4, M9, M10, and M5.6.
2. A **scheduler/cron layer** — needed by M5.7 (auto reminders), M7.3 (period close), and
   any future batch job (statement issuance, fuel reconciliation).

This wave is safe to start regardless of which downstream PRD items get confirmed, because
both pieces are pure foundation with no controversial business rules.

## Requirements

- **Functional**
  - Create a shipment (lô) with auto-generated unique code, customer, booking reference,
    expected delivery date, pickup/delivery points, contact, and status `DRAFT`/`IN_PROGRESS`.
  - A shipment owns containers (1 bill of lading → N containers, each with own seals,
    declarations, photos), mirroring today's `trip_containers` model.
  - Link shipments ↔ trips (one shipment → one or more trips; one trip → one shipment).
  - A scheduler that runs registered jobs on a cron, with audit-logged runs and retry.
  - Migrate trip-creation so a shipment is created first (or auto-created from a trip for
    backward compatibility), then a trip is dispatched against it.
- **Non-functional**
  - Vietnamese labels/errors throughout (per Mxx-HT-01).
  - Optimistic locking (`version`) on shipment, like `trips`.
  - Full audit log of shipment create/edit/status-change (per Mxx-HT-03).
  - Permission scoping: CUS role creates/edits; FORWARDER/DRIVER see only their assigned;
    CUSTOMER (new) sees only their own shipments.

## Architecture

### New tables (added to `backend/src/db/schema.ts`)

```
shipments
  id, shipmentCode (unique, YYMM-NNNNN), version
  customerId (FK customers), status (DRAFT/IN_PROGRESS/DELIVERED/CLOSED/CANCELED)
  bookingRef, blNumber (bill of lading), expectedDeliveryDate
  pickupLocation, deliveryLocation, contactName, contactPhone
  createdBy, createdAt, updatedBy, updatedAt
  (soft delete via deletedAt)

shipment_documents        -- booking, BL, delivery order, declaration PDFs
  id, shipmentId, type (BOOKING/BL/DO/DECLARATION/OTHER), storageKey, uploadedBy, createdAt

shipment_declarations     -- customs declarations (1 declaration → N containers allowed)
  id, shipmentId, declarationNumber, issuedAt, scope (SINGLE/SHARED), note

shipment_status_history   -- append-only status transitions w/ reason
  id, shipmentId, fromStatus, toStatus, reason, changedBy, changedAt

-- Link shipments to trips (1 shipment : N trips)
trips.shipmentId  (NEW nullable FK on existing trips table)
```

Containers model: **reuse `trip_containers` is wrong** (a shipment can exist before any
trip). Introduce `shipment_containers` mirroring the schema; when a trip is dispatched
against a shipment, copy/snapshot the relevant containers into `trip_containers` (which
already exists and is tightly coupled to trip expense photos, geotags, etc.). Keep
`trip_container_seals` as-is on the trip side.

### Trip-creation refactor

Today: `POST /api/trips` creates a trip directly.
After: `POST /api/shipments` creates the shipment; `POST /api/shipments/:id/dispatch`
creates a trip linked to it. The old direct-create endpoint stays for backward compat but
auto-creates a shipment under the hood.

### Scheduler (`backend/src/scheduler/`)

- New `scheduler/registry.ts` — register jobs with `{ name, cron, handler, retries }`.
- New `scheduler/runner.ts` — boot-time cron scheduler (use `node-cron` or a thin wrapper
  on `setInterval` + DB-locked execution to avoid double-runs across instances).
- New `scheduler_run_logs` table — job name, startedAt, endedAt, status, error, attempt.
- Jobs registered in this wave: none yet (placeholder). Later waves register:
  - M5.7 receivables reminders
  - M7.3 salary period close
  - M5/M6 statement issuance

### RBAC additions (`backend/src/casbin/policy.csv`)

- New resource `shipments`:
  - `ADMIN, *, *`
  - `MANAGER, shipments, read|write|delete`
  - `ACCOUNTANT, shipments, read|write`
  - `FORWARDER, shipments, read` (own scope only)
  - `DRIVER, shipments, read` (own scope only)
- New role `CUSTOMER` (customer portal users) — `p, CUSTOMER, customer_portal, read`.
- New role `CLERK` (nhân viên chứng từ, M10) — `p, CLERK, shipments, read|write`;
  `p, CLERK, customer_portal, read`.

## Related Code Files

- Create: `backend/src/db/schema.ts` (extend with shipments + scheduler tables)
- Create: `backend/src/routes/shipments.ts` (new router)
- Create: `backend/src/services/shipment.service.ts`
- Create: `backend/src/scheduler/registry.ts`, `runner.ts`
- Modify: `backend/src/routes/trips.ts` (link to shipmentId)
- Modify: `backend/src/services/trip.service.ts` (optional shipment auto-create)
- Modify: `backend/src/casbin/policy.csv` (new resources + roles)
- Modify: `backend/src/index.ts` (mount router, boot scheduler)
- Modify: `backend/src/db/schema.ts` → add `users.role` enum values `CUSTOMER`, `CLERK`
- Create migration via `drizzle-kit generate`

## Implementation Steps

1. Add `shipments`, `shipment_documents`, `shipment_declarations`,
   `shipment_status_history` tables + `trips.shipmentId` FK. Generate migration.
2. Add `CUSTOMER` and `CLERK` to the `roleEnum`; update Casbin policy.csv + enforcer.
3. Build `shipment.service.ts` (CRUD, status transitions, container snapshot into trips).
4. Build `shipments.ts` router: list, detail, create (draft), update, dispatch (→ trip),
   status transitions, document upload, container upsert.
5. Refactor trip creation to set `shipmentId`; add back-compat auto-shipment path.
6. ~~Build scheduler skeleton: registry, runner, run-log table, boot in `index.ts`.~~
   ✅ **DONE** — `backend/src/scheduler/{registry,runner,index}.ts` +
   `scheduler_run_logs` table (migration `0111_peaceful_lenny_balinger.sql`) +
   boot in `backend/src/index.ts` (heartbeat job, env-gated by `NODE_ENV=test` and
   `SCHEDULER_DISABLE=1`) + graceful drain in `stopScheduler()`. 15 tests in
   `backend/src/tests/scheduler.test.ts`. Reviewed: blockers B1 (reserve-pinned
   connection for advisory lock) and B2 (attempt-count stamping) addressed.
7. Frontend: minimal Shipment list + detail page under `frontend/src/pages/ShipmentsPage.tsx`
   and `ShipmentDetailPage.tsx`. Route in `App.tsx`. (Full CUS UI comes in Wave 2.)
8. Seed: a couple of test shipments + a customer-role user for QA.
9. Audit-log every shipment write.

## Success Criteria

- [ ] Shipment can be created in `DRAFT`, advanced to `IN_PROGRESS`/`DELIVERED`/`CLOSED`,
      with full status history and audit entries.
- [ ] One shipment → many trips works; trip detail shows its shipment; shipment detail
      shows its trips.
- [ ] Customer-role user can log in and sees only their own shipments (direct URL to
      another customer's shipment is rejected — HT-02 / HT-11).
- [ ] Clerk-role user can create/edit shipments but cannot dispatch or post to ledger.
- [x] Scheduler boots, a no-op registered job runs on cron, and a row appears in
      `scheduler_run_logs`. ✅ heartbeat job registered in `index.ts`, runner writes
      RUNNING→SUCCESS rows per tick, tests verify the attempt-stamp state machine.
- [ ] All Vietnamese labels/errors; no raw English strings in shipment UI.
- [ ] Optimistic-lock conflict returns 409 with a clear Vietnamese message.
- [ ] Existing trip flows (create, dispatch, lock) still pass after refactor.

## Risk Assessment

- **Trip-creation refactor regression** — the trip service is large and central. Mitigation:
  keep the old direct-create path working (auto-shipment) so existing tests and the driver /
  forwarder portals don't break. Add a feature flag `SHIPMENT_FIRST_CREATE` to flip later.
- **Customer-role data scoping** — Casbin gates *actions*, not *row-level visibility*. Need
  a row-level filter helper (e.g. `scopedByCustomer(req.user, query)`) applied on shipment
  and ledger reads. This is reusable in Wave 2 (portal) and Wave 3 (receivables).
- **Scheduler double-run in multi-instance deploys** — if/when the app runs >1 backend pod,
  a DB advisory-lock around each job run prevents double execution. Single-instance today,
  so this is a documented note, not a blocker.

## Open PRD questions to confirm before Wave 2+ (not Wave 0)

Wave 0 itself needs no PRD sign-off (it's pure foundation). But the shipment entity shape
will be reviewed against these once Silver Sea responds:

- M3.1 §1: which fields are mandatory at shipment creation vs. before dispatch?
- M3.1 §2: confirm 1 BL → N containers (assumed yes).
- M3.1 §3: declaration per container or shared? (default: per container, shared on approval)
- M3.1 §5: shipment-code format (proposed `{customerCode}-{YYMMDD}-{NNN}`).
