# case-2026-10-29-sil561 — Popover dialog: nền phải inert khi mở (residual QA fail 29/10)

- Ticket: SIL-561 (board id 639), lane `fix-sil-a11y2`.
- Repro (QA Glint fail 29/10, build 28c3a120): mở ColumnPicker/FilterDropdown/
  MonthPicker/UDRP → "nội dung nền không inert — main không có aria-hidden,
  inert=false; chỉ vùng toast (role=log) là inert". Mong đợi: nền bị inert.
- Root cause 1: sweep của usePopoverDialog exempt trigger-ancestor chain
  ("island sống") → `main` (cha của trigger) KHÔNG BAO GIỜ inert.
- Root cause 2: UDRP panel render INLINE trong main → main không thể inert
  (inert là hereditary — panel con sẽ chết theo).
- Root cause 3 (nảy sinh khi fix): restore focus ĐỒNG BỘ trên trigger đang
  inert bị browser từ chối → keyboard rơi body (MonthPicker Escape).
- Expected: khi popover-dialog mở, nền (kể cả main + opener chain) mang
  attribute `inert`; panel aria-modal + focus trong panel; Escape trả focus
  về trigger SAU khi un-inert (1 frame).
- Fix: (1) sweep rework — mọi element ngoài panel path mang inert attribute
  (attribute trên từng element để landmark probe thấy), un-inert trước restore
  (effect cleanup order); (2) UDRP portal về body theo house triple
  usePopoverPosition + useClickOutside + createPortal (như ColumnPicker);
  (3) MonthPicker closeAndRestore defer 1 frame (Escape + pick + Hôm nay).
- Pin: `frontend/src/hooks/usePopoverDialog.test.tsx` case mới (main + trigger
  inert/release); `mobile-overlays.focus-return.test.tsx` 2 case đổi sang
  waitFor deferred restore.
- Evidence: `qa/2026-10-29_sil561_ui-driver.log` (35/35 — 4 popover × aria-
  modal/focus-in/main-inert/Escape-restore @1280/768/390),
  `qa/2026-10-29_sil561_tsc.log`, `qa/2026-10-29_sil561_vitest.log`.
