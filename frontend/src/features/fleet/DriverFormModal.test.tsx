import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TruckStatus, type Truck } from '@tingting/shared';
import { DriverFormModal } from './DriverFormModal';

const trucks: Truck[] = [{
  id: 1,
  licensePlate: '51H-123.45',
  trailerPlateNumber: null,
  trailerType: null,
  currentTrailerId: null,
  status: TruckStatus.ACTIVE,
  nextInspectionDate: null,
  insuranceExpiryDate: null,
  lastOilServiceDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}];

describe('DriverFormModal', () => {
  it('renders each assignment select as one labelled control', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        trucks={trucks}
        onsave={vi.fn()}
        oncancel={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Xe phân công')).toHaveLength(1);
    expect(screen.getAllByText('Trạng thái')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '— Chưa phân — Xe phân công' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoạt động Trạng thái' })).toBeTruthy();
  });

  it('renders one flat field grid — no boxed sections or prose headers', () => {
    render(
      <DriverFormModal
        isOpen
        saving={false}
        trucks={trucks}
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
        trucks={trucks}
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
        trucks={trucks}
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
        trucks={trucks}
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
