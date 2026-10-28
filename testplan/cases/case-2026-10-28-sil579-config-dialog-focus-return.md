# case-2026-10-28-sil579 — Config catalog dialogs không trả focus về nút Thêm mới

- Ticket: SIL-579 (board id 657), lane `fix-sil-a11y`.
- Repro (live 320+1280): ports, trucks, cargo-types, penalty-reasons,
  expense-categories — cả 5 create dialog (.modal.modal--operational-density
  .modal--polished, render qua components/config/CrudTable → Modal) mở đúng
  (role=dialog ✓ aria-modal ✓ focus moves in ✓ Escape closes ✓) nhưng sau khi
  đóng `document.activeElement = BODY`, không phải nút Thêm mới. Cùng class
  capture-order với SIL-576 (restore target bắt được = body khi opener không
  focused lúc open).
- Expected: Escape (và Hủy/Xong) từ create dialog bất kỳ trả focus về nút Thêm
  mới của trang đó; keyboard flow Add → Cancel → Add chạy không cần tab lại từ
  đầu. Edit dialog (nút Chỉnh sửa trên row) cũng trả về đúng trigger.
- Fix: CrudTable bắt opener tại click time (event.currentTarget) và truyền
  `openerRef` qua Modal cho cả create lẫn edit dialog — 2 nút Thêm mới + nút
  Chỉnh sửa row; machinery restore dùng chung với SIL-576/577.
- Pin: `frontend/src/components/config/CrudTable.focus-return.test.tsx`
  (create: Escape + Hủy trả focus về Thêm mới, reopen không cần re-tab; edit:
  Escape trả về nút Chỉnh sửa row).
- Evidence: `qa/2026-10-28_sil579_tsc.log`, `qa/2026-10-28_sil579_vitest.log`.
