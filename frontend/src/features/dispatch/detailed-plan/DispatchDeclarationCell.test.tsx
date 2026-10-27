// SIL-591 — the SỐ TỜ KHAI cell of the detailed-plan grid (per-container
// SIL-521 model): value display, role-gated click-to-edit, Enter/Escape
// mechanics, LCL lot-list fallback.
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

import { DispatchDeclarationCell } from './DispatchDeclarationCell';

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
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

beforeEach(() => {
  updateLineMock.mockReset().mockResolvedValue({ line: {}, declarationSync: { updatedContainerIds: [78, 79] } });
  toastMock.mockReset();
  authRole = null;
});

describe('DispatchDeclarationCell — value display', () => {
  it('renders the container declaration number as text (no auth → read-only)', () => {
    render(<DispatchDeclarationCell row={row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: null, declarationNumber: 'VN123456789' } })} />);
    expect(screen.getByText('VN123456789')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the missing field (Chưa có tờ khai) — never a bare dash', () => {
    render(<DispatchDeclarationCell row={row()} />);
    expect(screen.getByText('Chưa có tờ khai')).toBeTruthy();
  });

  it('an LCL row reads the lot declaration list and stays read-only', () => {
    render(<DispatchDeclarationCell row={row({
      cargoMode: 'LCL',
      shipmentContainerId: null,
      docs: { billNumber: 'BL-2026-010', tradeDirection: 'IMPORT', declarationNumbers: ['TK-A', 'TK-B'] },
    })} />);
    expect(screen.getByText('TK-A, TK-B')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('DispatchDeclarationCell — role gating (card 261013200312)', () => {
  it.each(['CUS', 'ADMIN', 'MANAGER'])('role %s gets the click-to-edit affordance', (role) => {
    authRole = role;
    render(<DispatchDeclarationCell row={row()} />);
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ })).toBeTruthy();
  });

  it.each(['DISPATCHER', 'ACCOUNTANT'])('role %s gets static text — no edit affordance the server would 403', () => {
    authRole = 'DISPATCHER';
    render(<DispatchDeclarationCell row={row()} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Chưa có tờ khai')).toBeTruthy();
  });
});

describe('DispatchDeclarationCell — click-to-edit mechanics', () => {
  it('click → inline input → Enter saves through the container-line command and refreshes', async () => {
    authRole = 'CUS';
    const onSaved = vi.fn();
    render(<DispatchDeclarationCell row={row()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'VN998877665' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(1));
    expect(updateLineMock).toHaveBeenCalledWith(11, 77, { expectedShipmentVersion: 5, declarationNumber: 'VN998877665' }, expect.any(String));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // FB-109 auto-copy toast: the mocked result synced 2 siblings.
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: expect.stringContaining('2 container') })));
  });

  it('Enter with no change closes the editor without a write', async () => {
    authRole = 'CUS';
    render(<DispatchDeclarationCell row={row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-KEEP' } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(input.value).toBe('TK-KEEP');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByLabelText('Số tờ khai')).toBeNull());
    expect(updateLineMock).not.toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('Escape reverts — the baseline survives, nothing is written', () => {
    authRole = 'CUS';
    render(<DispatchDeclarationCell row={row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-KEEP' } })} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const input = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'TK-CHANGED' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('TK-KEEP')).toBeTruthy();
    expect(updateLineMock).not.toHaveBeenCalled();
  });

  it('a refused save surfaces the backend reason verbatim and keeps the editor open', async () => {
    authRole = 'CUS';
    updateLineMock.mockRejectedValue(new Error('Số tờ khai đã thuộc lô hàng khác. Vui lòng kiểm tra lại trước khi lưu.'));
    render(<DispatchDeclarationCell row={row()} />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const input = screen.getByLabelText('Số tờ khai');
    fireEvent.change(input, { target: { value: 'TK-DUP' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: 'Số tờ khai đã thuộc lô hàng khác. Vui lòng kiểm tra lại trước khi lưu.' })));
    // The editor stays open (draft intact) for a correction.
    expect(screen.getByLabelText('Số tờ khai')).toBeTruthy();
  });

  it('the same cell re-edits after a successful save — saving clears on success (regression: stale saving dead-locked the next click)', async () => {
    authRole = 'CUS';
    const onSaved = vi.fn();
    render(<DispatchDeclarationCell row={row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: null, declarationNumber: 'TK-FIRST' } })} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-SECOND' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    // The board refetch reuses the row key — the cell instance survives, and
    // the click AFTER a success must still open the editor.
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const reopened = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(reopened.value).toBe('TK-FIRST');
    fireEvent.change(reopened, { target: { value: 'TK-THIRD' } });
    fireEvent.keyDown(reopened, { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(2));
    expect(updateLineMock).toHaveBeenLastCalledWith(11, 77, { expectedShipmentVersion: 5, declarationNumber: 'TK-THIRD' }, expect.any(String));
  });
});
