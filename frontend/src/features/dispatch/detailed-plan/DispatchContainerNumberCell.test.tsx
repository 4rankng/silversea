// SIL-653 (id 760) — the SỐ CONT line of the detailed-plan grid: role-gated
// click-to-edit through the CUS container-line command (the save the backend
// bridges onto the trip snapshot for the driver app), SIL-594 echo display.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const updateLineMock = vi.fn();
vi.mock('../../../api/shipmentClient', () => ({
  updateCusShipmentContainerLine: (...args: unknown[]) => updateLineMock(...args),
}));

const toastMock = vi.fn();
vi.mock('../../../components/shared/Toast', () => ({
  useToastOptional: () => ({ toast: toastMock }),
}));

let authRole: string | null = null;
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => (authRole == null ? undefined : { user: { userId: 1, role: authRole } }),
}));

import { DispatchContainerNumberCell } from './DispatchContainerNumberCell';

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentContainerId: 77,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: null },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00', declarationNumber: null },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null, pairKind: 'KEP' },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

beforeEach(() => {
  updateLineMock.mockReset().mockResolvedValue({ line: {} });
  toastMock.mockReset();
  authRole = null;
});

describe('DispatchContainerNumberCell — value display', () => {
  it('renders the container number as static text when no auth (never actionable-looking), no redundant KEP tag (SIL-732)', () => {
    render(<DispatchContainerNumberCell row={row()} />);
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('[KẸP]')).toBeNull();
  });

  it('names the missing field (Chưa có số cont) — the pre-sync dead state', () => {
    render(<DispatchContainerNumberCell row={row({ container: { containerNumber: null, containerTypeLabel: '40HC', cargoWeightKg: null, declarationNumber: null } })} />);
    expect(screen.getByText('Chưa có số cont')).toBeTruthy();
  });
});

describe('DispatchContainerNumberCell — role gating (SIL-551 writer law)', () => {
  it.each(['CUS', 'ADMIN', 'MANAGER', 'DISPATCHER'])('role %s gets the click-to-edit affordance', (role) => {
    authRole = role;
    render(<DispatchContainerNumberCell row={row()} />);
    expect(screen.getByRole('button', { name: /Sửa số container/ })).toBeTruthy();
  });

  it.each(['ACCOUNTANT', 'DRIVER', 'OPS'])('role %s gets static text — no edit affordance the server would 403', (role) => {
    authRole = role;
    render(<DispatchContainerNumberCell row={row()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DispatchContainerNumberCell — click-to-edit mechanics', () => {
  it('click → inline input → Enter saves through the container-line command, echoes, refreshes', async () => {
    const onSaved = vi.fn();
    authRole = 'DISPATCHER';
    render(<DispatchContainerNumberCell row={row()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số container/ }));
    const input = screen.getByLabelText('Số container');
    fireEvent.change(input, { target: { value: 'TCKU1234560' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(1));
    expect(updateLineMock).toHaveBeenCalledWith(11, 77, { expectedShipmentVersion: 5, containerNumber: 'TCKU1234560' }, expect.any(String));
    // SIL-594 echo — the saved value shows immediately, before any refetch.
    expect(screen.getByText('TCKU1234560')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('an in-lot duplicate (server 400) surfaces the backend reason verbatim and keeps the editor open', async () => {
    authRole = 'CUS';
    updateLineMock.mockRejectedValue(new Error('Số container "TCKU1234560" đã tồn tại trong lô hàng.'));
    render(<DispatchContainerNumberCell row={row()} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số container/ }));
    const input = screen.getByLabelText('Số container');
    fireEvent.change(input, { target: { value: 'TCKU1234560' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith({ kind: 'error', message: 'Số container "TCKU1234560" đã tồn tại trong lô hàng.' }));
    // The editor STAYS OPEN on a failed save (same law as the declaration
    // cell): the user fixes the value in place; `saving` cleared so Enter
    // can re-commit instead of dead-locking.
    expect(screen.getByLabelText('Số container')).toBeTruthy();
    expect(updateLineMock).toHaveBeenCalledTimes(1);
  });

  it('Escape reverts to the baseline without a save', () => {
    authRole = 'DISPATCHER';
    render(<DispatchContainerNumberCell row={row()} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số container/ }));
    const input = screen.getByLabelText('Số container');
    fireEvent.change(input, { target: { value: 'XXXX1234560' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(updateLineMock).not.toHaveBeenCalled();
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
  });
});
