import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DriverFormModal } from './DriverFormModal';

describe('DriverFormModal', () => {
  it('renders the status select as one labelled control', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Trạng thái')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Hoạt động Trạng thái' })).toBeTruthy();
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

  it('pairs fields on the driver grid — phone takes the full row when salary is hidden', () => {
    const { rerender } = render(
      <DriverFormModal
        isOpen
        saving={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(document.querySelector('.fleet-form__grid')?.className).toContain('fleet-form__grid--driver');
    expect(document.getElementById('driver-phone')?.closest('.fleet-form__field')?.className)
      .not.toContain('fleet-form__field--wide');
    expect(document.getElementById('driver-salary')).toBeTruthy();

    rerender(
      <DriverFormModal
        isOpen
        saving={false}
        showSalary={false}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(document.getElementById('driver-phone')?.closest('.fleet-form__field')?.className)
      .toContain('fleet-form__field--wide');
    expect(document.getElementById('driver-salary')).toBeNull();
  });
});
