# Case: SIL-583 round 2 — QA-listed touch clusters reach a REAL 44px hit area

- **Ticket:** SIL-583 (board id 683) · **Date:** 2026-10-30
- **Trigger:** QA round-4 verdict (comment 2881, build 8ebd8503): the 24px
  WCAG 2.5.8 floor clause PASSED (36 screens swept, 0 controls under 24px),
  but the remaining AC clause "các cluster liệt kê đạt ≥44px hit-area" FAILED
  — measured "nút 40px, 'Phát lệnh' 28×28, 'Gán xe' 30/32, 'Thêm container'
  38/40 — không cluster nào đạt 44px thật".

## Root cause (round-3 engine finding, QA-confirmed)

`::after` pseudo hit-extensions are inert on this Chromium: a real mouse
click 2px outside a control's border box never captures. The REAL hit area
is the element border box, so 44px is only reachable by growing the element
itself. The round-1/2 pseudo layers were removed as superseded dead code.

## Fix (owner option (a) named by the QA verdict)

The §5/GP-06 touch law ("44px touch targets on mobile"; card law "tap
targets on cards ≥44px") is delivered by REAL element growth:

- `--control-touch-h` decoupled from the 40px ordinary ceiling
  (`--control-max-h` unchanged at 40px) → touch token = 44px real.
- Touch form factor = `(pointer: coarse)` at any width **or ≤768px** at any
  pointer (the AC's 390/768 sweep widths; a windowed browser reports
  `pointer: fine` at phone width).
- Unconditional (any-pointer) consumers of the touch token re-anchored to
  `--control-max-h` (pagination buttons/jump/ellipsis, topbar hamburger) so
  44px cannot leak to a fine pointer at ≥769px.
- Band edges aligned to the sweep width: tabs/note-action 767→768, FilterBar
  coarse→coarse+≤768, control-geometry gains a ≤768 leg, segmented-group
  members (compact chips) ride the touch token on touch form factors,
  ShipmentsPage h-8 desktop band moved 768→769, debit header actions carry
  the touch token, SIL-533 cargo-sheet compact floors moved 641→769
  (structure stays ≥641).
- Named clusters grow their own boxes: kebab/chevron/copy (44×44), docs
  badge (44 tall — content-sized width, round-1 40×44 precedent, no-overlap
  proven), dispatch row-menu kebab, dpcard note/info.

## Regression steps

1. `make dev` (or backend 3002 + frontend 7175 with the shared dev DB).
2. Run `node qa/scripts/ui-tap-targets-r2-verify-20261030.mjs` from repo root.
3. Expect `TOTAL: ALL PASS` (36 checks) + `ALL PASS` in
   `qa/2026-10-30_sil583r2_ui-driver-result.txt`.

## Expected behavior

- Every QA-named cluster measures ≥44px (badge ≥44 tall) at 390/768 fine and
  coarse; a real mouse click inside the grown kebab box opens its menu.
- 0 interactive controls under 24×24 on the six AC screens at 390/768/1440
  (the QA-passed floor clause stays green).
- At 1440 fine pointer the ordinary 40px ceiling holds (no touch-token leak).
- No overlapping hit boxes among the measured clusters (0 intersecting pairs).
- Read-only run: API identity unchanged before/after.

## Evidence

- `qa/2026-10-30_sil583r2_ui-driver.log` (+ `-result.txt`), 8 screenshots
  `qa/2026-10-30_sil583r2_ui-*.png`, driver script
  `qa/scripts/ui-tap-targets-r2-verify-20261030.mjs`.
- Pins: `frontend/src/styles/mobile-touch-floor.styles.test.ts`,
  `frontend/src/components/control-density.styles.test.ts`,
  `frontend/src/styles/customer-pagination-control-ceiling.styles.test.ts`.

## Review round (independent code-reviewer pass, same day)

The reviewer verified the cascade/band/width-grant reasoning but caught one
HIGH: the "no desktop leak" claim was incomplete — nine unconditional
(all-pointer) consumers of the touch token (topbar icon buttons + date
trigger, /shipments cell trigger — the geometry measured-and-refused
2026-09-28, dashboard widgets, CUS portal shell, truck-tire picker, driver
call bar, accounting container link, create-page appointment cluster) would
have grown to 44px on desktop fine pointers. All were re-anchored to
`--control-max-h` (their exact pre-change behavior); the appointment cluster
and the record-table ≤1100px container band keep the real touch token
deliberately (card law / tablet band, pinned "touchable"). The driver was
hardened: authenticated API-identity proof (Bearer from `lib/token` — the
anonymous fetch 401'd on both sides and proved nothing), minimum sweep
coverage, and a widened @1440 ceiling guard (icon buttons, date trigger,
cell-trigger floor). Five stale 40px-era comments were corrected.
