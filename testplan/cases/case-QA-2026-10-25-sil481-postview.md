# Case: SIL-481 — /shipments/:id post-create review = form /shipments/new ở chế độ VIEW

- **Ticket:** SIL-481 (board id 541) — RULING owner 25/10 (comment 1759): "just post view action after create mới lô hàng"; layout parity với /shipments/new, KHÔNG thiết kế layout mới.
- **Date:** 2026-10-25
- **Branch:** fix-481-postview (off main 0e8cd190)
- **Pattern tham chiếu:** SIL-171 (Sửa lô = form tạo edit mode, f0c87b15) + SIL-483 (drawer parity).

## Bug / yêu cầu

Trang `/shipments/:id` sau khi tạo lô là một layout riêng (header summary + 10 panel:
Nhà xe, Phối hợp khách hàng, Điều chỉnh giá cước, Container, Chi phí, Tài chính,
Tài liệu, Tờ khai, Lịch sử trạng thái + 5 modal) — owner gọi là "a fucking mess".
RULING 25/10: trang này = lại form Tạo lô hàng ở CHẾ ĐỘ VIEW.

## Expected behavior

1. `/shipments/:id` render đúng layout `/shipments/new`: topline + form (Loại hàng →
   Nhận diện lô → Tuyến/LCL → Thông tin hàng → Lịch & ghi chú) + FreightPreviewCard +
   footer actions. Không thêm panel nào.
2. Pre-fill đầy đủ dữ liệu lô (cùng mapping `buildShipmentEditPrefill` của SIL-171):
   mọi giá trị hiển thị đúng (Khách hàng, Hình thức XNK, Số Bill/Booking, tờ khai,
   container rows, giờ đóng/trả, ghi chú...).
3. Toàn bộ control disabled (read-only): input/select/combobox/radio/textarea + mọi
   nút mutation (Thêm nhà máy, copy giờ, xoá cont, "+ Thêm"...). Không thể submit:
   không có nút Lưu nháp/Tạo lô hàng; Enter không submit.
4. Topline: tiêu đề "Chi tiết lô hàng"; ẩn chip "Bắt buộc X/Y"; actions = "Quay lại"
   (về /shipments) + "Chuyển sang sửa" (primary → `/shipments/:id/edit`).
5. "Chuyển sang sửa" chỉ hiện cho role được PUT /shipments/:id
   (ADMIN/MANAGER/CUS/DISPATCHER); ẩn với ACCOUNTANT/OPS/DRIVER; disabled + title
   giải thích khi lô bị khóa kế toán (view vẫn đọc được).
6. Footer lặp lại cặp actions view (FB-108 pattern, aria-label "(cuối trang)").
7. Duplicate-reference guard (cảnh báo Bill/Booking trùng) KHÔNG chạy ở view.
8. Entry point giữ nguyên: chỉ flow tạo lô (POST xong navigate /shipments/:id) và
   direct URL/link cũ. KHÔNG thêm nút điều hướng từ drawer (đã bỏ theo ruling 483).
9. Routing khác bất biến: /shipments/new (create), /shipments/:id/edit (edit,
   shipmentCreatorOnly), /portal/shipments/:id (CUS portal) không đổi.

## Out of scope (ghi nhận minh bạch)

- Các panel cũ (Chi phí/Tài chính/Phối hợp/Điều chỉnh cước/Tài liệu/Tờ khai/Lịch sử)
  rời khỏi trang này theo ruling; component feature giữ nguyên file, số phận re-host
  là việc follow-up riêng. Surface thay thế hiện có: drawer Tổng quan (/shipments),
  Expense workspace, /shipments-debit, dispatch pages.
- **Deep-link degradation (chấp nhận theo ruling, review 25/10 m3):** link cũ tới
  /shipments/:id từ ExpenseWorkRows/ExpenseReport (kế toán), ShipmentFinancePanel,
  TripHeader/BasicInfoCard/DebitLotTable giờ đổ về form view read-only — đúng
  layout ruling nhưng không còn panel kế toán/tài chính ở đó. Người dùng kế toán/
  OPS cần dữ liệu tài chính đi thẳng surface chuyên: Expense workspace,
  /shipments-debit, drawer Tổng quan. Ticket follow-up riêng nếu owner muốn
  re-host panel tài chính lên drawer/form.


## Reproduction (trước patch)

1. Đăng nhập CUS/ADMIN local, tạo lô mới ở /shipments/new → landing /shipments/:id.
2. Thấy layout kiểu dashboard 10 panel, không phải form vừa điền → "mess".

## Verification plan

- Scoped vitest: view-mode workspace test (prefill + disabled + actions + role gate
  + lock) + route wrapper test + topline view-mode test.
- `tsgo --noEmit` frontend 0 lỗi; eslint files đụng 0; check-structure + design:drift.
- UI DRIVEN: before/after 390/768/1440 ở `qa/2026-10-25-sil481/`; click "Chuyển sang
  sửa" → /shipments/:id/edit thật; "Quay lại" → /shipments; screenshot + DOM assert
  + driver log.

## Independent review round (25/10, code-reviewer NEEDS_WORK → fixes)

- **M1 (fixed):** nút copy-giờ cấp ROW (`canCopyAppointment`) không gate `saving` —
  lot ≥2 cont có thể mutate containers trong view. Fix: `&& !saving` (ẩn).
- **M2 (fixed):** nút Xóa container cấp ROW không gate `saving` — mở confirm discard
  → setContainers trong view. Fix: `containersLength > 1 && !saving` (ẩn).
- **m1 (fixed):** role gate dùng shared `SHIPMENT_INTAKE_MUTATION_ROLES` thay vì
  hardcode 4 role (tránh drift với backend PUT /shipments/:id).
- **m2 (documented):** combobox.tsx (frozen 486) 488→493 — mảng exceed có sẵn từ
  HEAD; functional lines bắt buộc ~4 (gate + prop), comment đã trim; tổng số dòng
  exceed toàn repo GIẢM so với HEAD (52→51) do ShipmentDetailPage thu gọn.
- **NIT (fixed):** topline view fallback `onBack ?? onCancel`; combobox bỏ `pr-8`
  chết khi disabled; Enter-test spy `requestSubmit`; header comment cho CSS family
  đang chờ re-host.
- **m3 (documented ở Out of scope):** deep-link accountant/OPS giờ đổ về form view.
- Re-verify: tsgo 0 · eslint 0 · scoped vitest 99 file/994 test pass · full FE
  5653/5653 · live probe lot 3-cont (321): 54/54 input disabled, 0 nút Xoá, 0 nút
  delete/copy row, chỉ còn 2 nút view actions.

## Verification coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| /shipments/:id = form view mode (parity /shipments/new) | UI DRIVEN | qa/2026-10-25-sil481/after-{390,768,1440}.png + ui-driver.log (h1 "Chi tiết lô hàng", 25/25 input disabled, 0 enabled input) | role ACCOUNTANT/OPS chưa drive UI (unit test chốt gate) |
| "Chuyển sang sửa" → /shipments/:id/edit (SIL-171 form) | UI DRIVEN | qa/2026-10-25-sil481/after-1440-after-click-edit.png + driver log path=/shipments/300/edit h1="Sửa lô hàng" | role bị từ chối edit (route guard shipmentCreatorOnly — không đổi) |
| "Quay lại" → /shipments | UI DRIVEN | qa/2026-10-25-sil481/after-1440-after-click-back-list.png + driver log path=/shipments | — (xem Not covered cột 1 về role) |
| Multi-container: 0 affordance mutation (M1/M2) | UI DRIVEN | qa/2026-10-25-sil481/after-1440-multi-container-3cont.png (lot 321: 54/54 disabled, 0 Xoá, 0 delete/copy row) | lot khóa kế toán trên UI thật (unit test chốt disabled+title) |
| Before: layout dashboard cũ | UI DRIVEN | qa/2026-10-25-sil481/before-{390,768,1440}.png (:7175 = 0e8cd190) | — |

