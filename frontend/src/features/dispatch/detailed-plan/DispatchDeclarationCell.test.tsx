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

describe('DispatchDeclarationCell — role gating (SIL-551 writer law)', () => {
  it.each(['CUS', 'ADMIN', 'MANAGER', 'DISPATCHER'])('role %s gets the click-to-edit affordance', (role) => {
    authRole = role;
    render(<DispatchDeclarationCell row={row()} />);
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ })).toBeTruthy();
  });

  it.each(['ACCOUNTANT', 'DRIVER', 'OPS'])('role %s gets static text — no edit affordance the server would 403', (role) => {
    authRole = role;
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
    // the click AFTER a success must still open the editor. SIL-594 (id 694):
    // the just-saved value is the visible truth (the row prop may still carry
    // the pre-save projection until the refetch lands), so the reopened editor
    // seeds the saved value — never the stale prop.
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    const reopened = screen.getByLabelText('Số tờ khai') as HTMLInputElement;
    expect(reopened.value).toBe('TK-SECOND');
    fireEvent.change(reopened, { target: { value: 'TK-THIRD' } });
    fireEvent.keyDown(reopened, { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(2));
    expect(updateLineMock).toHaveBeenLastCalledWith(11, 77, { expectedShipmentVersion: 5, declarationNumber: 'TK-THIRD' }, expect.any(String));
  });
});

// SIL-594 (id 694, QA Glint 29/10): "Giá trị vừa lưu không hiển thị ngay —
// phải tải lại trang mới thấy". The cell must show the just-saved value from
// the save's own confirmation, WITHOUT waiting for the board refetch — a
// refetch can land late, land stale (cache replay), or not land at all, and
// reload/re-search must never be the way to see a save. Regression: the save
// display rides the mutation result, and the refreshed row (any later value)
// takes over when it arrives.
describe('DispatchDeclarationCell — SIL-594 saved value shows immediately', () => {
  it('C1: after Enter-save resolves the cell shows the saved value with no row refresh', async () => {
    authRole = 'CUS';
    updateLineMock.mockResolvedValue({ line: {}, declarationSync: { updatedContainerIds: [] } });
    render(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TESTBUG1-001' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TESTBUG1-002' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })));

    // NO prop refresh — the display already carries the save.
    const cell = screen.getByRole('button', { name: /Sửa số tờ khai/ });
    expect(cell.textContent).toContain('TESTBUG1-002');
    expect(cell.textContent).not.toContain('TESTBUG1-001');
  });

  it('C2: clearing the value shows "Chưa có tờ khai" immediately after save', async () => {
    authRole = 'CUS';
    updateLineMock.mockResolvedValue({ line: {}, declarationSync: { updatedContainerIds: [] } });
    render(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TESTBUG1-002' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })));

    const cell = screen.getByRole('button', { name: /Sửa số tờ khai/ });
    expect(cell.textContent).toContain('Chưa có tờ khai');
  });

  it('C3: when the refreshed row arrives with a later value, the server value wins (echo self-clears)', async () => {
    authRole = 'CUS';
    updateLineMock.mockResolvedValue({ line: {}, declarationSync: { updatedContainerIds: [] } });
    const { rerender } = render(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-OLD' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-SAVED' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(updateLineMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ }).textContent).toContain('TK-SAVED');

    // The board refetch lands with a fresher external value — it must win.
    rerender(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-SERVER' },
    })} />);
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ }).textContent).toContain('TK-SERVER');
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ }).textContent).not.toContain('TK-SAVED');
  });
});

// Review findings 1-2 — the echo lifecycle's hard cases (SIL-594 class). Each
// pin fails without its guard: the rapid re-save would show the INTERMEDIATE
// refetch value, and a late-resolving save would poison a swapped-in row.
describe('DispatchDeclarationCell — SIL-594 echo lifecycle', () => {
  it('C5: rapid re-save mid-refetch — the second save wins even when the first refetch lands in between', async () => {
    authRole = 'CUS';
    let resolveSave2!: (value: unknown) => void;
    updateLineMock
      .mockResolvedValueOnce({ line: {}, declarationSync: { updatedContainerIds: [] } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSave2 = resolve; }));
    const { rerender } = render(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-A' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-B' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));

    // Second save starts while the row prop still says TK-A…
    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-C' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    // …the FIRST save's refetch lands mid-flight (prop → TK-B)…
    rerender(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-B' },
    })} />);
    resolveSave2({ line: {}, declarationSync: { updatedContainerIds: [] } });
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(2));

    const cell = screen.getByRole('button', { name: /Sửa số tờ khai/ });
    expect(cell.textContent).toContain('TK-C');
    expect(cell.textContent).not.toContain('TK-B');
  });

  it('C6: a save resolving after a row swap never arms the echo onto the new row', async () => {
    authRole = 'CUS';
    let resolveSave!: (value: unknown) => void;
    updateLineMock.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { rerender } = render(<DispatchDeclarationCell row={row({
      shipmentContainerId: 77,
      container: { containerNumber: 'MSCU1111111', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-A' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: 'TK-B' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    // Row swaps to ANOTHER container carrying the same old value while the
    // save is still in flight — its display must stay its own.
    rerender(<DispatchDeclarationCell row={row({
      shipmentContainerId: 88,
      container: { containerNumber: 'MSCU2222222', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-A' },
    })} />);
    resolveSave({ line: {}, declarationSync: { updatedContainerIds: [] } });
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));

    const cell = screen.getByRole('button', { name: /Sửa số tờ khai/ });
    expect(cell.textContent).toContain('TK-A');
    expect(cell.textContent).not.toContain('TK-B');
  });

  it('C7: clear-to-empty echo self-clears when an external refetch value lands', async () => {
    authRole = 'CUS';
    updateLineMock.mockResolvedValue({ line: {}, declarationSync: { updatedContainerIds: [] } });
    const { rerender } = render(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-A' },
    })} />);

    fireEvent.click(screen.getByRole('button', { name: /Sửa số tờ khai/ }));
    fireEvent.change(screen.getByLabelText('Số tờ khai'), { target: { value: '' } });
    fireEvent.keyDown(screen.getByLabelText('Số tờ khai'), { key: 'Enter' });
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ }).textContent).toContain('Chưa có tờ khai');

    // An external writer's fresh value lands via refetch — the echo must not
    // mask it.
    rerender(<DispatchDeclarationCell row={row({
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: null, cargoWeightKg: null, declarationNumber: 'TK-EXT' },
    })} />);
    expect(screen.getByRole('button', { name: /Sửa số tờ khai/ }).textContent).toContain('TK-EXT');
  });
});
