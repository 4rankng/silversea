# Card 2026-10-05_383 — Theo dõi hóa đơn: bổ sung loại cont + Xuất/Nhập (regression case)

Case ID: TC-383-01
Feature: bảng "Theo dõi hóa đơn" (`/accounting/invoice-tracking`) — ô "Cont" và file Excel xuất ra.

## Quyết định sản phẩm (chốt từ mã nguồn, 2026-10-05)
Hai câu hỏi 'Cần chốt' của thẻ đã có sẵn câu trả lời trong hệ thống, không cần hỏi khách:
- **Loại cont** → dùng danh mục `containerTypes` đã có (`shared/src/types/index.ts:761`), **không** tạo danh mục mới.
- **Xuất/Nhập** → chính là `shipments.tradeDirection` đã lưu sẵn, giá trị `IMPORT` / `EXPORT` (`backend/src/db/schema/shipments.ts:37`). Không phải nội trong nước, mà là nhập khẩu / xuất khẩu.

**Quyết định quan trọng: KHÔNG thêm cột DB, KHÔNG thêm ô nhập ở form.**
Thẻ ghi "Thiết kế liên quan — InvoiceTrackingRow chỉ có trường containerNumber, cần bổ sung", nhưng `containerNumber` **không phải cột lưu trữ** — nó đã được SUY RA sẵn từ `tripContainers` tại `backend/src/services/invoice-tracking.service.ts:78-87`. Nghĩa là ô "Cont" hiện tại đã hiển thị dữ liệu suy ra, không phải dữ liệu nhập tay.
Vì vậy "loại cont" và "xuất/nhập" phải **suy ra tiếp từ cùng chỗ đó**, chứ không thêm 2 cột mới và không bắt kế toán nhập lại. Lý do:
1. Loại cont và xuất/nhập là thuộc tính của CONT/CHUYẾN, không phải của hoá đơn. Hỏi kế toán nhập lại là tạo nguồn dữ liệu thứ hai có thể lệch với hồ sơ container.
2. Bỏ qua migration → dữ liệu cũ hiển thị đúng ngay, không có cột null, không cần backfill.
3. Đúng với tiêu chí nghiệm thu "Dữ liệu cũ hiển thị được, không lỗi".

## Repro (trước khi sửa)
1. Đăng nhập kế toán → Kiểm soát phơi phiếu → Theo dõi hóa đơn kết hợp.
2. Nhìn cột Cont: chỉ hiện số cont, thiếu loại cont và xuất/nhập.
3. Xuất Excel: thiếu hai cột.

## Expected
- Ô Cont hiện 3 phần: số cont / loại cont / xuất–nhập.
- Loại cont lấy từ danh mục `containerTypes`; xuất–nhập lấy từ `shipments.tradeDirection` (IMPORT → Nhập, EXPORT → Xuất).
- Chuyến chưa gắn container hoặc chưa có loại cont / chưa có hướng thì hiện `—`, **không** làm hỏng dòng, không lỗi.
- Dữ liệu cũ hiển thị được ngay, không migration, không cần backfill.
- File Excel xuất ra có thêm hai cột, tiêu đề tiếng Việt đúng thuật ngữ.
- Không thêm ô nhập liệu ở form Thêm chi phí lô hàng.

## Automated pins
- `backend/src/services/invoice-tracking.service.ts` — suy ra đúng container type + trade direction theo chuyến; trường hợp thiếu dữ liệu trả null chứ không ném lỗi.
- `backend/src/routes/expense-accounting.ts` — schema export mở rộng tương ứng, giữ nguyên các cột cũ.
- Test frontend ghim bộ cột export và nội dung ô Cont.

## Not covered
- Chuyến có nhiều container: hiện `containerNumberByTrip` lấy container ĐẦU TIÊN. Tiền tố giữ nguyên quy tắc đó (không đổi hành vi số cont), chỉ lấy loại cont theo cùng container đó.
