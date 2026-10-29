import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PasswordModal } from './PasswordModal';

const FORM = { currentPassword: '', newPassword: '', confirmPassword: '' };

function renderModal(over: Partial<Parameters<typeof PasswordModal>[0]> = {}) {
  return render(
    <PasswordModal
      isOpen
      onClose={vi.fn()}
      saving={false}
      error={null}
      form={FORM}
      onFormChange={vi.fn()}
      onSave={vi.fn()}
      {...over}
    />,
  );
}

// A wrong current password is a FIELD error: announced beside the input
// (aria-invalid + describedby), never a session-expiry claim.
describe('PasswordModal current-password field error', () => {
  it('announces the field error with aria wiring when flagged', () => {
    renderModal({ error: 'Mật khẩu hiện tại không đúng', isCurrentPasswordError: true });
    const input = screen.getByPlaceholderText('Nhập mật khẩu hiện tại');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('current-password-error');
    expect(document.getElementById('current-password-error')?.textContent).toContain('Mật khẩu hiện tại không đúng');
  });

  it('keeps the generic banner for other errors without field wiring', () => {
    renderModal({ error: 'Không thể đổi mật khẩu.' });
    const input = screen.getByPlaceholderText('Nhập mật khẩu hiện tại');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByText(/nhập lại/i)).toBeNull();
  });
});

// SIL-574: password managers need the right autocomplete tokens — current vs
// new-password — so they offer save/generate on the correct fields.
describe('PasswordModal autocomplete tokens (SIL-574)', () => {
  it('marks the current password and both new-password fields', () => {
    renderModal();
    expect(screen.getByPlaceholderText('Nhập mật khẩu hiện tại').getAttribute('autoComplete')).toBe('current-password');
    expect(screen.getByPlaceholderText('Ít nhất 6 ký tự').getAttribute('autoComplete')).toBe('new-password');
    expect(screen.getByPlaceholderText('Nhập lại mật khẩu mới').getAttribute('autoComplete')).toBe('new-password');
  });
});

// SIL-574 (QA fail 29/10): tokens landed but the dialog still offered NO
// generation — "mong đợi: có nút tạo mật khẩu theo AC". The button fills the
// new + confirm fields with ONE strong password and never touches the
// current-password field.
describe('PasswordModal password generation (SIL-574)', () => {
  it('fills new + confirm with one generated strong password on demand', () => {
    const onFormChange = vi.fn();
    renderModal({ form: { currentPassword: 'old', newPassword: '', confirmPassword: '' }, onFormChange });
    fireEvent.click(screen.getByRole('button', { name: /Tạo mật khẩu/ }));
    expect(onFormChange).toHaveBeenCalledTimes(1);
    const next = onFormChange.mock.calls[0]![0] as typeof FORM;
    expect(next.currentPassword).toBe('old');
    expect(next.newPassword).toBe(next.confirmPassword);
    expect(next.newPassword).toHaveLength(16);
    expect(next.newPassword).toMatch(/[a-z]/);
    expect(next.newPassword).toMatch(/[A-Z]/);
    expect(next.newPassword).toMatch(/[0-9]/);
    expect(next.newPassword).toMatch(/[!@#$%^&*?\-_=+]/);
  });

  it('generates a fresh password on every press', () => {
    const onFormChange = vi.fn();
    renderModal({ onFormChange });
    const button = screen.getByRole('button', { name: /Tạo mật khẩu/ });
    fireEvent.click(button);
    fireEvent.click(button);
    const first = (onFormChange.mock.calls[0]![0] as typeof FORM).newPassword;
    const second = (onFormChange.mock.calls[1]![0] as typeof FORM).newPassword;
    expect(first).not.toBe(second);
  });
});
