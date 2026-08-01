import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { CreditOverrideRequestRecord } from '../api/creditOverrideClient';

const {
  approveMutateAsyncMock,
  checkMutateAsyncMock,
  currentUserState,
  creditQueueState,
  queueRefetchMock,
  rejectMutateAsyncMock,
} = vi.hoisted(() => ({
  approveMutateAsyncMock: vi.fn(),
  checkMutateAsyncMock: vi.fn(),
  currentUserState: {
    role: 'ADMIN' as Role,
    userId: 99,
  },
  creditQueueState: {
    data: {
      items: [] as CreditOverrideRequestRecord[],
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null as Error | null,
  },
  queueRefetchMock: vi.fn(),
  rejectMutateAsyncMock: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      userId: currentUserState.userId,
      role: currentUserState.role,
    },
  }),
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({
    data: {
      customers: [
        { id: 7, name: 'Công ty Minh Hải' },
        { id: 8, name: 'Công ty Đại Dương' },
      ],
    },
  }),
}));

vi.mock('../hooks/useCreditOverrideQueries', () => ({
  useCreditOverrideQueue: (filters: { customerId?: number; page?: number; limit?: number }) => {
    const filteredItems = filters.customerId
      ? creditQueueState.data.items.filter((request) => request.customerId === filters.customerId)
      : creditQueueState.data.items;
    const limit = filters.limit ?? 25;
    const page = filters.page ?? 1;
    return {
      ...creditQueueState,
      data: {
        items: filteredItems.slice((page - 1) * limit, page * limit),
        page,
        limit,
        total: filteredItems.length,
        totalPages: filteredItems.length === 0 ? 0 : Math.ceil(filteredItems.length / limit),
      },
      refetch: queueRefetchMock,
    };
  },
  useApproveCreditOverrideRequest: () => ({
    mutateAsync: approveMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
  useCheckCreditOverrideRequest: () => ({
    mutateAsync: checkMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
  useRejectCreditOverrideRequest: () => ({
    mutateAsync: rejectMutateAsyncMock,
    isPending: false,
    variables: null,
  }),
}));

import CreditOverrideQueuePage from './CreditOverrideQueuePage';

function makeRequest(overrides: Partial<CreditOverrideRequestRecord> = {}): CreditOverrideRequestRecord {
  return {
    id: 701,
    customerId: 7,
    shipmentId: 42,
    scopeType: 'SHIPMENT',
    status: 'PENDING',
    requiredTier: 'FINANCE_TIER_1',
    reason: 'Khách đang chờ giao gấp.',
    requestedBy: 12,
    requestedRole: 'CLERK',
    approvedBy: null,
    approvedRole: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedRole: null,
    rejectedAt: null,
    rejectionReason: null,
    proposedAmount: '15000000',
    outstandingAmount: '40000000',
    approvedCommitmentAmount: '10000000',
    totalExposure: '55000000',
    creditLimit: '50000000',
    warningThreshold: '0.8',
    overLimitAmount: '5000000',
    overLimitRatio: '0.1',
    repeatException: false,
    expiresAt: '2026-07-28T09:30:00.000Z',
    consumedTripId: null,
    consumedAt: null,
    version: 4,
    requestVersion: 1,
    workflowStatus: 'PENDING_APPROVAL',
    governanceActionId: 9001,
    checkedBy: 50,
    checkedAt: '2026-07-27T09:05:00.000Z',
    customerName: 'Công ty Minh Hải',
    shipmentCode: 'SHP-2607-00042',
    requestedByName: 'Nguyễn Thị Lan',
    checkedByName: 'Nguyễn Thị Mai',
    createdAt: '2026-07-27T09:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/credit-overrides']}>
      <Routes>
        <Route path="/credit-overrides" element={<CreditOverrideQueuePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CreditOverrideQueuePage', () => {
  beforeEach(() => {
    approveMutateAsyncMock.mockReset();
    checkMutateAsyncMock.mockReset();
    rejectMutateAsyncMock.mockReset();
    queueRefetchMock.mockReset();
    currentUserState.role = Role.ADMIN;
    currentUserState.userId = 99;
    creditQueueState.data.items = [makeRequest()];
    creditQueueState.isLoading = false;
    creditQueueState.isFetching = false;
    creditQueueState.isError = false;
    creditQueueState.error = null;
  });

  it('renders exposure, limit, expiry, and reason context in a card-based queue', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Duyệt vượt hạn mức' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hàng chờ phê duyệt' })).toBeTruthy();
    expect(screen.getByTestId('credit-override-card-list').className).toContain('credit-override-queue__cards');
    expect(screen.getByRole('heading', { name: 'Công ty Minh Hải' })).toBeTruthy();
    expect(screen.getByText('Nguyễn Thị Lan')).toBeTruthy();
    expect(screen.queryByText('CLERK')).toBeNull();
    expect(screen.getByText('Khách đang chờ giao gấp.')).toBeTruthy();
    expect(screen.getByText('55.000.000 ₫')).toBeTruthy();
    expect(screen.getByText('50.000.000 ₫')).toBeTruthy();
    expect(screen.getByText(/28\/7\/2026/)).toBeTruthy();
  });

  it('filters by customer name without exposing the database customer id', async () => {
    creditQueueState.data.items = [
      makeRequest(),
      makeRequest({ id: 802, customerId: 8, customerName: 'Công ty Đại Dương', reason: 'Cần giao hàng trong ngày.' }),
    ];
    renderPage();

    fireEvent.change(await screen.findByLabelText('Khách hàng'), { target: { value: '8' } });

    expect(screen.getByRole('heading', { name: 'Công ty Đại Dương' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Công ty Minh Hải' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Khách hàng\s*#\d+/);
  });

  it('lets reviewers reach every matching request through pagination', async () => {
    creditQueueState.data.items = Array.from({ length: 26 }, (_, index) => makeRequest({
      id: 800 + index,
      reason: `Lý do đề nghị ${index + 1}`,
    }));
    renderPage();

    expect(await screen.findByText('Lý do đề nghị 1')).toBeTruthy();
    expect(screen.queryByText('Lý do đề nghị 26')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '2' }));

    expect(await screen.findByText('Lý do đề nghị 26')).toBeTruthy();
    expect(screen.queryByText('Lý do đề nghị 1')).toBeNull();
    expect(screen.getByText(/Hiển thị/).textContent).toContain('26');
  });

  it('keeps the empty queue useful and lets the user clear custom filters', async () => {
    creditQueueState.data.items = [];
    renderPage();

    expect(await screen.findByText('Không có đề nghị chờ duyệt')).toBeTruthy();
    expect(screen.getByText('Các đề nghị mới sẽ xuất hiện tại đây.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Xóa bộ lọc' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Trạng thái'), { target: { value: 'APPROVED' } });

    const clearButton = screen.getByRole('button', { name: 'Xóa bộ lọc' });
    expect(screen.getByText('Không có đề nghị phù hợp')).toBeTruthy();
    fireEvent.click(clearButton);

    expect((screen.getByLabelText('Trạng thái') as HTMLSelectElement).value).toBe('PENDING');
    expect((screen.getByLabelText('Khách hàng') as HTMLSelectElement).value).toBe('');
  });

  it('announces loading and error states', async () => {
    creditQueueState.data.items = [];
    creditQueueState.isLoading = true;
    const { unmount } = renderPage();

    expect(screen.getByRole('status').textContent).toContain('Đang tải hàng chờ phê duyệt');
    unmount();

    creditQueueState.isLoading = false;
    creditQueueState.isError = true;
    creditQueueState.error = new Error('Mất kết nối');
    renderPage();

    expect(screen.getByRole('alert').textContent).toContain('Mất kết nối');
  });

  it('renders decision roles with Vietnamese labels', async () => {
    creditQueueState.data.items = [makeRequest({
      status: 'APPROVED',
      workflowStatus: 'APPROVED',
      approvedRole: 'ACCOUNTANT',
      approvedAt: '2026-07-28T09:30:00.000Z',
    })];
    renderPage();

    expect(await screen.findByText(/Đã duyệt bởi Kế toán/)).toBeTruthy();
    expect(screen.queryByText(/ACCOUNTANT/)).toBeNull();
  });

  it('lets ADMIN approve either tier and sends expectedVersion', async () => {
    creditQueueState.data.items = [
      makeRequest({ id: 701, requiredTier: 'FINANCE_TIER_1', version: 4 }),
      makeRequest({ id: 702, requiredTier: 'DIRECTOR', version: 9 }),
    ];
    renderPage();

    const approveButtons = await screen.findAllByRole('button', { name: 'Duyệt đề nghị' });
    fireEvent.click(approveButtons[0]);
    fireEvent.click(approveButtons[1]);

    await waitFor(() => expect(approveMutateAsyncMock).toHaveBeenNthCalledWith(1, {
      id: 701,
      expectedVersion: 4,
    }));
    await waitFor(() => expect(approveMutateAsyncMock).toHaveBeenNthCalledWith(2, {
      id: 702,
      expectedVersion: 9,
    }));
  });

  it('lets a distinct finance actor complete the checker step before approval', async () => {
    creditQueueState.data.items = [
      makeRequest({
        workflowStatus: 'PENDING_CHECK',
        checkedBy: null,
        checkedAt: null,
        version: 1,
      }),
    ];
    currentUserState.role = Role.ACCOUNTANT;
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận kiểm tra' }));

    await waitFor(() => expect(checkMutateAsyncMock).toHaveBeenCalledWith({
      id: 701,
      expectedVersion: 1,
    }));
    expect(screen.queryByRole('button', { name: 'Duyệt đề nghị' })).toBeNull();
  });

  it('prevents the checker from also approving the same request', async () => {
    creditQueueState.data.items = [makeRequest({ checkedBy: 99 })];
    renderPage();

    expect(await screen.findByText(/người khác phải phê duyệt hoặc từ chối/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt đề nghị' })).toBeNull();
  });

  it('shows wrong-tier requests as read-only for ACCOUNTANT and MANAGER', async () => {
    creditQueueState.data.items = [
      makeRequest({ id: 701, requiredTier: 'FINANCE_TIER_1' }),
      makeRequest({ id: 702, requiredTier: 'DIRECTOR' }),
    ];

    currentUserState.role = Role.ACCOUNTANT;
    const { rerender } = render(
      <MemoryRouter initialEntries={['/credit-overrides']}>
        <Routes>
          <Route path="/credit-overrides" element={<CreditOverrideQueuePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/đúng phân cấp phê duyệt/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Duyệt đề nghị' })).toHaveLength(1);

    currentUserState.role = Role.MANAGER;
    rerender(
      <MemoryRouter initialEntries={['/credit-overrides']}>
        <Routes>
          <Route path="/credit-overrides" element={<CreditOverrideQueuePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/đúng phân cấp phê duyệt/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Duyệt đề nghị' })).toHaveLength(1);
  });

  it('blocks self-approval in the dedicated queue', async () => {
    creditQueueState.data.items = [makeRequest({ requestedBy: 99 })];
    renderPage();

    expect(await screen.findByText(/không thể tự kiểm tra, phê duyệt hoặc từ chối/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Duyệt đề nghị' })).toBeNull();
  });

  it('requires a reject reason and passes expectedVersion on reject', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Từ chối' }));
    expect(screen.getByText(/Cần nhập lý do từ chối/i)).toBeTruthy();
    expect(rejectMutateAsyncMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Bắt buộc khi từ chối đề nghị.'), {
      target: { value: 'Thiếu bằng chứng thanh toán bổ sung.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Từ chối' }));

    await waitFor(() => expect(rejectMutateAsyncMock).toHaveBeenCalledWith({
      id: 701,
      body: {
        expectedVersion: 4,
        reason: 'Thiếu bằng chứng thanh toán bổ sung.',
      },
    }));
  });
});
