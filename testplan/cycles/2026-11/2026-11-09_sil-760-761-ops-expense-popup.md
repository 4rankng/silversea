# Regression spec — SIL-760 + SIL-761 Ops expense popup (2026-11-09)

**Source:** board SIL-760 (id 881) + SIL-761 (id 882), spec 2026.11.09.Ticket.docx
Phần III Epic 2 mục 1-3, ticket CR-006, nhóm B ưu tiên cao.
**Surface:** popup "Khai báo chi phí" (`OpsExpenseFormModal`) tại `/ops/orders`
và drawer lô (`ShipmentsPage`). Accounts per `testplan/testaccounts.txt`.

## TC-760-01 — Modal rộng, chỉ còn 2 tab giữa popup (không còn 2 khối dọc đè nhau)

- **Given** Ops (hoangnh) mở popup Khai báo chi phí ở bất kỳ lô nào
- **When** popup render
- **Then**: modal rộng chuẩn max-w-5xl; 2 tab `[PHÍ KHÔNG HÓA ĐƠN]` /
  `[PHÍ CÓ HÓA ĐƠN]` căn giữa; bấm tab nào chỉ khu nhập của nhóm đó mở rộng;
  không còn hai khối dọc xếp chồng.
- **Unit:** `OpsExpenseFormModal.containers.test.tsx` (tab role + region per tab).

## TC-760-02 — Dòng nhập NGANG liên tục đủ 6 cột

- **Then**: mỗi khoản chi là 1 dòng ngang: Loại phí | Số tiền (VNĐ)* |
  Số hóa đơn | Ghi chú | Ảnh chứng từ | Xóa. Tab không hóa đơn ẩn cột Số hóa
  đơn; tab có hóa đơn hiện ô nhập Số hóa đơn.
- **Unit:** `FeeRowFields` cells + C1/C2 tests; browser 1440/768/390.

## TC-760-03 — Chuyển tab giữ nguyên dữ liệu cả 2 tab

- **When** nhập 1 dòng tab không hóa đơn → sang tab có hóa đơn nhập thêm →
  quay lại tab đầu
- **Then**: dòng đã nhập còn nguyên vẹn ở cả hai tab.
- **Unit:** C1 (`tabs + shared save`).

## TC-760-04 — 1 nút Lưu chung gom cả 2 tab

- **When** bấm 1 nút Lưu duy nhất ở chân popup
- **Then**: tất cả dòng hợp lệ ở CẢ HAI tab được gửi trong một lần lưu
  (2 tác vụ ghi, theo đúng thứ tự không-hóa-đơn rồi có-hóa-đơn).
- **Unit:** C2. **Server law giữ nguyên:** dòng không thu khách vẫn bắt buộc
  Ghi chú (card 20260928_162 — BE 400, không đổi).

## TC-761-01 — Ops không còn thấy "Thực thu" / "Ghi chú thu khách"

- **Given** Ops (hoangnh) mở popup ở bất kỳ lô nào
- **Then**: toàn bộ popup không còn chuỗi "Thực thu", "Ghi chú thu khách";
  không còn cột Thực thu trong dòng nhập; không còn dòng nhắc
  "Dòng chi này không thu khách hàng (Thực thu để trống)…".
- **Unit:** containers describe "SIL-761 Ops viewer" — scan `/Thực thu/` = null.

## TC-761-02 — Ops vẫn khai và lưu chi phí bình thường

- **When** Ops nhập Loại phí + Số tiền + Ghi chú (+ ảnh tùy chọn) rồi Lưu
- **Then**: lưu thành công; payload không gửi customerChargeAmount
  (server tự suy 0) và recoveryNote null.
- **Unit:** containers C3.

## TC-761-03 — Vai khác không bị ảnh hưởng

- **Then**: CUS (và ADMIN/MANAGER) mở cùng popup vẫn thấy trường thu khách
  ở dòng không hóa đơn; Kế toán (hoapt) thao tác thu khách ở mục riêng
  (expense-accounting) không đổi; popup sửa khoản của Ops cũng ẩn 2 trường.
- **Unit:** containers (mặc định không auth = vai khác) + C3-NULL case;
  edit modal gate test.

## Not covered by unit

-Ảnh thật/legend, drag, mobile touch — browser drive ghi trong qa/ 2026-11-09.
