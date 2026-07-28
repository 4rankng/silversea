import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { CreditOverrideRequestRecord } from '../api/creditOverrideClient';

const {
  approveMutateAsyncMock,
  currentUserState,
  creditQueueState,
  queueRefetchMock,
  rejectMutateAsyncMock,
} = vi.hoisted(() => ({
  approveMutateAsyncMock: vi.fn(),
  currentUserState: {
    role: 'ADMIN' as Role,
    userId: 99,
  },
  creditQueueState: {
    data: [] as CreditOverrideRequestRecord[],
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

vi.mock('../hooks/useCreditOverrideQueries', () => ({
  useCreditOverrideQueue: () => ({
    ...creditQueueState,
    refetch: queueRefetchMock,
  }),
  useApproveCreditOverrideRequest: () => ({
    mutateAsync: approveMutateAsyncMock,
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
    rejectMutateAsyncMock.mockReset();
    queueRefetchMock.mockReset();
    currentUserState.role = Role.ADMIN;
    currentUserState.userId = 99;
    creditQueueState.data = [makeRequest()];
    creditQueueState.isLoading = false;
    creditQueueState.isFetching = false;
    creditQueueState.isError = false;
    creditQueueState.error = null;
  });

  it('renders exposure, limit, expiry, and reason context in a card-based queue', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Duyệt vượt hạn mức' })).toBeTruthy();
    expect(screen.getByTestId('credit-override-card-list').className).toContain('credit-override-queue__cards');
    expect(screen.getByText('Khách hàng #7')).toBeTruthy();
    expect(screen.getByText('Khách đang chờ giao gấp.')).toBeTruthy();
    expect(screen.getByText('55.000.000 ₫')).toBeTruthy();
    expect(screen.getByText('50.000.000 ₫')).toBeTruthy();
    expect(screen.getByText(/28\/7\/2026/)).toBeTruthy();
  });

  it('lets ADMIN approve either tier and sends expectedVersion', async () => {
    creditQueueState.data = [
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

  it('shows wrong-tier requests as read-only for ACCOUNTANT and MANAGER', async () => {
    creditQueueState.data = [
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
    creditQueueState.data = [makeRequest({ requestedBy: 99 })];
    renderPage();

    expect(await screen.findByText(/không thể tự duyệt hoặc tự từ chối/i)).toBeTruthy();
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
