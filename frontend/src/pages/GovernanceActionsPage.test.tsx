import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceActionRecord } from '../api/financialClient';

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

    expect(await screen.findByRole('heading', { name: 'Hàng chờ quản trị' })).toBeTruthy();
    expect(screen.getByText('Chốt kỳ lương')).toBeTruthy();
    expect(screen.getAllByText('Chờ kiểm tra')).toHaveLength(2);
    expect(screen.getByText('ACCOUNTANT · #12')).toBeTruthy();
    expect(screen.getByText('Đã đối soát đủ bảng công và điều chỉnh.')).toBeTruthy();
    expect(screen.getByText('Phiên bản yêu cầu').parentElement?.textContent).toContain('4');
    expect(screen.getByText('Phiên bản dữ liệu gốc').parentElement?.textContent).toContain('3');
    expect(screen.getByText('Quyền xử lý từ máy chủ:').parentElement?.textContent).toContain('Kiểm tra');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Kiểm tra' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Phê duyệt' }).disabled).toBe(true);
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
