# SIL-723 (id 843) — Nhập chi phí Ops: nút Lưu bị vô hiệu im lặng, luật bắt buộc sai KB Chương 6

- Ticket: SIL-723 (board SIL, id 843, tạo 07/11/2026; owner: "you are dev,
  investigate and fix").

## Bug (kết quả thực tế trước fix)

Surface: drawer/modal "Khai báo chi phí" của Ops (`OpsExpenseFormModal`,
mở từ /my-orders → "Khai chi phí").

1. Khi Lưu bị disabled, footer KHÔNG nói thiếu trường nào — vô hiệu im lặng
   (thông báo duy nhất nằm ở gợi ý dòng, xa nút, không nêu đúng tên trường).
2. Block "Phí không hóa đơn" có 2 ô ghi chú dễ nhầm ("Ghi chú thu khách" và
   "Ghi chú"): Thực thu để trống ⇒ dòng 0₫ thu khách ⇒ bắt buộc "Ghi chú"
   (luật card 20260928_162, server 400 giữ nguyên) — nhưng thông báo cũ
   "Dòng không thu khách — bắt buộc ghi chú lý do." không nêu tên trường.
3. Ảnh biên lai upload lỗi ⇒ canSubmit=false, thông báo "Còn ảnh chưa tải
   xong." không nêu cách xử lý.
4. Block "Phí có hóa đơn" KHÔNG bắt buộc Số hóa đơn — ngược KB Chương 6
   (chỉ nhóm CÓ HÓA ĐƠN mới bắt buộc số hóa đơn).

## Luật đúng (KB Chương 6 + owner 07/11)

- Bắt buộc tối thiểu = Loại phí + Số tiền (+ Số hóa đơn CHỈ khi thuộc nhóm
  có hóa đơn).
- Ảnh biên lai TÙY CHỌN ("có thể chụp hoặc không").
- Thực thu không tự ép; Thực chi / Thực thu / Đã thu ba số tách biệt.
- Server giữ nguyên luật "dòng không thu khách ⇒ bắt buộc Ghi chú" (400).

## Case pin (expected sau thay đổi)

1. Điền Loại + Số tiền + Ghi chú (không hóa đơn, không ảnh) → Lưu thành công,
   chi phí vào lô (payload `invoiceNumber: null`, `photoStorageKeys: []`).
2. Thiếu trường bắt buộc → thông báo NÊU TÊN trường, hiện cả ở hàng dòng lẫn
   ngay cạnh nút Lưu (`role="status"` trong footer):
   - thiếu Ghi chú khi không thu khách: "Dòng không thu khách (Thực thu để
     trống) — bắt buộc nhập trường \"Ghi chú\"."
   - nhóm có hóa đơn thiếu số: "Nhập \"Số hóa đơn\" — khoản có hóa đơn bắt
     buộc có số hóa đơn."
   - ảnh chưa tải xong: nêu 2 nút xử lý "Thử tải lại ảnh"/"Bỏ ảnh chưa tải".
3. Block không hóa đơn KHÔNG bao giờ đòi Số hóa đơn.
4. Điền đúng trường được nêu → nút Lưu bật lại.

## Regression evidence

- FE `OpsExpenseFormModal.containers.test.tsx` describe "Lưu law (SIL-723)"
  B1–B4 + A2/A3/A5 re-pin (điền Số hóa đơn) → 9/9 pass 2026-11-07
  (qa/2026-11-07-lane-g1/).
- UI drive rung-3: qa/2026-11-07-lane-g1/sil-723_ui-*.png + ui-driver.log.
- Server-side enforcement của Số hóa đơn cho nhóm có hóa đơn CHƯA có — gap
  ghi nhận ở Concerns (FE là cổng duy nhất enforcing trong lane này).
