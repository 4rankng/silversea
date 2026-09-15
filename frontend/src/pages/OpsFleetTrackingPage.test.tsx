import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpsFleetTrackingPage from './OpsFleetTrackingPage';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/api')>(),
  api: { get: apiGet },
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OpsFleetTrackingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OpsFleetTrackingPage (OpsVanHanh §4)', () => {
  beforeEach(() => apiGet.mockReset());

  it('renders assigned trucks with live trip state and the latest driver milestone', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          truckId: 1, licensePlate: '29A-123.45', trailerPlate: '29R-678.90',
          tripId: 10, tripCode: 'T-0010', shipmentCode: 'SS-100', driverName: 'Tài A',
          status: 'IN_TRANSIT', lastEventType: 'LOADING_OR_RETURNING', updatedAt: '2026-09-07T01:02:03.000Z',
        },
        {
          truckId: 2, licensePlate: '30B-999.99', trailerPlate: null,
          tripId: null, tripCode: null, shipmentCode: null, driverName: null,
          status: null, lastEventType: null, updatedAt: null,
        },
      ],
    });
    renderPage();

    expect(await screen.findByText('29A-123.45')).toBeInTheDocument();
    expect(screen.getByText(/T-0010 · SS-100/)).toBeInTheDocument();
    expect(screen.getByText('Đang vận chuyển (đang đóng/trả hàng)')).toBeInTheDocument();
    expect(screen.getByText('Đang rảnh')).toBeInTheDocument();
  });

  it('is read-only: no write affordances, and shows the empty state', async () => {
    apiGet.mockResolvedValue({ items: [] });
    renderPage();

    expect(await screen.findByText(/Chưa có xe nào được giao cho bạn quản lý/)).toBeInTheDocument();
    // Only control on the page is the refresh button.
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
    });
  });
  it('distinguishes failed fleet requests from an empty assignment and retries', async () => {
    apiGet.mockRejectedValueOnce(new Error('Unavailable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được phương tiện');
    expect(screen.queryByText(/Chưa có xe nào được giao/)).not.toBeInTheDocument();
    apiGet.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/Chưa có xe nào được giao/)).toBeInTheDocument();
  });

});
