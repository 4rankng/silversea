import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// REV2 (ticket-v2 Phần VI mục 2): PayablesTable (Bảng 2.3) is out of the
// Chốt-giá-bán drawer — the CUS settlement surface carries no giá vốn, so
// this suite pins Bảng 2.1/2.2 and the delta math only.
import { ChiHoTable, FreightTable, buildDelta, buildDraft } from './ShipmentDebitTables';
import type { ShipmentDebitDetail } from '../../../api/shipmentClient';

const detail = (rowOver: Record<string, unknown> = {}): ShipmentDebitDetail => ({
  freightRows: [{
    containerNumber: 'QATU1234569',
    containerTypeLabel: "20'DC",
    tripId: 601,
    rateKey: null,
    freightCharge: 45e5,
    fuelSurcharge: 0,
    customsFee: 250000,
    contractFreightTotal: null,
    psActual: null,
    psActualNote: null,
    ...rowOver,
  }],
  chiHoRows: [],
  unattachedTrips: [],
  payables: { chiHoTotal: null },
  thuKhachTotal: null,
});

describe('FreightTable customer HQGS charge is independent of payable cost', () => {
  it.each([150000, 0])('uses the negotiated charge %s for the revenue face', (charge) => {
    const value = detail({ customsCustomerCharge: charge, psActual: 50000 });
    render(<FreightTable detail={value} draft={buildDraft(value)} frozen setFreight={() => {}} />);
    const revenue = screen.getByRole('table', { name: 'Cước vận tải' });
    const cells = revenue.querySelectorAll('tbody tr td');
    expect(cells[4]).toHaveTextContent(charge === 0 ? '0' : '150.000');
    expect(cells[6]).toHaveTextContent(charge === 0 ? '4.550.000' : '4.700.000');
  });

  it('does not replace an absent customer-charge field with company cost', () => {
    const value = detail({ freightCharge: null, fuelSurcharge: null });
    render(<FreightTable detail={value} draft={buildDraft(value)} frozen setFreight={() => {}} />);
    const cells = screen.getByRole('table').querySelectorAll('tbody tr td');
    expect(cells[4]).toHaveTextContent('—');
    expect(cells[6]).toHaveTextContent('Chưa xác định');
  });
});

// REV2 dual-input (ticket-v2 VI.2) + SIL-782 FAIL 5080 (r21): every Phí khác
// row — accounting-projected copies (readOnly wire flag) included — keeps the
// Thực chi Ops amount READ-ONLY but a CUS-editable Thu khách hàng input and a
// live × delete; only a locked (frozen) lot disables them.
it('canonical fee copies keep read-only Thực chi Ops but an editable Thu khách hàng and a live × (SIL-782 FAIL 5080)', () => {
  const value = detail();
  value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null, items: [],
    otherFees: [{ id: 1, name: 'Canonical fee', amount: 100, thuKhach: 120, readOnly: true }, { id: 2, name: 'Manual fee', amount: 200 }],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' }];
  const draft = buildDraft(value), change = vi.fn(), remove = vi.fn();
  render(<ChiHoTable detail={value} draft={draft} frozen={false} setFeeSell={change} removeFee={remove} addFee={() => {}} setAddedFee={() => {}} />);
  // The projected copy's Thực chi Ops still reads the wire as a read-only
  // span (accounting-managed buy) with its source note.
  const opsAmount = screen.getByLabelText('Thực chi Ops phí khác Canonical fee QATU1234569');
  expect(opsAmount.tagName).toBe('SPAN');
  expect(opsAmount.textContent).toBe('100');
  expect(screen.getByText(/Thực chi Ops do nguồn chi phí kế toán quản lý/)).toBeInTheDocument();
  // The CUS-owned sell cell is editable on the projected copy.
  const sell = screen.getByRole('textbox', { name: 'Thu khách hàng phí khác Canonical fee QATU1234569' }) as HTMLInputElement;
  expect(sell).toBeEnabled();
  expect(sell.value).toBe('120');
  fireEvent.change(sell, { target: { value: '300' } });
  expect(change).toHaveBeenCalledWith(1, '300');
  // Its × deletes too (the wire soft-voids with the Q10 reason trail).
  const button = screen.getByRole('button', { name: 'Xóa phí khác Canonical fee' });
  expect(button).toBeEnabled(); fireEvent.click(button); expect(remove).toHaveBeenCalledWith(1);
  // The manual fee's Thu khách hàng cell stays the CUS-managed input.
  const manual = screen.getByRole('textbox', { name: 'Thu khách hàng phí khác Manual fee QATU1234569' });
  expect(manual).toBeEnabled(); fireEvent.change(manual, { target: { value: '300' } }); expect(change).toHaveBeenCalledWith(2, '300');
  draft.feeSells = { 1: '999', 2: '300' }; draft.removedFeeIds = [1, 2];
  // REV2: the delta travels the SELL side only — never a buyAmount — and the
  // projected copy's edit and removal both travel.
  expect(buildDelta(value, draft)).toMatchObject({ edits: [{ expenseId: 1, sellAmount: 999 }, { expenseId: 2, sellAmount: 300 }], removeExpenseIds: [1, 2] });
});

// SIL-782 (r21): a locked (Đã khóa) lot is the ONLY state that keeps the
// canonical row's cells disabled.
it('a frozen lot still locks the canonical row cells', () => {
  const value = detail();
  value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null, items: [],
    otherFees: [{ id: 1, name: 'Canonical fee', amount: 100, thuKhach: 120, readOnly: true }],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' }];
  render(<ChiHoTable detail={value} draft={buildDraft(value)} frozen setFeeSell={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={() => {}} />);
  expect(screen.getByRole('textbox', { name: 'Thu khách hàng phí khác Canonical fee QATU1234569' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Xóa phí khác Canonical fee' })).toBeDisabled();
});

it('names the CSHT column in full in Bảng 2.2 (card 20260924_1, image6)', () => {
  // "Phí CSHT" was an opaque abbreviation; the column now spells the name
  // out — the header wraps under .csc-debit-table (law §4), no tooltip needed.
  const value = detail();
  render(<ChiHoTable detail={value} draft={buildDraft(value)} frozen setFeeSell={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={vi.fn()} />);
  expect(screen.getByRole('columnheader', { name: 'Phí cơ sở hạ tầng' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Phí CSHT' })).not.toBeInTheDocument();
});

// LaneA's sweep flagged the conditional trip-id leak in the fee affordances
// (audit O4 pattern, a0e0c18c): aria-labels announce a business key + human
// row position — never the DB trip id (internal-ids-never-user-facing).
it('fee affordances announce business keys, never the DB trip id', () => {
  const value = detail();
  value.chiHoRows = [{
    tripId: 601, containerNumber: null, containerTypeLabel: null,
    items: [], otherFees: [{ id: 7, name: 'Phí lái xe kiểm thử', amount: 50000, thuKhach: null, readOnly: false }],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'READY' as const,
  }];
  render(<ChiHoTable detail={value} draft={buildDraft(value)} frozen setFeeSell={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={vi.fn()} />);
  expect(screen.getByLabelText(/Thu khách hàng phí khác Phí lái xe kiểm thử hàng 1/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/601/)).not.toBeInTheDocument();
});

// REV2 (ticket-v2 VI.2): the fee editor grew the dual-input — the Thực chi
// Ops side renders read-only beside the Thu khách hàng input, both as
// label-over-control fields; the × rides beside the dual block, and draft
// fees keep the 2-column field grid. Data flow — value/onChange/aria-labels
// — is byte-identical.
it('renders the dual-input fee editor: Thực chi Ops read-only + Thu khách hàng input, and a 2-field draft grid (REV2 ticket-v2 VI.2)', () => {
  const value = detail();
  value.chiHoRows = [{
    tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null,
    items: [], otherFees: [{ id: 31, name: 'Phí kiểm thử giao diện', amount: 1000, thuKhach: 2000 }],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' as const,
  }];
  const draft = { ...buildDraft(value), addedFees: [{ key: 'new-1', tripId: 601, name: '', amount: '', sell: '450000' }] };
  render(<ChiHoTable detail={value} draft={draft} frozen={false} setFeeSell={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={vi.fn()} />);

  // The dual block holds exactly two label-over-control fields.
  const dual = document.querySelector('.csc-debit-otherfee__dual');
  expect(dual).not.toBeNull();
  const fields = [...dual!.querySelectorAll('label.csc-debit-otherfee__field')];
  expect(fields).toHaveLength(2);
  expect(fields.map((field) => field.querySelector('.csc-debit-otherfee__label')?.textContent)).toEqual(['Thực chi Ops', 'Thu khách hàng']);
  // Thực chi Ops = the read-only wire amount; Thu khách hàng = the editable input.
  expect(fields[0]!.querySelector('.csc-debit-otherfee__ro')?.textContent).toBe('1.000');
  expect(fields[1]!.querySelector('input.csc-debit-input--amount')).not.toBeNull();

  // The fee name sits ABOVE the dual block (label trên, control dưới) and
  // the × remove control rides the same managed fee block.
  const managed = dual!.closest('.csc-debit-otherfee')!;
  const kids = [...managed.children];
  expect(kids.indexOf(managed.querySelector('.csc-debit-item__name')!)).toBeLessThan(kids.indexOf(dual!));
  expect(managed.querySelector('button[aria-label="Xóa phí khác Phí kiểm thử giao diện"]')).not.toBeNull();

  const grid = document.querySelector('.csc-debit-otherfee__grid');
  expect(grid).not.toBeNull();
  const draftFields = [...grid!.querySelectorAll('label.csc-debit-otherfee__field')];
  expect(draftFields).toHaveLength(2);
  expect(draftFields.map((field) => field.querySelector('.csc-debit-otherfee__label')?.textContent)).toEqual(['Tên phí', 'Số tiền']);
  expect(draftFields[0]!.querySelector('input[aria-label^="Tên phí mới"]')).not.toBeNull();
  expect(draftFields[1]!.querySelector('input[aria-label^="Số tiền phí mới"]')).not.toBeNull();

  // SIL-790 — the DRAFT row pairs the same dual-input as saved rows: Thực chi
  // Ops reads '—' (nguồn chi phí kế toán fills it), Thu khách hàng is the
  // seeded sell input riding the create.
  const draftDual = draftFields[1]!.closest('.csc-debit-otherfee')!.querySelector('.csc-debit-otherfee__dual');
  expect(draftDual).not.toBeNull();
  const dualFields = [...draftDual!.querySelectorAll('label.csc-debit-otherfee__field')];
  expect(dualFields.map((field) => field.querySelector('.csc-debit-otherfee__label')?.textContent)).toEqual(['Thực chi Ops', 'Thu khách hàng']);
  expect(dualFields[0]!.querySelector('.csc-debit-otherfee__ro')?.textContent).toBe('—');
  const sellInput = dualFields[1]!.querySelector('input[aria-label^="Thu khách hàng phí mới"]') as HTMLInputElement | null;
  expect(sellInput).not.toBeNull();
  expect(sellInput!.value).toBe('450000');
});

const originalMedia = window.matchMedia;
function phoneViewport() {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: query.includes('max-width: 640px'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

it('QA-AUDIT-UI-39 phone ledgers keep all amounts and mount editable controls once', () => {
  phoneViewport();
  const value = detail({ customsCustomerCharge: 150000 });
  value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null, items: [],
    otherFees: [{ id: 2, name: 'Manual fee', amount: 200 }], carrierDetention: 350000, repairAdvance: null, opsDocsStatus: 'PENDING' }];
  const freightChanges: unknown[] = []; const feeChanges: unknown[] = [];
  render(<><FreightTable detail={value} draft={buildDraft(value)} frozen={false} setFreight={(...args) => freightChanges.push(args)} />
    <ChiHoTable detail={value} draft={buildDraft(value)} frozen={false} setFeeSell={(...args) => feeChanges.push(args)} addFee={() => {}} removeFee={() => {}} setAddedFee={() => {}} /></>);
  // REV2 — two ledgers only: Bảng 2.1 freight + Bảng 2.2 chi hộ (Bảng 2.3
  // payables is out of the settlement surface).
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  const revenue = screen.getByText('Cước vận tải').closest('section')!;
  expect(within(revenue).getByText('4.650.000')).toBeTruthy();
  expect(screen.getAllByLabelText('PS thực tế QATU1234569')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('PS thực tế QATU1234569'), { target: { value: '100000' } });
  expect(freightChanges).toEqual([['QATU1234569', { psActual: '100000' }]]);
  fireEvent.change(screen.getByLabelText('Thu khách hàng phí khác Manual fee QATU1234569'), { target: { value: '400' } });
  expect(feeChanges).toEqual([[2, '400']]);
  expect(screen.getByText('[ 350.000 đ ]').closest('.csc-debit-warn-cell--armed')).toBeTruthy();
  expect(screen.getByText('Manual fee')).toBeTruthy();
  expect(screen.getByText('Manual fee').closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
  expect(screen.getByText('4.650.000').closest('.ledger-record__fact')).not.toHaveAttribute('data-layout');
});


// SIL-790 — the seeded row's Thu khách hàng rides addOtherFees.sellAmount in
// ONE save; a bare seed (no amount, no sell) never travels.
it('SIL-790: seed sell rides addOtherFees.sellAmount; bare seed is a no-op', () => {
  const value = detail();
  value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null,
    items: [], otherFees: [], carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' }];
  const seeded = { ...buildDraft(value), addedFees: [{ key: 'seed', tripId: 601, name: 'Phí không hóa đơn', amount: '', sell: '450000' }] };
  const delta = buildDelta(value, seeded);
  expect(delta.addOtherFees).toEqual([{ tripId: 601, name: 'Phí không hóa đơn', amount: 0, sellAmount: 450000 }]);

  const bare = { ...buildDraft(value), addedFees: [{ key: 'seed', tripId: 601, name: 'Phí không hóa đơn', amount: '', sell: '' }] };
  expect(buildDelta(value, bare).addOtherFees).toEqual([]);
});
