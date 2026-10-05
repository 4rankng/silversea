# Card 2026-10-05_377 — Tạm ứng: duyệt chi phí Ops + báo cáo hoàn ứng đối chiếu Sổ Quỹ (regression case)

Case ID: TC-377-01 … TC-377-04
Feature: bảng quản lý tạm ứng (duyệt chi phí Ops) và Báo cáo tổng hợp hoàn ứng (`/accounting/hoan-ung`) đối chiếu Sổ Quỹ — đặc tả khách hàng 5.10, Hình 8/Hình 9.

## Quyết định sản phẩm (owner rulings áp dụng)
- "Còn phải hoàn ứng" là số closing của Sổ quỹ: **min(đã ứng, đã cấp) − đã tiêu − đã trả** (PM ruling 2026-09-29, card 168 board "RULING PM" câu 1; đã pin bởi suite card 169). Công thức nguyên văn của đặc tả ("Số tiền ĐNTT − Số tiền đã ứng") bị supersede; thẻ 377 vẫn giữ câu hỏi "Số tiền ĐNTT lấy từ đâu" trong mục Cần chốt với khách hàng.
- Tên cột báo cáo bám đặc tả 5.10: **Nhân viên ĐNTT**, **Ghi chú** (đổi từ "Nhân viên"/"Chiều" trong card này).
- "Duyệt" là thao tác trực tiếp của kế toán (PRD §2.1, không có chuỗi gửi duyệt).

## TC-377-01 — Cột báo cáo + lọc khoảng ngày
Repro: đăng nhập kế toán → `/accounting/hoan-ung`.
Expected: bảng có đủ cột **STT · Nhân viên ĐNTT · Số tiền ĐNTT · Số tiền đã ứng · Còn phải hoàn ứng · Ghi chú**; bộ lọc **Từ ngày / Đến ngày** + nút Lọc; rail tổng 3 số.

## TC-377-02 — Ngày duyệt: tick từng dòng và tick ALL
Repro: đăng nhập kế toán → `/accounting/expenses` (view ops) → bảng đăng ký chi phí.
Expected: cột **Ngày duyệt** có nút **Duyệt** trên từng dòng đủ điều kiện; ghi "Đã đối chiếu + ngày + Người duyệt" sau khi duyệt. Chọn-all: **Chọn trang này** và **Chọn tất cả N kết quả** (trần 200 dòng/lượt) rồi **Đối chiếu chi phí** — một lượt batch qua cùng một POST `/confirm`, ghi `confirmedAt/confirmedById` như duyệt lẻ. Chọn bằng cách bấm dòng hoặc focus + Space; dòng đã đối chiếu/hủy không chọn được.

## TC-377-03 — Khớp số Sổ Quỹ TÀI KHOẢN OPS ↔ Còn phải hoàn ứng (tiêu chí quan trọng nhất)
Repro: tạo tạm ứng đã cấp tiền thật (phiếu chi kho quỹ nguồn COMPANY) cho nhân viên Ops, ghi chi phí Ops đã xác nhận, lập đợt hoàn ứng phân bổ một phần, rồi đọc hai bề mặt.
Expected: tại cùng một thời điểm, `Sổ quỹ → TÀI KHOẢN OPS` (tổng và theo nhân viên) **bằng đúng** cột **Còn phải hoàn ứng** của báo cáo cho cùng nhân viên. Sau khi lập phiếu THU hoàn ứng (nhân viên trả lại tiền), **cả hai bề mặt giảm cùng một số** — báo cáo và sổ quỹ không bao giờ lệch nhau.
Automated pin: `backend/src/tests/card377-ops-fund-book-report-parity.test.ts` — 2 test, dữ liệu thật qua engine thật (recordFundedOpsAdvance → đợt phân bổ → refundExpenseReconciliation), số dư đọc từ `listFundBook('COMPANY').opsAdvance` và `listMonthlyReconciliationReport`, so `===` từng nhân viên và tổng.

## TC-377-04 — Hiển thị hai chiều dương/âm
Repro: xem cột Còn phải hoàn ứng và thao tác "Lập phiếu" của một đợt.
Expected: số luôn kèm dấu và nhãn cạnh số (không bao giờ là số trần); dương (> 0) = nhân viên còn giữ tạm ứng chưa tiêu → ghi chú "Công ty yêu cầu nhân viên hoàn trả tạm ứng" (tone cảnh báo); đợt còn chênh lệch dương → chỉ offer **Lập phiếu chi** (công ty hoàn ứng thêm), đợt âm → chỉ offer **Lập phiếu thu** (nhân viên hoàn trả), chiều sai không bao giờ hiện (backend chặn cả hai chiều).
Lưu ý: quy ước dấu theo PM ruling (dương = nhân viên đang giữ), khác chiều với công thức nguyên văn đặc tả — đã ghi nhận trong thẻ, chờ khách hàng chốt nguồn ĐNTT.

## Không thuộc hồ sơ này
- Bằng chứng UI DRIVEN (rung 3) trên app thật: do lane chính QA chụp (theo phân công trên thẻ).
- Nguồn "Số tiền ĐNTT" (tổng chi phí trong kỳ hay đề nghị riêng) và quy ước dấu: còn chốt với khách hàng.
