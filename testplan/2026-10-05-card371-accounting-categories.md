# Card 2026-10-05_371 — Tách phân hệ kế toán thành 4 danh mục (regression case)

Case ID: TC-371-01
Feature: điều hướng phân hệ Kế toán — 4 danh mục con: Phơi phiếu / Công nợ vận tải / Quỹ / Khác.

## Quyết định sản phẩm (owner đã giao agent, 2026-10-05)
Đặc tả 5.10 yêu cầu chia phân hệ kế toán thành các danh mục con. Ba câu hỏi 'Cần chốt' đã chốt:
- **4 hay 3 danh mục → 4.** Đặc tả ghi "3 mục chính" nhưng liệt kê 4, và tên thẻ cùng toàn bộ #372–#382 đều giả định 4. Lấy phần liệt kê chi tiết.
- **Danh mục Quỹ có gồm Sổ quỹ của khu vực chi phí không → CÓ.** Sổ quỹ là sổ của kế toán, đã gắn cổng `treasury.read`.
- **Dạng hiển thị → nhóm xuống (accordion), KHÔNG phải tab con.** Tái dùng đúng pattern `sidebar-section` sẵn có; AGENTS.md §3 cấm tạo pattern mới khi đã có pattern dùng chung.

## Repro (trước khi sửa)
1. Đăng nhập với vai trò KẾ TOÁN → mở menu bên trái, mục 'Công nợ & Dòng tiền'.
2. Quan sát: toàn bộ màn kế toán nằm chung một mục phẳng — Sổ quỹ / Ngân hàng, Công nợ phải thu, Công nợ phải trả, Chi phí phát sinh, Tạm ứng & Hoàn ứng, Báo cáo hoàn ứng, Theo dõi hoá đơn, Theo dõi hoàn cược, Kiểm soát phơi phiếu, Kế toán chốt debit.
3. Không có nhóm nào tách Phơi phiếu / Công nợ vận tải / Quỹ / Khác.

## Expected
- Đủ 4 danh mục trong menu kế toán, theo đúng 4 nhóm đặc tả nêu.
- Mỗi màn của đặc tả nằm đúng một danh mục — không sót, không lặp.
- **Route cũ vẫn mở được**: /accounting, /accounting/phoi-phieu, /accounting/deposit-tracker, /accounting/invoice-tracking, /accounting/hoan-ung, /accounting/chot-debit, /debt, /payables, /advances, /salary, /finance/treasury. Đổi cấu trúc menu KHÔNG được làm hỏng đường dẫn đã phát ra.
- Vai trò không có quyền không nhìn thấy danh mục ngoài thẩm quyền (danh mục rỗng không được render).
- Menu dùng được ở 390 / 768 / 1440, nhãn không bị cắt.
- lint + typecheck + tests xanh.

## Phân bổ màn hình theo đặc tả
- **PHƠI PHIẾU**: Kiểm soát phơi phiếu (/accounting/phoi-phieu) · Chi phí phát sinh (/expenses) · Theo dõi hoá đơn kết hợp (/accounting/invoice-tracking) · Theo dõi hoàn cược (/accounting/deposit-tracker) · Tạm ứng & Hoàn ứng (/advances) · Báo cáo hoàn ứng (/accounting/hoan-ung) · Kế toán chốt debit (/accounting/chot-debit)
- **CÔNG NỢ VẬN TẢI**: Công nợ phải thu (/debt) · Công nợ phải trả (/payables)
- **QUỸ**: Sổ quỹ / Ngân hàng (/finance/treasury)
- **KHÁC**: Lương & Chấm công (/salary)

Ghi chú về mốc quyết định (a) "Quỹ có gồm Sổ quỹ của khu vực chi phí không": Sổ quỹ dạng tab nằm trong `ExpenseAccountingWorkspace` (`features/expense-accounting/ExpenseAccountingWorkspace.tsx:30,106`), nhưng route `/expenses` (`App.tsx:412`) lại mở `ExpenseListPage`, không mở workspace đó. Nên mục vào menu kế toán cho danh mục Quỹ là **Sổ quỹ / Ngân hàng** tại `/finance/treasury` — đây cũng là bề mặt kế toán dùng thật, đã gắn cổng `treasury.read` và đã có bằng chứng UI. Việc gộp tab Sổ quỹ trong workspace chi phí vào cùng danh mục là việc riêng, chưa làm ở thẻ này.

Ghi chú về "danh sách nhân sự" mà đặc tả nêu trong danh mục Khác: không tồn tại màn hình danh sách nhân sự tương ứng trong hệ thống (không có route nào khớp). Khác với các màn khác, mục này của đặc tả chưa có sản phẩm để gom — đã ghi ra đây để không bị hiểu là bỏ sót.

## Automated pins
- `frontend/src/components/Layout.test.tsx` — mỗi vai trò thấy đúng 4 danh mục với đúng danh sách màn; không màn nào lặp giữa 2 danh mục; danh mục rỗng không render.
- Kiểm tra route không đổi: path của từng NavItem so với giá trị cũ.

## Not covered bằng hồ sơ này
- Nội dung từng màn hình trong từng danh mục thuộc #372–#382, không thuộc thẻ này.
- Bằng chứng UI rung 3 (UI DRIVEN) ở 390/768/1440: xem bảng coverage trong thẻ.
