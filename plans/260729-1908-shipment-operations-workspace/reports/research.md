# Shipment Operations Research

Scope: additive shipment-first modeling for factory/site, shipping line, import/export, deadlines, and LCL cargo. No application code changed.

## Bottom line

1. Keep `shipments` as the aggregate root.
2. Add new nullable columns only for single-valued shipment header facts.
3. Add child tables for repeating facts.
4. Do not retrofit these into `trips`; dispatch stays fulfillment-time data.

## What the repo already has

- `backend/src/db/schema.ts` already has a first-class `shipments` root with `customerId`, `cargoTypeId`, `responsibleUnitId`, `bookingRef`, `blNumber`, `expectedDeliveryDate`, `pickupLocation`, `deliveryLocation`, `contactName`, `contactPhone`, `status`, `version`, `shipment_documents`, `shipment_declarations`, `shipment_status_history`, and `shipment_containers`.
- `backend/src/services/shipment.service.ts` already treats shipment containers as shipment-owned and snapshots them into `trip_containers` on dispatch.
- `shared/src/schemas/index.ts` already keeps shipment create/update/container batch payloads optional/additive.
- `ROADMAP.md` and `plans/silversea-prd-roadmap/phase-01-wave-0-foundation.md` explicitly frame shipments as the keystone and say trip fulfillment fields stay off shipment.

## Recommended model

### Shipment-level fields

- `tradeDirection` / `importExportType`: `IMPORT | EXPORT` as a shipment header fact.
- `shippingLineId`: FK to a `shipping_lines` lookup table, nullable.
- `pickupSiteId` and `deliverySiteId`: FK to a `customer_sites` or `shipment_sites` table, nullable.
- `pickupLocationText` and `deliveryLocationText`: keep the existing free-text fields for back-compat and messy real-world entry.
- `cargoMode`: `FCL | LCL` as a shipment header fact.
- `etaAt`, `etdAt`, `cutoffAt`, `docDeadlineAt`: typed shipment deadline fields if the workbook only needs a few stable milestones.

### Container-level fields

- `containerNumber`, `containerTypeId`, `sealNumber`, `cargoWeightKg`, `notes` stay container-level.
- Any field that can differ by container on the same shipment belongs here, not on `shipments`.

### Cargo-line-level fields

- For LCL, add a `shipment_cargo_lines` child table for commodity-level rows: description, package count, weight, volume, HS code, and optional container allocation later.
- Do not stuff LCL line items into `shipments`; that would collapse distinct cargo detail into header state.

### Deadline modeling

- Prefer a child table `shipment_deadlines` if the workbook can grow beyond 4-5 stable date types.
- Use header columns only if the deadline set is fixed and small.
- If deadlines are event-based or customer-specific, child table wins.

## Ranked options

| Rank | Option | Fit | Trade-off |
|---|---|---|---|
| 1 | Add nullable header columns + child tables for repeating facts | Best | Smallest API break risk, easy additive migration, matches current shipment aggregate |
| 2 | Wide `shipments` table with many nullable columns only | Medium | Simpler now, but deadline/LCL multiplicity becomes messy and hard to evolve |
| 3 | JSON blob for workbook data | Poor | Lowest migration friction, highest query/reporting pain, weakest validation |

## Why this is the best fit

- The repo already uses explicit tables, typed enums, optimistic locking, and append-only history. Additive tables/nullable columns match that style.
- Drizzle supports schema-first migrations and generated diffs; keep changes code-first and additive.
- PostgreSQL constraints and partial indexes fit the shape: use NOT NULL/FOREIGN KEY/CHECK only on new fields when their semantics are stable; use partial unique indexes where uniqueness applies only to active rows.

## Source quality and adoption risk

- Highest credibility: local repo code + roadmap + PRD docs for current contract/state.
- Next: official Drizzle and PostgreSQL docs for schema/migration/constraint behavior.
- No tutorials or blog opinions were needed.
- Adoption risk is low for nullable header columns and child tables because they are additive and preserve current payloads.
- Adoption risk is medium for new lookup tables if workbook terminology is still moving.
- Adoption risk is high for JSON blobs or overloaded text columns because they hide validation and make reporting brittle.

## Migration and back-compat risk

- Lowest-risk path is nullable additions with no required-field changes.
- Keep current shipment create/update payloads working by making new fields optional in `shared/src/schemas/index.ts`.
- Avoid reusing `bookingRef` or `blNumber` for shipping-line/import-export semantics; that would overload existing public contracts.
- If `shipping_lines` or `shipment_sites` are new lookup tables, seed them lazily and tolerate null FK values during rollout.
- Adding enum values is acceptable for stable classifications, but lookup tables are safer if customer workbook terms are still changing.
- Existing shipments must remain readable with all new fields null.

## Concrete acceptance tests

1. Create a shipment with the current legacy payload only; it still succeeds.
2. Update a shipment with `tradeDirection`, `shippingLineId`, `pickupSiteId`, `deliverySiteId`, `cargoMode`, and deadlines; only those fields change.
3. Container upsert and dispatch still work unchanged; dispatch snapshots containers and does not depend on the new header fields.
4. A shipment with LCL cargo can store multiple cargo-line rows without changing the container schema.
5. A shipment with multiple deadlines can add/remove deadline rows without touching `shipment_status_history`.
6. Older clients that omit the new fields keep seeing the same create/update behavior because the shared Zod schemas stay additive.
7. Migration/backfill leaves existing shipments valid with all new fields null and no destructive column rename/drop.

## Limitations

- This was the initial repository-only architecture pass. The workbook was
  subsequently inspected directly; its three operating sections and exact
  field vocabulary are documented in
  `workbook-workflow-analysis.md` and were used to lock the implemented scope.
- I did not propose concrete table names for `shipping_lines` or `shipment_sites` beyond the shape above; that should follow the workbook’s canonical terms.

## Sources consulted

- `backend/src/db/schema.ts`
- `backend/src/services/shipment.service.ts`
- `shared/src/schemas/index.ts`
- `ROADMAP.md`
- `plans/silversea-prd-roadmap/phase-01-wave-0-foundation.md`
- `docs/prd/business-logic-qa-proposals.md`
- Drizzle ORM docs: schema generation, indexes/constraints, relations
- PostgreSQL docs: constraints, partial indexes, unique indexes
