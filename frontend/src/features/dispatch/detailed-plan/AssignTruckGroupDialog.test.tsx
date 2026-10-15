/**
 * FB-092 — "Gán xe nhóm" dialog: lot order list, billing-BKS auto-copy, the
 * FB-090 sourcing rule (truck-tonnage classes refuse internal plates), and
 * the assign call's payload.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const assignMock = vi.fn();
vi.mock('../../../api/dispatchPlanningClient', () => ({
  assignLclCostGroup: (input: unknown) => assignMock(input),
}));
const toastMock = vi.fn();
vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));
const truckClasses = [
  { id: 7, code: '3.5T', name: 'Xe 3.5 tấn', isContainer: false, sortOrder: 2, deletedAt: null },
  { id: 12, code: 'CONT20', name: 'Container 20 feet', isContainer: true, sortOrder: 8, deletedAt: null },
];
vi.mock('../../../hooks/useCatalogQueries', () => ({
  useVehicleSizeClasses: () => ({ data: truckClasses, isLoading: false }),
  useTrucksAndDrivers: () => ({
    data: { trucks: [{ id: 1, licensePlate: '31B-777.99' }], drivers: [] },
    isLoading: false,
  }),
}));

import { AssignTruckGroupDialog } from './AssignTruckGroupDialog';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const row = (shipmentId: number, bill: string): DispatchDetailPlanRow => ({
  fulfillmentId: shipmentId,
  version: 1,
  shipmentId,
  shipmentVersion: 1,
  shipmentCode: null,
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: null, deliveryPoint: null, routeName: null },
  docs: { billNumber: bill, tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '900.00' },
  lcl: { packageCount: 3, packageType: 'KIỆN', cargoVolumeCbm: '2.000', group: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: null, dropoffPortName: null, dropoffPortShortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  plannedEndAt: null,
  classification: 'SINGLE' as const,
  lotFullyPlated: false,
} as DispatchDetailPlanRow);

function renderDialog(rows: DispatchDetailPlanRow[]) {
  return render(
    <AssignTruckGroupDialog rows={rows} onClose={vi.fn()} onAssigned={vi.fn()} />,
  );
}

async function openAndType(label: RegExp, text: string) {
  const combo = screen.getByRole('combobox', { name: label });
  fireEvent.focusIn(combo);
  fireEvent.click(combo);
  fireEvent.change(combo, { target: { value: text } });
}

async function pickVehicleClass(name: string) {
  await openAndType(/Loại xe tính cước trả ĐV/, name);
  const option = await screen.findByRole('option', { name: new RegExp(name) });
  fireEvent.click(option);
}

function setField(label: RegExp, value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
}

describe('FB-092 — AssignTruckGroupDialog', () => {
  beforeEach(() => {
    assignMock.mockReset();
    toastMock.mockReset();
  });

  it('lists the selected lots in operator order and stays closed without rows', () => {
    const { rerender } = renderDialog([]);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<AssignTruckGroupDialog rows={[row(31, 'BL-1'), row(32, 'BL-2')]} onClose={vi.fn()} onAssigned={vi.fn()} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]!.textContent).toContain('Lô 1 · BL-1');
    expect(items[1]!.textContent).toContain('Lô 2 · BL-2');
  });

  it('blocks an internal plate on a truck class, accepts it on a container class (FB092-04)', async () => {
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    setField(/BKS thực/, '31B-777.99');
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhóm xe' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('100% xe ngoài');
    });
    expect(assignMock).not.toHaveBeenCalled();

    // CONT20 allows the internal plate — the assign call goes through.
    await pickVehicleClass('Container 20 feet');
    setField(/BKS thực/, '31B-777.99');
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhóm xe' }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    expect(assignMock.mock.calls[0]![0]).toMatchObject({
      shipmentIds: [31, 32],
      vehicleSizeClassId: 12,
      actualTruckNo: '31B-777.99',
    });
  });

  it('auto-copies the billing BKS from the actual one (FB092-03)', async () => {
    assignMock.mockResolvedValue({ groupId: 'g', memberCount: 2, members: [] });
    renderDialog([row(31, 'BL-1'), row(32, 'BL-2')]);
    await pickVehicleClass('Xe 3.5 tấn');
    setField(/BKS thực/, '29C-123.45');
    const billing = screen.getByRole('combobox', { name: /BKS báo khách/ }) as HTMLInputElement;
    await waitFor(() => expect(billing.value).toBe('29C-123.45'));
    fireEvent.click(screen.getByRole('button', { name: 'Gán nhóm xe' }));
    await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1));
    // Billing equals actual ⇒ the server-side default applies; no explicit
    // billingTruckNo rides the payload.
    expect(assignMock.mock.calls[0]![0]).not.toHaveProperty('billingTruckNo');
  });
});
