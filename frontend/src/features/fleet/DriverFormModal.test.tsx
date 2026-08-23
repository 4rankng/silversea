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
});
