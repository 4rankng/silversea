import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountingTransportRegisterRow } from '@tingting/shared';
import { AccountingTransportRegister } from './AccountingTransportRegister';
import { confirmRateAdjustments, withdrawRateAdjustments } from '../../api/accountingDebitClient';

/** K6.41 — the 'Đối chiếu vận tải' tab must carry the reconciliation strip the
 *  chốt debit screen has: the four counts (Lô trong kỳ / Chưa đối soát / Chờ
 *  xác nhận / Đã đối soát), the [Đối soát]/[Hoàn tác] pair acting on the
 *  selected rows' live PENDING rate-adjustment requests, and a 'Cột hiển thị'
 *  picker that lists the register's columns. */

vi.mock('../../api/accountingDebitClient', () => ({
  confirmRateAdjustments: vi.fn(() => Promise.resolve({ confirmed: 1 })),
  withdrawRateAdjustments: vi.fn(() => Promise.resolve({ withdrawn: 1 })),
}));

const row = (over: Partial<AccountingTransportRegisterRow> = {}): AccountingTransportRegisterRow => ({
  financialPostingId: over.tripId ?? 1,
  financialPostingVersion: 1,
  financialPostingEffectiveAt: '2026-08-01T00:00:00.000Z',
  tripId: 1,
  tripCode: 'C-001',
  completionDate: '2026-08-01',
  customerId: 5,
  customerName: 'Silver Sea',
  carrierId: null,
  carrierName: null,
  ownership: 'OWN',
  shipmentId: 8,
  shipmentCode: 'S-008',
  routeId: 2,
  routeName: 'Cát Lái - Long An',
  factoryName: null,
  containerNumbers: ['TGHU1234567'],
  containerTypes: ['40HC'],
  plateNumber: '51D-123.45',
  revenue: '40000000',
  directCost: '25000000',
  carrierPayable: '0',
  profit: '15000000',
  readiness: {
    status: 'READY',
    acceptedPodSubmissionId: 11,
    acceptedPodVersion: 2,
    acceptedPodAt: '2026-08-01T00:00:00.000Z',
    profitabilitySnapshotId: 17,
    evidence: ['COMPLETED_TRIP'],
  },
  adjustment: { status: 'NONE', requestId: null, requestedAt: null, confirmedAt: null },
  ...over,
});

const missingReadiness = {
  status: 'MISSING_ACCEPTED_POD',
  acceptedPodSubmissionId: null,
  acceptedPodVersion: null,
  acceptedPodAt: null,
  profitabilitySnapshotId: null,
  evidence: [] as string[],
} as const;

const pendingAdjustment = {
  status: 'PENDING',
  requestId: 42,
  requestedAt: '2026-08-01T01:00:00.000Z',
  confirmedAt: null,
} as const;

function renderRegister(
  rows: AccountingTransportRegisterRow[],
  opts: {
    total?: number;
    adjustmentCounts?: { none: number; pending: number; confirmed: number };
  } = {},
) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AccountingTransportRegister
          rows={rows}
          total={opts.total ?? rows.length}
          totalPages={1}
          fingerprint={'a'.repeat(64)}
          adjustmentCounts={opts.adjustmentCounts}
          page={1}
          search=""
          customerId=""
          carrierId=""
          customers={[]}
          carriers={[]}
          ownership=""
          readiness=""
          selectionScopeKey="scope-1"
          loading={false}
          error={false}
          sort={null}
          onSortChange={() => {}}
          onSearchChange={() => {}}
          onFilterChange={() => {}}
          onSearch={() => {}}
          onPageChange={() => {}}
          onRetry={() => {}}
          onReset={() => {}}
          onResetSecondary={() => {}}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const bodyRows = (container: HTMLElement) =>
  [...container.querySelectorAll('.accounting-register__table tbody tr')] as HTMLTableRowElement[];

beforeEach(() => {
  vi.clearAllMocks();
  // The column choice persists per workstation (useHiddenColumns) — a toggle
  // in one case must never leak its stored payload into the next.
  localStorage.clear();
});

describe('K6.41 — reconciliation strip on Đối chiếu vận tải', () => {
  it('shows the four reconciliation counts at the page top', () => {
    renderRegister([row()], {
      total: 6,
      adjustmentCounts: { none: 3, pending: 2, confirmed: 1 },
    });
    const rail = screen.getByRole('region', { name: 'Tổng hợp đối soát vận tải' });
    for (const [label, value] of [
      ['Lô trong kỳ', '6'],
      ['Chưa đối soát', '3'],
      ['Chờ xác nhận', '2'],
      ['Đã đối soát', '1'],
    ] as const) {
      const dt = within(rail).getByText(label);
      expect(dt.nextElementSibling, label).toHaveTextContent(value);
    }
  });

  it('renders [Đối soát]/[Hoàn tác] disabled without an eligible selection, with the chốt debit hints', () => {
    renderRegister([row({ adjustment: pendingAdjustment })]);
    const confirm = screen.getByRole('button', { name: 'Đối soát' });
    const withdraw = screen.getByRole('button', { name: 'Hoàn tác' });
    expect(confirm).toBeDisabled();
    expect(withdraw).toBeDisabled();
    expect(confirm).toHaveAttribute('title', 'Chọn ít nhất một dòng đang chờ xác nhận để đối soát');
    expect(withdraw).toHaveAttribute('title', 'Chọn ít nhất một dòng để hoàn tác yêu cầu điều chỉnh');
  });

  it('[Đối soát]/[Hoàn tác] act on the selected rows live PENDING requests (same endpoints as chốt debit)', async () => {
    const { container } = renderRegister([
      row({ tripId: 1, adjustment: pendingAdjustment }),
      row({ tripId: 2, adjustment: { status: 'CONFIRMED', requestId: 7, requestedAt: '2026-08-01T01:00:00.000Z', confirmedAt: '2026-08-01T02:00:00.000Z' } }),
    ]);
    fireEvent.click(bodyRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Đối soát' }));
    // mutate() invokes the mutationFn on a microtask — the success line is the
    // sync barrier; the variables assertion reads the call afterwards.
    expect(await screen.findByText('Đã xác nhận đối soát.')).toBeInTheDocument();
    expect(vi.mocked(confirmRateAdjustments).mock.calls[0]?.[0]).toEqual([42]);
  });

  it('[Hoàn tác] withdraws the selected rows live PENDING requests', async () => {
    const { container } = renderRegister([row({ tripId: 1, adjustment: pendingAdjustment })]);
    fireEvent.click(bodyRows(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    expect(await screen.findByText('Đã rút yêu cầu.')).toBeInTheDocument();
    expect(vi.mocked(withdrawRateAdjustments).mock.calls[0]?.[0]).toEqual([42]);
  });

  it('keeps a not-READY row locked unless it carries a live PENDING request', () => {
    const { container } = renderRegister([
      row({ tripId: 1, readiness: missingReadiness, adjustment: pendingAdjustment }),
      row({ tripId: 2, readiness: missingReadiness }),
    ]);
    const [pendingLocked, noneLocked] = bodyRows(container);
    fireEvent.click(pendingLocked);
    expect(pendingLocked).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Đối soát' })).toBeEnabled();
    fireEvent.click(noneLocked);
    expect(noneLocked).not.toHaveAttribute('aria-selected');
  });
});

describe('K6.41 — Cột hiển thị', () => {
  it('lists the hideable register columns and hides a column on toggle', () => {
    const { container } = renderRegister([row()]);
    const trigger = screen.getByRole('button', { name: 'Cột hiển thị' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    // Closed by default — the panel is the popover body, never raw in the bar.
    expect(document.querySelector('.column-picker__options')).toBeNull();
    fireEvent.click(trigger);
    const options = document.querySelector('.column-picker__options');
    expect(options).not.toBeNull();
    for (const label of ['Khách hàng', 'Nhà xe', 'Doanh thu', 'Chi phí', 'Lợi nhuận', 'Trạng thái']) {
      expect(within(options as HTMLElement).getByLabelText(label), label).toBeInTheDocument();
    }
    // Pinned columns (row identity, only action) are never offered.
    expect(within(options as HTMLElement).queryByLabelText('Chuyến')).toBeNull();
    expect(within(options as HTMLElement).queryByLabelText('Thao tác')).toBeNull();
    fireEvent.click(screen.getByLabelText('Lợi nhuận'));
    const table = container.querySelector('.accounting-register__table') as HTMLElement;
    expect(within(table).queryByText('Lợi nhuận')).toBeNull();
    expect(within(table).getByText('Chi phí')).toBeInTheDocument();
  });
});
