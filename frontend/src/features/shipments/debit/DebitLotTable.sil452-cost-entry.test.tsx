import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShipmentDebitLotRow } from '../../../api/shipmentDebit';

const { onDeclareCost, onDeleted, onToggle, onSaved, onUnmerged } = vi.hoisted(() => ({
  onDeclareCost: vi.fn(),
  onDeleted: vi.fn(),
  onToggle: vi.fn(),
  onSaved: vi.fn(),
  onUnmerged: vi.fn(),
}));

import { DebitLotTable } from './DebitLotTable';
import { ToastProvider } from '../../../components/shared/Toast';

function row(overrides: Partial<ShipmentDebitLotRow> = {}): ShipmentDebitLotRow {
  return {
    customerId: 1,
    shipmentId: 835,
    code: 'SHP-835',
    customerName: 'KH A',
    factoryName: null,
    factoryAddress: null,
    billOrBookNumber: 'R4B-RG-FCL1',
    customsNumber: null,
    documentsSummary: null,
    freightAuto: null,
    chiHoTotal: null,
    receivableTotal: null,
    payableTotal: null,
    profit: null,
    lockStatus: 'OPEN',
    lockedAt: null,
    ...overrides,
  };
}

function renderTable(props: { canManage?: boolean; canDeleteLot?: boolean; canDeclareCost?: boolean; locked?: boolean } = {}) {
  return render(
    <MemoryRouter initialEntries={['/shipments-debit']}>
      <ToastProvider>
        <DebitLotTable
          items={[row(props.locked ? { lockStatus: 'LOCKED', lockedAt: '2026-11-01T00:00:00.000Z' } : {})]}
          canManage={props.canManage ?? true}
          canDeleteLot={props.canDeleteLot}
          canDeclareCost={props.canDeclareCost}
          onDeclareCost={props.canDeclareCost ? onDeclareCost : undefined}
          onDeleted={onDeleted}
          mergeMode={false}
          selectedIds={new Set()}
          expandedId={null}
          onToggle={onToggle}
          onSaved={onSaved}
          onUnmerged={onUnmerged}
          ratesRefreshing={false}
          plateOptions={[]}
          onSelect={() => {}}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * SIL-452 (FB-097 entry restore, QA fail 06/11 build dcaa8295, hoapt/
 * ACCOUNTANT): the settlement board's ⋯ row menu carries the lot-scope cost
 * entry — the accountant opens the shared "Thêm khoản chi" drawer without
 * leaving /shipments-debit. Gate = the BE expense-write trio (NOT
 * canManage, which also admits CUS); a locked lot disables the entry with
 * the cost-lock reason (the 06/11 law: locked lots refuse expense writes).
 */
describe('DebitLotTable — the row menu Khai chi phí entry (SIL-452)', () => {
  beforeEach(() => {
    onDeclareCost.mockReset();
    onDeleted.mockReset();
    onToggle.mockReset();
    onSaved.mockReset();
    onUnmerged.mockReset();
  });

  async function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: 'Hành động lô R4B-RG-FCL1' }));
    const menu = await screen.findByRole('menu', { name: 'Hành động lô R4B-RG-FCL1' });
    return menu;
  }

  it('the trio gate renders the entry; activating it hands the ROW to the host opener', async () => {
    renderTable({ canManage: true, canDeclareCost: true });
    const menu = await openMenu();
    const entry = within(menu).getByRole('menuitem', { name: 'Khai chi phí' });
    expect(entry).toBeEnabled();
    fireEvent.click(entry);
    await waitFor(() => expect(onDeclareCost).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 835, billOrBookNumber: 'R4B-RG-FCL1' })));
  });

  it('a locked lot keeps the entry visible but disabled with the cost-lock reason', async () => {
    renderTable({ canManage: true, canDeclareCost: true, locked: true });
    const menu = await openMenu();
    const entry = within(menu).getByRole('menuitem', { name: 'Khai chi phí' });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute('title', 'Lô đã chốt kế toán — không thể khai chi phí.');
    fireEvent.click(entry);
    expect(onDeclareCost).not.toHaveBeenCalled();
  });

  it('a role outside the trio (e.g. CUS via canManage) never sees the entry', async () => {
    renderTable({ canManage: true, canDeleteLot: true });
    const menu = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Khai chi phí' })).toBeNull();
    // The menu still carries its other affordances — only the cost entry is gone.
    expect(within(menu).getByRole('menuitem', { name: 'Xem lô hàng' })).toBeTruthy();
  });
});
