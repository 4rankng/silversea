import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api/errors';
import LoginPage from './LoginPage';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ login, sessionExpired: false }) }));

function fillCredentials() {
  fireEvent.change(screen.getByLabelText('Tên đăng nhập hoặc số điện thoại'), { target: { value: ' admin ' } });
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong' } });
}

describe('login recovery', () => {
  beforeEach(() => { login.mockReset(); });

  it('clears stale credential feedback as the user corrects either field', async () => {
    login.mockRejectedValue(new ApiError(401, {}, 'Unauthorized'));
    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sai thông tin đăng nhập');
    expect(login).toHaveBeenCalledWith('admin', 'wrong');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'corrected' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText('Mật khẩu')).not.toHaveAttribute('aria-describedby');
  });

  it('preserves transient API feedback without blaming valid credentials', async () => {
    login.mockRejectedValue(new ApiError(503, {}, 'Dịch vụ tạm thời gián đoạn. Vui lòng thử lại.'));
    render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dịch vụ tạm thời gián đoạn');
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('aria-invalid', 'false');
  });

  it('does not duplicate a pending submit and preserves the password when revealing it', async () => {
    let resolve!: () => void;
    login.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const { container } = render(<LoginPage />);
    fillCredentials();
    fireEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(screen.getByLabelText('Mật khẩu')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Mật khẩu')).toHaveValue('wrong');
    const form = container.querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Đang đăng nhập…' })).toBeDisabled();
    await act(async () => resolve());
  });
});
