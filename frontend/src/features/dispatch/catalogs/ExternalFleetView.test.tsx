import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateCarrierFleetVehicle, createCarrierFleetVehicle, listAllExternalFleet } = vi.hoisted(() => ({
  updateCarrierFleetVehicle: vi.fn(),
  createCarrierFleetVehicle: vi.fn(),
  listAllExternalFleet: vi.fn(async () => ({ catalog: [] as unknown[], linkedTrucks: [] })),
}));

vi.mock('../../../api/externalFleetClient', () => ({ listAllExternalFleet }));
vi.mock('../../../api/dispatchPlanningClient', () => ({
  listDispatchFleetResources: vi.fn(async () => ({ items: [] })),
  createCarrierFleetVehicle,
  updateCarrierFleetVehicle,
}));

import { qk } from '../../../api/keys';
import { ExternalFleetView } from './ExternalFleetView';

const row = {
  id: 4,
  licensePlate: '29A-123.45',
  isActive: true,
  carrierId: 9,
  carrierName: 'Vận tải Hải An',
  carrierStatus: 'ACTIVE',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/** Seed the list into the cache: the view's own `useQuery` then renders the row
 *  synchronously, so the assertions never race a fetch. */
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(qk.externalFleet.union, { catalog: [row], linkedTrucks: [] });
  return render(
    <QueryClientProvider client={client}>
      <ExternalFleetView />
    </QueryClientProvider>,
  );
}

describe('ExternalFleetView (Xe ngoài)', () => {
  beforeEach(() => {
    updateCarrierFleetVehicle.mockReset();
  });

  it('surfaces a failed activate/deactivate instead of failing silently', async () => {
    updateCarrierFleetVehicle.mockRejectedValue(new Error('Không thể ngưng xe đang có chuyến.'));
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Ngưng hoạt động' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể ngưng xe đang có chuyến.');
    expect(updateCarrierFleetVehicle).toHaveBeenCalledWith(4, { isActive: false });
  });

  it('clears the failure banner once a retry succeeds', async () => {
    updateCarrierFleetVehicle.mockRejectedValueOnce(new Error('Lỗi tạm thời.'));
    updateCarrierFleetVehicle.mockResolvedValueOnce({});
    mount();

    fireEvent.click(screen.getByRole('button', { name: 'Ngưng hoạt động' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Lỗi tạm thời.');

    fireEvent.click(screen.getByRole('button', { name: 'Ngưng hoạt động' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
