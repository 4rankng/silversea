import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { useCRUD } from './useCRUD';

const { apiPut, apiDelete, toast } = vi.hoisted(() => ({
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  api: {
    put: (...args: unknown[]) => apiPut(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
    post: vi.fn(),
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
});
