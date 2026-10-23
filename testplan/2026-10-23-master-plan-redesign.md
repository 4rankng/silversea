# Test plan — Redesign Kế hoạch Tổng quát (/dispatch) — cân đối cột + card-list mobile (QA R38 "mess vẫn live", 23/10 12:39)

Lane: `redesign-master-plan` off main `60d0c576` (sau merge feat-gomhang-fe —
gate điều kiện của brief thỏa: merge commit là HEAD main). Pattern chuẩn:
commit `8a28c094` (detailed-plan) — `DispatchPlanCardList.tsx` +
`DetailedPlanGrid.css` compact.

## Bối cảnh defect (QA R38 screenshot 23/10 12:39)

Trang per-truck schedule `/dispatch` (MasterPlanGrid — Kế hoạch Tổng quát,
nơi điều vận trải khối lượng theo lô trước khi xuống Kế hoạch Chi tiết Xe):

- Cột Thời gian & lịch trình (15.5%) + Khách hàng & nhà máy (15.75%) +
  Tuyến đường & hãng tàu (17.25%) ≈ 48.5% canvas — hàng cao rỗng
  (`--mpg-row-h: 96px` fixed, FB-043 era).
- Cảng nâng 8.75% / Cảng hạ 7.25% (~100px/83px @1144px canvas) cắt cụt
  ("Cả…", "Bãi…"), Tổng quan hàng hóa ép nén.
- Mobile ≤900px: td-grid card bands (pattern pre-redesign mà
  DetailedPlanGrid đã xóa ở 8a28c094).
- Cùng defect class owner đã chê ở DetailedPlanGrid — giờ fix lại cho
  master plan theo đúng pattern đã chuẩn hóa, NHẤT QUÁN detailed-plan.

## Phạm vi

- FE-only: `MasterPlanGrid.tsx/.css`, mới `MasterPlanCardList.tsx`,
  `MasterPlanPage.tsx` (chỉ nếu cần), `DispatchPlanPage.css` (chỉ nếu cần).
- KHÔNG đụng: data-flow, API, BE, logic gộp hàng (LclSelectCheckbox /
  LclMergeModeToggle / floating bar / Gán xe nhóm dialog giữ nguyên hành vi).
- Chi tiết spec:
  1. Desktop ≥640px (table): THỜI GIAN thu lại ~110-130px @floor (ngày+giờ
     gọn), KHÁCH HÀNG & LỘ TRÌNH phần lớn còn lại không phình, Nâng/Trả/
     Container 1 dòng + truncate tooltip (title), row 70-93px THEO NỘI DUNG
     (hết tower `--mpg-row-h`), sticky header, rail scroll trong container
     (min-width table) — không overflow ngang page.
  2. Mobile <640px: card list theo pattern DispatchPlanCardList — mỗi lô =
     1 card: head [tick gộp khi mode] + KH + bill + loại; body giờ+ngày ·
     Nâng · Trả (nơi trả 1 dòng) · container/cargo chip · ghi chú; foot nút
     chính "Phân bổ nhà xe" khi sửa được; menu ⋯ (UUI Dropdown primitive)
     cho hành động phụ (Chi tiết container, Sửa ghi chú).
  3. GIỮ nguyên MỌI logic/checkbox gộp hàng (spec 23/10 cards
     231026123901/902/903) — chỉ đổi trình bày.
  4. Header dài: wrap tối đa 2 dòng (line-clamp-2, word-break keep-all).

## Cases

### MP-RD-01 — Desktop cột cân đối (rung 2/3) — PASS
- [x] @1440 & @768: THỜI GIAN đo 125px (floor 1200 — brief "~110-130px");
      KHÁCH+TUYẾN vùng rộng nhất; Nâng/Trả 108/101px @floor, 1 dòng +
      ellipsis + title; không cột nào mất chữ đầu.
- [x] Table min-width 1200px; wrapper pane `overflow: auto` (rail + cuộn dọc);
      page KHÔNG overflow ngang mọi VP (scrollWidth ≤ innerWidth).
- [x] Header wrap tối đa 2 dòng tại space (line-clamp trên `__th-label`
      span — KHÔNG trên th; xem MP-RD-07).

### MP-RD-02 — Row height theo nội dung ≤ 93px (rung 2/3, JSON metrics) — PASS
- [x] 768 & 1440: mọi row 69-90px (max 90 ≤ 93); không còn `--mpg-row-h`.
- [x] Cell-body clamp `max-height: 77px` (budget 93 − 16 padding) — lot
      pathological clip, title giữ fact.

### MP-RD-03 — Sticky header (rung 3) — PASS (sau khi đổi model sang pane)
- [x] Pane scrollTop=400: thead top 40 = pane top 39+1; 15 rows dưới header.
- Ghi chú method: rail `overflow-x:auto` là scroll container và giết sticky
  thead theo app-body (overflow-y: clip computes thành hidden) — wrapper đổi
  thành pane bounded (cả 2 trục + thead pin trong pane). Cùng fix áp cho
  DetailedPlanGrid (cùng defect class).

### MP-RD-04 — Mobile <640 card list (rung 3) — PASS
- [x] 390: 20 card `mpcard`; head KH + bill + loại (Nhập · Lẻ); body giờ+ngày,
      Nâng, Trả, cargo, cảnh báo/hải quan, note 1 dòng; foot "Phân bổ nhà xe";
      menu ⋯ (Chi tiết container / Sửa ghi chú).
- [x] Card tap → `/dispatch-detail?q=…&date=…` (FB-014 giữ).
- Unit thêm: `MasterPlanCardList.test.tsx` 11/11 (menu, editor inline, merge
  mode, LCL vocabulary, cảnh báo).

### MP-RD-05 — Gộp hàng on-demand GIỮ NGUYÊN (rung 3 — regression chính) — PASS
- [x] D1-D5 log: CHỌN on-demand; tick LCL/FCL dim; floating bar totals +
      "Lô 1 giữ 100% cước trả ĐV"; dialog 4 trường không BKS ảo (HỦY —
      không lưu); thoát mode tự ẩn, selection clear.
- [x] DB identity: lô 122/173 cost_group null trước/sau.

### MP-RD-06 — Trạng thái phân xe sweep (rung 2) — PASS
- [x] "Phân xe": Tất cả=20 / Chờ phân xe=5 / Đã phân xong — đổi tập row đúng.

### MP-RD-07 — (mới trong lane) Header /dispatch-detail sập cột dọc — FIXED
Defect class tìm trên main (8a28c094): `display: -webkit-box` trên `thead th`
phá table-cell layout → mọi header cell sếp dọc tại cột đầu (spread 0, đo
trunk :7175 — ảnh `trunk-detailed-header-defect-1440.png`). Fix cả 2 board:
clamp chuyển vào phần tử con (`__sort` / `__th-label`), th giữ wrap-at-spaces.
Sau fix: spread 1056px (master) / 1104px (detailed); sticky hoạt động.
Pin: `DetailedPlanGrid.test.tsx` (th NOT contain -webkit-line-clamp) +
`MasterPlanGrid.test.tsx` (th-label rule).

## Gates

- vitest scoped: MasterPlanGrid.* + MasterPlanPage.* + master-plan feature
- FULL FE + `npx tsgo -b` 0 + `npx tsc -b` 0 + root lint 0 + `make build`
- Playwright driver: `qa/scripts/2026-10-23-master-plan-redesign.mjs`,
  artifacts `qa/2026-10-23-master-plan-redesign/` (before/after 390/768/1440,
  JSON row-height/col-width metrics, UI DRIVEN rung 3 cho MP-RD-03/04/05).
- design:drift delta ≤ base (base đỏ sẵn — nợ baseline, không thêm counter).

## Không thuộc phạm vi (Not covered)

- /dispatch-detail (đã redesign 8a28c094), CUS quyết toán, role sweep khác,
  staging (owner NEVER per law), keyboard-nav menu (ngoài react-aria mặc định).
