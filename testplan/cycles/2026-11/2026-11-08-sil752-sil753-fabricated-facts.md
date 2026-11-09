# Regression spec — SIL-752 / SIL-753 fabricated facts on trip page + dispatch row

**Ticket:** SIL-752 (trip page shows RƠ MOÓC 40FT with no trailer) + SIL-753 (row shows 'SilverSea / Chưa phân xe' after Hủy phân xe)
**Owner (implement):** fullstack
**Owner (verify):** qa
**Status (this doc):** PREP — regression guard for the fix landing on fix/k15-trailer-cancel
**Cycle:** 2026-11

## Goal

Two sibling defects of the same class: a UI fact is FABRICATED when no backing data exists.
SIL-752: the trips read layer coerces a null `trips.trailer_type` into the literal '40FT'
(`shapeTripRelations`), so an external dispatch-issued trip (no trailer, no truck) renders
RƠ MOÓC = 40FT while Container & Seal reads 20'DC. SIL-753: the detailed-plan read layer
derives carrierName = 'SilverSea' for every OWN fulfillment, including the post-cancel
shape (OWN + no plate + no live trip = the stored shape of "chưa phân xe"), so the ĐIỀU
PHỐI cell renders a carrier that does not exist. Rule: khi không có rơ moóc / không có
phân xe, hiển thị để trống ('—' / 'Chưa phân xe') — không bịa dữ liệu.

## Out of scope

- Write-side defaults (`trip-create.service.ts:361`, `trip-lifecycle-ops.service.ts:210`
  `|| '40FT'`): they feed the roadAllowance pricing snapshot for OWN trips with a real
  tractor — financial behavior, separate decision.
- SIL-751 (lot stays DISPATCHED after cancel) — tracked separately.
- CUS workspace / master-plan carrier identity (`cus-workspace-builders`) and shipment
  list carrier facets — different surfaces, same question, not reported here.

## Acceptance criteria

### TC-SIL752-001 — no trailer ⇒ no moóc type on trip detail

- **Given** trip with `trailer_id = null`, `trailer_type = null` (e.g. external dispatch issue, plate 'Bổ sung sau')
- **When** GET /api/trips/:id, then open /trips/:id 'Thông tin cơ bản'
- **Then** RƠ MOÓC renders '—' (empty fact), never a fabricated size
- **Assert:** API payload `trailerType === null`, `trailer` absent; UI row shows '—'
- **Evidence:** unit test `trip-queries` shaping + qa/ artifacts

### TC-SIL752-002 — trailer present ⇒ real plate · type

- **Given** trip with a resolved trailer
- **When** trip detail read
- **Then** RƠ MOÓC = `<plate> · <type>` unchanged (no regression on assigned rows)

### TC-SIL753-001 — Hủy phân xe ⇒ ĐIỀU PHỐI shows only 'Chưa phân xe'

- **Given** lot assigned to external carrier 4GS, dispatched (chuyến issued)
- **When** ⋯ → Hủy phân xe → confirm
- **Then** detailed-plan row: carrier line 'Chưa phân xe' (placeholder), no 'SilverSea', no duplicate line — including the optimistic patch right after the confirm (the savePlan response echoes carrierName null for a plate-less OWN save; no fabricated flash before the refetch)
- **Assert:** API row `dispatch.carrierName === null` while `carrierType === 'OWN'`, plate null, no live trip; savePlan response payload same law

### TC-SIL753-002 — OWN row with plate keeps its fleet label

- **Given** OWN fulfillment with planned plate
- **When** detailed-plan row renders
- **Then** carrier line 'SilverSea' + plate visible (regression guard for assigned rows)

## Round 4 (09/11/2026 — product decision: cancel clears the carrier)

- **Evidence QA (comment 4709/4716, staging e6db602f):** sau Hủy phân xe (cả
  2 đường: ô ĐIỀU PHỐI và ⋯ menu), lô probe mới vẫn dính
  '4GS / ● Chờ bổ sung biển', Phát lệnh hiện lại — cancel chỉ gỡ lệnh.
  'Sửa điều phối' từ chối lưu không nhà xe ('Chọn nhà xe trước khi lưu.')
  nên không thể trả lô về 'Chưa phân xe' bằng tay.
- **Root cause r4:** FE `handleCancelDispatch` (DispatchDetailPlanPage.tsx)
  gọi `cancelTrip` rồi `savePlan(OWN + clearVehicle)`. Từ build có fix
  SIL-751 (rewind DISPATCHED→READY_FOR_DISPATCH trong cùng tx cancel),
  `transitionShipmentStatus` bump `shipments.version` ⇒ savePlan kế tiếp gửi
  expectedShipmentVersion CŨ ⇒ 409 'Lô hàng đã thay đổi' ⇒ assignment
  (plannedCarrierType EXTERNAL + external id + placeholder plate) KẸT VĨNH
  VIỄN trên row. Trước rewind, savePlan ăn được nên shape OWN-plateless kịp
  ghi (đó là lý do c4cea6b6 flip OWN nhưng e6db602f không).
- **Product decision (owner, 09/11):** Hủy phân xe PHẢI xóa luôn nhà xe,
  trả lô về 'Chưa phân xe' đúng nghĩa — clear MỌI carrier assignment kể cả
  placeholder, không phụ thuộc đường click.
- **Fix r4:**
  1. BE: trong CANCELED branch của trip status machine (cùng tx với rewind),
     chuyến bị hủy NHẢ assignment planned của fulfillment mình:
     plannedCarrierType 'OWN' + plannedExternalCarrierId/VehicleId NULL +
     plannedVehiclePlateNumber NULL (+ parity SIL-494: rơi actualTruckNo khi
     lô không costGroupId) — shape plan-read render 'Chưa phân xe'. Mọi
     surface hủy (grid cell, ⋯ menu, workspace chuyến) cùng một cửa.
  2. FE: bỏ savePlan sau cancelTrip (đây chính là đường gây 409); chỉ `refresh()`.

### TC-SIL753-003 (r4) — cancel returns the lot to true 'Chưa phân xe'

- **Given** lô external 4GS plate 'Bổ sung sau', đã Phát lệnh (trip live)
- **When** Hủy phân xe (bất kỳ đường nào) → confirm
- **Then** fulfillment: plannedCarrierType 'OWN', external ids NULL, plate
  NULL, version +1; grid cell đọc đúng 1 dòng 'Chưa phân xe'; Phát lệnh
  available; KHÔNG còn '4GS / Chờ bổ sung biển'
- **Pin:** BE source-scan pin trong tests/unit (CANCELED branch clears) + FE
  `DispatchDetailPlanPage.test.tsx` (cancelTrip + refresh, KHÔNG savePlan).
