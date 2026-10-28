# case-2026-10-28-sil574 — Password modal thiếu autocomplete tokens

- Ticket: SIL-574 (board id 652), lane `fix-sil-a11y`.
- Repro: driver /my-trips → Tài khoản → Đổi mật khẩu — 3 ô password trong
  PasswordModal render không có `autoComplete` → password manager không nhận
  diện current/new-password, không đề xuất sinh mật khẩu.
- Expected: Mật khẩu hiện tại → `autoComplete="current-password"`; Mật khẩu mới
  + Xác nhận → `autoComplete="new-password"` (khớp UserAddPanel/UserEditPanel/
  SecretField đang làm đúng sẵn).
- Pin: `frontend/src/components/layout/PasswordModal.test.tsx` — case mới assert
  3 token theo đúng loại field.
- Evidence: `qa/2026-10-28_sil574_tsc.log`, `qa/2026-10-28_sil574_vitest.log`.
