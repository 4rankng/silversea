import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditPanel } from './UserForm';

const BASE_USER = {
  id: 7,
  username: 'manager1',
  fullName: 'Nguyễn Văn A',
  email: 'nva@cty.vn',
  phone: '0900000001',
  employeeCode: '',
  role: 'MANAGER',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const PROPS = {
  isOpen: true,
  customerList: [],
  businessUnits: [],
  shipmentOptions: [],
  saving: false,
  error: null,
  onClose: vi.fn(),
  onSave: vi.fn(async () => true),
  onOpenBusinessUnits: vi.fn(),
  isMe: false,
};

function renderPanel() {
  return render(<EditPanel {...PROPS} user={BASE_USER as never} />);
}

// Field-level Vietnamese validation: invalid email / short password show
// beside their fields with a11y wiring and first-error focus; the values
// never reach the server, so no raw English schema banner can appear.
describe('EditPanel field-level validation', () => {
  it('blocks an invalid email with a Vietnamese field message and focus', async () => {
    renderPanel();
    const emailInput = screen.getByPlaceholderText('nva@cty.vn');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Email chưa đúng định dạng'));
    expect(emailInput.getAttribute('aria-invalid')).toBe('true');
    expect(PROPS.onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(emailInput);
  });

  it('blocks a short password with the Vietnamese message beside the field', async () => {
    renderPanel();
    const pwInput = screen.getByPlaceholderText('Tối thiểu 6 ký tự');
    fireEvent.change(pwInput, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu mới phải có tối thiểu 6 ký tự'));
    expect(PROPS.onSave).not.toHaveBeenCalled();
  });

  it('clears the email message on correction and saves', async () => {
    renderPanel();
    const emailInput = screen.getByPlaceholderText('nva@cty.vn');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.change(emailInput, { target: { value: 'ok@cty.vn' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
    await waitFor(() => expect(PROPS.onSave).toHaveBeenCalled());
  });

  it('blank optional email passes (unchanged rule)', async () => {
    renderPanel();
    fireEvent.change(screen.getByPlaceholderText('nva@cty.vn'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
    await waitFor(() => expect(PROPS.onSave).toHaveBeenCalled());
  });
});
