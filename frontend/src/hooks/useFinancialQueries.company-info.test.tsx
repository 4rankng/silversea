import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GovernanceActionRecord } from '../api/financialClient';
import { qk } from '../api/keys';

const { approveGovernanceActionMock } = vi.hoisted(() => ({
  approveGovernanceActionMock: vi.fn(),
}));

vi.mock('../api/financialClient', () => ({
  financialClient: {
    approveGovernanceAction: approveGovernanceActionMock,
  },
}));

import { useApproveGovernanceAction } from './useFinancialQueries';

function approvedAction(subjectKey: string | null): GovernanceActionRecord {
  return {
    id: 71,
    subjectType: 'PRICE_CONFIG',
    subjectId: null,
    subjectKey,
    actionKind: 'PRICE_CONFIG_CHANGE',
    status: 'APPROVED',
    reason: 'Cập nhật cấu hình',
    originalVersion: 0,
    makerId: 1,
    makerRole: 'ACCOUNTANT',
    checkerId: 2,
    checkerRole: 'MANAGER',
    checkedAt: '2026-07-29T00:00:00.000Z',
    approverId: 3,
    approverRole: 'ADMIN',
    approvedAt: '2026-07-29T00:01:00.000Z',
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
    version: 3,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:01:00.000Z',
    allowedActions: [],
  };
}

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
}

describe('useApproveGovernanceAction company-info refresh', () => {
  beforeEach(() => {
    approveGovernanceActionMock.mockReset();
  });

  it('refreshes company-info caches after the governed change is approved', async () => {
    approveGovernanceActionMock.mockResolvedValue(approvedAction('company-info'));
    const { invalidateSpy, wrapper } = createHarness();
    const { result } = renderHook(() => useApproveGovernanceAction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 71, expectedVersion: 2 });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['governance-actions'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.catalogs.companyInfo });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: qk.configCounts.companyInfo });
  });

  it('does not refresh company-info caches for unrelated approvals', async () => {
    approveGovernanceActionMock.mockResolvedValue(approvedAction('fuel-config'));
    const { invalidateSpy, wrapper } = createHarness();
    const { result } = renderHook(() => useApproveGovernanceAction(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 71, expectedVersion: 2 });
    });

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['governance-actions'] });
  });
});
