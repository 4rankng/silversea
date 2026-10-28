# SIL-553 — drawer "Chi tiết container" (/dispatch): ô SỐ TỜ KHAI click-to-edit cho Điều vận

- Ticket: SIL-553 (board SIL, internal id 627, high) — repro role dungnv
  (Điều vận) trên staging build **9094e31c**: /dispatch ("Kế hoạch Tổng quát")
  → drawer "Chi tiết container" lô K2K4124325234 (LOG COM) → cột SỐ TỜ KHAI
  là plain text "Chưa có tờ khai", click/ double-click không mở editor.
  Số cont + Giờ hẹn đóng/trả trong cùng drawer đã sửa được (SIL-550).
  Expected: Điều vận sửa được cả Số cont, Số tờ khai, Giờ hẹn đóng/trả.
- **Trạng thái trên main (4f173243) — finding của lane này**: editor ô SỐ
  TỜ KHAI của drawer ĐÃ tồn tại từ SIL-530 (8f6e3ed2,
  `ContainerLineTextField field="declarationNumber"`, hint "Enter lưu · Esc
  thoát" — cùng contract với reference `DispatchDeclarationCell` của SIL-551:
  maxLength 50, trim, Enter lưu / Esc+blur hồi, payload per-cont
  `{ expectedShipmentVersion, declarationNumber }` + Idempotency-Key, FB-109
  toast đếm sibling, lỗi surface nguyên văn). Cái thiếu ở build staging của
  QA là gate: trước SIL-551 drawer gate CUS/Quản trị/Quản lý only
  (card 261013200312) → DISPATCHER thấy text tĩnh. Commit 6f9c3e87 (SIL-551)
  mở gate theo per-cont writer law **ở cả 2 surface** dùng container-line
  command — `DispatchDeclarationCell` (/dispatch-detail) + drawer
  `DispatchContainerDetailDrawer` (/dispatch): "một law cho command". Repro
  của ticket là trên build TRƯỚC commit đó → premise "drawer không có editor"
  đã stale so với main; lỗi còn lại là regression-pin cho đường repro của
  ticket (Điều vận + ô trống "Chưa có tờ khai").
- Law giữ nguyên (không reopen): per-cont tờ khai write = CUS/Quản trị/
  Quản lý/Điều vận; ACCOUNTANT/DRIVER/OPS + unauthenticated text tĩnh
  (writer 403). Luật tờ khai cấp LÔ (FB-005) không đổi. "Role CUS/QT/QL
  không mở editor" trong brief dispatch mâu thuẫn với chính "đúng law
  SIL-551" trong brief và với server writer law — brief liệt kê role editable
  của law rồi negate; theo law đã land, CUS/Quản trị/Quản lý MỞ editor
  (pins hiện có). Nếu owner thật sự muốn drawer Điều-vận-only thì đó là
  reversal của "một law cho command" — cần ruling mới, không làm trong lane này.

## Case pin (expected)

1. Drawer "Chi tiết container" (/dispatch) cột SỐ TỜ KHAI, dòng cont
   (`shipment_containers.declaration_number` per-cont SIL-521): Điều vận/
   CUS/Quản trị/Quản lý thấy text-button click-to-edit
   ("Sửa số tờ khai · <số cont>", owner ruling 20261006_537 — không nút Sửa
   riêng). Ô trống render placeholder "Chưa có tờ khai" **vẫn clickable**.
2. Click ô (kể cả ô trống "Chưa có tờ khai") → in-cell editor mở
   (input aria "Số tờ khai", maxLength 50, hint "Enter lưu · Esc thoát")
   — regression này: trước gate SIL-551, click không mở gì (plain text).
3. Enter lưu qua container-line command per-cont:
   `POST /shipments/cus-workspace/:id/containers/:lineId` với
   `{ expectedShipmentVersion, declarationNumber }` + Idempotency-Key;
   FB-109 auto-copy server-side + toast đếm sibling; drawer refetch detail +
   `onSaved` ping board. Enter không đổi giá trị không ghi; Esc/blur hồi
   placeholder "Chưa có tờ khai" khi trống, không write; lỗi 409/403 surface
   nguyên văn, editor giữ mở.
4. ACCOUNTANT/DRIVER/OPS/unauthenticated: text tĩnh, không affordance
   (server 403) — như hiện trạng.

## Regression evidence (qa/2026-10-28_sil553-drawer/)

- `qa/2026-10-28_sil553-drawer_tests.log` — scoped FE vitest
  (DispatchContainerDetailDrawer + DispatchDeclarationCell + styles) PASS,
  gồm 2 pin mới `SIL-553 repro` (Điều vận + ô trống click-to-edit mở editor,
  Esc giữ placeholder không write) và `SIL-553 — Điều vận Enter lưu payload
  per-cont` (assert đúng `{ expectedShipmentVersion: 7, declarationNumber }`
  cho line 10).
- `qa/2026-10-28_sil553-drawer_regression-red.log` — red proof: gate drawer
  tạm revert về luật cũ (bỏ Role.DISPATCHER) → 2 pin mới FAIL đúng triệu
  chứng ticket (click không mở editor) → restore xanh. Guard đúng defect
  class của ticket (role gate), không pin incidental.
- `qa/2026-10-28_sil553-drawer_tsc.log` — FE `tsc --noEmit` 0 errors.
- Scope limit: không UI-drive lại (behavior đã được UI drive rung-3 ở
  6f9c3e87 — `qa/2026-10-28_sil551-decl/run1/` dispatcher click drawer-cell
  path tương đương surface + command); lane này pin unit regression +
  red/green. QA re-verify trên staging build ≥ 4f173243.
