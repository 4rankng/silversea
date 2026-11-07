import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { DispatchAllocationPopover } from './DispatchAllocationPopover';

/**
 * SIL-390 (id 423) — the "+ Thêm nhanh biển số xe" quick-add.
 *
 * Owner law 2026-11-07 (KB chương 3, chốt) SUPERSEDES the FB-066 lần 3
 * "FCL field-set: NOT APPLICABLE" disposition: the button must appear beside
 * the plate/carrier field AFTER a nhà xe is chosen on all three surfaces —
 * the FCL field-set of "Phân bổ nhà xe" (beside each carrier row's select,
 * fresh rows already resolve to đội xe nội bộ), the LCL field-set's BKS thực
 * picker (owned since FB-066 lần 3), and /trips/new's Xe ngoài plate field.
 * The quick-add registers the plate into THAT carrier's catalog (luật
 * 17/10: cả hai đường nhập đều lưu danh mục chung). The allocation field-set
 * itself still owns NO plate field — a carrier row can cover several
 * containers, and a cont lot's plate is set per container in Kế hoạch Chi
 * tiết, which carries the same quick-add.
 */
vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    getBootstrap: vi.fn().mockResolvedValue({
      externalCarriers: [{ id: 77, name: 'HÀ AN', isActive: true }],
    }),
  },
}));

vi.mock('../../../api/shipmentClient', () => ({
  saveShipmentCarrierAllocations: vi.fn(),
  getCusShipmentWorkspaceDetail: vi.fn().mockResolvedValue(null),
}));

const { createCarrierFleetVehicleMock, createInternalTruckMock } = vi.hoisted(() => ({
  createCarrierFleetVehicleMock: vi.fn(),
  createInternalTruckMock: vi.fn(),
}));

vi.mock('../../../api/dispatchPlanningClient', () => ({
  createCarrierFleetVehicle: createCarrierFleetVehicleMock,
  createInternalTruck: createInternalTruckMock,
}));

const fclShipment = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  version: 4,
  customerName: 'Công ty ABC',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  containerCount20: 2,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 2 x 20DC',
  allocationStatus: 'NOT_ALLOCATED',
  cargoMode: 'FCL',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

describe('DispatchAllocationPopover — the FCL field-set contract (SIL-390)', () => {
  beforeEach(() => {
    createCarrierFleetVehicleMock.mockReset();
    createInternalTruckMock.mockReset();
  });

  it('allocates a carrier + the container counts per day', async () => {
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());
    expect(screen.getByLabelText(/Số container 20' dòng 1/)).toBeTruthy();
    expect(screen.getByLabelText(/Số container 40' dòng 1/)).toBeTruthy();
  });

  it('carries no plate field, yet offers the quick-add beside the carrier select', async () => {
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());
    // No ô BKS in the allocation field-set — a cont lot's plate belongs to
    // the container (Kế hoạch Chi tiết), even though the quick-add is here.
    expect(screen.queryByLabelText(/Biển số/)).toBeNull();
    // The fresh row already resolves to đội xe nội bộ (toEmptyRow default) —
    // "sau khi chọn nhà xe" is satisfied by the chosen default, exactly the
    // dispatch editor's default-OWN-row contract.
    expect(screen.getByRole('button', { name: /Thêm nhanh/ })).toBeTruthy();
  });

  it('external carrier row: quick-add registers the plate into THAT nhà xe (Xe ngoài API)', async () => {
    createCarrierFleetVehicleMock.mockResolvedValue({ id: 9, licensePlate: '60C-077.55' });
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());

    // react-aria select: the trigger is a BUTTON (aria-haspopup listbox);
    // press it, then pick the option from the opened listbox.
    fireEvent.click(screen.getByRole('button', { name: /Nhà xe dòng 1/ }));
    const carrierOptions = await screen.findAllByRole('option');
    const haAn = carrierOptions.find((item) => item.textContent?.includes('HÀ AN'));
    expect(haAn, 'HÀ AN option').toBeTruthy();
    fireEvent.click(haAn!);

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));

    // The allocation shell stays mounted under the quick-add dialog.
    const dialog = (await screen.findByText('Thêm nhanh biển số xe')).closest('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('HÀ AN');
    fireEvent.change(screen.getByLabelText('Biển số xe'), { target: { value: '60c 077.55' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createCarrierFleetVehicleMock).toHaveBeenCalledWith({ carrierId: 77, licensePlate: '60C 077.55' }));
    expect(createInternalTruckMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Thêm nhanh biển số xe')).toBeNull());
    // The allocation draft is untouched — the shell still holds row 1.
    expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy();
  });

  it('own-fleet row: quick-add registers an internal tractor, never the Xe ngoài API', async () => {
    createInternalTruckMock.mockResolvedValue({ id: 8, licensePlate: '29C-888.11' });
    render(<DispatchAllocationPopover shipment={fclShipment()} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/Nhà xe dòng 1/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Thêm nhanh/ }));
    fireEvent.change(await screen.findByLabelText('Biển số xe'), { target: { value: '29c 888.11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    await waitFor(() => expect(createInternalTruckMock).toHaveBeenCalledWith({ licensePlate: '29C 888.11' }));
    expect(createCarrierFleetVehicleMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Thêm nhanh biển số xe')).toBeNull());
  });
});
