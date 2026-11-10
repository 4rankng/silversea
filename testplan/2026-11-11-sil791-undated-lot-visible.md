# Card SIL-791 — Hồi quy: lô không ngày giao vẫn hiện trên /shipments khi bật lọc ngày

Ngày: 2026-11-11 · Ticket SIL-791 (id 917, medium) · KB Ch3 §3.1.5

## Lỗi
Lô không có ngày giao (deliveryDate null) bị ẩn khỏi Tổng quan lô hàng
(/shipments) khi bật lọc ngày. Repro lô 982 (R7B-C3-702L): không lọc thấy,
lọc 01/11–10/11 → "Không có lô hàng phù hợp" (Tất cả 0).

Nguyên nhân: SIL-588 (khách 29/10) đã xoá lane "undated = luôn hiện" khỏi
`shipmentTransportDateCondition` để Tổng quan khớp Chi tiết — nhưng KB Ch3
§3.1.5 (law chủ) quy định: có lọc ngày, lô không ngày vẫn hiện ở MỨC LÔ; chỉ
container không ngày mới bị loại ở mức dòng container. Ticket = bằng chứng
chủ mới (10/11) quay lại lane undated ở mức lô.

## Kỳ vọng
- /shipments + lọc ngày: lô không bằng chứng ngày nào (EDD null, không
  container nào có lịch hẹn) vẫn hiện; cell Tổng quan hàng hoá hiện nhãn
  thiếu-hàng ngày-lọc (không mất dữ liệu).
- Lô CÓ ngày nhưng ngoài khoảng: vẫn bị ẩn (không hồi quy SIL-588 arm dated).
- Chi tiết (/shipments-detail): container không ngày vẫn bị loại khi có lọc
  ngày (SIL-506 giữ nguyên).
- Scoped counts (tab "Tất cả", đếm cont theo ngày) khớp rows.

## Rủi ro hồi quy

| # | Khu vực | Rủi ro | Kiểm |
|---|---|---|---|
| R1 | Arm dated (SIL-588) | sửa nhầm làm lô ngày-ngoài-khoảng quay lại | test SQL giữ pin EXISTS + EDD-gated arm |
| R2 | Chi tiết container triage | vô tình mở undated container | `containerDayTriageCondition` không đổi; test SIL-506 giữ xanh |
| R3 | Dispatch master-plan | KHÔNG đổi (tiếp tục law SIL-588) — ghi nhận Concerns | list-summaries.ts không sửa |
| R4 | Scoped container counts | đếm cont vẫn loại cont không ngày | container-date-filter.ts không đổi hành vi |

## Thiết kế
Thêm arm `undatedShipmentLaneSql()` (EDD null + không container nào có
appointment) OR vào call site shipment-level trong
`buildShipmentPageConditions` — KHÔNG đổi `shipmentTransportDateCondition`
(dùng chung với master-plan).

## Kiểm chứng
- `backend/src/tests/unit/cus-shipment-undated-lane.test.ts` (mới) — SQL pin.
- Cập nhật comment law trong container-date-filter.ts + test comment.
