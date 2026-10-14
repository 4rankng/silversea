# 2026-10-14 — Round 19 / FB-086 (ticket 131026201000): sửa lô thêm container

Ngày: 2026-10-14 · Nguồn: Zalo QLVT — "lot entered wrong/missing a container
→ edit → add container: (a) overview/schedule không cập nhật, (b) container
mới không kế thừa dữ liệu lô, (c) phiếu trước báo chính luồng add bị lỗi".

## Đường đi (surface)

Thêm container duy nhất hiện hữu: drawer "Chi tiết" trên Tổng quan lô hàng
(`/shipments`) → "Chi tiết container" → "Thêm container"
(`CusContainerLedger` → `POST /shipments/cus-workspace/:id/containers`).
`/shipments-detail` cố ý chỉ còn row-edit (card 20260922_41).

## Tái hiện (đã có bằng chứng)

Tạo lô FCL 1x20DC đủ dữ liệu (type/route/cảng nâng/cảng hạ/nhà máy/hẹn)
qua `POST /shipments/quick`, rồi thêm container từ drawer:

- Container mới persist (201, fulfillment riêng tạo đúng) — (c) không tái
  hiện được ở HEAD trên stack QA.
- **(b) KHÔNG kế thừa gì:** row mới có `container_type_id/route_id/
  pickup_port_id/dropoff_port_id/operational_site_id` = NULL trong khi
  container tạo-kèm-lô có đủ (bằng chứng DB qa/2026-10-14_r19-fb086-*).
- **(a)** hệ quả của (b): không có hẹn → dòng lịch của container mới không
  xuất hiện ở "Lịch cont"/cột Lịch trình & điều xe cho tới khi bổ sung tay.
- **(c) 409版本:** drawer cache `detail.summary.version`; sau khi lô đổi
  phiên bản ở nơi khác (quick-edit ngoài drawer, người khác sửa), add trả
  409 "Lô hàng vừa thay đổi..." và không có đường phục hồi nào ngoài đóng/
  mở lại drawer.

## Kỳ vọng mới (TC-R19-ADD-01/02/03)

- TC-R19-ADD-01 (kế thừa): container thêm vào kế thừa MẶC ĐỊNH từ container
  cùng lô (giá trị không-null đầu tiên theo thứ tự id): loại cont, tuyến,
  cảng nâng, cảng hạ, nhà máy, giờ hẹn đóng/trả — đúng như container tạo
  kèm lô được pre-fill từ hàng trước ở form tạo (`createContainerFromPrevious`).
  Trường nào người dùng nhập trong form thêm vẫn thắng (override).
- TC-R19-ADD-02 (overview): sau khi thêm, "Lịch cont" của drawer và cột
  "Lịch trình & điều xe" của Tổng quan hiển thị ngay dòng lịch của container
  mới (vì giờ hẹn kế thừa), đếm cont tăng.
- TC-R19-ADD-03 (phục hồi 409): khi add bị 409 phiên bản, drawer tự tải lại
  chi tiết lô (fresh version) và thông báo; thử lại ngay được mà không cần
  đóng/mở drawer.

## Sweep

| # | Bề mặt | Xử lý |
|---|---|---|
| S1 | `addCusShipmentContainer` — default kế thừa | sửa BE (shared owner) |
| S2 | `CusContainerLedger.submitAddContainer` — 409 → reload detail | sửa FE |
| S3 | `AddContainerRowForm` (ledger chi tiết, chưa wire) | hưởng kế thừa BE khi được wire; không đổi |
| S4 | LCL add | giữ guard "Chỉ lô hàng FCL mới thêm được dòng container." |

## Chạy xác minh

- BE: `cd backend && npx tsx --test src/tests/container-quickadd-validation.test.ts` (+ file test mới kế thừa).
- FE: `cd frontend && npx vitest run <file test drawer>`.
- UI drive rung 3 + DB proof như qa/2026-10-14_r19-fb086-*.
