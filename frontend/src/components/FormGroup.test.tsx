import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormGroup } from './UI';
import { Lock, User } from 'lucide-react';
import { IconInput } from '../features/users/components/UserFormFields';

function WrappedField({ id }: { id?: string }) {
  return <div><input id={id} aria-describedby="email-error" /></div>;
}

describe('FormGroup field associations', () => {
  it('links current validation to the field without discarding an existing description', () => {
    const { rerender } = render(<FormGroup label="Số tiền" helpText="Nhập bằng đồng" error="Số tiền phải lớn hơn 0"><input aria-describedby="currency" /><span id="currency">VND</span></FormGroup>);
    const input = screen.getByLabelText('Số tiền');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('VND Số tiền phải lớn hơn 0');
    expect(screen.getByRole('alert')).toHaveTextContent('Số tiền phải lớn hơn 0');
    rerender(<FormGroup label="Số tiền" helpText="Nhập bằng đồng"><input aria-describedby="currency" /><span id="currency">VND</span></FormGroup>);
    expect(screen.getByLabelText('Số tiền')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Số tiền')).toHaveAccessibleDescription('VND Nhập bằng đồng');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('associates feedback with an explicitly selected later field only', () => {
    render(<FormGroup label="Kết thúc" htmlFor="end" error="Ngày kết thúc không hợp lệ"><input id="start" aria-label="Bắt đầu" /><input id="end" /></FormGroup>);
    expect(screen.getByLabelText('Kết thúc')).toHaveAccessibleDescription('Ngày kết thúc không hợp lệ');
    expect(screen.getByLabelText('Bắt đầu')).not.toHaveAttribute('aria-invalid');
  });

  it('connects generated feedback through the actual user IconInput', () => {
    render(<FormGroup label="Email" error="Email không hợp lệ"><IconInput icon={<User />} value="bad" onChange={() => {}} /></FormGroup>);
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email không hợp lệ');
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('labels a custom input without overwriting its sibling error id', () => {
    render(<FormGroup label="Email"><WrappedField /><div id="email-error" role="alert">Email không hợp lệ</div></FormGroup>);
    const field = screen.getByLabelText('Email');
    expect(field.tagName).toBe('INPUT');
    expect(field).toHaveAccessibleDescription('Email không hợp lệ');
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'email-error');
    const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves an existing first-field id through fragments and native wrappers', () => {
    render(<FormGroup label="Số tiền"><><p id="amount-help">Số tiền bằng đồng</p><div><input id="amount" aria-describedby="amount-help" /><input id="other-amount" aria-label="Khác" /></div></></FormGroup>);
    expect(screen.getByLabelText('Số tiền')).toHaveAttribute('id', 'amount');
    expect(screen.getByLabelText('Số tiền')).toHaveAccessibleDescription('Số tiền bằng đồng');
    expect(screen.getByLabelText('Khác')).toHaveAttribute('id', 'other-amount');
  });

  it('respects an explicit htmlFor targeting a later control', () => {
    render(<FormGroup label="Ngày kết thúc" htmlFor="end"><input id="start" aria-label="Ngày bắt đầu" /><input id="end" /></FormGroup>);
    expect(screen.getByLabelText('Ngày kết thúc')).toHaveAttribute('id', 'end');
    expect(screen.getByLabelText('Ngày bắt đầu')).toHaveAttribute('id', 'start');
  });

  it('generates distinct ids for separate native fields while preserving help siblings', () => {
    render(<><FormGroup label="Tên"><input /><span id="name-help">Tên hiển thị</span></FormGroup><FormGroup label="Ghi chú"><textarea /></FormGroup></>);
    expect(screen.getByLabelText('Tên').id).not.toBe(screen.getByLabelText('Ghi chú').id);
    expect(document.getElementById('name-help')).toHaveTextContent('Tên hiển thị');
  });

  it('skips leading profile and password icons when associating wrapped inputs', () => {
    render(<><FormGroup label="Mật khẩu hiện tại"><div><Lock size={16} /><input type="password" /></div></FormGroup><FormGroup label="Họ tên"><div><User size={16} /><input /></div></FormGroup></>);
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Họ tên').tagName).toBe('INPUT');
    expect(document.querySelectorAll('svg[id]')).toHaveLength(0);
  });

  it('forwards field ids through the user editor IconInput', () => {
    render(<FormGroup label="Email"><IconInput icon={<User />} value="invalid" onChange={() => {}} ariaDescribedBy="actual-user-error" /><span id="actual-user-error">Email không hợp lệ</span></FormGroup>);
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Email không hợp lệ');
  });

  it('skips hidden metadata before the visible field', () => {
    render(<FormGroup label="Mã chứng từ"><input type="hidden" id="record-id" value="7" readOnly /><input /></FormGroup>);
    expect(screen.getByLabelText('Mã chứng từ')).not.toHaveAttribute('type', 'hidden');
    expect(document.getElementById('record-id')).toHaveAttribute('type', 'hidden');
  });
});
