# SIL-167 — "Chỉnh sửa phân xe": dropdown Biển số xe TRỐNG

Board: https://plan.tingting.vip/tingtingsoft/SIL (SIL-167)
Ảnh khách (Zalo): modal "Chỉnh sửa phân xe" Container số 2, Nhà xe = Đội xe
SilverSea, dropdown Biển số xe mở ra không có option nào.

## Surface

`frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`,
`InlineEditor` mode `vehicle` (heading "Chỉnh sửa phân xe"). Host:
`/shipments-detail` (ShipmentContainersPage). Component dùng chung cho ledger
container của lô; modal trong ảnh = editor dock theo cell của cont thứ 2.

## Root cause (CODE — không phải DATA)

1. `vehicleOptions` filter `detail.selectors.carrierVehicles` bằng
   `vehicle.carrierId === Number(carrierId)`. Nhà xe "Đội xe SilverSea" có
   `carrierId = 'OWN'` → `Number('OWN') === NaN` → KHÔNG option nào match được
   (so sánh với NaN luôn false).
2. Kể cả bỏ lỗi NaN, `carrierVehicles` chỉ chứa `carrier_fleet_vehicles`
   (xe của nhà xe NGOẠI, join customers.isCarrier). Xe nội bộ nằm ở bảng
   `trucks` (carrier_id NULL = xe nhà), serve qua
   `GET /api/shipments/dispatch-fleet?resource=TRUCK` — đúng nguồn mà cả 4
   dialog điều phối đang dùng (AssignTruckGroupDialog, LclGroupTruckEditDialog,
   DispatchAllocationLclDialog, TripReassignDialog).
3. DATA kiểm chứng (local dev, silversea @:5441): bảng `trucks` có 40 xe
   ACTIVE carrier_id NULL → danh sách xe nội bộ CÓ, lỗi thuộc về code.
4. Không có empty-state lý do: dropdown mở ra trắng im lặng (AC2 fail).

## Cases

| ID | Steps | Expected |
|----|-------|----------|
| SIL167-01 | Mở /shipments-detail → lô 249 (2 cont) → cell Phân xe cont 2 (SILQ1520011) → "Chỉnh sửa phân xe" → chọn Nhà xe = Đội xe SilverSea → mở dropdown Biển số xe | Dropdown liệt kê biển số xe nội bộ (trucks ACTIVE, tên file trước: rỗng = BUG) |
| SIL167-02 | Sau fix: chọn 1 biển số từ dropdown → Lưu | Lưu thành công; DB: fulfillment cont gán carrier_type OWN + planned plate |
| SIL167-03 | Nhà xe ngoại không có xe trong danh mục → mở dropdown Biển số xe | Hiện dòng lý do ("Nhà xe chưa có biển số trong danh mục…"), không dropdown trắng im lặng |
| SIL167-04 | OWN nhưng fetch danh sách xe lỗi (mock reject) | Hiện lý do "Không tải được danh sách xe nội bộ…"; field vẫn gõ tay được (allowsCustomValue) |

## Gates

```
cd frontend && pnpm exec vitest run src/features/shipments/detail/ShipmentContainerLedger.test.tsx
cd frontend && pnpm exec tsc -b
```

## Evidence

- Driver: `qa/scripts/2026-10-24_sil167_phanxe.mjs before|after`
- Artifacts: `qa/2026-10-24-sil167/` (screenshot trước/sau + driver log + DB proof)
