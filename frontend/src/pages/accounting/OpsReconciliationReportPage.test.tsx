import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// internals have their own suites. Mocked here so the page test pins the
// page's own contract: which direction each sign opens, and that the wrong
// direction is never offered. The props spy lets the SIL-728 recovery pin
// assert WHAT the page hands the drawer (staff + deficit) without rebuilding
// the money form here.
const drawerCapture = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('../../features/expense-accounting/ExpenseCashDrawer', () => ({ ExpenseCashDrawer: (props: Record<string, unknown>) => { drawerCapture.last = props; return <div data-testid={props.recovery ? 'recovery-drawer' : 'thu-drawer'} />; } }));
vi.mock('../../features/expense-accounting/ExpenseVoucherDrawer', () => ({ ExpenseVoucherDrawer: () => <div data-testid="chi-drawer" /> }));
// SIL-728 — the row's settlement-dialog branch is role-gated (SIL-487 law:
// ADMIN/ACCOUNTANT create, MANAGER reads) and the dialog reads the advances
// workspace through useForwarderQueries.
const authState = vi.hoisted(() => ({ role: 'ACCOUNTANT' as string | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authState.role ? { userId: 9, role: authState.role } : null }) }));
const forwarderApi = vi.hoisted(() => ({ balances: vi.fn(), eligibility: vi.fn() }));
vi.mock('../../hooks/useForwarderQueries', () => ({
  useAdminAdvanceBalances: () => ({ data: forwarderApi.balances() }),
  useAdminSettlementEligibility: (forwarderId: number | null) => forwarderApi.eligibility(forwarderId),
  useCreateAdvanceSettlementForForwarder: () => ({ mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), error: null }),
}));

import OpsReconciliationReportPage from './OpsReconciliationReportPage';
import type { ExpenseReconciliation } from '@tingting/shared';

const TODAY = '2026-09-29';
// Remaining mocks follow the 2026-09-29 ruling: the number is the sổ quỹ
// closing formula (granted − consumed, floored per request), so it is ≥ 0 —
// > 0 the staff still holds unspent advance, 0 nothing left to settle.
const rowPositive: OpsReconciliationReportRow = {
  staffId: 5, staffName: 'NV A', dntt: 250000, advanced: 100000, advancedRecorded: 100000, remaining: 150000,
  remainingSigned: 150000, outstandingSigned: 150000, needsCollection: false,
  direction: 'CTY_YEU_CAU_HOAN_TRA', note: 'Công ty yêu cầu nhân viên hoàn trả tạm ứng',
};
const rowSettled: OpsReconciliationReportRow = {
  staffId: 6, staffName: 'NV B', dntt: 120000, advanced: 120000, advancedRecorded: 120000, remaining: 0,
  remainingSigned: 0, outstandingSigned: 0, needsCollection: false,
  direction: 'KHONG_CON_GI', note: 'Không còn chênh lệch',
};
// Số âm: ĐNTT − ĐÃ ỨNG = 300.000 − 500.000 — tiền ứng vượt chi phí và nhân
// viên vẫn còn nắm tiền đã cấp, nên đề nghị thu tiền ứng.
const rowCollection: OpsReconciliationReportRow = {
  staffId: 9, staffName: 'NV C', dntt: 300000, advanced: 500000, advancedRecorded: 500000, remaining: 500000,
  remainingSigned: -200000, outstandingSigned: 500000, needsCollection: true,
  direction: 'CTY_YEU_CAU_THU_TIEN_UNG', note: 'Đề nghị thu tiền ứng',
};
const unscopedReport = {
  from: TODAY, to: TODAY, rows: [rowPositive, rowSettled],
  totals: { dntt: 370000, advanced: 220000, advancedRecorded: 220000, remaining: 150000, remainingSigned: 150000 },
};
function scopedReport(row: OpsReconciliationReportRow, code: string) {
  return {
    from: TODAY, to: TODAY, reconciliation: { id: 7, code, from: '2026-09-28', to: TODAY },
    rows: [row], totals: { dntt: row.dntt, advanced: row.advanced, advancedRecorded: row.advancedRecorded, remaining: row.remaining, remainingSigned: row.remainingSigned },
  };
}
function mkLot(row: OpsReconciliationReportRow, remainingDifference: number): ExpenseReconciliation {
  return {
    id: 7, code: 'HU-QA-169', opsUserId: row.staffId, from: '2026-09-28', to: TODAY,
    amount: row.dntt, advanceAmount: row.advanced, initialDifference: remainingDifference,
    paidAmount: 0, refundedAmount: 0, remainingDifference,
    refundSettledAt: null, refundSettledByName: null,
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
    return Promise.resolve({ ...unscopedReport, rows, totals: rows.length ? unscopedReport.totals : { dntt: 0, advanced: 0, advancedRecorded: 0, remaining: 0, remainingSigned: 0 } });
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

  it('a row with a negative difference shows the signed amount and the collection warning', async () => {
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY, rows: [rowCollection],
      totals: { dntt: 300000, advanced: 500000, advancedRecorded: 500000, remaining: 500000, remainingSigned: -200000 },
    });
    page();
    await screen.findByText('NV C', { selector: 'td' });
    const row = screen.getByText('NV C', { selector: 'td' }).closest('tr')!;
    // Card 141026230770 — "Còn phải hoàn ứng" CHÍNH LÀ cột có dấu: âm hiện
    // −200.000 ₫ (không ép về 0 và không cột trùng nào khác).
    expect(row.querySelector('td[data-label="Còn phải hoàn ứng"] .money')?.textContent).toBe('−200.000 ₫');
    expect(screen.getByText('ÂM — đề nghị thu lại tiền ứng')).toBeTruthy();
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

  it('Lập phiếu chi loads the đợt entries and opens the voucher drawer; Lập phiếu thu opens the refund drawer', { timeout: 15000 }, async () => {
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

// ── SIL-728 — "Xác nhận hoàn ứng" staff-level trên dòng ÂM ─────────────────
// A negative WALLET balance (outstandingSigned < 0) rides the advance-recovery
// drawer (bút toán Quỹ công ty + Idempotency-Key). A report-âm row whose
// wallet is settled (outstandingSigned ≥ 0 — QA fail 09/11: Vũ Đình Cường
// −4.300.000₫ hiển thị nhưng không có nút nào) opens the SAME "Lập phiếu hoàn
// ứng" dialog the /advances tab uses, prefilled with the row's staff — the
// legacy settlement phiếu family the advance requests settle through.
// Role law mirrors /advances (SIL-487): ADMIN/ACCOUNTANT create, MANAGER reads.
const rowDeficit: OpsReconciliationReportRow = {
  staffId: 12, staffName: 'Vũ Đình Cường', dntt: 0, advanced: 4300000, advancedRecorded: 4300000, remaining: 0,
  remainingSigned: 0, outstandingSigned: -4300000, needsCollection: true,
  direction: 'CTY_YEU_CAU_THU_TIEN_UNG', note: 'Đề nghị thu tiền ứng',
};
const rowReportNegativeSettledWallet: OpsReconciliationReportRow = {
  staffId: 8, staffName: 'Vũ Đình Cường', dntt: 700000, advanced: 5000000, advancedRecorded: 5000000, remaining: 0,
  remainingSigned: -4300000, outstandingSigned: 0, needsCollection: false,
  direction: 'CTY_YEU_CAU_THU_TIEN_UNG', note: 'Đề nghị thu tiền ứng',
};

describe('OpsReconciliationReportPage — Lập phiếu hoàn ứng (SIL-728)', () => {
  beforeEach(() => {
    authState.role = 'ACCOUNTANT';
    forwarderApi.balances.mockReset().mockReturnValue({
      items: [{ forwarderId: 8, name: 'Vũ Đình Cường', outstanding: '0' }],
    });
    forwarderApi.eligibility.mockReset().mockReturnValue({
      data: { advances: [], expenses: [] }, isPending: false, isError: false, error: null,
    });
  });

  it('a wallet-deficit row offers the recovery action in ANY filter state and hands the drawer the deficit', async () => {
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY, rows: [rowDeficit],
      totals: { dntt: 0, advanced: 4300000, advancedRecorded: 4300000, remaining: 0, remainingSigned: 0 },
    });
    page();
    await screen.findByText('Vũ Đình Cường', { selector: 'td' });
    // No đợt filter is set — the action is still on the row. (SIL-827: the
    // header carries its own same-named button now — this click is row-scoped.)
    const deficitRow = screen.getByText('Vũ Đình Cường', { selector: 'td' }).closest('tr')!;
    fireEvent.click(within(deficitRow).getByRole('button', { name: 'Lập phiếu hoàn ứng' }));
    expect(await screen.findByTestId('recovery-drawer')).toBeTruthy();
    expect(drawerCapture.last?.recovery).toMatchObject({ opsUserId: 12, staffName: 'Vũ Đình Cường', deficit: 4300000 });
  });

  it('a report-âm row with a settled wallet opens the /advances settlement dialog prefilled with the row staff', async () => {
    // The exact QA repro: −4.300.000₫ hiển thị, wallet đã tất toán qua phiếu
    // legacy (outstandingSigned = 0) — recovery would 409, the row rides the
    // settlement phiếu family instead.
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY, rows: [rowReportNegativeSettledWallet],
      totals: { dntt: 700000, advanced: 5000000, advancedRecorded: 5000000, remaining: 0, remainingSigned: -4300000 },
    });
    page();
    await screen.findByText('Vũ Đình Cường', { selector: 'td' });
    const negativeRow = screen.getByText('Vũ Đình Cường', { selector: 'td' }).closest('tr')!;
    fireEvent.click(within(negativeRow).getByRole('button', { name: 'Lập phiếu hoàn ứng' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lập phiếu hoàn ứng cho nhân viên' });
    expect(dialog).toBeTruthy();
    expect(forwarderApi.eligibility).toHaveBeenCalledWith(8);
    // The row's staff arrives PRESELECTED — one click from the phiếu.
    expect(screen.getByRole('radio', { name: /Vũ Đình Cường/ })).toBeChecked();
    // The drawer the backend would refuse is NOT opened.
    expect(screen.queryByTestId('recovery-drawer')).not.toBeInTheDocument();
  });

  it('a row holding granted money (outstandingSigned ≥ 0, report dương) offers nothing', async () => {
    // rowCollection: needsCollection=true through the remainingSigned arm, but
    // the staff wallet is POSITIVE (+500.000) and the report row is Dương
    // (+150.000 hiển thị ở bộ other) — neither collection path applies.
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY, rows: [{ ...rowCollection, remainingSigned: 150000 }],
      totals: { dntt: 300000, advanced: 500000, advancedRecorded: 500000, remaining: 500000, remainingSigned: 150000 },
    });
    page();
    await screen.findByText('NV C', { selector: 'td' });
    const heldRow = screen.getByText('NV C', { selector: 'td' }).closest('tr')!;
    // Row-scoped (SIL-827): the header button legitimately exists for
    // ACCOUNTANT — the row itself must still offer nothing.
    expect(within(heldRow).queryByRole('button', { name: 'Lập phiếu hoàn ứng' })).not.toBeInTheDocument();
    expect(screen.getByText('ÂM — đề nghị thu lại tiền ứng')).toBeTruthy();
  });

  it('MANAGER reads the report but never sees the settlement affordance', async () => {
    authState.role = 'MANAGER';
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY, rows: [rowReportNegativeSettledWallet],
      totals: { dntt: 700000, advanced: 5000000, advancedRecorded: 5000000, remaining: 0, remainingSigned: -4300000 },
    });
    page();
    await screen.findByText('Vũ Đình Cường', { selector: 'td' });
    expect(screen.queryByRole('button', { name: 'Lập phiếu hoàn ứng' })).not.toBeInTheDocument();
  });
});

// ── SIL-827 — nút [Lập phiếu hoàn ứng] trên CHÍNH tab Báo cáo ───────────────
// SIL-728 AC1: the button lives on BOTH surfaces — the Phiếu hoàn ứng tab has
// had the header button since SIL-487, this tab only had row actions. Same
// role law (ADMIN/ACCOUNTANT create; MANAGER reads), same dialog, opened with
// NO preselected staff (the accountant picks the nhân viên themselves).
describe('OpsReconciliationReportPage — nút Lập phiếu hoàn ứng trên tab Báo cáo (SIL-827)', () => {
  beforeEach(() => {
    authState.role = 'ACCOUNTANT';
    forwarderApi.balances.mockReset().mockReturnValue({
      items: [{ forwarderId: 5, name: 'NV A', outstanding: '150000' }],
    });
    forwarderApi.eligibility.mockReset().mockReturnValue({
      data: { advances: [], expenses: [] }, isPending: false, isError: false, error: null,
    });
  });

  it('ACCOUNTANT sees the header button beside the filters and it opens the settlement dialog with no staff preselected', async () => {
    page();
    await screen.findByText('NV A', { selector: 'td' });
    const headerButton = screen.getByRole('button', { name: 'Lập phiếu hoàn ứng' });
    expect(headerButton.className).toContain('btn--primary');
    fireEvent.click(headerButton);
    const dialog = await screen.findByRole('dialog', { name: 'Lập phiếu hoàn ứng cho nhân viên' });
    expect(dialog).toBeTruthy();
    // No row was clicked: eligibility runs against null (no preselected
    // staff) — the accountant picks the nhân viên inside the dialog.
    expect(forwarderApi.eligibility).toHaveBeenCalledWith(null);
    expect(forwarderApi.eligibility).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it('MANAGER never sees the header button (SIL-487 read-only law)', async () => {
    authState.role = 'MANAGER';
    page();
    await screen.findByText('NV A', { selector: 'td' });
    expect(screen.queryByRole('button', { name: 'Lập phiếu hoàn ứng' })).not.toBeInTheDocument();
  });
});

// ── SIL-839 — SỐ TIỀN ĐÃ ỨNG khớp 100% giữa /advances và Quỹ cá nhân ────────
// The exact QA repro (CR-008 Task 1.2): the staff's held advances net to 0
// through the legacy settlement phiếu, but the gross (Đã ghi nhận)
// disbursements exist — Quỹ cá nhân (/accounting/hoan-ung) shows 320.000₫
// while this tab's rail + column read the netted field and showed 0₫. Both
// surfaces now read ONE shared backend number: advancedRecorded.
describe('OpsReconciliationReportPage — ĐÃ ỨNG đọc số GỐC đã ghi nhận (SIL-839)', () => {
  it('the rail total and the row column show the recorded disbursements, not the netted held', async () => {
    // advanced = 0 (fully netted by legacy settlements) — the old display
    // read this field and rendered 0₫ everywhere.
    reportApi.report.mockResolvedValue({
      from: TODAY, to: TODAY,
      rows: [{ ...rowPositive, advanced: 0, advancedRecorded: 320000, dntt: 250000, remainingSigned: 250000 }],
      totals: { dntt: 250000, advanced: 0, advancedRecorded: 320000, remaining: 0, remainingSigned: 250000 },
    });
    page();
    await screen.findByText('NV A', { selector: 'td' });
    // Rail: 'Tổng số tiền đã ứng' = the recorded gross — the SAME number the
    // Quỹ cá nhân table renders for this staff (khớp 100%).
    const rail = screen.getByText('Tổng số tiền đã ứng').closest('div,li,section') ?? document.body;
    expect(rail.textContent).toContain('320.000 ₫');
    // Row column 'Số tiền đã ứng' = the same shared field.
    const row = screen.getByText('NV A', { selector: 'td' }).closest('tr')!;
    expect(row.querySelector('td[data-label="Số tiền đã ứng"] .money')?.textContent).toBe('320.000 ₫');
  });
});
