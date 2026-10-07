import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

    render(
      <MemoryRouter>
        <BasicInfoCard trip={baseTrip as unknown as TripDetail} />
      </MemoryRouter>
    );

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

    render(
      <MemoryRouter>
        <BasicInfoCard trip={{ ...baseTrip, containerCount: 2 } as unknown as TripDetail} />
      </MemoryRouter>
    );

    expect(screen.getByText('Số container')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('Lô hàng lẻ')).toBeNull();
  });

  it('renders a shipment details link when shipmentId is present', () => {
    useQueryMock.mockReturnValue({
      data: { items: [] },
      isLoading: false,
    });

    render(
      <MemoryRouter>
        <BasicInfoCard trip={{ ...baseTrip, shipmentId: 42 } as unknown as TripDetail} />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /Chi tiết lô hàng #42/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/shipments/42');
  });

  // Card 071026141640: /trips/:id rendered TWO identical "Lô hàng" rows for one
  // shipment — "Chi tiết lô hàng (E2EROLE001)" and "Chi tiết lô hàng #326" —
  // because the row was pushed once inline and again in the trailing block.
  // One shipment must yield exactly one row, keyed by the shipment id.
  it('renders exactly ONE shipment row, keyed by the shipment id (card 071026141640)', () => {
    useQueryMock.mockReturnValue({ data: { items: [] }, isLoading: false });

    render(
      <MemoryRouter>
        <BasicInfoCard trip={{ ...baseTrip, shipmentId: 42 } as unknown as TripDetail} />
      </MemoryRouter>
    );

    const links = screen.getAllByRole('link', { name: /lô hàng/i });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/shipments/42');
    // The "Lô hàng" label must not appear twice either.
    expect(screen.getAllByText('Lô hàng')).toHaveLength(1);
  });

  it('still renders exactly one shipment row when the trip has no customer reference (card 071026141640)', () => {
    useQueryMock.mockReturnValue({ data: { items: [] }, isLoading: false });

    render(
      <MemoryRouter>
        <BasicInfoCard
          trip={{ ...baseTrip, customerReference: null, shipmentId: 42 } as unknown as TripDetail}
        />
      </MemoryRouter>
    );

    expect(screen.getAllByRole('link', { name: /lô hàng/i })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Chi tiết lô hàng #42/i }).getAttribute('href')).toBe('/shipments/42');
  });

  it('renders no shipment row at all when the trip has no shipment (card 071026141640)', () => {
    useQueryMock.mockReturnValue({ data: { items: [] }, isLoading: false });

    render(
      <MemoryRouter>
        <BasicInfoCard trip={{ ...baseTrip, shipmentId: null } as unknown as TripDetail} />
      </MemoryRouter>
    );

    expect(screen.queryAllByRole('link', { name: /lô hàng/i })).toHaveLength(0);
    expect(screen.queryByText('Lô hàng')).toBeNull();
  });
});
