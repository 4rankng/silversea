---
phase: 1
title: Additive shipment operations contract
status: completed
effort: large
---

# Phase 01 — Additive shipment operations contract

## Scope

Add nullable shipment header facts matching the customer workbook without moving execution facts from trips or container facts from shipment containers.

## Fields

- `tradeDirection`: `IMPORT | EXPORT`
- `cargoMode`: `FCL | LCL`
- `factoryName`, `shippingLineName`
- `customsCutoffAt`, `closingAt`, `plannedReturnAt`
- `cargoWeightKg`, `cargoVolumeCbm`
- `packageCount`, `packageType`
- `operationalNotes`

## Files

- `backend/src/db/schema.ts`
- `backend/drizzle/0165_shipment_operations_workspace.sql` and migration journal metadata
- `shared/src/schemas/index.ts`
- `backend/src/services/shipment.service.ts`
- `backend/src/routes/shipments.ts`
- focused shipment schema/service/route tests

## Requirements

- All additions are nullable and legacy payloads remain valid.
- Create and optimistic-lock update paths persist every field.
- Clerk change classification includes the new operational fields so post-dispatch edits follow the existing request boundary.
- `GET /shipments?q=` performs server-side case-insensitive search across code, B/L, booking, customer name, factory, and shipping line.
- No dispatch, pricing, finance, portal, container snapshot, lifecycle, Casbin, or audit-event semantic change.

## Verification

- Shared/backend typecheck.
- Focused schema and shipment tests against the real test database.
- Legacy create payload regression, new-field round trip, search, 409 conflict, and ACCOUNTANT write denial.

## Risks and rollback

- Invalid timestamp or numeric coercion could reject legacy payloads; keep every new key optional/nullish and test an unchanged legacy body.
- New post-dispatch fields must not bypass clerk change requests; include them in the existing classification snapshots.
- Rollback is application-code reversal plus leaving nullable database columns unused; no destructive down migration.

## Done

- [x] Migration, schema, shared validators, route forwarding, service persistence, and server search are implemented.
- [x] Focused tests prove legacy compatibility and new-field round trips.
