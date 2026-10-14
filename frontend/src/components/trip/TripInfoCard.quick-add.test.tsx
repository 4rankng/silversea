import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createInternalTruckMock, apiPostMock, formContextMock } = vi.hoisted(() => ({
  createInternalTruckMock: vi.fn(),
  apiPostMock: vi.fn(),
  formContextMock: vi.fn(),
}));

vi.mock('../../api/dispatchPlanningClient', () => ({
  createInternalTruck: createInternalTruckMock,
}));
vi.mock('../../lib/api', () => ({
  api: { post: apiPostMock, get: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../hooks/useTripFormContext', () => ({
  useTripFormContext: formContextMock,
}));

import { TripInfoCard } from './TripInfoCard';
import type { SelectOption, RouteOption, TrailerTypeOption } from '../../hooks/useTripOptions';

const setTruckId = vi.fn();
const setDriverId = vi.fn();

function baseForm(overrides: Record<string, unknown> = {}) {
  return {
    carrierType: 'OWN',
    customerId: '',
    setCustomerId: vi.fn(),
    routeId: '',
    setRouteId: vi.fn(),
    cargoTypeId: '',
    setCargoTypeId: vi.fn(),
    customerReference: '',
    setCustomerReference: vi.fn(),
    truckId: '',
    setTruckId,
    trailerType: '',
    setTrailerType: vi.fn(),
    driverId: '',
    setDriverId,
    externalCarrierId: null,
    setExternalCarrierId: vi.fn(),
    externalFreightCost: '',
    setExternalFreightCost: vi.fn(),
    externalPlateNumber: '',
    setExternalPlateNumber: vi.fn(),
    externalDriverName: '',
    setExternalDriverName: vi.fn(),
    externalDriverPhone: '',
    setExternalDriverPhone: vi.fn(),
    departureDate: '',
    setDepartureDate: vi.fn(),
    containerCount: '1',
    setContainerCount: vi.fn(),
    plannedContainerTypeId: '',
    setPlannedContainerTypeId: vi.fn(),
    containerRows: [],
    vatRate: 0.08,
    setVatRate: vi.fn(),
    previewTotals: { externalMargin: null },
    ...overrides,
  };
}

const props = {
  customers: [] as SelectOption[],
  carrierCustomers: [] as SelectOption[],
  routes: [] as RouteOption[],
  trucks: [{ id: 3, label: '60C-12345' }] as SelectOption[],
  trailerTypes: [{ value: '40FT', label: '40FT' }] as TrailerTypeOption[],
  drivers: [{ id: 7, label: 'Phạm Văn Hùng' }] as SelectOption[],
  cargoTypes: [] as SelectOption[],
  containerTypes: [] as SelectOption[],
  loading: false,
};

function renderCard(form = baseForm()) {
  formContextMock.mockReturnValue(form);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TripInfoCard {...props} />
    </QueryClientProvider>,
  );
}

// FB-066 (card 121026141040, owner ruling 2026-10-14 — supersedes the
// round-16 "no quick-add by design" state): the OWN-branch vehicle/driver
// selectors on the trip form regain the quick-add affordance the dispatch
// editor already owns.
describe('TripInfoCard quick-add on vehicle/driver selectors (FB-066)', () => {
  beforeEach(() => {
    createInternalTruckMock.mockReset();
    apiPostMock.mockReset();
    setTruckId.mockClear();
    setDriverId.mockClear();
  });

  it('mounts a Thêm nhanh button beside Xe đầu kéo and Lái xe on the OWN branch', () => {
    renderCard();
    const truckField = screen.getByLabelText('Xe đầu kéo').closest('.field') as HTMLElement;
    const driverField = screen.getByLabelText('Lái xe').closest('.field') as HTMLElement;
    expect(withinFieldButton(truckField, 'Thêm nhanh')).toBeTruthy();
    expect(withinFieldButton(driverField, 'Thêm nhanh')).toBeTruthy();
  });

  it('quick-adds an internal tractor: POST /trucks, form selects the new plate', async () => {
    createInternalTruckMock.mockResolvedValue({ id: 41, licensePlate: '29C-999.88' });
    renderCard();
    fireEvent.click(withinFieldButton(screen.getByLabelText('Xe đầu kéo').closest('.field') as HTMLElement, 'Thêm nhanh'));

    const plateInput = await screen.findByLabelText('Biển số xe');
    fireEvent.change(plateInput, { target: { value: '29C-999.88' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createInternalTruckMock).toHaveBeenCalledWith({ licensePlate: '29C-999.88' }));
    await waitFor(() => expect(setTruckId).toHaveBeenCalledWith('41'));
  });

  it('quick-adds a driver: POST /drivers with the name, form selects the new driver', async () => {
    apiPostMock.mockResolvedValue({ id: 88, name: 'Trần Văn Mới' });
    renderCard();
    fireEvent.click(withinFieldButton(screen.getByLabelText('Lái xe').closest('.field') as HTMLElement, 'Thêm nhanh'));

    fireEvent.change(await screen.findByLabelText('Tên tài xế'), { target: { value: 'Trần Văn Mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledWith('/drivers', { name: 'Trần Văn Mới' }));
    await waitFor(() => expect(setDriverId).toHaveBeenCalledWith('88'));
  });

  it('refuses a blank driver name inside the dialog instead of calling the API', async () => {
    renderCard();
    fireEvent.click(withinFieldButton(screen.getByLabelText('Lái xe').closest('.field') as HTMLElement, 'Thêm nhanh'));
    fireEvent.click(await screen.findByRole('button', { name: 'Áp dụng' }));
    expect(await screen.findByText('Vui lòng nhập tên tài xế.')).toBeTruthy();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('keeps the EXTERNAL branch quick-add free — the partner fields are free text', () => {
    renderCard(baseForm({ carrierType: 'EXTERNAL' }));
    expect(screen.queryByText('Thêm nhanh')).toBeNull();
  });
});

function withinFieldButton(field: HTMLElement, name: string) {
  const buttons = Array.from(field.querySelectorAll<HTMLButtonElement>('button'));
  const found = buttons.find((button) => button.textContent?.includes(name));
  if (!found) throw new Error(`No ${name} button inside the field`);
  return found;
}
