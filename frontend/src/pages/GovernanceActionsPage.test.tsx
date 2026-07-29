import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceActionRecord } from '../api/financialClient';
import { api } from '../lib/api';

const {
  approveMutateAsyncMock,
  checkMutateAsyncMock,
  governanceQueueState,
  queueRefetchMock,
  rejectMutateAsyncMock,
} = vi.hoisted(() => ({
  approveMutateAsyncMock: vi.fn(),
  checkMutateAsyncMock: vi.fn(),
  governanceQueueState: {
    data: [] as GovernanceActionRecord[],
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
  },
  queueRefetchMock: vi.fn(),
  rejectMutateAsyncMock: vi.fn(),
}));

vi.mock('../hooks/useFinancialQueries', () => ({
  useGovernanceActions: () => ({
    ...governanceQueueState,
    refetch: queueRefetchMock,
  }),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <GovernanceActionsPage />
    </MemoryRouter>,
  );
}

describe('GovernanceActionsPage', () => {
  beforeEach(() => {
    approveMutateAsyncMock.mockReset();
    checkMutateAsyncMock.mockReset();
    queueRefetchMock.mockReset();
    rejectMutateAsyncMock.mockReset();
    governanceQueueState.data = [makeAction()];
    governanceQueueState.isLoading = false;
    governanceQueueState.isFetching = false;
    governanceQueueState.isError = false;
    governanceQueueState.error = null;
  });

  it('renders type, status, requester, versions, reason, and server-allowed actions', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Yêu cầu chờ kiểm tra & phê duyệt' })).toBeTruthy();
    expect(screen.queryByText('Kiểm soát maker / checker / approver')).toBeNull();
    expect(screen.getByText('Chốt kỳ lương')).toBeTruthy();
    expect(screen.getAllByText('Chờ kiểm tra')).toHaveLength(2);
    expect(screen.getByText('ACCOUNTANT · #12')).toBeTruthy();
    expect(screen.getByText('Đã đối soát đủ bảng công và điều chỉnh.')).toBeTruthy();
    expect(screen.getByText('1 yêu cầu đang chờ quyết định theo quyền của bạn.')).toBeTruthy();
    expect(screen.getByText('Phiên bản yêu cầu').parentElement?.textContent).toContain('4');
    expect(screen.getByText('Phiên bản dữ liệu gốc').parentElement?.textContent).toContain('3');
    expect(screen.getByText('Quyền xử lý từ máy chủ:').parentElement?.textContent).toContain('Kiểm tra');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Kiểm tra' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Phê duyệt' }).disabled).toBe(true);
  });

  it('labels salary issue and official posting operations distinctly from period close', async () => {
    governanceQueueState.data = [
      makeAction({
        id: 511,
        afterSnapshot: { operation: 'ISSUE_PAYSLIPS', period: '2026-07' },
      }),
      makeAction({
        id: 512,
        afterSnapshot: { operation: 'POST_OFFICIAL', period: '2026-07' },
      }),
    ];

    renderPage();

    expect(await screen.findByText('Phát hành phiếu lương')).toBeTruthy();
    expect(screen.getByText('Hạch toán lương chính thức')).toBeTruthy();
    expect(screen.queryByText('Chốt kỳ lương')).toBeNull();
  });

  it('checks a salary issue request through its period-bound decision route', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    governanceQueueState.data = [makeAction({
      id: 511,
      subjectKey: '2026-07',
      version: 6,
      afterSnapshot: { operation: 'ISSUE_PAYSLIPS', period: '2026-07' },
      allowedActions: ['CHECK'],
    })];

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Kiểm tra' }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        '/salary/periods/2026-07/issue-actions/511/check',
        { expectedVersion: 6 },
      );
    });
    expect(checkMutateAsyncMock).not.toHaveBeenCalled();
    expect(queueRefetchMock).toHaveBeenCalled();
  });

  it('shows the pending trip-expense decision and typed evidence without claiming it is applied', async () => {
    governanceQueueState.data = [makeAction({
      actionKind: 'TRIP_EXPENSE_APPROVAL',
      subjectType: 'TRIP_EXPENSE',
      afterSnapshot: { decision: 'APPROVED', tripId: 77 },
      deltaSnapshot: {
        evidence: {
          reviewNote: 'Đã đối chiếu biên nhận hiện trường.',
          attachmentRefs: ['PHOTO-123'],
        },
      },
    })];
    renderPage();

    expect(await screen.findByText('Đề nghị phê duyệt', { exact: false })).toBeTruthy();
    expect(screen.getByText(/Đã đối chiếu biên nhận hiện trường/)).toBeTruthy();
    expect(screen.getByText(/PHOTO-123/)).toBeTruthy();
    expect(screen.getByText(/Chi phí vẫn chờ xử lý/)).toBeTruthy();
  });

  it('lists pending actions by default and reveals completed history under Tất cả', async () => {
    governanceQueueState.data = [
      makeAction(),
      makeAction({
        id: 502,
        status: 'APPROVED',
        actionKind: 'PRICE_CONFIG_CHANGE',
        reason: 'Cập nhật đơn giá tuyến.',
        allowedActions: [],
      }),
    ];
    renderPage();

    expect(await screen.findByText('Chốt kỳ lương')).toBeTruthy();
    expect(screen.queryByText('Thay đổi cấu hình giá')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(await screen.findByText('Thay đổi cấu hình giá')).toBeTruthy();
    expect(screen.getByText('Chỉ xem')).toBeTruthy();
  });

  it('checks and approves with the current expectedVersion only when allowed', async () => {
    governanceQueueState.data = [
      makeAction({ id: 501, version: 4, allowedActions: ['CHECK'] }),
      makeAction({
        id: 502,
        version: 9,
        status: 'PENDING_APPROVAL',
        allowedActions: ['APPROVE'],
      }),
    ];
    renderPage();

    const checkButtons = await screen.findAllByRole('button', { name: 'Kiểm tra' });
    const approveButtons = screen.getAllByRole('button', { name: 'Phê duyệt' });
    fireEvent.click(checkButtons[0]);
    fireEvent.click(approveButtons[1]);

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

    fireEvent.change(screen.getByPlaceholderText('Bắt buộc khi từ chối yêu cầu.'), {
      target: { value: 'Thiếu biên bản đối soát kỳ lương.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));

    await waitFor(() => expect(rejectMutateAsyncMock).toHaveBeenCalledWith({
      id: 501,
      expectedVersion: 4,
      reason: 'Thiếu biên bản đối soát kỳ lương.',
    }));
  });
});
