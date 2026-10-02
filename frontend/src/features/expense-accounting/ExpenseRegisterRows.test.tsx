import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseAccountingEntry } from '@tingting/shared';

import { expenseKey } from './expense-accounting-model';
import { ExpenseRegisterRows } from './ExpenseRegisterRows';

const entry = {
  sourceKind: 'OPS', sourceId: 164, status: 'RECORDED', locked: true,
  feeName: 'Chi phí QA', shipmentCode: 'QA-EXP-164', amount: 3000,
  customerChargeAmount: 3000, expenseDate: '2026-09-16',
} as ExpenseAccountingEntry;

it('QA-AUDIT-UI-37 keeps the truck plate while a missing carrier name never exposes its grouping key', () => {
  const missingCarrier = { ...entry, carrierName: null, carrierCode: 'SILVERSEA_INTERNAL', truckPlate: 'QA22C-60376805' };
  const { bodyRows } = renderRows([missingCarrier]);
  const cell = bodyRows()[0].querySelector('[data-label="Xe / người chi"]')!;
  expect(cell).toHaveTextContent('QA22C-60376805');
  expect(cell).toHaveTextContent('Chưa có tên nhà xe');
  expect(cell).not.toHaveTextContent('SILVERSEA_INTERNAL');
});

/** Pickable rows are the ones the old per-row checkbox enabled: status RECORDED
 *  and not yet confirmed (a VOIDED row can never join a confirm batch — same
 *  predicate as ExpenseBoard's "Chọn trang này"). */
const row = (sourceId: number, status: ExpenseAccountingEntry['status'] = 'RECORDED') => ({
  sourceKind: 'OPS', sourceId, status, locked: false,
  feeName: `Phí ${sourceId}`, shipmentCode: `QA-EXP-${sourceId}`, amount: 3000,
  customerChargeAmount: 3000, expenseDate: '2026-09-16',
}) as ExpenseAccountingEntry;

/** The board owns the batch (it can span pages), so the table is exercised the
 *  way its three hosts drive it: the selection lives in state and comes back
 *  down as `selected`. Every case below therefore sees the real round trip a
 *  row click makes, not a stand-in. */
function Host({ rows, initial, selectable = true, canViewPayments = true, onSelect }: {
  rows: ExpenseAccountingEntry[];
  initial?: string[];
  selectable?: boolean;
  canViewPayments?: boolean;
  onSelect?: (entry: ExpenseAccountingEntry, checked: boolean) => void;
}) {
  const [selected, setSelected] = useState(new Set(initial));
  return <ExpenseRegisterRows
    rows={rows}
    selected={selected}
    selectable={selectable}
    canViewPayments={canViewPayments}
    onOpen={vi.fn()}
    onSelect={(entry_, checked) => {
      onSelect?.(entry_, checked);
      setSelected(current => { const next = new Set(current); if (checked) next.add(expenseKey(entry_)); else next.delete(expenseKey(entry_)); return next; });
    }}
  />;
}

function renderRows(rows: ExpenseAccountingEntry[], initial: string[] = [], extra: { selectable?: boolean; canViewPayments?: boolean; onSelect?: (entry: ExpenseAccountingEntry, checked: boolean) => void } = {}) {
  const onSelect = extra.onSelect ?? vi.fn();
  const view = render(<Host rows={rows} initial={initial} onSelect={onSelect} {...extra} />);
  const bodyRows = () => [...view.container.querySelectorAll('.expense-register-table tbody tr')] as HTMLTableRowElement[];
  return { onSelect, view, bodyRows };
}

const bodyRow = (container: HTMLElement, sourceId: number) =>
  [...container.querySelectorAll('.expense-register-table tbody tr')].find(row => within(row as HTMLElement).queryByText(`Phí ${sourceId}`)) as HTMLTableRowElement;

describe('ExpenseRegisterRows', () => {
  it('keeps the complete expense title on the canonical compact action without selecting its row', () => {
    const existing = { ...entry, feeName: 'Phí sửa chữa dọc đường' };
    const onOpen = vi.fn(), onSelect = vi.fn();
    render(<ExpenseRegisterRows rows={[existing]} selected={new Set()} selectable canViewPayments={false} onSelect={onSelect} onOpen={onOpen} />);
    const action = screen.getByRole('button', { name: existing.feeName });
    expect(action).toHaveTextContent(existing.feeName);
    expect(action).toHaveClass('btn', 'btn--ghost', 'btn--sm');
    fireEvent.click(action);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(existing);
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('describes a generic source lock without claiming that the accounting period is locked', () => {
    render(<ExpenseRegisterRows rows={[entry]} selected={new Set()} selectable={false} canViewPayments={false} onSelect={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.getByText('Đã khóa chỉnh sửa')).toBeInTheDocument();
    expect(screen.queryByText('Khóa kỳ')).not.toBeInTheDocument();
  });
});

/** Card 20260929_207 — the checkbox column is gone; a row IS the control.
 *  These cases pin the behaviour that replaces it, so a later refactor cannot
 *  quietly take the selection away, or make a row's own button select it. */
describe('ExpenseRegisterRows — row selection replaces the checkbox column', () => {
  it('ships no checkbox in the table', () => {
    const { view } = renderRows([row(1), row(2)]);
    expect(view.container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('picks a row on click and unpicks it on a second click', () => {
    const { bodyRows } = renderRows([row(1)]);
    const [first] = bodyRows();

    expect(first).not.toHaveAttribute('data-selected');
    fireEvent.click(first);
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(first);
    expect(first).not.toHaveAttribute('data-selected');
  });

  // Every row carries buttons. Clicking one must run THAT control and leave the
  // selection alone — otherwise one tap both opens the detail and picks a row
  // for a batch the accountant never chose.
  it('does not pick the row when the press lands on the row’s own button', () => {
    const onOpen = vi.fn();
    render(<ExpenseRegisterRows rows={[row(1)]} selected={new Set()} selectable canViewPayments onOpen={onOpen} onSelect={vi.fn()} />);
    const first = document.querySelector('.expense-register-table tbody tr') as HTMLTableRowElement;

    fireEvent.click(within(first).getByText('Phí 1'));
    expect(onOpen).toHaveBeenCalled();
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('tells the host which row was picked and which was released', () => {
    const onSelect = vi.fn();

    const { view } = renderRows([row(1), row(2)], [], { onSelect });
    fireEvent.click(bodyRow(view.container, 1));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 1 }), true);
    fireEvent.click(bodyRow(view.container, 1));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 1 }), false);
  });

  it('leaves a row that cannot join a batch inert', () => {
    const { bodyRows } = renderRows([row(1, 'VOIDED')]);
    const [first] = bodyRows();

    expect(first).toHaveClass('expense-register-row--locked');
    expect(first).not.toHaveAttribute('tabindex');
    fireEvent.click(first);
    expect(first).not.toHaveAttribute('data-selected');
  });

  it('picks the focused row with the keyboard', () => {
    const { bodyRows } = renderRows([row(1)]);
    const [first] = bodyRows();

    expect(first).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(first, { key: ' ' });
    expect(first).toHaveAttribute('data-selected', 'true');
  });

  it('a host that never offers selection has no pickable row and no hint', () => {
    const { view, bodyRows } = renderRows([row(1)], [], { selectable: false });
    const [first] = bodyRows();

    expect(first).not.toHaveClass('expense-register-row--pickable');
    expect(first).not.toHaveAttribute('tabindex');
    fireEvent.click(first);
    expect(first).not.toHaveAttribute('data-selected');
    expect(view.container.querySelector('.expense-accounting-hint')).toBeNull();
  });
});

describe('ExpenseRegisterRows — Ngày duyệt column + approved rows (card 20260928_168)', () => {
  it('uses honest missing approver copy without exposing the stored numeric ID (UI37)', () => {
    const approved = { ...row(9), confirmedAt: '2026-09-21T02:00:00.000Z', confirmedById: 42, confirmedByName: null } as ExpenseAccountingEntry;
    const { view } = renderRows([approved]);
    expect(screen.getByText('Người duyệt: Chưa có tên người duyệt')).toBeInTheDocument();
    expect(view.container.textContent).not.toContain('#42');
  });
  it('AC1: the date column is named Ngày duyệt and shows who approved', () => {
    const approved = {
      ...row(9),
      confirmedAt: '2026-09-21T02:00:00.000Z',
      confirmedById: 42,
      confirmedByName: 'Kế toán B',
    } as ExpenseAccountingEntry;
    render(<ExpenseRegisterRows rows={[approved]} selected={new Set()} selectable canViewPayments onSelect={vi.fn()} onOpen={vi.fn()} />);
    const header = [...document.querySelectorAll('th')].find(cell => cell.textContent.trim() === 'Ngày duyệt');
    expect(header).toBeTruthy();
    expect(screen.getByText('Người duyệt: Kế toán B')).toBeInTheDocument();
  });

  // Card 20260929_207 kept the intent, changed the affordance: an approved row
  // can no longer be ticked, so it can no longer be picked.
  it('AC2: an approved row cannot be picked again', () => {
    const approved = { ...row(9), confirmedAt: '2026-09-21T02:00:00.000Z', confirmedById: 42 } as ExpenseAccountingEntry;
    const { view } = renderRows([approved, row(10)]);

    const locked = bodyRow(view.container, 9);
    const pickable = bodyRow(view.container, 10);
    expect(locked).toHaveClass('expense-register-row--locked');
    expect(pickable).toHaveClass('expense-register-row--pickable');

    fireEvent.click(locked);
    expect(locked).not.toHaveAttribute('data-selected');
  });
});

/** Card 20260928_168 (PM ruling 2026-09-29 câu 3): the checkbox column is gone
 *  and the duyệt action lives IN the 'Ngày duyệt' column — a per-row button on
 *  exactly the rows that can be confirmed. Hosts that pass no onConfirm (the
 *  lot panel, the work drawer) keep the read-only cell. */
describe('ExpenseRegisterRows — the duyệt action lives in the Ngày duyệt column (card 20260928_168)', () => {
  it('renders the per-row Duyệt button inside the Ngày duyệt cell and fires onConfirm for that row', () => {
    const onConfirm = vi.fn();
    const onOpen = vi.fn();
    render(<ExpenseRegisterRows rows={[row(1)]} selected={new Set()} selectable canViewPayments onOpen={onOpen} onSelect={vi.fn()} onConfirm={onConfirm} />);
    const cell = [...document.querySelectorAll('td')].find(td => td.dataset.label === 'Ngày duyệt') as HTMLElement;
    expect(cell).toBeTruthy();
    fireEvent.click(within(cell).getByRole('button', { name: 'Duyệt' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 1 }));
    // The press belongs to the control: it neither opens the entry nor picks the row.
    expect(onOpen).not.toHaveBeenCalled();
    expect(cell.closest('tr')).not.toHaveAttribute('data-selected');
  });

  it('an approved row shows date and approver instead of the button — it cannot be duyệt-ed again', () => {
    const onConfirm = vi.fn();
    const approved = { ...row(9), confirmedAt: '2026-09-21T02:00:00.000Z', confirmedById: 42, confirmedByName: 'Kế toán B' } as ExpenseAccountingEntry;
    render(<ExpenseRegisterRows rows={[approved]} selected={new Set()} selectable canViewPayments onOpen={vi.fn()} onSelect={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(screen.getByText('Người duyệt: Kế toán B')).toBeInTheDocument();
  });

  it('a locked row keeps the read-only cell — same admission the batch button uses', () => {
    const onConfirm = vi.fn();
    const locked = { ...row(8), locked: true } as ExpenseAccountingEntry;
    render(<ExpenseRegisterRows rows={[locked]} selected={new Set()} selectable canViewPayments onOpen={vi.fn()} onSelect={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(screen.getByText('Đã khóa chỉnh sửa')).toBeInTheDocument();
  });

  it('a host that passes no onConfirm never sees the button (the lot panel, the work drawer)', () => {
    render(<ExpenseRegisterRows rows={[row(1)]} selected={new Set()} selectable canViewPayments onOpen={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Duyệt' })).not.toBeInTheDocument();
    expect(screen.getByText('Chưa đối chiếu')).toBeInTheDocument();
  });
});

/** Card 20260922_7 put a "Chọn tất cả" checkbox in the header. Card
 *  20260929_207 removed the control, so these cases now pin where that
 *  capability lives: the row itself, and the scope a bulk pick covers. */
describe('ExpenseRegisterRows — the header Chọn tất cả capability (20260922_7)', () => {
  it('the selection column header is gone for every host', () => {
    const withControl = renderRows([row(1)]);
    const headers = [...withControl.view.container.querySelectorAll('th')].map(cell => cell.textContent.trim());
    expect(headers).not.toContain('Chọn');
    expect(headers[0]).toBe('Lô / công việc');

    const plain = renderRows([row(1)], [], { selectable: false });
    expect([...plain.view.container.querySelectorAll('th')].map(cell => cell.textContent.trim())).toEqual(headers);
  });

  // Requirement 3: per-row toggles stay live. The header control is gone, so
  // the row click is the only way in — and it reports the same (entry, true).
  it('requirement 3: per-row toggles stay live', () => {
    const onSelect = vi.fn();
    const { view } = renderRows([row(7)], [], { onSelect });

    fireEvent.click(bodyRow(view.container, 7));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 7 }), true);
  });

  it('requirement 3: a partial selection marks exactly the picked rows', () => {
    const { bodyRows } = renderRows([row(1), row(2)], [expenseKey(row(1))]);
    const [first, second] = bodyRows();

    expect(first).toHaveAttribute('data-selected', 'true');
    expect(second).not.toHaveAttribute('data-selected');
  });

  it('AC1 scope: "all" means selectable rows — a complete selectable set reads picked beside a VOIDED row', () => {
    const { bodyRows } = renderRows([row(1), row(2, 'VOIDED')], [expenseKey(row(1))]);
    const [first, second] = bodyRows();

    expect(first).toHaveAttribute('data-selected', 'true');
    expect(second).not.toHaveAttribute('data-selected');
    expect(second).toHaveClass('expense-register-row--locked');
  });

  it('AC1 scope: a page with no selectable rows leaves every row inert', () => {
    const onSelect = vi.fn();
    const { view, bodyRows } = renderRows([row(1, 'VOIDED')], [], { onSelect });

    for (const row of bodyRows()) {
      expect(row).toHaveClass('expense-register-row--locked');
      expect(row).not.toHaveAttribute('data-selected');
    }
    fireEvent.click(bodyRow(view.container, 1));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
