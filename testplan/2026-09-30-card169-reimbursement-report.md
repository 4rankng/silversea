# Card 20260928_169 — Báo cáo tổng hợp hoàn ứng (regression case)

Case ID: TC-169-01
Feature: /accounting/hoan-ung — Báo cáo tổng hợp hoàn ứng theo nhân viên / theo đợt (lô đối soát).

## Repro
1. Đăng nhập kế toán (hoapt / Abc123 trên staging; ketoan local) → menu 'Báo cáo hoàn ứng'.
2. Lọc khoảng ngày + nhân viên + đợt (lô đối soát).
3. Đối chiếu ba cột: Số tiền ĐNTT · Số tiền đã ứng · Còn phải hoàn ứng.

## Expected
- 'Còn phải hoàn ứng' = công thức sổ quỹ chuẩn: min(đã ứng, đã cấp) − đã tiêu (cùng nguồn số với dòng 'Còn phải hoàn ứng (theo kế toán)' của Sổ quỹ TÀI KHOẢN OPS) — two tables, ONE definition (PM ruling 29/09).
- Còn lại > 0 → hành động 'Lập phiếu' theo chiều CHI tạm ứng (công ty thanh toán hoàn ứng).
- Còn lại < 0 → hành động theo chiều THU tạm ứng (công ty thu lại); chiều SAI không bao giờ được render và backend từ chối (test pin qua engine phiếu thật).
- Một khoản chi CHỈ thuộc đúng MỘT đợt (đợt sở hữu đúng các source nó đã stamp — không đếm theo cửa sổ ngày).

## Automated pins
- backend/src/tests/card169-reconciliation-report.test.ts (đợt ownership discriminator · remaining = book trước/sau khi post phiếu · wrong-direction refusals · settle-exactly-once).
- backend/src/tests/card11-reconciliation-report.test.ts (re-pinned: đề nghị không cấp tiền KHÔNG được tính là đã ứng).
