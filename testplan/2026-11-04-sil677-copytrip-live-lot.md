# Case SIL-677 — copyTrip 500 chưa bắt khi copy trip live thuộc lô (clone đè unique index)

- Ticket: SIL-677 — "Sao chép chuyến" trên trip live thuộc lô gãy 500 (raw
  23505 không được bắt).
- Nguyên nhân: `buildCopiedTripValues` (`backend/src/services/trip-mutations-shared.service.ts`,
  `COPY_EXCLUDED_TRIP_FIELDS`) không exclude `shipmentId` / `fulfillmentId` /
  `activeTripPairId` + `activeTripPairOrder`, rồi reset status CREATED ⇒ insert
  đụng unique index; route `POST /api/trips/:id/copy`
  (`backend/src/routes/trips/crud.ts`) không có guard riêng.

## Unique index bị đè (backend/src/db/schema/trips.ts)

| Nhánh | Index | Điều kiện đè |
|---|---|---|
| pair-active | `trips_active_trip_pair_order_uniq` | copy kế thừa `(activeTripPairId, activeTripPairOrder)` — index KHÔNG lọc status ⇒ luôn đè kể cả source CANCELED |
| có-fulfillment | `trips_fulfillment_id_live_uniq` | source live có `fulfillmentId` — copy kế thừa, cả hai cùng live trên 1 fulfillment |
| lot-linked-thường | `trips_shipment_without_fulfillment_live_uniq` | source live `shipmentId` không fulfillment — copy kế thừa `shipmentId`, cùng lô 2 chuyến live |

## Reproduction (before fix)

- Service-level: `qa/scripts/2026-11-04-sil655-r2-p2-copytrip-link-probe.mjs`
  arm 0 — copy trip live lot-linked ⇒ DrizzleQueryError 23505
  (`trips_shipment_without_fulfillment_live_uniq`).
- HTTP-level: `qa/scripts/2026-11-04-sil677-driver.mjs` arm live-source —
  trước fix response 5xx (evidence: `qa/2026-11-04-sil677/`).

## Required behavior (SIL-677 + bảo lưu law SIL-655)

1. **Source LIVE thuộc lô (3 nhánh trên): copy THÀNH CÔNG, detach khỏi lô** —
   chuyến copy là chuyến mới: `shipmentId` / `fulfillmentId` /
   `activeTripPairId` + `activeTripPairOrder` = NULL, status CREATED. Không 500.
2. **Source CANCELED: giữ hành vi SIL-655 r2** — copy kế thừa
   `shipmentId`/`fulfillmentId` (chiếm lại slot live của lô — partial unique
   index loại row CANCELED; pin `p2.copy-stays-lot-linked` của probe SIL-655
   phải giữ xanh), pair columns vẫn NULL.
3. **Mọi xung đột slot còn sót trong nhánh copy** ⇒ ApiError 409 kèm message
   nghiệp vụ, không 500. Trên đường HTTP (idempotent, READ COMMITTED) race
   là 23505; trên đường service trực tiếp (repeatable-read) race là 40001 —
   mapper map cả hai (`mapCopyTripUniqueViolation`).
4. Container lines copy giữ nguyên law SIL-655: `source_shipment_id` /
   `source_shipment_container_id` / `source_shipment_version` giữ, số cont/seal
   reset NULL.

## Regression check

- `cd backend && npx tsx --test --test-concurrency=1
  tests/unit/sil677-copytrip-live.test.ts` — 3 nhánh live detach + nhánh
  canceled kế thừa + mapping 23505→4xx.
- Re-run `qa/scripts/2026-11-04-sil655-r2-p2-copytrip-link-probe.mjs` —
  arm SourceCanceled phải vẫn PASS (link law + pins sil655).
