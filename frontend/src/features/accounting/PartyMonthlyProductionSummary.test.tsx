/**
 * Card 380 — the /debt + /payables monthly production summary composition.
 *
 * Pins: spec column groups, the còn-nợ reconciliation against the page's own
 * ledger numbers (the same endpoint/field the page prints as Tổng nợ), the
 * Lập Phiếu disabled state with its gap reason, the month totals band
 * (money + VAT gap) and the calendar-month period default.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPhoiPhieuReport = vi.hoisted(() => vi.fn());
const getCustomerAging = vi.hoisted(() => vi.fn());
const getPayablesSummary = vi.hoisted(() => vi.fn());
const listSettlementRounds = vi.hoisted(() => vi.fn());
const authRole = vi.hoisted(() => ({ role: 'ACCOUNTANT' as string | undefined }));

vi.mock('../../api/phoiPhieuClient', () => ({
  getPhoiPhieuReport: (...args: unknown[]) => getPhoiPhieuReport(...args),
}));

vi.mock('../../api/accountingDebitClient', () => ({
  DEBIT_SETTLEMENT_ROUNDS_KEY: [['accounting-debit-settlement-rounds']] as const,
  listSettlementRounds: (...args: unknown[]) => listSettlementRounds(...args),
}));

vi.mock('../../api/financialClient', () => ({
  financialClient: {
    getCustomerAging: (...args: unknown[]) => getCustomerAging(...args),
    getPayablesSummary: (...args: unknown[]) => getPayablesSummary(...args),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { userId: 7, role: authRole.role } }),
}));

import {
  PartyMonthlyProductionSummary,
  calendarMonthBounds,
} from './PartyMonthlyProductionSummary';

type ReportRowFixture = {
  party: string;
  partyShortName?: string | null;
  partyId?: number | null;
  partyKind?: 'customer' | 'carrier' | 'vendor' | null;
  soLuong: number;
  tongPhaiThuTra: number;
  daThuTra: number;
  conLai: number;
};

function reportRow(party: string, over: Partial<ReportRowFixture> = {}): ReportRowFixture {
  return {
    party,
    partyShortName: null,
    partyId: null,
    partyKind: null,
    soLuong: 0,
    tongPhaiThuTra: 0,
    daThuTra: 0,
    conLai: 0,
    ...over,
  };
}

const thuEnvelope = {
  rows: [
    reportRow('Công ty A', { soLuong: 8, tongPhaiThuTra: 41_000_000, daThuTra: 12_000_000, conLai: 29_000_000 }),
    reportRow('Chủ xe B', { soLuong: 3, tongPhaiThuTra: 15_800_000, daThuTra: 0, conLai: 15_800_000 }),
  ],
  grand: reportRow('TỔNG CỘNG', { soLuong: 11, tongPhaiThuTra: 56_800_000, daThuTra: 12_000_000, conLai: 44_800_000 }),
};

const traEnvelope = {
  rows: [
    reportRow('Chủ xe B', { soLuong: 2, tongPhaiThuTra: 6_800_000, daThuTra: 0, conLai: 6_800_000 }),
    reportRow('NCC Xe', { soLuong: 5, tongPhaiThuTra: 24_500_000, daThuTra: 2_000_000, conLai: 22_500_000 }),
  ],
  grand: reportRow('TỔNG CỘNG', { soLuong: 7, tongPhaiThuTra: 31_300_000, daThuTra: 2_000_000, conLai: 29_300_000 }),
};

// The ledger values the host page itself renders as Tổng nợ — the còn-nợ
// column must print exactly these numbers for the same party names.
// customerIds sit in a range the base (id-less) report fixtures never hit, so
// the base tests keep exercising the NAME fallback tier.
const agingEnvelope = {
  customers: [
    { customerId: 901, customerName: 'Công ty A', totalOutstanding: 12_000_000 },
    { customerId: 902, customerName: 'Chủ xe B', totalOutstanding: 8_000_000 },
  ],
};

const payablesEnvelope = {
  items: [
    { supplier: { id: 903, name: 'NCC Xe' }, kind: 'vendor', totalOutstanding: 30_000_000 },
    { supplier: { id: 904, name: 'Chủ xe B' }, kind: 'vendor', totalOutstanding: 8_000_000 },
  ],
};

function renderSummary(variant: 'receivable' | 'payable' = 'receivable') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartyMonthlyProductionSummary variant={variant} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPhoiPhieuReport.mockReset();
  getCustomerAging.mockReset();
  getPayablesSummary.mockReset();
  listSettlementRounds.mockReset();
  authRole.role = 'ACCOUNTANT';
  getPhoiPhieuReport.mockImplementation((kind: string) => {
    if (kind === 'THU') return Promise.resolve(thuEnvelope);
    return Promise.resolve(traEnvelope);
  });
  getCustomerAging.mockResolvedValue(agingEnvelope);
  getPayablesSummary.mockResolvedValue(payablesEnvelope);
  listSettlementRounds.mockResolvedValue({ items: [] });
});

describe('PartyMonthlyProductionSummary', () => {
  it('renders the spec column groups and gap columns', async () => {
    renderSummary();
    const table = await screen.findByRole('table');
    expect(screen.getAllByRole('columnheader', { name: 'Phải thu' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('columnheader', { name: 'Phải trả' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('columnheader', { name: 'Tồn cuối kỳ' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Đã thanh toán' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Còn nợ' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Số ĐNTT' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '% thuế · HĐ · số CT/ngày' })).toBeTruthy();
    // Named-gap columns render the house dash, never an accidental blank.
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('reconciles còn nợ with the page ledger and defaults absent parties to 0', async () => {
    renderSummary('receivable');
    await screen.findByText('Công ty A');

    expect(getCustomerAging).toHaveBeenCalledWith({ page: 1, limit: 500 });
    const table = screen.getByRole('table');
    // The còn-nợ CELL itself (data-label pins it, whatever else repeats in the
    // row) must equal the page ledger's totalOutstanding for that party.
    const conNoCellOf = (row: HTMLElement | null) =>
      row?.querySelector('td[data-label="Còn nợ"]')?.textContent ?? '';
    const rowA = within(table).getByText('Công ty A').closest('tr');
    expect(conNoCellOf(rowA as HTMLElement)).toBe('12.000.000 ₫');
    const rowB = within(table).getByText('Chủ xe B').closest('tr');
    expect(conNoCellOf(rowB as HTMLElement)).toBe('8.000.000 ₫');
    // A party with no ledger row (≤ 0 balance, absent from the aging surface)
    // reads as the computed 0 — nothing left to settle.
    const rowX = within(table).getByText('NCC Xe').closest('tr');
    expect(conNoCellOf(rowX as HTMLElement)).toBe('0 ₫');
  });

  it('reconciles còn nợ from the payables ledger on the payable variant', async () => {
    renderSummary('payable');
    await screen.findByText('NCC Xe');

    expect(getPayablesSummary).toHaveBeenCalledWith({ page: 1, limit: 500 });
    expect(getCustomerAging).not.toHaveBeenCalled();
    const table = screen.getByRole('table');
    const conNoCellOf = (row: HTMLElement | null) =>
      row?.querySelector('td[data-label="Còn nợ"]')?.textContent ?? '';
    const rowX = within(table).getByText('NCC Xe').closest('tr');
    expect(conNoCellOf(rowX as HTMLElement)).toBe('30.000.000 ₫');
  });

  it('renders Lập Phiếu disabled with the gap reason', async () => {
    renderSummary();
    await screen.findAllByRole('button', { name: /Lập phiếu cho/ });
    for (const button of screen.getAllByRole('button', { name: /Lập phiếu cho/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('title')).toContain('chưa có');
    }
  });

  it('totals the month from the reports grand row and names the VAT gap', async () => {
    renderSummary();
    const table = await screen.findByRole('table');
    const foot = within(table.querySelector('tfoot') as HTMLElement);
    expect(foot.getAllByText('56.800.000 ₫').length).toBeGreaterThanOrEqual(1);
    expect(foot.getAllByText('31.300.000 ₫').length).toBeGreaterThanOrEqual(1);
    // Còn nợ total = 12M + 8M + 0 (the absent party).
    expect(foot.getAllByText('20.000.000 ₫').length).toBeGreaterThanOrEqual(1);
    expect(foot.getAllByText('VAT: —').length).toBeGreaterThanOrEqual(1);
    const vatNote = screen.getByText(/Tổng hợp công nợ theo tháng/);
    expect(vatNote.textContent).toContain('VAT: —');
    expect(vatNote.textContent).toContain('chưa có đợt chốt công nợ trong kỳ');
  });

  it('card 051026231555: the period VAT line totals the recorded chốt-debit rounds', async () => {
    const bounds = calendarMonthBounds();
    const periodKey = bounds.from.slice(0, 7);
    listSettlementRounds.mockResolvedValue({
      items: [
        { id: 1, periodKey, direction: 'THU', amount: 570000, vatRate: 8 },
        { id: 2, periodKey, direction: 'TRA', amount: 570000, vatRate: 8 },
      ],
    });
    renderSummary();
    const table = await screen.findByRole('table');
    const foot = within(table.querySelector('tfoot') as HTMLElement);
    // 570.000 × 8% on each side → 45.600 + 45.600 = 91.200.
    expect(foot.getAllByText('VAT: 91.200 ₫').length).toBeGreaterThanOrEqual(1);
    const vatNote = screen.getByText(/Tổng hợp công nợ theo tháng/);
    expect(vatNote.textContent).toContain('VAT: 91.200 ₫');
    expect(vatNote.textContent).toContain('thu: 45.600 ₫');
    expect(vatNote.textContent).toContain('trả: 45.600 ₫');
  });

  it('keeps the honest dash when the rounds readout itself fails', async () => {
    listSettlementRounds.mockRejectedValue(new Error('rounds endpoint down'));
    renderSummary();
    const table = await screen.findByRole('table');
    const foot = within(table.querySelector('tfoot') as HTMLElement);
    expect(foot.getAllByText('VAT: —').length).toBeGreaterThanOrEqual(1);
    const vatNote = screen.getByText(/Tổng hợp công nợ theo tháng/);
    expect(vatNote.textContent).toContain('VAT: —');
  });

  it('defaults the period to the current calendar month', async () => {
    renderSummary();
    await screen.findByText('Công ty A');
    const bounds = calendarMonthBounds();
    expect(getPhoiPhieuReport).toHaveBeenCalledWith('THU', { dateFrom: bounds.from, dateTo: bounds.to });
    expect(getPhoiPhieuReport).toHaveBeenCalledWith('TRA', { dateFrom: bounds.from, dateTo: bounds.to });
    const fromInput = screen.getByLabelText('Tổng hợp sản lượng từ ngày') as HTMLInputElement;
    const toInput = screen.getByLabelText('Tổng hợp sản lượng đến ngày') as HTMLInputElement;
    expect(fromInput.value).toBe(bounds.from);
    expect(toInput.value).toBe(bounds.to);
  });

  it('hides the section for roles the period report would 403', async () => {
    authRole.role = 'OPS';
    const { container } = renderSummary();
    await waitFor(() => expect(getPhoiPhieuReport).not.toHaveBeenCalled());
    expect(container.querySelector('.pm-summary')).toBeNull();
  });
});

/* ─── Card 201026095604b — short display names ride an ID-first ledger join ──
 * The party column moves to the wire's own partyShortName (never a string
 * derivation), while the Còn-nợ reconciliation joins by entity ID (aging
 * customerId / payables supplier.id scoped by kind) with the legacy name only
 * as the fallback tier — so a shortened label or a duplicate display string
 * can no longer mis-join the aging/payables numbers. */
describe('PartyMonthlyProductionSummary — short names + ID-first join (card 201026095604b)', () => {
  const conNoCellOf = (row: HTMLElement | null) =>
    row?.querySelector('td[data-label="Còn nợ"]')?.textContent ?? '';
  const partyCell = (table: HTMLElement, label: string) =>
    within(table).getByText(label).closest('tr');

  it('shows the operational short name and keeps the full name one tooltip away', async () => {
    getPhoiPhieuReport.mockImplementation((kind: string) => kind === 'THU'
      ? { rows: [reportRow('CÔNG TY TNHH MTV LONG MINH', { partyShortName: 'LONG MINH', partyId: 12, partyKind: 'customer', soLuong: 2, tongPhaiThuTra: 41_000_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 2, tongPhaiThuTra: 41_000_000 }) }
      : { rows: [], grand: reportRow('TỔNG CỘNG') });
    getCustomerAging.mockResolvedValue({ customers: [{ customerId: 12, customerName: 'CÔNG TY TNHH MTV LONG MINH', totalOutstanding: 15_500_000 }] });
    renderSummary('receivable');
    const table = await screen.findByRole('table');
    const cell = within(table).getByText('LONG MINH');
    expect(cell.tagName).toBe('TD');
    expect(cell.getAttribute('title')).toBe('CÔNG TY TNHH MTV LONG MINH');
    expect(conNoCellOf(cell.closest('tr') as HTMLElement)).toBe('15.500.000 ₫');
  });

  it('joins by ID even when the aging display name disagrees, and a same-named different party cannot steal it', async () => {
    getPhoiPhieuReport.mockImplementation((kind: string) => kind === 'THU'
      ? { rows: [reportRow('CÔNG TY TNHH MTV LONG MINH', { partyShortName: 'LONG MINH', partyId: 12, partyKind: 'customer', soLuong: 1, tongPhaiThuTra: 10_000_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 1, tongPhaiThuTra: 10_000_000 }) }
      : { rows: [], grand: reportRow('TỔNG CỘNG') });
    // Aging shows a DIFFERENT display name for id 12 (renamed since the trips
    // ran), plus a different customer that happens to carry the report's
    // legacy full label — the name tier would pick the wrong one.
    getCustomerAging.mockResolvedValue({ customers: [
      { customerId: 12, customerName: 'LONG MINH (mới)', totalOutstanding: 15_500_000 },
      { customerId: 40, customerName: 'CÔNG TY TNHH MTV LONG MINH', totalOutstanding: 1_000_000 },
    ] });
    renderSummary('receivable');
    const table = await screen.findByRole('table');
    expect(conNoCellOf(partyCell(table, 'LONG MINH') as HTMLElement)).toBe('15.500.000 ₫');
  });

  it('scopes the payable join by the payables kind branch (carrier ids ≠ vendor ids)', async () => {
    getPhoiPhieuReport.mockImplementation((kind: string) => kind === 'TRA'
      ? { rows: [reportRow('LONG MINH', { partyShortName: 'LONG MINH', partyId: 7, partyKind: 'carrier', soLuong: 3, tongPhaiThuTra: 24_500_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 3, tongPhaiThuTra: 24_500_000 }) }
      : { rows: [], grand: reportRow('TỔNG CỘNG') });
    // A vendor with the SAME numeric id and the SAME display name must lose to
    // the kind-scoped carrier:7 row.
    getPayablesSummary.mockResolvedValue({ items: [
      { supplier: { id: 7, name: 'LONG MINH' }, kind: 'carrier', totalOutstanding: 9_000_000 },
      { supplier: { id: 99, name: 'LONG MINH' }, kind: 'vendor', totalOutstanding: 2_000_000 },
    ] });
    renderSummary('payable');
    const table = await screen.findByRole('table');
    expect(conNoCellOf(partyCell(table, 'LONG MINH') as HTMLElement)).toBe('9.000.000 ₫');
  });

  it('merges a dual-role party into ONE row when both sides resolve the same customers.id', async () => {
    getPhoiPhieuReport.mockImplementation((kind: string) => kind === 'THU'
      ? { rows: [reportRow('CÔNG TY TNHH ABC', { partyShortName: 'ABC', partyId: 55, partyKind: 'customer', soLuong: 4, tongPhaiThuTra: 20_000_000, daThuTra: 5_000_000, conLai: 15_000_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 4, tongPhaiThuTra: 20_000_000 }) }
      : { rows: [reportRow('ABC', { partyShortName: 'ABC', partyId: 55, partyKind: 'carrier', soLuong: 2, tongPhaiThuTra: 6_000_000, conLai: 6_000_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 2, tongPhaiThuTra: 6_000_000 }) });
    getCustomerAging.mockResolvedValue({ customers: [{ customerId: 55, customerName: 'CÔNG TY TNHH ABC', totalOutstanding: 4_400_000 }] });
    getPayablesSummary.mockResolvedValue({ items: [{ supplier: { id: 55, name: 'ABC' }, kind: 'carrier', totalOutstanding: 3_300_000 }] });
    renderSummary('receivable');
    const table = await screen.findByRole('table');
    // ONE "ABC" row (the old name-join would have printed two: full + short).
    const abcCells = within(table).getAllByText('ABC');
    expect(abcCells.length).toBe(1);
    const row = abcCells[0]!.closest('tr') as HTMLElement;
    expect(row.querySelector('td[data-label="Phải thu SL"]')?.textContent).toBe('4');
    expect(row.querySelector('td[data-label="Phải trả SL"]')?.textContent).toBe('2');
    // Receivable variant reconciles through the customer id space.
    expect(conNoCellOf(row)).toBe('4.400.000 ₫');
  });

  it('keeps the name fallback for id-less rows (unknown bucket, internal fleet)', async () => {
    getPhoiPhieuReport.mockImplementation((kind: string) => kind === 'TRA'
      ? { rows: [reportRow('XE NHÀ — SILVER SEA', { soLuong: 6, tongPhaiThuTra: 18_000_000 })], grand: reportRow('TỔNG CỘNG', { soLuong: 6, tongPhaiThuTra: 18_000_000 }) }
      : { rows: [], grand: reportRow('TỔNG CỘNG') });
    getPayablesSummary.mockResolvedValue({ items: [{ supplier: { id: 1, name: 'XE NHÀ — SILVER SEA' }, kind: 'vendor', totalOutstanding: 18_000_000 }] });
    renderSummary('payable');
    const table = await screen.findByRole('table');
    expect(conNoCellOf(partyCell(table, 'XE NHÀ — SILVER SEA') as HTMLElement)).toBe('18.000.000 ₫');
  });
});

