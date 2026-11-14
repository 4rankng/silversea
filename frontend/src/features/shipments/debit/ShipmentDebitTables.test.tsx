import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// SIL-837 (REV2 danh sách phẳng + ngăn trượt): the Chốt-giá-bán drawer reads
// as TWO named blocks — "Phí Có HĐ" (chỉ đọc) and "Phí Không HĐ" (nhập được)
// — not the old per-container matrices. This suite pins the blocks and the
// delta math only (Bảng 2.3 payables left the drawer with ticket-v2 VI.2).
import { DebitCoHdBlock, DebitKhongHdBlock, buildDelta, buildDraft } from './ShipmentDebitTables';
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

describe('DebitCoHdBlock — the read-only Phí Có HĐ block (SIL-837)', () => {
  it('names itself Phí Có HĐ and shows the negotiated HQGS charge, never the company cost', () => {
    const value = detail({ customsCustomerCharge: 150000 });
    render(<DebitCoHdBlock detail={value} />);
    expect(screen.getByRole('region', { name: 'Phí Có HĐ' })).toBeInTheDocument();
    expect(screen.getByText('Cước thu: 4.500.000')).toBeInTheDocument();
    expect(screen.getByText('Phí hải quan: 150.000')).toBeInTheDocument();
  });

  it('does not replace an absent customer-charge field with company cost', () => {
    const value = detail({ freightCharge: null, fuelSurcharge: null, customsFee: 500000, customsCustomerCharge: 150000 });
    render(<DebitCoHdBlock detail={value} />);
    // The customer-charge face reads the negotiated figure; the company-side
    // customsFee never leaks into it.
    expect(screen.getByText('Phí hải quan: 150.000')).toBeInTheDocument();
    expect(screen.queryByText('500.000')).toBeNull();
  });

  it('renders chi hộ items with HD numbers and the bracketed tiền treo holds', () => {
    const value = detail();
    value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null,
      items: [{ id: 9, expenseType: 'LIFT_ON', feeName: 'Phí nâng', amount: 180000, thuKhach: null, note: null, invoiceNumber: 'TD-001', readOnly: true }],
      otherFees: [], carrierDetention: 350000, repairAdvance: null, opsDocsStatus: 'PENDING' as const }];
    render(<DebitCoHdBlock detail={value} />);
    expect(screen.getByText('180.000')).toBeInTheDocument();
    expect(screen.getByText('HD: TD-001')).toBeInTheDocument();
    expect(screen.getByText('[ 350.000 đ ]')).toBeInTheDocument();
  });

  it('an intake lot with no Ops money names the empty state', () => {
    render(<DebitCoHdBlock detail={{ ...detail({ freightCharge: null, fuelSurcharge: null, customsCustomerCharge: null }), freightRows: [] }} />);
    expect(screen.getByText('Chưa có khoản phí có hóa đơn trên lô.')).toBeInTheDocument();
  });
});

describe('DebitKhongHdBlock — the editable Phí Không HĐ block (SIL-837)', () => {
  it('names itself Phí Không HĐ and mounts the PS thực tế editor once', () => {
    const changes: unknown[] = [];
    const value = detail({ customsCustomerCharge: 150000 });
    render(<DebitKhongHdBlock detail={value} draft={buildDraft(value)} frozen={false} setFreight={(...args) => changes.push(args)} setFeeSell={vi.fn()} addFee={vi.fn()} removeFee={vi.fn()} setAddedFee={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Phí Không HĐ' })).toBeInTheDocument();
    expect(screen.getAllByLabelText('PS thực tế QATU1234569')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('PS thực tế QATU1234569'), { target: { value: '100000' } });
    expect(changes).toEqual([['QATU1234569', { psActual: '100000' }]]);
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
    render(<DebitKhongHdBlock detail={value} draft={draft} frozen={false} setFreight={vi.fn()} setFeeSell={change} addFee={() => {}} removeFee={remove} setAddedFee={() => {}} />);
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
    render(<DebitKhongHdBlock detail={value} draft={buildDraft(value)} frozen setFreight={vi.fn()} setFeeSell={vi.fn()} addFee={() => {}} removeFee={vi.fn()} setAddedFee={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Thu khách hàng phí khác Canonical fee QATU1234569' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xóa phí khác Canonical fee' })).toBeDisabled();
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
    render(<DebitKhongHdBlock detail={value} draft={buildDraft(value)} frozen setFreight={vi.fn()} setFeeSell={vi.fn()} addFee={vi.fn()} removeFee={vi.fn()} setAddedFee={vi.fn()} />);
    expect(screen.getByLabelText(/Thu khách hàng phí khác Phí lái xe kiểm thử hàng 1/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/601/)).not.toBeInTheDocument();
  });

  // SIL-837 §3 — the dead add button: the click adds a draft row for the lot's
  // trip even when the fee row itself carries no tripId, and a trip-less lot
  // EXPLAINS the refusal on the button instead of doing nothing.
  it('[+ Thêm chi phí] adds a draft via the lot-wide trip fallback', () => {
    const value = detail();
    // The fee row itself carries no tripId (LOT-scope cost row); the lot's
    // freight trip is the fallback the draft needs.
    value.chiHoRows = [{ tripId: null, containerNumber: 'QATU1234569', containerTypeLabel: null,
      items: [], otherFees: [], carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' as const }];
    const addFee = vi.fn();
    render(<DebitKhongHdBlock detail={value} draft={buildDraft(value)} frozen={false} setFreight={vi.fn()} setFeeSell={vi.fn()} addFee={addFee} removeFee={vi.fn()} setAddedFee={vi.fn()} />);
    const button = screen.getByRole('button', { name: '+ Thêm chi phí' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(addFee).toHaveBeenCalledWith(601);
  });

  it('[+ Thêm chi phí] on a trip-less lot stays disabled with its reason', () => {
    const value = { ...detail({ tripId: null }), freightRows: [] };
    render(<DebitKhongHdBlock detail={value} draft={buildDraft(value)} frozen={false} setFreight={vi.fn()} setFeeSell={vi.fn()} addFee={vi.fn()} removeFee={vi.fn()} setAddedFee={vi.fn()} />);
    const button = screen.getByRole('button', { name: '+ Thêm chi phí' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Lô chưa có chuyến — không thể thêm phí');
  });

  it('renders the dual-input fee editor: Thực chi Ops read-only + Thu khách hàng input, and a 2-field draft grid (REV2 ticket-v2 VI.2)', () => {
    const value = detail();
    value.chiHoRows = [{
      tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null,
      items: [], otherFees: [{ id: 31, name: 'Phí kiểm thử giao diện', amount: 1000, thuKhach: 2000 }],
      carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' as const,
    }];
    const draft = { ...buildDraft(value), addedFees: [{ key: 'new-1', tripId: 601, name: '', amount: '', sell: '450000' }] };
    render(<DebitKhongHdBlock detail={value} draft={draft} frozen={false} setFreight={vi.fn()} setFeeSell={vi.fn()} addFee={() => {}} removeFee={vi.fn()} setAddedFee={vi.fn()} />);

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
