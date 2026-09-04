import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DriverFormModal } from './DriverFormModal';

describe('DriverFormModal', () => {
  it('renders the driver form fields', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Mã tài xế/)).toBeTruthy();
    expect(screen.getByLabelText(/Họ và tên/)).toBeTruthy();
    expect(screen.getByLabelText(/Số CCCD/)).toBeTruthy();
    expect(screen.getByLabelText(/GPLX/)).toBeTruthy();
  });

  it('groups fields into labeled sections', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Thông tin lái xe')).toBeTruthy();
    expect(screen.getByText('Tài khoản nhận lương')).toBeTruthy();
    expect(document.querySelector('.fleet-form__section')).toBeNull();
  });

  it('cancels with the bordered secondary action, never a ghost', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Hủy/ }).className).toContain('btn--secondary');
  });

  it('renders the remaining fields and gates save on the required name', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Hạn bằng lái')).toBeTruthy();
    expect(screen.getByLabelText('Số điện thoại')).toBeTruthy();
    expect(screen.getByLabelText('Ngân hàng nhận tiền')).toBeTruthy();
    expect(screen.getByLabelText('Số TK nhận tiền')).toBeTruthy();
    expect(screen.getByLabelText('Hình thức lương')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Thêm lái xe/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
