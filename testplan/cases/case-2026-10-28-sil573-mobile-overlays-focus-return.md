# case-2026-10-28-sil573 — Mobile overlays rơi focus về body/skip-link sau Escape

- Ticket: SIL-573 (board id 651), lane `fix-sil-a11y`.
- Repro (driver /my-trips 390×844):
  1. Mở `.mobile-user-sheet` (role=dialog, aria-modal) từ nút Tài khoản ở
     bottom-nav → Escape/Đóng → `document.activeElement` = skip-link/body, KHÔNG
     phải nút Tài khoản.
  2. Mở `.month-picker` từ `.topbar-date__trigger` → Escape → focus rơi body.
- Expected: Escape và nút Đóng của cả hai overlay trả focus về trigger đã mở
  (`focus({ preventScroll: true })`); đóng qua month/year grid cũng trả về
  trigger; click outside (pointerdown ngoài) thì KHÔNG cướp focus (giữ nguyên
  target người dùng vừa click).
- Pin: `frontend/src/components/layout/mobile-overlays.focus-return.test.tsx`
  (sheet: Escape + nút Đóng; picker: Escape + chọn tháng; outside-press không
  steal focus).
- Evidence: `qa/2026-10-28_sil573_tsc.log`, `qa/2026-10-28_sil573_vitest.log`.
