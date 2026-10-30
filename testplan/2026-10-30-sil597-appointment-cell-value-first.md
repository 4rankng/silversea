# SIL-597 (ticket 697) — Cột "Ngày giờ đóng trả" trong bảng Thông tin hàng phải value-first, không lộ khung input

Ngày: 2026-10-30 · Ticket SIL-597 (board id 697) · QA Glint

## Hiện tượng (bug)

Trên form tạo lô hàng `/shipments/new`, mục "Thông tin hàng", cột NGÀY GIỜ
ĐÓNG TRẢ của từng container hiển thị trực tiếp 2 khung nhập liệu (HH:mm và
DD/MM/YYYY) trong ô — khác với cột SỐ CONTAINER bên cạnh vốn hiển thị
nhãn + giá trị (chữ giữ chỗ, không lộ khung input).

## Các bước tái hiện

1. Đăng nhập vai trò tạo được lô hàng (CUS).
2. Mở `/shipments/new` → mục "Thông tin hàng" → dòng container đầu tiên.
3. So sánh cột SỐ CONTAINER với cột NGÀY GIỜ ĐÓNG TRẢ.

Kết quả thực tế: cột NGÀY GIỜ ĐÓNG TRẢ lộ khung input ngay cả khi chưa sửa.

## Trường hợp kiểm (regression case)

- **C1 (hiển thị khi nghỉ):** ô NGÀY GIỜ ĐÓNG TRẢ ở trạng thái nghỉ hiển thị
  nhãn (`data-label="Ngày giờ đóng trả *"`) + giá trị dạng text
  (`formatContainerAppointment` — "HH:mm DD/MM/YYYY") hoặc chữ giữ chỗ
  "Chọn ngày giờ"; ô KHÔNG mang class `csc-container-cell--persistent`
  (mode ép editor hiện mọi lúc) — khung input không lộ ngoài ô.
- **C2 (khi sửa):** kích hoạt ô (click) đưa focus vào editor datetime
  (các segment) — khung nhập chỉ xuất hiện khi sửa, đúng value-first reveal
  contract của các ô khác trong cùng bảng.
- **C3 (sau khi nhập):** giá trị đã nhập hiển thị trong lane display
  ("09:00 20/09/2026"), không cần mở editor để đọc giá trị.
- **C4 (style contract):** CSS của ShipmentContainerCell giữ editor ẩn mặc
  định (`.csc-container-cell__editor > *` opacity 0, `:focus-within` reveal)
  và không còn rule `--persistent` ép editor hiện.

## Phạm vi

- CHỈ cột NGÀY GIỜ ĐÓNG TRẢ theo từng container trong bảng "Thông tin hàng".
- KHÔNG đụng phần "Ngày giờ đóng trả cho tất cả cont" ở mục Lịch & ghi chú
  (ticket ghi rõ không thuộc phạm vi).
- Mobile ≤620px giữ nguyên phone-record rule (editors shown continuously) —
  hành vi mobile không đổi.

## Bằng chứng

- Pin: `frontend/src/features/shipments/create/ShipmentCreateWorkspace.appointment-display.test.tsx` (C1–C4).
- Sửa pin lạc hậu: `ClerkShipmentCreatePage.test.tsx` (assert class
  `--persistent` → assert display lane), `ShipmentCreateWorkspace.invalid-required-paint.test.tsx`
  (bỏ nhánh `--persistent` trong helper).
