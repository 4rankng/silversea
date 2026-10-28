# case-2026-10-28-sil557 — Viewport zoom lock (WCAG 1.4.4)

- Ticket: SIL-557 (board id 635), lane `fix-sil-a11y`.
- Repro: mở bất kỳ trang nào trên mobile → pinch zoom / browser zoom bị chặn toàn
  app vì `frontend/index.html:5` khai `maximum-scale=1, user-scalable=0`. Mâu
  thuẫn trực tiếp với token law ở `frontend/src/styles/tokens.css` (touch-font
  block): "Browser zoom remains available; do not disable it to enforce density."
- Expected: meta chỉ còn `width=device-width, initial-scale=1, viewport-fit=cover`;
  pinch zoom + zoom 200% khả dụng (WCAG 1.4.4 Resize Text / Reflow).
- Pin: `frontend/src/viewport-zoom.test.ts` — meta không chứa
  `maximum-scale`/`user-scalable`, giữ đủ 3 thuộc tính còn lại.
- Evidence: `qa/2026-10-28_sil557_tsc.log`, `qa/2026-10-28_sil557_vitest.log`.
