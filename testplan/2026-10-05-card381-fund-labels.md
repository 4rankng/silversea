# Card 2026-10-05_381 — Danh mục Quỹ: nhãn nguồn quỹ theo đặc tả 5.10 (regression case)

Case ID: TC-381-01
Feature: nhãn nguồn quỹ trên toàn bộ bề mặt kế toán — Sổ quỹ, phiếu chi phí, phiếu tiền mặt, Sổ quỹ / ngân hàng, vị trí quỹ, và thông báo lỗi backend.

## Quyết định sản phẩm (owner, 2026-10-05)
Đặc tả giao diện 5.10 của khách hàng (bản gửi 05/10/2026) gọi hai nguồn quỹ là **"Quỹ tiền mặt"** và **"Quỹ công ty"**. Hệ thống dùng tắt **"Quỹ TM"**. Owner chốt: **bám đặc tả khách hàng**, đổi nhãn hiển thị sang "Quỹ tiền mặt", đồng thời sửa PRD để không mâu thuẫn với giao diện.

Mã nguồn nội bộ `COMPANY` / `TM` **không đổi** — tài khoản quỹ và bút toán đã phát sinh gắn với mã này. Đây chỉ là đổi chuỗi hiển thị.

## Repro (trước khi sửa)
1. Đăng nhập kế toán → khu vực chi phí → tab 'Sổ quỹ' → mở bộ lọc 'Nguồn quỹ'.
2. Quan sát hai lựa chọn: hiện là `Quỹ công ty` và `Quỹ TM`.
3. Lặp lại ở: phiếu chi phí (ExpenseVoucherDrawer), phiếu tiền mặt (ExpenseCashDrawer), Sổ quỹ / ngân hàng (TreasuryAccountDrawer), và trang vị trí quỹ (TreasuryPositionPage).
4. Gọi API ghi phiếu với tài khoản chưa phân nguồn quỹ, và với phiếu trộn hai nguồn quỹ.

## Expected
- Mọi nơi kế toán nhìn thấy đều hiện **`Quỹ tiền mặt`** và `Quỹ công ty`; **không còn chuỗi "Quỹ TM"** ở bất kỳ bề mặt kế toán nào.
- Thông báo lỗi backend nói `Quỹ tiền mặt` thay cho `Quỹ TM` (cả thông báo "tài khoản chưa phân nguồn quỹ" và thông báo "phiếu trộn hai nguồn quỹ").
- Nhãn đọc từ **một hằng dùng chung**, không còn chuỗi lặp rải rác: đổi tên sau này là sửa một chỗ.
- **Mã nội bộ `COMPANY` / `TM` không đổi**: URL/query vẫn là `fundSource=TM`, payload vẫn gửi `"TM"`, tài khoản quỹ cũ và lịch sử tiền vẫn đọc được.
- Đơn vị tiền hiển thị: **đồng (₫)**, không đổi (đặc tả không nói; giữ hiện trạng).

## Automated pins
- `shared/src/schemas/treasury.test.ts` — hằng nhãn khớp đặc tả; mọi mã đều có nhãn; **không còn "Quỹ TM"**; mã `['COMPANY','TM']` bất biến.
- `frontend/src/features/expense-accounting/FundBookSection.test.tsx` — chọn quỹ tiền mặt vẫn refetch `source=TM` (nhãn đổi, mã không đổi).
- `frontend/src/features/treasury/TreasuryAccountDrawer.test.tsx` — chọn theo nhãn mới ở cả hai chỗ.
- `backend/src/tests/expense-cash-routes.test.ts` — thông báo chặn ghi phiếu dùng nhãn mới; luật nghiệp vụ không đổi.

## Not covered bởi hồ sơ này
- **Vị trí danh mục Quỹ trong phân hệ kế toán**: thuộc #371 (tách phân hệ kế toán thành 4 danh mục), chưa triển khai. Thẻ này chỉ chốt nhãn và nguồn dùng chung.
- **Số dư quỹ âm / thông báo nhanh góc phải**: thuộc #370.
- **Bằng chứng UI DRIVEN (rung 3)**: cần chạy app thật; chưa thực hiện trong phiên này. Xem bảng coverage trong thẻ.
