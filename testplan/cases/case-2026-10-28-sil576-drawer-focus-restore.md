# case-2026-10-28-sil576 — Drawer focus restore về body khi opener không focusable

- Ticket: SIL-576 (board id 654), lane `fix-sil-a11y`.
- Repro (live /penalties 1280): click chuột lên row/cell mở
  `.drawer.drawer--operational-density` (role=dialog, aria-modal) → focus vào
  `.drawer__close` ✓, Escape đóng ✓, nhưng focus rơi `<body>` thay vì row/cell
  đã mở. Root cause: `useAnimatedOverlay.ts` capture `document.activeElement`
  ở isOpen transition — với click trên non-focusable target thì là body; focus-in
  của useFocusTrap xảy ra SAU capture → hook "restore" về body.
- Expected: mở drawer bằng click chuột trên row/cell rồi Escape → focus quay lại
  đúng row/cell đó (làm nó focusable được hoặc restore về container); mở bằng
  keyboard (Enter trên trigger) → quay về trigger.
- Fix: shared owner — `useAnimatedOverlay` nhận `openerRef` (capture tại event),
  fallback activeElement khi không biết opener; `restoreFocusTo` (preventScroll +
  tabindex fallback) cho mọi đường restore; wire openerRef qua Drawer/Modal +
  PenaltyFormDrawer + call sites (row/card/button).
- Pin: `frontend/src/hooks/useAnimatedOverlay.focus-return.test.tsx` (hook class)
  + `PenaltyTable.test.tsx` (wiring truyền event.currentTarget).
- Evidence: `qa/2026-10-28_sil576_tsc.log`, `qa/2026-10-28_sil576_vitest.log`.
