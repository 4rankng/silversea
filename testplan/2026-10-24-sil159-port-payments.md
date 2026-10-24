# SIL-159 — /demo/port-payments: UNC queue + Sổ hoàn ứng lái xe

Spec: 2026.10.24_Demo_layout.docx §PHÂN HỆ 2 (mục 2, doc_bb1b74fcfa8b).
Surface: Tab 2.1 Hàng đợi Duyệt UNC + Tab 2.2 Sổ hoàn ứng lái xe.
Fixtures only (`frontend/src/demo/data`) — zero API calls.

Owner consult verdict (lane brief, 24/10): status badge pill `py-0.5 px-2
text-xs font-medium` (warning-50/700 ⏳ chờ → success-50/700 ✅ đã); checkbox
column `w-10`; khi duyệt ô trạng thái hiện mini spinner TRƯỚC badge xanh
(chặn double-click).

## Cases

### TC-SIL159-01 — Tab 2.1 queue contents (filter đúng loại phí)
Vào `/demo/port-payments` (mặc định ngày 2026-10-24, tab 2.1).
Expected: mọi dòng là phí `lift`/`drop` method `unc` của chuyến ngày chọn.
KHÔNG xuất hiện: phí `surcharge` UNC (F-2401c 250k), phí `driver-cash`
(F-2402a). Dòng chờ có pill ⏳ Chờ UNC + nền highlight; dòng đã UNC có pill
✅ Đã UNC, mờ đi.

### TC-SIL159-02 — Bộ lọc cảng + trạng thái
Chọn Cảng "Cát Lái" → chỉ còn dòng portId=CL. Chọn Trạng thái "Đã UNC" →
chỉ dòng uncStatus=paid (hoặc override). Đổi Ngày → 25/10: chỉ phí của
T-2501/T-2502.

### TC-SIL159-03 — Duyệt từng dòng: spinner → ✅, chặn double-click
Bấm [Xác nhận Đã UNC] trên 1 dòng chờ: ô trạng thái hiện mini spinner
(button biến mất) → sau ~900ms pill ✅ Đã UNC + dòng mờ. Bấm 2 lần nhanh:
không có trạng thái kỳ dị (idempotent — click thứ 2 rơi vào lúc spinner).

### TC-SIL159-04 — Duyệt lô cùng cảng
Tick ≥2 checkbox cùng cảng (CL) → nút "Duyệt lô" bật; bấm → cả lô qua
spinner → ✅, selection tự clear. Tick trộn cảng (CL + CM) → nút disabled +
hint chỉ duyệt lô cùng một cảng.

### TC-SIL159-05 — Tab 2.2 thẻ số dư per tài xế (sort desc + click filter)
Tab 2.2: thẻ tài xế đội xe nhà có phí chi hộ, sort tổng chờ hoàn desc
(Tâm 1.430.000 → Lộc 1.250.000 → Dũng 200.000 → Bảy 150.000 → Hậu 0).
Xe ngoài (T-2416, HTD) KHÔNG có thẻ. Click thẻ Tâm → bảng chi tiết chỉ còn
2 dòng của Tâm; click lại → bỏ lọc.

### TC-SIL159-06 — Bảng chi tiết hoàn ứng
Cột: Ngày · Tài xế & BKS · Số cont · Loại phí ứng (PHÍ NÂNG/PHÍ HẠ/PHỤ PHÍ)
· Số tiền · thumb HĐ/phiếu thu · Trạng thái (⏳ Chờ duyệt / ✅ Đã hoàn theo
consult pill).

### TC-SIL159-07 — Route/shell không hồi quy
`demo-shell.routes.test.tsx` vẫn pass: H1 "Duyệt Chi Cảng & Hoàn Ứng",
breadcrumb, sidebar active đúng (trang thật thay placeholder).

## Gates
- scoped vitest: `DemoPortPaymentsPage.test.tsx` + `demo-shell.routes.test.tsx`
- `npx tsgo --noEmit` (hoặc `tsc -b`) 0 errors — lane brief yêu cầu tsgo 0
- screenshots 1440 → `qa/2026-10-24-demo24/`
