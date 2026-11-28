/**
 * UX-02 (staging UI audit 2026-11-27) — DebitMergeMobileList: the ≤767px
 * per-bill card face of the Ghép bộ Debit board. Fixture per the QA sheet:
 * QA-S6-LCL-A/B are one merged rev group totalling 120,000 ₫ (60,000 + 60,000)
 * and BOTH stay individually selectable; a four-record fixture must show four
 * bill ids on initial load. Selection parity runs through the SAME Set +
 * callback the page gives the desktop grid.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DebitMergeItem } from '@tingting/shared';
import { DebitMergeMobileList } from './DebitMergeMobileList';

const row = (over: Partial<DebitMergeItem> & Pick<DebitMergeItem, 'shipmentId'>): DebitMergeItem => ({
  code: null,
  customerId: 11,
  customerName: 'Long Minh',
  factoryName: null,
  routeName: null,
  deliveryDate: null,
  billOrBookNumber: null,
  creatorName: null,
  creatorCode: null,
  containers: [],
  revenue: { cuoc: null, lachHuyen: null, phuPhi: null, phatSinh: null, tong: null },
  chiHo: { csht: [], lift: [], drop: [], other: [] },
  noInvoice: { gnFee: null, gnPaid: null, psFee: null, psPaid: null, fees: [] },
  control: { tongTc: null, lockStatus: 'OPEN', lockedAt: null },
  ...over,
});

// The QA-S6 sheet: two LCL lots merged into one rev group, 120,000 ₫ total,
// plus two standalone records — four bills on the initial load.
const FIXTURE: DebitMergeItem[] = [
  row({
    shipmentId: 101,
    billOrBookNumber: 'QA-S6-LCL-A',
    revGroupId: 'RG-QA-S6',
    revGroupOrder: 1,
    revGroupMemberCount: 2,
    revenue: { cuoc: '60000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '60000' },
  }),
  row({
    shipmentId: 102,
    billOrBookNumber: 'QA-S6-LCL-B',
    revGroupId: 'RG-QA-S6',
    revGroupOrder: 2,
    revGroupMemberCount: 2,
    revenue: { cuoc: '60000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '60000' },
    chiHo: { csht: [{ invoiceNumber: 'HD-S6-01', amount: '12000', pending: true }], lift: [], drop: [], other: [] },
  }),
  row({ shipmentId: 103, billOrBookNumber: 'QA-S6-FCL-1' }),
  row({ shipmentId: 104, billOrBookNumber: 'QA-S6-FCL-2', revenue: { cuoc: '45000', lachHuyen: null, phuPhi: null, phatSinh: null, tong: '45000' } }),
];

function renderList(over: Partial<Parameters<typeof DebitMergeMobileList>[0]> = {}) {
  const onSelectionChange = vi.fn();
  const view = render(
    <DebitMergeMobileList
      rows={FIXTURE}
      selection={new Set<number>()}
      onSelectionChange={onSelectionChange}
      {...over}
    />,
  );
  return { view, onSelectionChange };
}

const card = (bill: string) => {
  const article = screen.getByText(bill).closest('article');
  expect(article).not.toBeNull();
  return within(article as HTMLElement);
};

describe('DebitMergeMobileList — UX-02 card face', () => {
  it('four-record fixture shows four bill ids on initial load', () => {
    renderList();
    const cards = screen.getAllByTestId('debit-merge-card');
    expect(cards).toHaveLength(4);
    const bills = cards.map((cardEl) => cardEl.querySelector('.debit-merge-card__bill')?.textContent);
    expect(bills).toEqual(['QA-S6-LCL-A', 'QA-S6-LCL-B', 'QA-S6-FCL-1', 'QA-S6-FCL-2']);
  });

  it('QA-S6-LCL-A/B: one card per bill, group total 120,000 ₫ across the pair, both selectable', () => {
    const { onSelectionChange } = renderList();
    // One card per BILL (never one per merged group) — the pair reads
    // 60.000 + 60.000 = 120.000 ₫ on its two cards.
    const cardA = card('QA-S6-LCL-A');
    const cardB = card('QA-S6-LCL-B');
    expect(cardA.getByText('60.000')).toBeTruthy();
    expect(cardB.getByText('60.000')).toBeTruthy();
    // Both stay individually selectable: one tap per card, each its own id.
    fireEvent.click(cardA.getByLabelText('Chọn lô QA-S6-LCL-A'));
    fireEvent.click(cardB.getByLabelText('Chọn lô QA-S6-LCL-B'));
    expect(onSelectionChange).toHaveBeenCalledWith(101, true);
    expect(onSelectionChange).toHaveBeenCalledWith(102, true);
  });

  it('selection parity: the shared Set drives the checkbox state (checked faces render checked)', () => {
    renderList({ selection: new Set([104]) });
    const cardD = card('QA-S6-FCL-2');
    expect((cardD.getByLabelText('Chọn lô QA-S6-FCL-2') as HTMLInputElement).checked).toBe(true);
    expect((card('QA-S6-LCL-A').getByLabelText('Chọn lô QA-S6-LCL-A') as HTMLInputElement).checked).toBe(false);
  });

  it('fee breakdowns live in an expandable detail per card (closed by default, pending line wears the red tone)', () => {
    renderList();
    // Closed by default: no fee rows anywhere.
    expect(screen.queryByText('Cước')).toBeNull();
    const cardB = card('QA-S6-LCL-B');
    fireEvent.click(cardB.getByRole('button', { name: 'Phí chi tiết' }));
    const detail = cardB.getByText('Cước').closest('dl');
    expect(detail).not.toBeNull();
    // The cước leaf + the pending chi-hộ invoice line, the money law's '—'
    // on the unknown leaves.
    expect(within(detail as HTMLElement).getByText('60.000')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('HD-S6-01')).toBeTruthy();
    expect(within(detail as HTMLElement).getByText('12.000').className).toContain('debit-merge-card__fee-value--pending');
    expect(within(detail as HTMLElement).getAllByText('—').length).toBeGreaterThanOrEqual(3);
    // Collapse removes the detail again.
    fireEvent.click(cardB.getByRole('button', { name: 'Ẩn phí' }));
    expect(cardB.queryByText('Cước')).toBeNull();
  });

  it('unknown money keeps the ghost face — never a fabricated 0', () => {
    renderList();
    const empty = card('QA-S6-FCL-1');
    expect(empty.getByText('—')).toBeTruthy();
    expect(empty.queryByText('0')).toBeNull();
  });

  it('empty result set renders the same refusal the desktop grid reads', () => {
    render(<DebitMergeMobileList rows={[]} selection={new Set()} onSelectionChange={vi.fn()} />);
    expect(screen.getByText('Không có lô nào khớp bộ lọc hiện tại.')).toBeTruthy();
  });
});
