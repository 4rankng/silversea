# SIL-708 (id 708, SIL-605) — Kế hoạch Tổng quát: tag "Lẻ" là chip (và bảng dữ liệu edge-to-edge)

- Ticket: id 708 (identifier SIL-605, board SIL, priority medium) — QA Glint 30/10/2026,
  ảnh đính kèm cho thấy tag "Lẻ" chỉ là chữ trơn trong cột Tổng quan hàng hoá.
- Surface: `/dispatch` bảng Kế hoạch Tổng quát — cột "Tổng quan hàng hóa" (grid @≥640px +
  card mobile @<640px), role Điều vận. Lane này cũng áp dụng doctrine owner 30/10
  "bảng dữ liệu render EDGE-TO-EDGE" cho đúng rail dữ liệu đó.

## Bug

Tag "Lẻ" (SIL-589, id 689) hiển thị text thuần cùng giọng mọi meta line khác — lướt bảng
không nhận ra dòng lô lẻ ("chỉ là chữ trơn, khó nhận biết nhanh"). AC của SIL-589 chỉ yêu
cầu flag XUẤT HIỆN, không locks kiểu chip — ticket này là supersession về kiểu hiển thị,
KHÔNG đụng logic (isLclLotRow + costGroupId giữ nguyên).

## Expected sau thay đổi

1. Flag "Lẻ" / "Lẻ · Ghép" render dạng CHIP có nền: pill 24px, radius 999, viền + nền tint
   `--chip-open-*` (#EFF8FF/#B2DDFF/#175CD3 — contrast 5.57:1), chữ bên trong, nhìn là
   nhận ra ngay. Cùng recipe với chip SIL-478 (LedgerGroupedList) + Untitled UI v8
   `base/badges`. Static fact, không phải control: span, không role/tabindex/hover/focus.
2. Lô đã ghép (`costGroupId != null`) vẫn đọc "Lẻ · Ghép", title nêu BKS thực — dữ liệu
   như SIL-589, chỉ khác vỏ.
3. Dòng FCL không bao giờ có chip (SIL-589 giữ nguyên).
4. Card mobile (<640px): token LCL trong dòng Loại là CÙNG chip (`master-plan-grid__lcl-chip`
   chung class — một pattern, một implementation); dòng Cont giữ text thuần.
5. Doctrine owner 30/10: rail bảng (`master-plan-grid__wrapper`) tràn FULL WIDTH 2 mép
   (bleed `var(--app-body-pad-x)` 24/12/8 theo breakpoint, width calc(+2×token) — edge phải
   không bị kẹt bởi width %), filter card + strip Sản lượng giữ inset (reading spine,
   deepseek consult A), bảng cap 1920px căn giữa trên canvas siêu rộng (consult B), sticky
   thead vẫn pin trong pane (consult C = luật MP-RD-03, stickDelta=0 khi đã verify).

## Regression lock

- `MasterPlanGrid.lcl-display.test.tsx` — describe "the Lẻ flag is a chip (SIL-708)":
  chip element + text + title cho ungrouped/grouped, FCL không chip, CSS pin recipe
  (24px/999/--chip-open-*/nowrap, không raw hex).
- `MasterPlanCardList.test.tsx` — case SIL-708: 2 card LCL (Lẻ + Lẻ · Ghép) đều chip,
  không còn 'Nhập · Cont' thuần khi cả hai là LCL.
- Driver rung-3: `qa/scripts/ui-sil708-le-chip-verify-20261030.mjs` — 12/12 PASS
  (EXIT=0), artifact: 4 ảnh qa/2026-10-30_sil708_ui-*.png + qa/2026-10-30_sil708_ui-driver.log
  + qa/2026-10-30_sil708_db-side-effect-proof.txt (identity READ-ONLY:
  SHP-2610-00161/R42RV-D2 LCL chưa gộp has_active_lcl=t; SHP-2610-00083/KK95249354 LCL đã
  gộp BKS 15C-222.22; BULK-EXP-0248 FCL 0 LCL fulfillment).

## Explicit non-goals

- /dispatch-detail (Kế hoạch Chi tiết Xe) CHUYỂN ĐỔI edge-to-edge: chưa convert trong lane
  này (surface khác, cần lane riêng) — ghi rõ trong law book 30/10.
- Card list không bleed (doctrine nêu "bảng dữ liệu", card mobile giữ nhịp riêng).
- Detail plan Phân loại: giữ text thuần theo e608eb93 (không phải surface của ticket).
