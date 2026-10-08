import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsReconciliationReportRow } from '../../api/opsReconciliationReportClient';

const reportApi = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('../../api/opsReconciliationReportClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/opsReconciliationReportClient')>()),
  opsReconciliationReportClient: { report: reportApi.report },
}));
const expenseApi = vi.hoisted(() => ({ catalog: vi.fn(), reconciliations: vi.fn(), get: vi.fn() }));
vi.mock('../../api/expenseAccountingClient', () => ({ expenseAccountingClient: expenseApi }));
// The drawers are the existing engine surfaces this page composes; their
// internals have their own suites. Mocked here so the page test pins the page's
// own contract: which direction each sign opens, and that the wrong direction
// is never offered.
vi.mock('../../features/expense-accounting/ExpenseCashDrawer', () => ({ ExpenseCashDrawer: () => <div data-testid="thu-drawer" /> }));
vi.mock('../../features/expense-accounting/ExpenseVoucherDrawer', () => ({ ExpenseVoucherDrawer: () => <div data-testid="chi-drawer" /> }));

import OpsReconciliationReportPage from './OpsReconciliationReportPage';
import type { ExpenseReconciliation } from '@tingting/shared';

const TODAY = '2026-09-29';
// Remaining mocks follow the 2026-09-29 ruling: the number is the sổ quỹ
// closing formula (granted − consumed, floored per request), so it is ≥ 0 —
// > 0 the staff still holds unspent advance, 0 nothing left to settle.
const rowPositive: OpsReconciliationReportRow = {
  staffId: 5, staffName: 'NV A', dntt: 250000, advanced: 100000, remaining: 150000,
  direction: 'CTY_YEU_CAU_HOAN_TRA', note: 'Công ty yêu cầu nhân viên hoàn trả tạm ứng',
};
const rowSettled: OpsReconciliationReportRow = {
  staffId: 6, staffName: 'NV B', dntt: 120000, advanced: 120000, remaining: 0,
  direction: 'KHONG_CON_GI', note: 'Không còn chênh lệch',
};
const unscopedReport = {
  from: TODAY, to: TODAY, rows: [rowPositive, rowSettled],
  totals: { dntt: 370000, advanced: 220000, remaining: 150000 },
};
function scopedReport(row: OpsReconciliationReportRow, code: string) {
  return {
    from: TODAY, to: TODAY, reconciliation: { id: 7, code, from: '2026-09-28', to: TODAY },
    rows: [row], totals: { dntt: row.dntt, advanced: row.advanced, remaining: row.remaining },
  };
}
function mkLot(row: OpsReconciliationReportRow, remainingDifference: number): ExpenseReconciliation {
  return {
    id: 7, code: 'HU-QA-169', opsUserId: row.staffId, from: '2026-09-28', to: TODAY,
    amount: row.dntt, advanceAmount: row.advanced, initialDifference: remainingDifference,
    paidAmount: 0, refundedAmount: 0, remainingDifference,
    entries: [{ sourceKind: 'OPS', sourceId: 11, expectedVersion: 3 }],
    createdAt: TODAY, note: null, voidedAt: null,
  };
}

let currentLot: ExpenseReconciliation = mkLot(rowPositive, 150000);
const scopedCode = 'HU-QA-169';

function page(initialEntry = '/accounting/hoan-ung') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <OpsReconciliationReportPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  reportApi.report.mockReset();
  reportApi.report.mockImplementation((params: { reconciliationId?: number; opsUserId?: number } | undefined) => {
    if (params?.reconciliationId) {
      return Promise.resolve(scopedReport(currentLot.opsUserId === 6 ? rowSettled : rowPositive, scopedCode));
    }
    // The service narrows the monthly view to the staff filter server-side —
    // the mock mirrors that contract (card 20260928_168 seeds opsUserId from
    // the Sổ quỹ row link).
    const rows = params?.opsUserId ? unscopedReport.rows.filter(row => row.staffId === params.opsUserId) : unscopedReport.rows;
    return Promise.resolve({ ...unscopedReport, rows, totals: rows.length ? unscopedReport.totals : { dntt: 0, advanced: 0, remaining: 0 } });
  });
  expenseApi.catalog.mockReset().mockResolvedValue({
    staff: [], accountants: [], suppliers: [], expenseTypes: [], advances: [], pendingAdvances: [],
    opsUsers: [{ id: 5, name: 'NV A' }, { id: 6, name: 'NV B' }],
    accounts: [{ id: 3, name: 'ACB công ty', fundCode: 'COMPANY' as const }],
  });
  expenseApi.reconciliations.mockReset().mockImplementation(() => Promise.resolve({ items: [currentLot] }));
  expenseApi.get.mockReset().mockResolvedValue({
    id: 'OPS:11', sourceKind: 'OPS', sourceId: 11, feeName: 'card169 phí QA', amount: 250000,
    outstandingPayable: 150000, payerName: 'NV A',
  });
});

async function pickLot() {
  fireEvent.click(screen.getByRole('button', { name: /Đợt đối soát$/ }));
  // React Aria renders the listbox items on an effect after the trigger press —
  // the findBy retry gives that effect its tick (a synchronous getBy sees an
  // empty collection in jsdom).
  const option = await screen.findByRole('option', { name: /HU-QA-169/ });
  fireEvent.click(option);
}

describe('card 20260928_169 — báo cáo tổng hợp hoàn ứng', () => {
  it('renders the shared filter strip, the labeled remaining values and the totals rail', async () => {
    const { container } = page();
    await screen.findByText('NV A', { selector: 'td' });
    const bar = container.querySelector('.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('.date-range-fields')).toBeTruthy();
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lọc' })).toBeTruthy();
    // The remaining value is always labeled beside the amount — never a bare number.
    expect(screen.getAllByText('+150.000 ₫')).toBeTruthy();
    const positiveRow = screen.getByText('NV A', { selector: 'td' }).closest('tr')!;
    const remaining = positiveRow.querySelector('td[data-label="Còn phải hoàn ứng"]')!;
    expect(remaining.querySelector('.money')?.textContent).toBe('+150.000 ₫');
    const settledRow = screen.getByText('NV B', { selector: 'td' }).closest('tr')!;
    expect(settledRow.querySelector('td[data-label="Còn phải hoàn ứng"] .money')?.textContent).toBe('0 ₫');
    expect(screen.getByText('Công ty yêu cầu nhân viên hoàn trả tạm ứng')).toBeTruthy();
    expect(screen.getByText('Không còn chênh lệch')).toBeTruthy();
    expect(screen.getByText('Tổng còn phải hoàn ứng')).toBeTruthy();
    expect(reportApi.report).toHaveBeenCalledWith(expect.objectContaining({ from: undefined, to: undefined, reconciliationId: undefined, opsUserId: undefined }));
  });

  it('the unscoped monthly view offers no phiếu action', async () => {
    page();
    await screen.findByText('NV B', { selector: 'td' });
    expect(screen.queryByRole('button', { name: 'Lập phiếu chi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lập phiếu thu' })).not.toBeInTheDocument();
  });

  it('a đợt the company owes offers ONLY the phiếu chi action (AC3)', async () => {
    currentLot = mkLot(rowPositive, 150000);
    page();
    await pickLot();
    // The scope caption proves the report refetched scoped to the lot.
    await screen.findByText(/Đợt HU-QA-169/);
    await screen.findAllByText('+150.000 ₫');
    expect(screen.getByRole('button', { name: 'Lập phiếu chi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lập phiếu thu' })).not.toBeInTheDocument();
    await waitFor(() => expect(reportApi.report).toHaveBeenCalledWith(expect.objectContaining({ reconciliationId: 7 })));
  });

  it('a đợt that owes the company offers ONLY the phiếu thu action (AC3)', async () => {
    currentLot = mkLot(rowSettled, -200000);
    page();
    await screen.findByText('NV B', { selector: 'td' });
    await pickLot();
    await screen.findByText(/Đợt HU-QA-169/);
    await screen.findAllByText('0 ₫');
    expect(screen.getByRole('button', { name: 'Lập phiếu thu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lập phiếu chi' })).not.toBeInTheDocument();
  });

  it('a settled đợt offers no action at all', async () => {
    currentLot = mkLot(rowPositive, 0);
    page();
    await pickLot();
    await screen.findByText(/Đợt HU-QA-169/);
    expect(screen.queryByRole('button', { name: 'Lập phiếu chi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lập phiếu thu' })).not.toBeInTheDocument();
  });

  it('Lập phiếu chi loads the đợt entries and opens the voucher drawer; Lập phiếu thu opens the refund drawer', async () => {
    currentLot = mkLot(rowPositive, 150000);
    const first = page();
    await pickLot();
    await screen.findByText(/Đợt HU-QA-169/);
    fireEvent.click(await screen.findByRole('button', { name: 'Lập phiếu chi' }));
    expect(await screen.findByTestId('chi-drawer')).toBeTruthy();
    expect(expenseApi.get).toHaveBeenCalledWith({ sourceKind: 'OPS', sourceId: 11, expectedVersion: 3 });
    first.unmount();

    currentLot = mkLot(rowSettled, -200000);
    page();
    await screen.findByText('NV B', { selector: 'td' });
    await pickLot();
    await screen.findByText(/Đợt HU-QA-169/);
    fireEvent.click(await screen.findByRole('button', { name: 'Lập phiếu thu' }));
    expect(await screen.findByTestId('thu-drawer')).toBeTruthy();
  });

  // Card 20260928_168 AC4 — the Sổ quỹ's TÀI KHOẢN OPS row links here with
  // the same period and staff, so the converged number's phiếu flow starts
  // pre-scoped ("cùng một bộ lọc").
  it('seeds the staff and period from the URL (card 168 AC4)', async () => {
    const seededView = page('/accounting/hoan-ung?opsUserId=5&from=2026-09-01&to=2026-09-30');
    await screen.findByText('NV A', { selector: 'td' });
    await waitFor(() => expect(screen.queryByText('NV B', { selector: 'td' })).not.toBeInTheDocument());
    await waitFor(() => expect(reportApi.report).toHaveBeenCalledWith(expect.objectContaining({
      opsUserId: 5, from: '2026-09-01', to: '2026-09-30',
    })));
    seededView.unmount();
    // Garbage params never seed filters.
    reportApi.report.mockClear();
    page('/accounting/hoan-ung?opsUserId=abc&from=lộ-trở');
    await screen.findByText('NV A', { selector: 'td' });
    await waitFor(() => expect(reportApi.report).toHaveBeenCalledWith(expect.objectContaining({
      opsUserId: undefined, from: undefined, to: undefined,
    })));
  });
});
