# SIL-852 — Hồi quy: Chuẩn hóa Sidebar Kế toán & Phân trang chống trắng màn hình

Ngày: 2026-11-19 · Agent-MiMo · Ticket: 2026.11.18.Ticket.docx — Epic 2, Task 2.1

## Phạm vi hồi quy (trước khi làm)

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---|---|---|
| C1 | Sidebar Kế toán (`Layout.tsx` nav, nhãn từ `titleForPath`) | nhãn in hoa 'KIỂM SOÁT LÔ HÀNG' quay lại; menu kẹt giữa Công nợ phải thu/trả; 'Ghép bộ Debit' tách khỏi nhóm | Nhãn đúng 'Kiểm soát lô hàng' (sentence case); thứ tự: Kiểm soát lô hàng → Ghép bộ Debit → Công nợ phải thu → Công nợ phải trả trong nhóm Công nợ vận tải |
| C2 | Bảng Kiểm soát lô hàng `/accounting/chot-debit` (AccountingDebitClosePage) | render hàng trăm dòng không phân trang → trang ~6000px, trắng vùng dữ liệu dưới | 25 lô trong kỳ → trang 1 đúng 20 dòng; thanh điều hướng trang + chọn 20/50 dòng/trang; 'Trang sau' → 5 dòng còn lại |
| C3 | Bảng Ghép bộ Debit trên `/shipments-debit` (DebitMergeGrid) | cùng triệu chứng trắng màn hình | 45 lô → đúng 20 dòng/trang; page sizes [20, 50]; điều hướng hoạt động |
| C4 | Chỉ mục trang khi bộ lọc thu gọn kết quả (boardPage không clamp) | đang ở trang sau, gõ tìm kiếm/đổi tab FCL-LCL khiến bảng còn < 1 trang → bảng TRỐNG dù vẫn có dòng khớp (trắng vùng dữ liệu) | lọc rút gọn bảng khi đang ở trang 2 → dòng khớp vẫn render (về trang cuối còn tồn tại), không bảng trống |
| C5 | Ghép bộ Debit / chốt debit khác (money logic, backend) | ngoài phạm vi | KHÔNG đụng — chỉ đọc/pin hành vi FE phân trang |

## Quyết định đã chốt

1. Phân trang client-side trên dữ liệu kỳ đã tải (tháng mặc định) — tái dùng đúng
   pattern `design-system/Pagination` + page-size [20, 50] như DebitMergeGrid;
   không thêm endpoint page/limit (giữ nguyên dữ liệu/sắp xếp, ít rủi ro nhất).
2. Pattern clamp `safePage = min(page, totalPages)` của DebitMergeGrid là luật
   chung; board chot-debit phải theo luật đó (C4 là fix, không phải feature).
3. Vùng 'Chờ xác nhận' để nguyên không phân trang: luồng gửi yêu cầu điều chỉnh
   đã gỡ (SIL-805 Task 1.1) nên vùng này chỉ co lại, không bao giờ hàng trăm dòng.
4. Sidebar: nhãn + thứ tự đã có trên main (commit ab50b4c9, cùng ticket 18/11) —
   C1 là pin giữ bằng Layout.test.ts / routes.test.ts, không sửa lại code.

## Bằng chứng thi hành

Xem `qa/2026-11-19_sil852_vitest.txt` (scoped vitest) và commit message đính kèm
kết quả verbatim; UI rung/coverage theo AGENTS.md §9 ghi trong báo cáo lane.
