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

  it('keeps native credential semantics through shared field and action owners', () => {
    const { container } = render(<LoginPage />);
    const username = screen.getByLabelText('Tên đăng nhập hoặc số điện thoại');
    const password = screen.getByLabelText('Mật khẩu');
    expect(username).toHaveAttribute('id', 'username-input');
    expect(username).toHaveAttribute('name', 'username');
    expect(username).toHaveAttribute('autocomplete', 'username');
    expect(username).toHaveAttribute('autocapitalize', 'none');
    expect(username).toHaveFocus();
    expect(username).toBeRequired();
    expect(password).toHaveAttribute('id', 'password-input');
    expect(password).toHaveAttribute('name', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toBeRequired();
    expect(username).toHaveClass('ds-field__input');
    expect(password).toHaveClass('ds-field__input');
    expect(container.querySelectorAll('.ds-field__input-group')).toHaveLength(2);
    expect(container.querySelectorAll('.input-icon,.password-toggle')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Hiện mật khẩu' })).toHaveAttribute('data-uui-control', 'button');
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toHaveAttribute('data-uui-control', 'button');
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeDisabled();
  });

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
    expect(form).toHaveAttribute('aria-busy', 'false');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(form).toHaveAttribute('aria-busy', 'true');
    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Đang đăng nhập…' })).toBeDisabled();
    await act(async () => resolve());
    expect(form).toHaveAttribute('aria-busy', 'false');
  });
});

// Card 121026084543 (QA1-003): submit used to return silently when its state
// was still empty, so a click produced no request and no error at all. Browser
// autofill writes the value into the DOM without firing onChange, which is how
// an operator ends up staring at a filled form that "does nothing".
describe('login submit never no-ops (QA1-003)', () => {
  beforeEach(() => { login.mockReset(); });

  it('shows a visible error instead of silently doing nothing', () => {
    render(<LoginPage />);
    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }).closest('form')!);
    expect(login).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/nhập/i);
  });

  it('logs in with the values the browser put in the DOM, not the empty state', async () => {
    render(<LoginPage />);
    // Autofill: DOM value set directly, no onChange → component state stays ''.
    const username = screen.getByLabelText('Tên đăng nhập hoặc số điện thoại') as HTMLInputElement;
    const password = screen.getByLabelText('Mật khẩu') as HTMLInputElement;
    username.value = 'admin';
    password.value = 'Abc123';

    await act(async () => { login.mockResolvedValue(undefined); });
    fireEvent.submit(screen.getByRole('button', { name: 'Đăng nhập' }).closest('form')!);

    expect(login).toHaveBeenCalledWith('admin', 'Abc123');
  });
});

// Card 121026084723 (QA2-006): Caps Lock silently uppercases the password, so
// the typed value stops matching and login is refused for no visible reason.
describe('Caps Lock hint on the password field', () => {
  beforeEach(() => { login.mockReset(); });

  // jsdom has no CapsLock, so the native event's modifier state is stubbed —
  // React's synthetic getModifierState reads through to it.
  const setCaps = (active: boolean) =>
    vi.spyOn(KeyboardEvent.prototype, 'getModifierState').mockReturnValue(active);

  it('warns while Caps Lock is on and clears when it goes off', () => {
    render(<LoginPage />);
    const password = screen.getByLabelText('Mật khẩu');
    expect(screen.queryByText('Caps Lock đang bật.')).toBeNull();

    setCaps(true);
    fireEvent.keyDown(password);
    expect(screen.getByText('Caps Lock đang bật.')).toBeTruthy();
    expect(password).toHaveAttribute('aria-describedby', 'login-caps-hint');

    setCaps(false);
    fireEvent.keyUp(password);
    vi.restoreAllMocks();
    expect(screen.queryByText('Caps Lock đang bật.')).toBeNull();
  });

  it('drops the hint when the field loses focus', () => {
    render(<LoginPage />);
    const password = screen.getByLabelText('Mật khẩu');
    setCaps(true);
    fireEvent.keyDown(password);
    expect(screen.getByText('Caps Lock đang bật.')).toBeTruthy();
    fireEvent.blur(password);
    vi.restoreAllMocks();
    expect(screen.queryByText('Caps Lock đang bật.')).toBeNull();
  });
});

// Card 121026084733 (QA2-007): accounts are admin-issued by design, so there is
// no self-service reset — but an admin CAN set a user's password
// (updateUserSchema accepts `password`, via PATCH /api/auth/users/:id). The
// footnote therefore has to name that path instead of only stating who issues
// accounts.
describe('locked-out user is told how to get back in', () => {
  it('points at the administrator as the reset path', () => {
    render(<LoginPage />);
    const help = document.querySelector('.login-help');
    expect(help?.textContent).toMatch(/quản trị viên/i);
    expect(help?.textContent).toMatch(/Quên mật khẩu|liên hệ/i);
  });

  it('does not advertise a self-service recovery that does not exist', () => {
    render(<LoginPage />);
    const help = document.querySelector('.login-help')?.textContent ?? '';
    expect(help).not.toMatch(/gửi email|đặt lại mật khẩu tại đây|forgot password/i);
  });
});
