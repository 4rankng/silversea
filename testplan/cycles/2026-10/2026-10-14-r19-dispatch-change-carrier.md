# 2026-10-14 — Round 19: Điều vận — đổi nhà xe + biển sau khi đã chọn

Ngày: 2026-10-14 · Nguồn: Zalo QLVT (ĐIỀU VẬN) — "khi chọn nhà xe với biển xe
- muốn đổi lại nhà xe với biển khác như tác vụ đơn, ghép, lấy lẻ k có mục đó
để chọn lại".

## Hiện trạng & tái hiện (code-path)

Tác vụ đã phát lệnh (task DISPATCHED, trip CREATED/IN_TRANSIT) đổi xe qua
`TripReassignDialog` ("Phân xe lại" từ Kế hoạch Chi tiết). Với nhà xe
NGOÀI dialog chỉ có ô **biển số free-text**; route `PATCH /trips/:id/reassign`
luôn **giữ nguyên `externalCarrierVehicleId` của trip cũ**:

- **Đổi nhà xe (carrier khác):** vehicle cũ bị validate theo carrier MỚI →
  409 "Xe không thuộc nhà xe đã gán hoặc không còn hoạt động." — đổi nhà xe
  KHÔNG THỂ thành công.
- **Đổi biển (cùng nhà xe):** plate của vehicle cũ thắng plate gõ tay
  (`carrierVehicle?.licensePlate ?? input`) — lưu "thành công" nhưng biển
  không đổi.

→ đúng phàn nàn "k có mục đó để chọn lại".

## Kỳ vọng mới (TC-R19-REASSIGN-01/02/03)

- TC-R19-REASSIGN-01 (BE): route chỉ giữ vehicle cũ khi payload KHÔNG đổi
  nhà xe VÀ KHÔNG đổi biển; payload đổi nhà xe/biển thì vehicle cũ bị bỏ
  (plate text thắng), vehicle id do FE chọn được chuyển thẳng.
- TC-R19-REASSIGN-02 (FE): dialog Phân xe lại cho nhà xe ngoài có bộ chọn
  **nhà xe + biển số** (list xe của nhà xe qua fleet resources + cho phép
  gõ biển mới), pre-select nhà xe/biển hiện tại — dùng lại pattern combobox
  của editor chi tiết.
- TC-R19-REASSIGN-03: overlap guard round-18 (RIG_OVERLAP_COMPLETED,
  d4798cda/27b63bfe) vẫn chạy nguyên vẹn qua confirm flag.

## Sweep

| # | Bề mặt | Xử lý |
|---|---|---|
| S1 | `loadReassignmentGuardContext` — thêm externalCarrierId/externalPlateNumber | BE |
| S2 | `reassignment.ts` — forwarding externalCarrierVehicleId | BE |
| S3 | `TripReassignDialog` — vehicle picker EXTERNAL | FE |
| S4 | OWN branch (truck/driver) | không đổi |

## Chạy xác minh

- BE: test unit forwarding logic + test hội nhập hiện có
  (`trip-reassign-acceptance.test.ts` giữ xanh).
- FE: `TripReassignDialog.test.tsx` mở rộng (picker load theo carrier, gửi
  vehicle id; free-text vẫn được).
