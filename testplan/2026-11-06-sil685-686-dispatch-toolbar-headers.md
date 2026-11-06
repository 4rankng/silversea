# SIL-685/686 — dispatch toolbar 1 hàng (FB-056) + header /dispatch-detail 1 dòng (FB-063) (regression cases)

Case IDs: REG-SIL685-TOOLBAR-ONE-ROW · REG-SIL686-DETAIL-HEADERS-ONE-LINE
Opened: 2026-11-06 · Board: SIL-685 (id 797), SIL-686 (id 798) · Lane: fix/sil-dispatch-toolbar-685-686

## Surface

`/dispatch` (Kế hoạch Tổng quát — `MasterPlanFilters` → shared `FilterBar`) và
`/dispatch-detail` (Kế hoạch Chi tiết Xe — `DetailedPlanFilters` → shared
`FilterBar`, bảng `DetailedPlanGrid`). Viewport kiểm tra: 1440 và 1920, vai
trò Điều vận.

## REG-SIL685 — thanh công cụ xuống 2 hàng (FB-056)

Repro: đăng nhập dieuvan, mở /dispatch và /dispatch-detail ở 1440/1920. Trước
fix (build dcaa8295): toolbar cao 88–92px — hàng 2 rớt (Gộp hàng/Gán xe/Xóa
lọc trên /dispatch-detail; Gộp hàng/Xuất file Excel/Tạo lô hàng trên
/dispatch) vì budget 3 hàng từ 1280 (card 20261002_282 ladder) giữ mọi
primary inline. Expected (FB-056, 06/11): toolbar MỘT hàng, cao 44–48px ở cả
1440 lẫn 1920; mọi chức năng lọc còn nguyên (criteria + khoảng ngày + phạm vi
ngày trong `Bộ lọc`). Pin: `desktopMaxRows={1}` trên 2 page + measured ladder
`useFilterBarFit`; band passes presets into the fold at `dialog-presets`.

## REG-SIL686 — header cột /dispatch-detail wrap 2 dòng (FB-063)

Repro: /dispatch-detail, nhìn hàng header. Trước fix: 4/11 header wrap ở
1920 (THỜI GIAN & LỊCH TRÌNH, KHÁCH HÀNG & LỘ TRÌNH, TRẢ HÀNG, THAO TÁC);
thêm cột hẹp wrap ở 1440 (TUYẾN ĐƯỜNG, SỐ TỜ KHAI, CONTAINER) — `thead th`
đang `white-space: normal` theo SIL-515 (26/10). Expected (FB-063/SIL-686,
06/11, supersedes SIL-515 cho HEADER): mọi header MỘT DÒNG ở mọi width —
`white-space: nowrap` + colgroup shares trả trước chiều rộng label đo thực
(174–180px cho 2 header kép), floor bảng 1340→1520px. VALUE cells giữ luật
wrap SIL-515 (không đụng). Pin: `DetailedPlanGrid.rowheights.styles.test.ts`
(nowrap + floors) + `DetailedPlanGrid.test.tsx` (share sum 100 + floors).

## Verification evidence

`qa/2026-11-06-lane-dispatch/` — `capture.mjs` (driver, exit 0) +
`capture.log` (12 PASS) + 5 screenshots (detail/dispatch × 1440/1920 + dialog
range). Toolbar h=46–48px, 1 row; thead 45px 1 dòng, 0 overflow; folded range
đánh máy 05/11 re-query API `dateFrom=2026-11-05` (first row 01/11 → 05/11).
