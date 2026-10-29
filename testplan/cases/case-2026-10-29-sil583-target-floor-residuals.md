# case-2026-10-29-sil583 — Tap-target sàn 24px: residuals QA fail 29/10

- Ticket: SIL-583 (board id 683), lane `fix-sil-a11y2`.
- Repro (QA Glint fail 29/10, build 28c3a120): đo bounding box control trên
  6 màn /dispatch, /dispatch-detail, /shipments, /shipments/:id,
  /shipments-debit, /shipments/new ở 390/768 — "link xem ghi chú 55×13 (cao
  13px) vẫn dưới ngưỡng 24px", ô nhập combobox 16px, v.v.
- Root cause 55×13: `.master-plan-grid__note-detail-trigger` khai
  `min-height: max(28px, var(--uui-control-h))` — trigger link-color KHÔNG
  mang `data-uui-control` nên `--uui-control-h` undefined trong subtree →
  max() invalid-at-computed-value → min-height rớt về auto → 55×13.
- Expected: mọi control đo được ≥24px chiều ngang lẫn chiều dọc (WCAG 2.5.8
  AA); riêng note-link ≥24 chiều cao. Visual không đổi (hit box nở bằng
  padding + margin âm; glyph spacing của date-seg giữ nguyên card 20260924_10).
- Fix: (1) fallback `var(--uui-control-h, 28px)` cho trigger rule; (2) date
  segments HH/DD/MM — content-box padding 3px + margin −3px (hit ≥24, nội
  dung giữ); (3) combobox typing overlay — min-height 24 + padding-block 4 +
  margin-block −4 ở cả band base lẫn phone block `#root`-prefixed;
  (4) `.detailed-plan-grid__sort` min-height 24 (94.5×14.8 → 24).
- Pin: `frontend/src/styles/mobile-touch-floor.styles.test.ts` — 4 case mới.
- Evidence: `qa/2026-10-29_sil583_sub24-baseline.log` (trước fix),
  `qa/2026-10-29_sil583_residual-verify.log` (sau fix, 0 sub-24),
  `qa/2026-10-29_sil583_tsc.log`, `qa/2026-10-29_sil583_vitest.log`.
