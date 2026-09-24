import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChiHoTable, FreightTable, PayablesTable, buildDelta, buildDraft } from './ShipmentDebitTables';
import type { ShipmentDebitDetail } from '../../../api/shipmentClient';

const detail = (rowOver: Record<string, unknown> = {}, payablesOver: Record<string, unknown> = {}): ShipmentDebitDetail => ({
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
  payables: { chiHoTotal: null, ...payablesOver },
  thuKhachTotal: null,
});

describe('PayablesTable (Bảng 2.3) reads the wire', () => {
  it('renders the per-container HQGS fee instead of a hardcoded unknown', () => {
    render(<PayablesTable detail={detail()} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    // The HQGS cell reads the wire; cells without data keep the honest null
    // render — the bug was the whole row hardcoding the unknown string.
    expect(row?.textContent).toContain('250.000');
  });

  it('renders per-container payable freight and phat-sinh fee from the wire', () => {
    render(<PayablesTable detail={detail({ payableFreight: 8e6, phatSinhFee: 90000 })} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    expect(row?.textContent).toContain('8.000.000');
    expect(row?.textContent).toContain('90.000');
  });

  it('keeps Chưa xác định when the container has no data', () => {
    render(<PayablesTable detail={detail({
      customsFee: null,
      payableFreight: null,
      phatSinhFee: null,
    })} />);
    const row = screen.getByText('QATU1234569').closest('tr');
    expect(row?.textContent).toContain('Chưa xác định');
  });

  it('renders the chung-lô common row with the container-NULL ops fees', () => {
    render(<PayablesTable detail={detail({
      customsFee: null,
      payableFreight: null,
      phatSinhFee: null,
    }, { hqgsCommonFee: 250000 })} />);
    const row = screen.getByText('Phí chung lô').closest('tr');
    expect(row?.textContent).toContain('250.000');
    expect(row?.textContent).toContain('Chưa xác định');
  });
});

describe('FreightTable customer HQGS charge is independent of payable cost', () => {
  it.each([150000, 0])('uses the negotiated charge %s and keeps the payable cost', (charge) => {
    const value = detail({ customsCustomerCharge: charge, psActual: 50000 });
    render(<><FreightTable detail={value} draft={buildDraft(value)} frozen setFreight={() => {}} /><PayablesTable detail={value} /></>);
    const revenue = screen.getByRole('table', { name: 'Bảng 2.1 — Cước vận tải' });
    const payable = screen.getByRole('table', { name: 'Bảng 2.3 — Phí Phải trả (chỉ xem)' });
    const cells = revenue.querySelectorAll('tbody tr td');
    expect(cells[4]).toHaveTextContent(charge === 0 ? '0' : '150.000');
    expect(cells[6]).toHaveTextContent(charge === 0 ? '4.550.000' : '4.700.000');
    expect(payable).toHaveTextContent('250.000');
    expect(revenue).not.toHaveTextContent('250.000');
  });

  it('does not replace an absent customer-charge field with company cost', () => {
    const value = detail({ freightCharge: null, fuelSurcharge: null });
    render(<FreightTable detail={value} draft={buildDraft(value)} frozen setFreight={() => {}} />);
    const cells = screen.getByRole('table').querySelectorAll('tbody tr td');
    expect(cells[4]).toHaveTextContent('—');
    expect(cells[6]).toHaveTextContent('Chưa xác định');
  });
});

it('keeps canonical fee copies read-only and drops their stale draft changes, preserving manual fees', () => {
  const value = detail();
  value.chiHoRows = [{ tripId: 601, containerNumber: 'QATU1234569', containerTypeLabel: null, items: [],
    otherFees: [{ id: 1, name: 'Canonical fee', amount: 100, thuKhach: 120, readOnly: true }, { id: 2, name: 'Manual fee', amount: 200 }],
    carrierDetention: null, repairAdvance: null, opsDocsStatus: 'PENDING' }];
  const draft = buildDraft(value), change = vi.fn(), remove = vi.fn();
  render(<ChiHoTable detail={value} draft={draft} frozen={false} setFeeAmount={change} removeFee={remove} addFee={() => {}} setAddedFee={() => {}} />);
  expect(screen.getByRole('textbox', { name: /Số tiền chi hộ phí khác Canonical fee/ })).toBeDisabled();
  const button = screen.getByRole('button', { name: 'Xóa phí khác Canonical fee' });
  expect(button).toBeDisabled(); fireEvent.click(button); expect(remove).not.toHaveBeenCalled();
  expect(screen.getByText(/Điều chỉnh tại nguồn chi phí kế toán/)).toBeInTheDocument();
  const manual = screen.getByRole('textbox', { name: /Số tiền chi hộ phí khác Manual fee/ });
  expect(manual).toBeEnabled(); fireEvent.change(manual, { target: { value: '300' } }); expect(change).toHaveBeenCalledWith(2, '300');
  draft.feeAmounts = { 1: '999', 2: '300' }; draft.removedFeeIds = [1, 2];
  expect(buildDelta(value, draft)).toMatchObject({ edits: [{ expenseId: 2, buyAmount: 300 }], removeExpenseIds: [2] });
});

it('names the CSHT column in full in Bảng 2.2 (card 20260924_1, image6)', () => {
  // "Phí CSHT" was an opaque abbreviation; the column now spells the name
  // out — the header wraps under .csc-debit-table (law §4), no tooltip needed.
  const value = detail();
  render(<ChiHoTable detail={value} draft={buildDraft(value)} frozen setFeeAmount={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={vi.fn()} />);
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
  render(<ChiHoTable detail={value} draft={buildDraft(value)} frozen setFeeAmount={vi.fn()} removeFee={vi.fn()} addFee={() => {}} setAddedFee={vi.fn()} />);
  expect(screen.getByLabelText(/Số tiền chi hộ phí khác Phí lái xe kiểm thử hàng 1/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/601/)).not.toBeInTheDocument();
});
