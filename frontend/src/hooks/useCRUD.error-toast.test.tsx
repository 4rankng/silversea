import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { useCRUD } from './useCRUD';

const { apiPost, apiPut, apiDelete, toast } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    put: (...args: unknown[]) => apiPut(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

vi.mock('../components/shared/Toast', () => ({
  useToast: () => ({ toast }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}

describe('useCRUD mutation failures stay loud (card _11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a 409 on update raises an error toast, not just the in-modal alert', async () => {
    const { result } = renderHook(() => useCRUD('/dispatch-zones', vi.fn()), { wrapper: Wrapper });
    apiPut.mockRejectedValueOnce(new Error('Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.'));
    await result.current.doUpdate(4, { label: 'x' }, '2026-09-19T18:42:59.115Z');
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
      expect(result.current.error).toContain('người khác cập nhật');
    });
  });

  it('a 409 on delete raises an error toast as well', async () => {
    const { result } = renderHook(() => useCRUD('/ports', vi.fn()), { wrapper: Wrapper });
    apiDelete.mockRejectedValueOnce(new Error('Cảng đang được dùng bởi tuyến/điểm nhắc.'));
    await result.current.doDelete(68, '2026-09-19T18:42:59.115Z');
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
      expect(result.current.error).toContain('đang được dùng');
    });
  });

  // Card 101026163020 (FB-051): the success toast for a committed write must
  // not be hostage to the cache refresh that follows it. A rejecting
  // onRefresh used to swallow the feedback entirely — and an AbortError
  // raced refetch was fully silent (no toast of any kind) while the page
  // kept stale data, the round-13 signature on /config/penalty-reasons.
  describe('useCRUD success feedback survives refresh failures (card 101026163020)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('update: success toast fires even when the refresh rejects with an abort', async () => {
      const abort = new Error('The user aborted a request.');
      abort.name = 'AbortError';
      const { result } = renderHook(() => useCRUD('/penalty-reasons', vi.fn().mockRejectedValue(abort)), { wrapper: Wrapper });
      apiPut.mockResolvedValueOnce(undefined);
      await result.current.doUpdate(9, { defaultAmount: 1000001 });
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã cập nhật cấu hình.' }));
      });
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
      // The saving flag must reset on every path — a stuck "Đang lưu..."
      // after a failed or degraded save is its own regression.
      expect(result.current.saving).toBe(false);
    });

    it('update: a failed write resets the saving flag', async () => {
      const { result } = renderHook(() => useCRUD('/penalty-reasons', vi.fn()), { wrapper: Wrapper });
      apiPut.mockRejectedValueOnce(new Error('Dữ liệu đã được người khác cập nhật.'));
      await result.current.doUpdate(9, { defaultAmount: 1000001 });
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
      });
      expect(result.current.saving).toBe(false);
    });

    it('update: success toast fires and no contradictory error toast follows when the refresh rejects with a server error', async () => {
      const { result } = renderHook(() => useCRUD('/penalty-reasons', vi.fn().mockRejectedValue(new Error('boom'))), { wrapper: Wrapper });
      apiPut.mockResolvedValueOnce(undefined);
      await result.current.doUpdate(9, { defaultAmount: 1000001 });
      await waitFor(() => {
        expect(toast).toHaveBeenCalledTimes(1);
      });
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã cập nhật cấu hình.' }));
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });

    it('create: success toast fires even when the refresh rejects', async () => {
      const abort = new Error('The user aborted a request.');
      abort.name = 'AbortError';
      const { result } = renderHook(() => useCRUD('/penalty-reasons', vi.fn().mockRejectedValue(abort)), { wrapper: Wrapper });
      apiPost.mockResolvedValueOnce(undefined);
      await result.current.doCreate({ reasonText: 'X', defaultAmount: 1, severity: 'mid' });
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã thêm cấu hình.' }));
      });
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });

    it('delete: success toast fires even when the refresh rejects', async () => {
      const abort = new Error('The user aborted a request.');
      abort.name = 'AbortError';
      const { result } = renderHook(() => useCRUD('/penalty-reasons', vi.fn().mockRejectedValue(abort)), { wrapper: Wrapper });
      apiDelete.mockResolvedValueOnce(undefined);
      await result.current.doDelete(9);
      await waitFor(() => {
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success', message: 'Đã xóa cấu hình.' }));
      });
      expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });
  });
});
