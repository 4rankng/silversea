# Card 2026-10-05_384 — COM là số tiền trừ cho khách + Tổng COM (regression case)

Case ID: TC-384-01
Feature: bảng "Theo dõi hóa đơn" (`/accounting/invoice-tracking`) — cột COM và dải tổng phía trên.

Ghi chú về quy trình: hồ sơ này được viết SAU khi bắt đầu sửa, không phải trước. Đã ghi lại thẳng thắn thay vì giả vờ làm trước. Bù lại, phần quyết định (dưới đây) được chốt trước khi viết dòng mã nguồn đầu tiên, và mọi thay đổi đều có test.

## Quyết định sản phẩm (chốt 2026-10-05)
- **Thêm trường số MỚI `comAmount`; GIỮ `comNote` làm ghi chú chữ.** Dòng cũ đang có chữ thật trong `comNote`; chính tiêu chí nghiệm thu yêu cầu "Dòng cũ chỉ có comNote chữ vẫn hiển thị được". Đổi kiểu `comNote` thành số sẽ mất dữ liệu chữ của các dòng đã có.
- **COM KHÔNG đổi công thức Chênh lệch.** Chênh lệch là thứ đối soát HÓA ĐƠN với TIỀN TRẢ NCC — hỏi "có trả nhà cung cấp thừa không". "Tiền trừ cho khách" là khoản bên KHÁCH. Hai câu hỏi khác nhau; trộn vào sẽ làm sai một con số đang được dùng trong báo cáo. Thẻ mức Thấp, chỉ đối chiếu đặc tả, nên công thức tiền không được đổi khi chưa có quyết định của chủ sở hữu.
- **COM là tiền tròn, số nguyên** (`numeric(15,0)`), khớp với `invoiceAmount`/`supplierPayment` và các test cũ.
- Dải tổng từ 3 ô lên 4 ô bằng cách **thêm** một ô "Tổng COM"; ba ô cũ giữ nguyên giá trị và thứ tự tương đối.

## Repro (trước khi sửa)
1. Đăng nhập kế toán → Kiểm soát phơi phiếu → Theo dõi hóa đơn kết hợp.
2. Cột COM chỉ nhập được CHỮ tối đa 200 ký tự (ghi chú), không có ô tiền.
3. Dải tổng chỉ có 3 ô: Hóa đơn / Trả NCC / Chênh lệch — không có ô tổng COM.

## Expected
- COM nhập được dạng tiền; tổng COM hiện đúng ở dải tổng theo kỳ lọc.
- Dòng cũ chỉ có `comNote` chữ vẫn hiển thị được, ô COM hiện ghi chú đó (không mất dữ liệu).
- Ô COM hiện tiền ở dòng chính, ghi chú (nếu có) ở dòng dưới; chỉ khi cả hai rỗng mới hiện `—`.
- **Chênh lệch KHÔNG bị trừ COM.**
- COM âm hoặc có phần thập phân bị từ chối (400).
- lint + typecheck + tests xanh.

## Automated pins
- `backend/src/tests/invoice-tracking.test.ts`
  - COM vào tổng COM trên server; COM vẫn được ghi đúng vào từng dòng.
  - **Pin quyết định tiền (quan trọng nhất):** mỗi dòng có COM vẫn phải báo Chênh lệch = hoá đơn − trả NCC; và ở mức cửa sổ, `totals.difference === totals.invoice − totals.paid`. Đã kiểm tra bằng mutation: sửa backend để trừ `comAmount` thì suite ĐỎ (7 pass / 1 fail) — pin này có tác dụng thật, không trơ.
  - Dòng cũ chỉ có ghi chú chữ vẫn trả về với `comAmount` null, không lỗi.
  - COM âm và COM có phần thập phân đều bị 400.
- `frontend/src/pages/AccountingInvoiceTrackingPage.render.test.tsx` — ô COM hiện tiền + giữ ghi chú bên dưới; dòng chỉ có ghi chú vẫn hiện ghi chú; dải tổng có ô thứ 4 "Tổng COM" bên cạnh ba ô cũ.
- `frontend/src/pages/AccountingInvoiceTrackingPage.totals.test.ts` — `computeTotals` cộng COM.
- Hai pin `deepEqual(totals, …)` có sẵn được cập nhật thêm `com: 0`; **giá trị `difference` giữ nguyên** (3.500.000 và 4.000.000).

## Not covered
- Bằng chứng UI rung 3 (UI DRIVEN) cho ô COM có dữ liệu: xem bảng coverage trong thẻ.
- Câu hỏi còn treo cho LEAD/khách hàng: nếu ý khách hàng là "Chênh lệch = hoá đơn − trả NCC − tiền trừ khách" thì phải mở lại thẻ này; không sửa lặng lẽ.