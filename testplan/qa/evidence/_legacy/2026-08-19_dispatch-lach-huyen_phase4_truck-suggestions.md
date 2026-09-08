# QA — Dispatch Lạch Huyện Phase 4: Own-truck D-1/D+1 suggestions

- Date: 2026-08-19
- Scope: `qa/2026-08-19_dispatch-lach-huyen_phase4_truck-suggestions`
- Gate: phase 4 implementation complete, all automated gates green

## What shipped

### Fleet-picker LH suggestions (`dispatch-planning.service.ts`)
- `GET /api/shipments/dispatch-fleet?resource=TRUCK&…&fulfillmentId=<id>` now also returns
  `suggestedItems: TruckSuggestion[]` — advisory, ranked, never eligibility-gating
- `buildLachHuyenTruckSuggestions(tx, {actor, fulfillmentId, qPattern})`:
  - **Authorization first**: target row + shipment loaded; `assertActorCanAccessShipment(write)` —
    inaccessible/deleted/canceled/stale target → `[]` (no error; picker stays usable)
  - Target date D = shipment `expectedDeliveryDate` (the detailed-plan transport date)
  - **One set-based query** (bounded `limit 500`): active fulfillments (non-canceled, non-deleted,
    OWN-planned, plate snapshot present) ⟕ shipmentContainers ⟕ ports (OR join on dropoff/pickup)
    ⟕ trucks (canonical normalized-plate join) ⟕ live trips (non-CANCELED, non-deleted)
    - Work date = `coalesce(trips.departureDate, shipments.expectedDeliveryDate)`
    - Port must be persisted `dispatch_zone = 'LACH_HUYEN'` — never name-matched
  - Reasons: LH **dropoff on D-1** → `D-1_DROP`; LH **pickup on D+1** → `D+1_PICKUP`
    - `isDropoff` = "joined LH port IS the container's dropoff port" (`dropoff_port_id = ports.id`),
      not "any dropoff exists" — the OR port join makes the distinction load-bearing
  - Search parity: `q` narrows the suggestion set exactly like the page set
  - Merged visible order: both-signals → D-1 → D+1 → plate (`localeCompare vi`) tie-break; capped at 20
  - Privacy: response exposes `{truckId, plateNumber, reasons}` only — no other shipment/customer data
- **Cursor semantics untouched**: `suggestedItems` rides beside the page; `items`, `total`,
  `nextCursor` byte-compatible for legacy callers (no `fulfillmentId` → `suggestedItems: []`)
- External-carrier vehicles deliberately NOT enriched (per plan)
- Frontend: `listDispatchFleetResources` accepts `fulfillmentId`; response type carries
  optional `suggestedItems?: TruckSuggestion[]`

### Plate normalization
- Join uses `upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))` on BOTH sides — identical
  semantics to the write-path `normalizePlate` (`formatPlate` + strip non-alphanumerics), so
  `51C-XXX` (truck) matches `51C XXX`/`51CXXX` (fulfillment snapshots)

## Commands run + results

| Gate | Command | Result |
|------|---------|--------|
| shared build | `cd shared && npm run build` | OK |
| backend tsc | `cd backend && npx tsc --noEmit` | 0 errors |
| backend focused | `npx tsx --test src/tests/dispatch-detail-plan.test.ts` | **34/34** (3 new: D-1/D+1 ranked reasons + canceled-evidence ignored + reasons-only privacy shape; both-signals rank-first + no-context legacy compat; search narrows/misses + stale-target 200-with-[]) |
| backend full | `cd backend && npm test` | **2100/2100, 0 fail** |
| frontend tsc | `cd frontend && npx tsc -b` | 0 errors |
| frontend tests | `cd frontend && pnpm test` | **959/959** |
| lint | `pnpm lint` | 0 errors (90 pre-existing warnings) |

## Defects found & fixed during gate

1. **Plate-join asymmetry** (found by tests): truck side stripped only spaces while the
   fulfillment side used `regexp_replace` — hyphenated truck plates (`51C-…`) never matched.
   Both sides now use the canonical normalizer.
2. **`isDropoff` always true** (found by tests): computed as `dropoffPortId is not null`, which
   holds for every container — `D+1_PICKUP` was unreachable. Now compares the joined LH port
   id against `dropoffPortId`, making the OR-join side distinguishable.
3. **Test-fixture ordering bug** (mine): the first evidence lot was created before the LH port
   id was derived, silently making it zoneless. Reordered fixture.

## Semantics decisions (documented in code)

- Inaccessible or stale `fulfillmentId` context returns no suggestions and keeps the picker
  usable (advisory context must never break the resource listing).
- Suggestions respect the search box (`q`) — a hidden suggestion is a lie; a filtered-out one
  is consistent with what the dispatcher sees.
- Advisory ceiling: 20 suggestions, evidence query bounded at 500 rows.

## Out of scope (per plan)

- Picker UI rendering of pinned suggestions (Phase 5 workspaces).
- External-carrier vehicle enrichment (explicitly excluded).
