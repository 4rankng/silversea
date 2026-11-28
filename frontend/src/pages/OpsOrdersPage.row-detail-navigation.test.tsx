import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/shared/Toast';
import type { OpsOrderItem } from '../api/opsClient';
import type * as OpsApiModule from '../lib/api';
import OpsOrdersPage from './OpsOrdersPage';

/**
 * SIL-1222 — /ops/orders phải mở được chi tiết lô:
 *   1. ô Bill/Booking là link THẬT (`/shipments/:id`) — bàn phím tới được,
 *      hover hiện URL, mở tab mới được;
 *   2. thân dòng cũng mở chi tiết lô;
 *   3. control của chính dòng ([Ghim …], [Khai chi phí]) KHÔNG mở — chúng
 *      giữ hành vi riêng;
 *   4. Enter trên dòng đang có focus thì mở.
 */

const { apiGet, apiPost, apiPut, apiUpload } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiUpload: vi.fn(),
}));
vi.mock('../lib/imageCompression', () => ({ compressImageFile: vi.fn(async (file: File) => file) }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof OpsApiModule>(),
  api: {
    get: apiGet,
    post: apiPost,
    put: apiPut,
    patch: vi.fn(),
    delete: vi.fn(),
    upload: apiUpload,
  },
}));

function makeItems(): { date: string; items: OpsOrderItem[] } {
  return {
    date: '2026-11-28',
    items: [
      {
        id: 11, shipmentCode: 'SS-A', status: 'READY_FOR_DISPATCH', tradeDirection: 'IMPORT',
        billRef: 'BL-001', customerName: 'Khách A', routeName: 'HP-BN', pinned: false,
        pinnedAt: null, containerCount: 1, containerNumbers: ['TSTU1111111'], containerIds: [111],
      },
      {
        id: 22, shipmentCode: 'SS-B', status: 'IN_TRANSIT', tradeDirection: 'EXPORT',
        billRef: 'BK-002', customerName: 'Khách B', routeName: 'HP-HY', pinned: false,
        pinnedAt: null, containerCount: 2, containerNumbers: ['TSTU2222222', 'TSTU3333333'], containerIds: [222, 333],
      },
    ],
  };
}

/** Ghi lại pathname hiện tại — đọc được sau mỗi lần điều hướng. */
function LocationProbe({ log }: { log: string[] }) {
  const location = useLocation();
  log[0] = location.pathname;
  return null;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const log: string[] = [];
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/ops/orders']}>
          <LocationProbe log={log} />
          <Routes>
            <Route path="/ops/orders" element={<OpsOrdersPage />} />
            <Route path="/shipments/:id" element={<div data-testid="shipment-detail" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return log;
}

describe('OpsOrdersPage — mở chi tiết lô từ danh sách (SIL-1222)', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiUpload.mockReset();
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith('/ops/orders')) return Promise.resolve(makeItems());
      if (url.startsWith('/ops/expenses/cont-claimants')) return Promise.resolve([]);
      if (url.startsWith('/ops/expense-types')) {
        return Promise.resolve({
          items: [
            { id: 1, code: 'NANGHA', name: 'Nâng/hạ', requiresInvoice: true },
            { id: 2, code: 'CANXE', name: 'Cân xe', requiresInvoice: false },
          ],
        });
      }
      return Promise.resolve({ items: [] });
    });
    apiPut.mockResolvedValue({ pinned: true });
  });

  it('ô Bill/Booking là link thật tới /shipments/<id> và click nó thì mở chi tiết', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    const link = screen.getByRole('link', { name: 'BL-001' });
    expect(link).toHaveAttribute('href', '/shipments/11');

    fireEvent.click(link);

    await waitFor(() => expect(log[0]).toBe('/shipments/11'));
  });

  it('click thân dòng (ô không phải control) thì mở chi tiết lô', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    fireEvent.click(screen.getByText('Khách A'));

    await waitFor(() => expect(log[0]).toBe('/shipments/11'));
  });

  it('click [Ghim …] không mở chi tiết — nút ghim giữ hành vi riêng', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    fireEvent.click(screen.getByRole('button', { name: 'Ghim BL-001' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/ops/orders/shipment-pins/11', { pinned: true }));
    expect(log[0]).toBe('/ops/orders');
  });

  it('click [Khai chi phí] không mở chi tiết — modal chi phí vẫn mở như cũ', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    fireEvent.click(screen.getAllByRole('button', { name: /Khai chi phí/ })[0]);

    expect(await screen.findByRole('dialog', { name: 'Khai báo chi phí' })).toBeInTheDocument();
    expect(log[0]).toBe('/ops/orders');
  });

  it('Enter trên dòng đang focus thì mở chi tiết; Enter trong control của dòng thì không', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    const row = screen.getByText('BL-001').closest('tr')!;
    expect(row).toHaveAttribute('tabindex', '0');

    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(log[0]).toBe('/shipments/11'));
  });

  it('Enter trên nút ghim của dòng không mở chi tiết (phím thuộc control)', async () => {
    const log = renderPage();
    await screen.findByText('BL-001');

    // jsdom không dựng click từ Enter trên <button> (trình duyệt thì có);
    // test này khoá phần của handler: phím bấm thuộc control thì DÒNG không
    // mở. Hành vi ghim khi click đã có test riêng ở trên.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ghim BL-001' }), { key: 'Enter' });

    expect(log[0]).toBe('/ops/orders');
  });
});
