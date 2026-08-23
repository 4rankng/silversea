import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GovernanceActionRecord,
  GovernanceActionsEnvelope,
} from '../api/financialClient';
import { api } from '../lib/api';

const {
  approveMutateAsyncMock,
  checkMutateAsyncMock,
  getGovernanceActionsMock,
  rejectMutateAsyncMock,
} = vi.hoisted(() => ({
  approveMutateAsyncMock: vi.fn(),
  checkMutateAsyncMock: vi.fn(),
  getGovernanceActionsMock: vi.fn(),
  rejectMutateAsyncMock: vi.fn(),
}));

vi.mock('../api/financialClient', () => ({
  financialClient: {
    getGovernanceActions: getGovernanceActionsMock,
  },
}));

vi.mock('../hooks/useFinancialQueries', () => ({
  governanceActionKeys: {
    all: ['governance-actions'],
    list: (filters?: unknown) => ['governance-actions', filters ?? {}],
  },
  useCheckGovernanceAction: () => ({
    mutateAsync: checkMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
  useApproveGovernanceAction: () => ({
    mutateAsync: approveMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
  useRejectGovernanceAction: () => ({
    mutateAsync: rejectMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
}));

import GovernanceActionsPage from './GovernanceActionsPage';

function makeAction(overrides: Partial<GovernanceActionRecord> = {}): GovernanceActionRecord {
  return {
    id: 501,
    subjectType: 'SALARY_PERIOD',
    subjectId: 202607,
    subjectKey: null,
    actionKind: 'SALARY_PERIOD_CLOSE',
    status: 'PENDING_CHECK',
    reason: 'Đã đối soát đủ bảng công và điều chỉnh.',
    originalVersion: 3,
    makerId: 12,
    makerRole: 'ACCOUNTANT',
    checkerId: null,
    checkerRole: null,
    checkedAt: null,
    approverId: null,
    approverRole: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedRole: null,
    rejectedAt: null,
    rejectionReason: null,
    returnedBy: null,
    returnedRole: null,
    returnedAt: null,
    returnReason: null,
    canceledBy: null,
    canceledRole: null,
    canceledAt: null,
    cancelReason: null,
    version: 4,
    createdAt: '2026-07-27T04:00:00.000Z',
    updatedAt: '2026-07-27T04:00:00.000Z',
    allowedActions: ['CHECK', 'REJECT'],
    ...overrides,
  };
}

function makeEnvelope(
  items: GovernanceActionRecord[],
  overrides: Partial<GovernanceActionsEnvelope> = {},
): GovernanceActionsEnvelope {
  const statusCounts: Record<string, number> = {};
  for (const item of items) {
    statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1;
  }
  return { items, total: items.length, page: 1, pageSize: 25, statusCounts, ...overrides };
}

function renderPage(search = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/governance-actions${search}`]}>
        <GovernanceActionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function lastCallParams(): { status?: string; page?: number; limit?: number; sortBy?: string; sortDir?: string } {
  return getGovernanceActionsMock.mock.calls.at(-1)?.[0] ?? {};
}

function summaryTileValue(label: string): string | undefined {
  const dt = screen.getByText(label, { selector: '.summary-rail dt' });
  return dt.parentElement?.querySelector('dd')?.textContent;
}

describe('GovernanceActionsPage', () => {
  beforeEach(() => {
    approveMutateAsyncMock.mockReset();
    checkMutateAsyncMock.mockReset();
    rejectMutateAsyncMock.mockReset();
    getGovernanceActionsMock.mockReset();
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction()]));
  });

  it('renders type, status, requester, versions, reason, and server-allowed actions', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Trung tâm phê duyệt' })).toBeTruthy();
    expect(screen.queryByText('Kiểm soát maker / checker / approver')).toBeNull();
    expect(await screen.findByText('Chốt kỳ lương')).toBeTruthy();
    expect(screen.getByText('Chờ kiểm tra', { selector: '.governance-actions__status' })).toBeTruthy();
    expect(screen.getByText('Kế toán')).toBeTruthy();
    expect(screen.getByText('Đã đối soát đủ bảng công và điều chỉnh.')).toBeTruthy();
    expect(summaryTileValue('Bạn có thể xử lý')).toBe('1');
    expect(screen.getByText('Phiên bản', { selector: 'dt' }).parentElement?.textContent).toContain('YC 4 · Gốc 3');
    expect(screen.getByText('Quyền xử lý:').parentElement?.textContent).toContain('Kiểm tra');
    expect(screen.getByPlaceholderText('Nhập lý do khi từ chối').tagName).toBe('INPUT');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Kiểm tra' }).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Phê duyệt' })).toBeNull();
  });

  it('explains why an admin maker cannot see a check or approve button', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction({
      actionKind: 'PRICE_CONFIG_CHANGE',
      subjectType: 'PRICE_CONFIG',
      makerId: 12,
      makerRole: 'ADMIN',
      allowedActions: ['CANCEL'],
    })]));

    renderPage();

    expect(await screen.findByText(
      'Bạn là người tạo nên không thể tự kiểm tra. Yêu cầu cần một người đủ thẩm quyền khác kiểm tra trước khi chuyển sang phê duyệt.',
    )).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Phê duyệt' })).toBeNull();
  });

  it('shows approve for an admin maker with a legacy pending price-config request', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction({
      actionKind: 'PRICE_CONFIG_CHANGE',
      subjectType: 'PRICE_CONFIG',
      makerId: 12,
      makerRole: 'ADMIN',
      allowedActions: ['CANCEL', 'APPROVE'],
    })]));

    renderPage();

    expect(await screen.findByRole('button', { name: 'Phê duyệt' })).toBeTruthy();
    expect(screen.queryByText(/không thể tự kiểm tra/)).toBeNull();
  });

  it('labels salary issue and official posting operations distinctly from period close', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([
      makeAction({
        id: 511,
        afterSnapshot: { operation: 'ISSUE_PAYSLIPS', period: '2026-07' },
      }),
      makeAction({
        id: 512,
        afterSnapshot: { operation: 'POST_OFFICIAL', period: '2026-07' },
      }),
    ]));

    renderPage();

    expect(await screen.findByText('Phát hành phiếu lương')).toBeTruthy();
    expect(screen.getByText('Hạch toán lương chính thức')).toBeTruthy();
    expect(screen.queryByText('Chốt kỳ lương')).toBeNull();
  });

  it('checks a salary issue request through its period-bound decision route', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction({
      id: 511,
      subjectKey: '2026-07',
      version: 6,
      afterSnapshot: { operation: 'ISSUE_PAYSLIPS', period: '2026-07' },
      allowedActions: ['CHECK'],
    })]));

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/salary/periods/2026-07/issue-actions/511/check',
        { expectedVersion: 6 },
      );
    });
    expect(checkMutateAsyncMock).not.toHaveBeenCalled();
    // The salary route bypasses the governance mutation hook, so the page
    // refetches the queue itself.
    await waitFor(() => expect(getGovernanceActionsMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('shows the pending trip-expense decision and typed evidence without claiming it is applied', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction({
      actionKind: 'TRIP_EXPENSE_APPROVAL',
      subjectType: 'TRIP_EXPENSE',
      afterSnapshot: { decision: 'APPROVED', tripId: 77 },
      deltaSnapshot: {
        evidence: {
          reviewNote: 'Đã đối chiếu biên nhận hiện trường.',
          attachmentRefs: ['PHOTO-123'],
        },
      },
    })]));
    renderPage();

    expect(await screen.findByText('Đề nghị phê duyệt', { exact: false })).toBeTruthy();
    expect(screen.getByText(/Đã đối chiếu biên nhận hiện trường/)).toBeTruthy();
    expect(screen.getByText(/PHOTO-123/)).toBeTruthy();
    expect(screen.getByText(/Chi phí vẫn chờ xử lý/)).toBeTruthy();
  });

  it('opens completed history under Tất cả via the server-side status filter', async () => {
    const pending = makeAction();
    const approved = makeAction({
      id: 502,
      status: 'APPROVED',
      actionKind: 'PRICE_CONFIG_CHANGE',
      reason: 'Cập nhật đơn giá tuyến.',
      allowedActions: [],
    });
    getGovernanceActionsMock.mockImplementation(async (filters?: { status?: string }) =>
      filters?.status
        ? makeEnvelope([pending])
        : makeEnvelope([pending, approved]));

    renderPage();

    expect(await screen.findByText('Chốt kỳ lương')).toBeTruthy();
    expect(screen.queryByText('Thay đổi cấu hình giá')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Tất cả/ }));
    expect(await screen.findByText('Thay đổi cấu hình giá')).toBeTruthy();
    expect(screen.getByText('Chỉ xem')).toBeTruthy();
    expect(lastCallParams().status).toBeUndefined();
    expect(lastCallParams().page).toBe(1);
  });

  it('checks and approves with the current expectedVersion only when allowed', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([
      makeAction({ id: 501, version: 4, allowedActions: ['CHECK'] }),
      makeAction({
        id: 502,
        version: 9,
        status: 'PENDING_APPROVAL',
        allowedActions: ['APPROVE'],
      }),
    ]));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Phê duyệt' }));

    await waitFor(() => expect(checkMutateAsyncMock).toHaveBeenCalledWith({
      id: 501,
      expectedVersion: 4,
    }));
    await waitFor(() => expect(approveMutateAsyncMock).toHaveBeenCalledWith({
      id: 502,
      expectedVersion: 9,
    }));
    expect(checkMutateAsyncMock).toHaveBeenCalledTimes(1);
    expect(approveMutateAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit rejection reason and sends it with expectedVersion', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    expect(screen.getByText(/Cần nhập lý do từ chối/i)).toBeTruthy();
    expect(rejectMutateAsyncMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Nhập lý do khi từ chối'), {
      target: { value: 'Thiếu biên bản đối soát kỳ lương.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));

    await waitFor(() => expect(rejectMutateAsyncMock).toHaveBeenCalledWith({
      id: 501,
      expectedVersion: 4,
      reason: 'Thiếu biên bản đối soát kỳ lương.',
    }));
  });

  it('forwards page/limit/status to the server and resets the page when the scope changes', async () => {
    getGovernanceActionsMock.mockImplementation(async (filters?: { status?: string; page?: number }) => {
      const page = filters?.page ?? 1;
      const items = Array.from({ length: 2 }, (_, i) => makeAction({ id: 600 + page * 10 + i }));
      return makeEnvelope(items, { total: 120, page, pageSize: 25 });
    });
    renderPage();

    await screen.findAllByText('Yêu cầu phê duyệt');
    expect(getGovernanceActionsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'PENDING_CHECK',
      page: 1,
      limit: 25,
    }));

    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(lastCallParams().page).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: /Chờ phê duyệt/ }));
    await waitFor(() => {
      expect(lastCallParams().status).toBe('PENDING_APPROVAL');
      expect(lastCallParams().page).toBe(1);
    });
  });

  it('drives the summary tiles from full-set statusCounts, not the current page', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope(
      [makeAction()],
      { total: 40, statusCounts: { PENDING_CHECK: 7, PENDING_APPROVAL: 5, APPROVED: 28 } },
    ));
    renderPage('?filter=all');

    await screen.findByText('Chốt kỳ lương');
    expect(summaryTileValue('Đang chờ')).toBe('12');
    expect(summaryTileValue('Chờ kiểm tra')).toBe('7');
    expect(summaryTileValue('Chờ phê duyệt')).toBe('5');
  });

  it('renders server-side pagination over the filtered total', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction()], { total: 60 }));
    renderPage();

    await screen.findByText('Chốt kỳ lương');
    const summary = screen.getByText(
      (_, element) => element?.classList.contains('ds-pagination__summary') === true,
    );
    expect(summary.textContent).toBe('Hiển thị 1–25 trên 60');

    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() => expect(lastCallParams().page).toBe(2));
  });

  it('sorts server-side from the sort bar and resets the page', async () => {
    getGovernanceActionsMock.mockResolvedValue(makeEnvelope([makeAction()], { total: 60 }));
    renderPage();

    await screen.findByText('Chốt kỳ lương');

    // Move to page 2 first so the sort's page reset is observable.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(lastCallParams().page).toBe(2));

    // Fresh field starts ascending, on page 1.
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lúc' }));
    await waitFor(() =>
      expect(getGovernanceActionsMock).toHaveBeenLastCalledWith(expect.objectContaining({
        sortBy: 'createdAt',
        sortDir: 'asc',
        page: 1,
      })),
    );

    // Same field flips to descending.
    fireEvent.click(screen.getByRole('button', { name: 'Tạo lúc' }));
    await waitFor(() =>
      expect(getGovernanceActionsMock).toHaveBeenLastCalledWith(expect.objectContaining({
        sortBy: 'createdAt',
        sortDir: 'desc',
        page: 1,
      })),
    );
  });
});
