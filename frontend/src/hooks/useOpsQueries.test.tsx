import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCreateOpsExpense, opsKeys } from './useOpsQueries';
import type { OpsWalletSummary } from '../api/opsClient';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet, post: apiPost, put: vi.fn(), patch: vi.fn(), delete: vi.fn(), upload: vi.fn() },
}));

const summary: OpsWalletSummary = {
  totalAdvance: '2000000', approved: '350000', pending: '90000',
  rejected: '0',
      returned: '0', balance: '1560000',
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(opsKeys.walletSummary(), summary);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useCreateOpsExpense(), { wrapper }) };
}

/**
 * PRD OpsVanHanh §5.2 optimistic UI (docx req 7): saving an expense moves the
 * wallet cards BEFORE the server confirms; a failed save restores them. The
 * four-card formula itself is server-computed and pinned by the backend unit
 * suite (ops-wallet-summary.test.ts).
 */
describe('useCreateOpsExpense optimistic wallet patch (OpsVanHanh §5.2)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
  });

  it('drops SỐ DƯ and raises Chưa quyết toán the moment save is pressed', async () => {
    apiPost.mockReturnValue(new Promise(() => {})); // server answer still pending
    const { client, result } = setup();

    act(() => {
      result.current.mutate({
        shipmentId: 1, expenseTypeCode: 'CANXE', amount: '120000',
        paidAt: '2026-09-09', photoStorageKeys: [],
      });
    });

    await waitFor(() => {
      const patched = client.getQueryData<OpsWalletSummary>(opsKeys.walletSummary());
      expect(patched?.balance).toBe('1440000'); // 1.560.000 − 120.000
      expect(patched?.pending).toBe('210000'); // 90.000 + 120.000
    });
  });

  it('restores the previous cards when the save fails', async () => {
    apiPost.mockRejectedValue(new Error('lưu thất bại'));
    const { client, result } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        shipmentId: 1, expenseTypeCode: 'CANXE', amount: '120000',
        paidAt: '2026-09-09', photoStorageKeys: [],
      }).catch(() => undefined);
    });

    await waitFor(() => {
      const patched = client.getQueryData<OpsWalletSummary>(opsKeys.walletSummary());
      expect(patched).toEqual(summary);
    });
  });
});
