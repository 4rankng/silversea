import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Driver } from '@tingting/shared';

const listTripsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
  },
}));

import { PenaltyFormDrawer } from './PenaltyFormDrawer';

function renderDrawer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PenaltyFormDrawer
        isOpen
        onClose={vi.fn()}
        drivers={[{ id: 17, name: 'Nguyễn Văn An' } as Driver]}
        reasons={[]}
        onSubmit={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe('PenaltyFormDrawer trip selector', () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    listTripsMock.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('queries a bounded driver-scoped page and forwards the debounced search term', async () => {
    renderDrawer();

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      driverId: undefined,
      search: undefined,
    }));

    fireEvent.change(screen.getByLabelText('Lái xe vi phạm *'), { target: { value: '17' } });
    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      driverId: 17,
      search: undefined,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Chuyến liên quan (tùy chọn)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo mã chuyến, khách hàng hoặc tuyến…' }), {
      target: { value: 'Minh Hải' },
    });

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      driverId: 17,
      search: 'Minh Hải',
    }), { timeout: 1_000 });
  });
});
