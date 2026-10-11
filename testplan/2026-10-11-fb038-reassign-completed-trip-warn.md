# FB-038 (REQ-04) — cảnh báo trùng giờ xe không nổ trên luồng Phân xe lại

Ngày: 2026-10-11 · ưu tiên P1 · ticket 101026043000 (còn mở) · retest round 13 FAIL

## Vấn đề đã báo

Tiệp Vũ (REQ-04): gán/đổi xe mà xe đó đã có **chuyến đã hoàn thành (COMPLETED)**
trùng khung giờ → **không có cảnh báo nào**, lưu thành công. Đây chính là biểu hiện
"cảnh báo trùng giờ xe không nổ" của FB-038, và nó vẫn còn ở round 13.

## Vì sao các fix trước không bắt được

| Fix | Khu vực | Vì sao không hết |
|---|---|---|
| Round 8 (10/08, Agent-MiniMax) | `assertResourceAvailability` | Chỉ sửa độ vô hình của chuyến **ACTIVE** thiếu `plannedEndAt` (`coalesce(end, start+8h)`). Không đụng tới chuyến COMPLETED. |
| Round 12 `d03fffbb` | legacy `assignFulfillmentPlate` | Bắt được ca "Chỉnh sửa điều phối", nhưng vẫn đi qua `assertResourceAvailability`. |
| `6051d39a` | `assertPlanRowRigAvailable` | Đổi tier cho same-lot, nhưng đây là **guard khác** — luồng Phân xe lại không đi qua nó. |

## Nguyên nhân gốc (xác minh trong mã)

`backend/src/services/dispatch-resource-availability.service.ts` — cổng
issue/reassign mà `TripReassignDialog` gọi:

- Scan lọc `inArray(trips.status, [CREATED, IN_TRANSIT])` → **chuyến COMPLETED
  hoàn toàn vô hình** với cổng này.
- Ba throw (xe đầu kéo / rơ-moóc / tài xế) là **409 trần, không kèm
  `{ code: 'RIG_OVERLAP_COMPLETED' }`**, và không có tham số confirm.

Trong khi đó luật card 061026172804 mà guard plan-row (`assertPlanRowRigAvailable`)
đã implement đúng: *chuyến COMPLETED của cùng xe không bao giờ được lưu im lặng —
warn một lần, confirm rồi lưu (chạy gối đầu lên chuyến đã xong là hợp lệ).*

`frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx:127` chỉ
`setError(message)` — không có nhánh confirm/retry, đối lập với
`DispatchPlanEditorCell.tsx:708` (có `RIG_OVERLAP_COMPLETED` → confirm → retry
kèm cờ).

## Cách sửa

1. `assertResourceAvailability`: thêm tier chuyến COMPLETED theo đúng luật
   061026172804 — quét COMPLETED trùng khung, throw 409 kèm
   `{ code: 'RIG_OVERLAP_COMPLETED' }`; thêm tham số `rigOverlapCompletedConfirmed`
   để lần retry đã confirm được đi qua. Không đổi: quét ACTIVE, exemption
   Kẹp/Kết hợp, message của các throw hard-tier hiện có.
2. Nối cờ `rigOverlapCompletedConfirmed` qua `reassignIssuedDispatchWriteCommand`
   và route `/trips/:id/reassign`.
3. `TripReassignDialog`: xử lý `RIG_OVERLAP_COMPLETED` → confirm → retry kèm cờ
   (đối xứng với `DispatchPlanEditorCell`).

## Case ID

- **FB038-COMPLETED**: reassign gán xe có chuyến COMPLETED trùng khung → phải 409
  kèm `code: 'RIG_OVERLAP_COMPLETED'` (red-first T12). Retry với
  `rigOverlapCompletedConfirmed: true` → được lưu (T13).
- **FB038-CONTROL**: chuyến COMPLETED ngoài khung → không cảnh báo (T14).
- **FB038-ACTIVE-UNCHANGED**: các ca ACTIVE hard-tier giữ nguyên (T5 + T8).
