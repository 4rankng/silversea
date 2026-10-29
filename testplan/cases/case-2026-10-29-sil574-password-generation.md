# case-2026-10-29-sil574 — Đổi mật khẩu: bổ sung nút tạo mật khẩu (residual QA fail 29/10)

- Ticket: SIL-574 (board id 652), lane `fix-sil-a11y2`.
- Repro (QA Glint fail 29/10, build df6047f3): driver → Tài khoản → Đổi mật
  khẩu — autocomplete tokens ĐÚNG (round trước) nhưng dialog KHÔNG có tính
  năng tạo mật khẩu ("các nút chỉ có nút icon trống, 'Hủy', 'Đổi mật khẩu';
  mong đợi: có nút tạo mật khẩu theo AC").
- Expected: dialog Đổi mật khẩu có nút "Tạo mật khẩu" — sinh mật khẩu mạnh
  (≥16 ký tự, đủ 4 lớp) điền vào CẢ Mật khẩu mới + Xác nhận, không đụng ô
  Mật khẩu hiện tại.
- Fix: `frontend/src/lib/generatePassword.ts` (crypto.getRandomValues +
  rejection sampling, Fisher–Yates, bảo đảm 1 lớp mỗi loại) + nút
  `btn--secondary--sm` trong FormGroup Mật khẩu mới (house primitive; UUI
  catalog application/modals/password-prompt-modal consult 29/10 — catalog
  không có pattern generate để adopt).
- Pin: `frontend/src/components/layout/PasswordModal.test.tsx` — 2 case mới
  (điền đủ + không đụng current; mỗi lần bấm ra mật khẩu mới).
- Evidence: `qa/2026-10-29_sil574_ui-driver.log` (5/5 PASS, giamdoc local
  :7202 — dialog mở qua sidebar user menu, nút có mặt, 2 field cùng giá trị
  16 ký tự 4 lớp, current rỗng) + `2026-10-29_sil574_ui-password-modal-1280.png`;
  `qa/2026-10-29_sil574_tsc.log`, `qa/2026-10-29_sil574_vitest.log` (5/5).
