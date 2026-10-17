# HANDOFF — 2026-10-18 card 171026154000 (A pre-merged + C landed here)

Controller: this session (Paseo agent), worktree
`fix-171026154000-cargomode-filter` (branch-off main @ 1105d184).
Updated: 2026-10-18.

## Mục tiêu + trạng thái

Owner decision (orchestrator 2026-10-17): hướng A (cargoMode filter) + C
(Gán xe nhóm disabled reason as text). Ticket
`171026154000-bang-ke-hoach-hang-le-ngoai-trang-1-khong-loc-duoc`.

- **A: ĐÃ CÓ SẴN TRƯỚC** — merge `b930be12` (feat `2f92d4dd`, `df506e69`;
  tests `06fb8e4c`, `dfc493c9`) đã trong history của branch này khi worktree
  được tạo. KHÔNG code mới cho A trong session này; đã re-verify: BE
  regression 2/2, FE cargo-mode test pass, API + UI drive qua filter LCL.
- **C: DONE trong session này** (commit trên branch này, chưa merge):
  reason là CHỮ thật trong selection bar + aria-disabled/aria-describedby
  (pattern DisabledActionTip, variant description-as-text), handler guard,
  CSS `[aria-disabled='true']` thay `:disabled`.

## Files owned by this task

- `frontend/src/pages/DispatchDetailPlanPage.tsx` — nút + hint span.
- `frontend/src/pages/DispatchPlanPage.css` — selector aria-disabled + hint.
- `frontend/src/pages/DispatchDetailPlanPage.lcl-assign-reason.test.tsx` — mới.
- `testplan/2026-10-17-card-171026154000-cargoMode-filter.md` — thêm Part C.
- `testplan/qa/scripts/2026-10-18-171026154000-c-assign-reason.mjs` — driver.
- `qa/2026-10-18_171026154000_c_*.{png,log,txt}` — force-tracked evidence.

## QA (lệnh đầy đủ + exit status trong qa/2026-10-18_171026154000_c_*)

- fe-tsc 0 · be-tsc 0 · lint 0 · BE cargoMode 2/2 · FE pages+dispatch
  (247 files / 2151 tests) pass.
- UI DRIVEN (§9 rung 3): driver 19/19 pass, exit 0 — dieuvan @
  :7186 (worktree vite) + backend :3002; filter LCL → chọn 1 lô → reason
  verbatim + aria wiring → guarded click (không dialog, KHÔNG request
  non-GET nào trong cả drive) → 2 lô → reason biến mất → dialog mở → Hủy →
  390px reason còn hiển thị. DB before/after rows 110503/110504 identical
  (read-only §9.3).

## Quyết định đáng chú ý / surface cho owner

- **rb2 branch CHƯA merge**: `origin/fix-171026154000-cargomode-filter-rb2`
  chứa 2 commit evidence QA rung-3 cho A (`afe4ee55`, `040d060f` — driver
  script + case-doc update + qa PNG/log force-tracked). Theo AGENTS.md §4
  không tự merge; owner quyết định (cherry-pick evidence hay bỏ).
- Chọn variant "description-as-text" thay vì wrapper DisabledActionTip: brief
  đòi lý do "bằng CHỨ"; wrapper chỉ render sr-only + hover bubble (vẫn
  tooltip). Text hiển thị + aria-describedby pointing at it = pattern core,
  mạnh hơn. Không consult catalog (house primitive + token sẵn có, không
  layout mới) — provenance ghi trong test header.
- Session này không đọc được ảnh (model không hỗ trợ image input): screenshots
  tồn tại (210–258KB) nhưng xác minh text dựa vào DOM assertions trong
  driver log.

## Environment / next step

- Vite worktree này chạy nền port 7186 (`npx vite --port 7186 --strictPort`);
  stack chung :3002/:5441 của máy đang UP. Tắt 7186 nếu cần.
- Next: owner review → merge trunk (không tự merge); quyết định rb2.
