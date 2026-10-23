# QA — Redesign Kế hoạch Tổng quát /dispatch (QA R38 "mess vẫn live") — 2026-10-23

Lane `redesign-master-plan` off main `60d0c576` (sau merge feat-gomhang-fe —
gate điều kiện của brief thỏa). Driver: `qa/scripts/2026-10-23-master-plan-redesign.mjs`
(env-only ports per dev-port-contract: `QA_FRONT`, `QA_API`, `QA_PHASE`).

- **BEFORE** = trunk main `60d0c576` @ `:7175` (gomhang đã có — đúng nền của lane).
- **AFTER** = worktree `:7184` (VITE proxy `:3002` trunk backend).
- DB `:5441` (ss-prod-db) — merge dialog mở rồi HỦY, KHÔNG lưu (presentation-only lane);
  DB identity trước/sau = null/null giữ nguyên (proof trong 2 driver log).
- Account: `dungnv` (dispatcher). Fixture gộp hàng: lô 122 `K04573847543` + 173
  `LCL01L2-DATED-259802` (LONG MINH, ungrouped — của lane gomhang để lại).

## Defect gốc (BEFORE, rung 2 — đo JSON `metrics_before.json`)

| Dấu hiệu | BEFORE (trunk) | AFTER (worktree) |
|---|---|---|
| Cột Thời gian | **175-177px** (15.5%) | **125px** (10% @floor 1200) ✓ "~110-130px" |
| 3 cột đầu (TG+KH+Tuyến) | 175+178+195 = **548px ≈ 47% canvas** | 125+219+181 = 525px nhưng canvas có rail 1200 — KH&Tuyến vẫn vùng rộng nhất, không bỏ đói cột sau |
| Cảng nâng / Cảng hạ | **99px / 82px** — cắt cụt "Cả…"/"Bãi…" | 108px / 101px @floor + 1 dòng ellipsis + title tooltip |
| Row height (768/1440) | **116-117px fixed** (`--mpg-row-h: 96px` + padding — tower trống) | **69-90px theo nội dung** (clamp 77px body) — ≤93px mọi VP |
| Mobile 390/768 | td-grid card bands **269-388px/card** | <640px: card list `mpcard` 222-302px (record đầy đủ факт); 768: table + rail |
| Header | nowrap 1 dòng (law cũ 091026091550) | wrap tại space tối đa 2 dòng (line-clamp trên `__th-label` span) |

VÀ — phát hiện lớn nhất của lane (rung 2, xem `trunk-detailed-header-defect-1440.png`):

## Defect class tìm thêm trên main: header /dispatch-detail sập thành cột dọc

Commit `8a28c094` (detailed-plan redesign, đã merge main 12:28) đặt
`display: -webkit-box` (+ line-clamp 2) trực tiếp trên `thead th` — th rời
khỏi table-cell layout và **cả hàng header sếp DỌC thành cột nhãn** ở cột đầu
(đo trên trunk :7175: mọi th left=272, tops 319→570 cách nhau 36px; "mess vẫn
live" của QA R38 nhiều khả năng chính là hình này). Micro-repro + fix:
clamp chuyển vào phần tử CON (`__sort` button có sẵn / `__th-label` span mới),
th chỉ giữ wrap-at-spaces + keep-all. Lane này fix cả hai board (sweep cùng
class, §2 AGENTS): master + detailed — proof `after_header-fix-*-1440.png`
(spread 1056/1104px, sticky pin trong pane).

Cùng phát hiện: rail `overflow-x: auto` là scroll container → giết sticky
thead theo app-body (clip computes thành hidden). Fix: wrapper thành **pane
bounded** (`overflow: auto` + `max-height: calc(100dvh - var(--topbar-h) - 72px)`),
thead pin trong pane — chạy đúng ở cả 2 board (C-check rung 3).

## AFTER — 23/23 PASS (log `master-plan-redesign_after_ui-driver.log`)

- A 390/768/1440: page không overflow ngang; table rows ≤ 93px (max 90);
  header sticky + header cells trải ngang đúng cột (spread 1056px);
  THỜI GIAN 125px; card list owns <640px.
- B: bộ lọc "Phân xe" Tất cả=20 / Chờ phân xe=5 / Đã phân xong — đổi tập row đúng.
- C (rung 3): pane scrollTop=400, thead top 40 = pane top 39+1, 15 rows dưới header.
- D1-D5 (rung 3): gộp hàng on-demand GIỮ NGUYÊN — CHỌN ẩn mặc định; mode bật
  hiện cột + tick; floating bar "Đang chọn 2 lô … Lô 1 giữ 100% cước trả ĐV";
  dialog Gán xe nhóm đủ 4 trường không BKS ảo (HỦY, không lưu); thoát mode tự ẩn.
- D-mobile (rung 3, bổ sung probe 390): card list toggle [📦 Gộp hàng] — mặc
  định 0 tick → bật: 20 tick (3 LCL enabled, 17 FCL disabled), tick 1 lô →
  floating bar "Đang chọn 1 lô … Lô 1 giữ 100% cước trả ĐV: LCL01L2-DATED…"
  (`after_gomhang-cards-merge-on-390.png`, `after_gomhang-cards-ticked-390.png`).
- H1 (rung 3): note save THẤT BẠI (PUT /shipments/:id force 500 qua request
  interception — không ghi dữ liệu) → dòng lỗi hiện + **Lưu/Hủy đều visible**
  (editor cell tự lift clamp 77px qua `:has(__notes-editor)`) —
  `after_h1-notes-editor-error-path-1440.png`.

## Independent review (code-reviewer, CODE-READ + đọc evidence lane)

Verdict DONE_WITH_CONCERNS → tất cả finding xử lý trong changeset:
- **H1** notes-editor clip khi lỗi lưu (regression do clamp 77px) — FIX: rule
  `:has(> __notes-editor) { max-height: none; overflow: visible }` + pin test
  + rung 3 ở trên.
- **M1** oscillation table↔cards tại 640-655px với scrollbar cổ điển
  (contentRect trừ scrollbar; defect class kế thừa từ detailed-plan) — FIX cả
  2 grid: hook đo `borderBoxSize` (miễn nhiễm scrollbar của chính pane).
- **M2** `hasContainers` + chuỗi chips bị re-derive trong card list — FIX:
  tách `hasContainerDemand` + `formatCarrierAllocationChips` vào
  MasterPlanValues, cả 2 layout dùng chung.
- **L1** card Hủy thiếu DisabledActionTip — FIX (id `master-card-notes-cancel-<id>`).
- **L2** cast `triggerRef as unknown` — FIX: guard null, no-op.
- **L3** (chấp nhận có ý thức): table 640-900px trên touch mất touch-floor cũ
  của notes/detail trigger — pattern-consistent với detailed board (card list
  owns <640; ≥640 là desktop pointer), đánh đổi ghi nhận chứ không phải drift.
- E1-E2 (rung 3): card 390 đầy đủ head/body/foot + menu ⋯; card tap → /dispatch-detail.
- DB identity: 122/173 cost_group null trước/sau.

Metrics JSON: `metrics_before.json` / `metrics_after.json` (rows/cols/overflow/
rail/thead mọi VP). Gates: `gates_build.log`, `gates_fe-full-vitest.log`
(5525/5525), `gates_design-drift_base-trunk.log` vs `gates_design-drift_lane.log`
(delta ≤ base mọi counter; containerWidthValues còn giảm 22→20 do xóa
@container bands; base đỏ sẵn = nợ baseline stale 2026-10-04 như HANDOFF ghi).

## Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Cột cân đối + THỜI GIAN thu lại (MP-RD-01) | UI DRIVEN | before/after `board-*.png`, `metrics_*.json`, driver log A | viewport 1024+sidebar; role MANAGER/ADMIN |
| Rows ≤93px theo nội dung, hết tower (MP-RD-02) | UI DRIVEN | `metrics_after.json` heights 69-90 mọi VP table; cards 390 đo kèm | lot 5+ lịch hẹn (clamp cắt, title giữ đủ) chưa gặp trên page-1 data |
| Sticky header trong pane (MP-RD-03) | UI DRIVEN | C-check log + `after_sticky-header-1440.png` | 768 sticky riêng (chạy 1440; cùng CSS pane) |
| Card list mobile + FB-014 card tap (MP-RD-04) | UI DRIVEN | `after_card-structure-390.png`, `after_card-tap-navigates-390.png`, E1/E2 | menu item click từng verb (đã cover unit 11/11); role khác |
| Gộp hàng on-demand giữ nguyên (MP-RD-05) | UI DRIVEN | D1-D5 log + `after_gomhang-*.png` | KHÔNG lưu nhóm (lane presentation-only — save flow thuộc lane gomhang đã QA 41/41) |
| Bộ lọc Phân xe sweep (MP-RD-06) | UI DRIVEN | B log + `after_phan-xe-sweep-1440.png` | filter Khoảng ngày + zone facets (không đổi trong lane) |
| Header /dispatch-detail sập cột dọc (defect class mới) | UI DRIVEN | `trunk-detailed-header-defect-1440.png` (trunk, trước fix) + `after_header-fix-dispatch-detail-1440.png` (spread 1104) | 390/768 của detail board (cùng CSS); role khác |
| Unit/compile | — | scoped 647/647 · FULL FE 5525/5525 · tsc/tsgo 0 · lint 0 · make build 0 · dev-port-contract 11/11 | — |

Not covered chung: staging (owner NEVER per law); các role MANAGER/ADMIN/
ACCOUNTANT trên /dispatch mới; lỗi rollback (không có write path mới — lane
presentation-only, không đụng API/BE).
