import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn() },
}));

import { BasicInfoCard } from './BasicInfoCard';
import type { TripDetail } from '@tingting/shared';

const baseTrip = {
  id: 2,
  truck: { licensePlate: '60C-12345' },
  driver: { name: 'Phạm Văn Hùng' },
  trailer: { licensePlate: '51R-246.80', type: '40FT' },
  trailerType: '40FT',
  containerCount: 1,
  departureDate: '2026-08-04',
  completedAt: null,
  customerReference: 'BK-O2C-20260803-02',
};

describe('BasicInfoCard container summary', () => {
  it('relabels a synthetic LCL scope without reporting a fake container count', () => {
    useQueryMock.mockReturnValue({
      data: {
        items: [{
          id: 501,
          containerNumber: null,
          sealNumber: null,
          containerTypeCode: null,
          containerTypeName: null,
          cargoWeightKg: null,
          notes: '__fulfillment_lcl:1',
        }],
      },
      isLoading: false,
    });

    render(<BasicInfoCard trip={baseTrip as unknown as TripDetail} />);

    expect(screen.getByText('Hình thức hàng')).toBeTruthy();
    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();
    expect(screen.queryByText('Số container')).toBeNull();
  });

  it('preserves the real FCL container count', () => {
    useQueryMock.mockReturnValue({
      data: {
        items: [
          { id: 601, containerNumber: 'MSKU1234567', notes: null },
          { id: 602, containerNumber: 'MSCU7654321', notes: null },
        ],
      },
      isLoading: false,
    });

    render(<BasicInfoCard trip={{ ...baseTrip, containerCount: 2 } as unknown as TripDetail} />);

    expect(screen.getByText('Số container')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('Lô hàng lẻ')).toBeNull();
  });
});
