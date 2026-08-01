import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTripsMock = vi.hoisted(() => vi.fn());

vi.mock('../api/tripClient', () => ({
  tripClient: {
    listTrips: listTripsMock,
  },
}));

vi.mock('../hooks/useCatalogs', () => ({
  useCatalogs: () => ({ data: { suppliers: [] } }),
}));

import { CommissionModal } from './PayableListPage';

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommissionModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        isPending={false}
        error={null}
      />
    </QueryClientProvider>,
  );
}

describe('CommissionModal trip selector', () => {
  beforeEach(() => {
    listTripsMock.mockReset();
    listTripsMock.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('queries one bounded page and forwards the debounced server search term', async () => {
    renderModal();

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      search: undefined,
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Chuyến liên quan (tuỳ chọn)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tìm theo mã chuyến, khách hàng hoặc tuyến…' }), {
      target: { value: 'Hải Phòng' },
    });

    await waitFor(() => expect(listTripsMock).toHaveBeenCalledWith({
      limit: 50,
      page: 1,
      search: 'Hải Phòng',
    }), { timeout: 1_000 });
  });
});
