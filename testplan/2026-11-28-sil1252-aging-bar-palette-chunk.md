# SIL-1252 (id 1529) — Thanh tuổi nợ /debt chỉ hiện vạch xám trống (regression case)

Case ID: TC-SIL1252-01
Feature: Thanh tuổi nợ (`.aging-bar__seg` palette) trên `/debt` (Công nợ phải thu, `DebtListPage`) và `/payables` — cùng họ `aging-bar__seg` với `/dashboard`.

## Đặc tả (nguồn: thẻ SIL-1252, build 61999831, staging 28/11/2026)
- Môi trường: vantai.tingting.vip, vai Kế toán (ngocntm), /debt, viewport 1440.
- Trước fix: thanh tuổi nợ đầu trang = vạch xám nhạt 724×6px, không đoạn màu nào — `.aging-bar__seg--ok` (rộng 714px, 98,6% tổng nợ) có nền `rgba(0,0,0,0)` trong suốt. Chú thích số liệu bên dưới vẫn đúng (273.861.240 đ · 2 KH).
- Mong đợi: đoạn 0–30 ngày hiện màu xanh lá đặc (`--accent`), các đoạn quá hạn đậm dần (`--warning`/amber/deep/`--danger`).

## Nguyên nhân (chẩn đoán 28/11)
- Mọi route là `lazy(() => import(...))` (`frontend/src/App.tsx`) → CSS mỗi trang nằm trong chunk riêng.
- Palette `.aging-bar__seg--{ok,t1,t2,t3,t4}` sống trong `DashboardPage.css` — chỉ tải khi chunk Dashboard tải. Vào thẳng /debt (landing role Kế toán) không tải chunk Dashboard → seg không có rule nền → transparent, chỉ còn nền `--surface-3` của container.
- Cùng lớp lỗi tiềm ẩn trên `/payables` (`PayableListPage` render cùng class, không tự định nghĩa màu).

## Thiết kế đã chọn (fix theo shared owner, một pattern một implementation)
- Palette chuyển về stylesheet component toàn cục `frontend/src/components/AgingBar.css` (className-based, không có owning .tsx — đúng convention aggregator `index.css`), `index.css` import cạnh các component sheet khác → palette đi theo entry chunk, mọi route đều có.
- `DashboardPage.css` không còn sở hữu palette (không dùng `.aging-bar` từ lâu). Không có page-local copy nào (sweep: Debt/Payable không khai lại màu).

## Automated pins
- `frontend/src/components/AgingBar.styles.test.ts`:
  - palette 5 modifier nằm trong `src/components/AgingBar.css`, nền token (`--accent`/`--warning`/`--wf-amber-mid`/`--warning-deep`/`--danger`);
  - `src/index.css` import sheet đó (palette không ở lazy page chunk);
  - defect-class sweep: không page CSS nào (`DashboardPage.css`, `DebtListPage.css`, `PayableListPage.css`) khai lại `.aging-bar__seg--` background.
- Kế cận: `frontend/src/pages/DebtListPage.band.test.tsx` (seg class/width), `frontend/src/pages/debt-payable-aging.test.tsx` (hành vi band).

## Quy tắc hiển thị (shipmate-uiux doctrine)
- `--accent` là graphic-only (§2 law book: dots, bars, rings) — dùng cho fill đoạn bar là đúng role; không dùng làm text color.
- Giữ nguyên kích thước thanh (6px band / 8px dashboard), chỉ sửa ownership màu.

## Not covered bởi hồ sơ này
- Rung 3 UI DRIVEN (screenshot computed style trên staging) thuộc cột QA theo chỉ đạo lane "Scoped tests + tsc".
- Câu màu tối ưu thị giác của từng bucket (đã chốt ở SIL-469) — không mở lại.
