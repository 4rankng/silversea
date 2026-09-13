import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripDetail } from '@tingting/shared';

vi.mock('../../../hooks/useTripQueries', () => ({
  useTripDetail: vi.fn(),
}));
vi.mock('../../../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { customers: [] } }),
}));
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useTrucksAndDrivers: () => ({ data: null }),
}));

import { useTripDetail } from '../../../hooks/useTripQueries';
import { TripReassignDialog } from './TripReassignDialog';

const useTripDetailMock = vi.mocked(useTripDetail);

const TRIP = {
  id: 3,
  version: 3,
  carrierType: 'OWN',
  truckId: 20,
  driverId: 7,
  externalCarrierId: null,
  externalPlateNumber: null,
  externalDriverName: null,
  externalDriverPhone: null,
} as unknown as TripDetail;

function renderDialog() {
  return render(<TripReassignDialog tripId={3} onClose={vi.fn()} onReassigned={vi.fn()} />);
}

describe('TripReassignDialog — fetch-state rendering', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
  });

  it('shows the loading label only while the trip fetch is in flight', () => {
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: true, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByText('Đang tải…')).toBeTruthy();
  });

  it('shows a recoverable error state instead of an eternal loading label when the fetch fails', () => {
    // Regression: the 2026-09-10 staging QA block — a failed fetch rendered
    // the eternal "Đang tải…" because the dialog had no error branch.
    useTripDetailMock.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('request failed'), refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được chuyến đi');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.queryByText('Đang tải…')).toBeNull();
  });

  it('renders the reassignment form once the trip loads', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    renderDialog();
    expect(screen.getByText('Loại xe')).toBeTruthy();
    expect(screen.getByDisplayValue('Xe nhà')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('TripReassignDialog — draft seeding across trip versions', () => {
  beforeEach(() => {
    useTripDetailMock.mockReset();
  });

  it('reseeds the draft when the served trip carries a new version after a reassign', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const { rerender } = renderDialog();
    expect(screen.getByDisplayValue('Xe nhà')).toBeTruthy();

    // A successful reassign bumps the trip version. Whenever the hook serves
    // that new snapshot — a refetch landing on an open dialog, or the cached
    // pre-reassign copy being replaced on reopen — the draft must follow the
    // fresh data instead of staying on the stale pre-reassign fields.
    const REASSIGNED_TRIP = {
      ...TRIP,
      version: 4,
      carrierType: 'EXTERNAL',
      truckId: null,
      driverId: null,
      externalCarrierId: 9,
      externalPlateNumber: '60C-999.99',
    } as unknown as TripDetail;
    useTripDetailMock.mockReturnValue({
      data: REASSIGNED_TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    rerender(<TripReassignDialog tripId={3} onClose={vi.fn()} onReassigned={vi.fn()} />);

    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();
    expect(screen.getByDisplayValue('60C-999.99')).toBeTruthy();
  });

  it('keeps in-progress edits when a refetch returns the same version', () => {
    useTripDetailMock.mockReturnValue({
      data: TRIP, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    const { rerender } = renderDialog();
    fireEvent.change(screen.getByDisplayValue('Xe nhà'), { target: { value: 'EXTERNAL' } });
    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();

    // Same version, fresh snapshot object — must not reseed over the edit.
    useTripDetailMock.mockReturnValue({
      data: { ...TRIP }, isLoading: false, error: null, refetch: vi.fn(),
    } as never);
    rerender(<TripReassignDialog tripId={3} onClose={vi.fn()} onReassigned={vi.fn()} />);

    expect(screen.getByDisplayValue('Xe ngoài')).toBeTruthy();
    expect(screen.queryByDisplayValue('60C-999.99')).toBeNull();
  });
});
