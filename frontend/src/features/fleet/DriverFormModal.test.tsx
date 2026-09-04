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

  it('renders one flat field grid — no boxed sections or prose headers', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.queryByText('Hồ sơ lái xe')).toBeNull();
    expect(screen.queryByText('Phân công')).toBeNull();
    expect(document.querySelector('.fleet-form__section')).toBeNull();
    expect(document.querySelectorAll('.fleet-form__grid')).toHaveLength(1);
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

  it('renders the driver grid with all fields', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(document.querySelector('.fleet-form__grid')?.className).toContain('fleet-form__grid--driver');
    expect(document.getElementById('driver-code')).toBeTruthy();
    expect(document.getElementById('driver-name')).toBeTruthy();
    expect(document.getElementById('driver-phone')).toBeTruthy();
    expect(document.getElementById('driver-idNumber')).toBeTruthy();
    expect(document.getElementById('driver-licenseNumber')).toBeTruthy();
    expect(document.getElementById('driver-bankName')).toBeTruthy();
    expect(document.getElementById('driver-bankAccount')).toBeTruthy();
    expect(document.getElementById('driver-salaryType')).toBeTruthy();
  });
});
