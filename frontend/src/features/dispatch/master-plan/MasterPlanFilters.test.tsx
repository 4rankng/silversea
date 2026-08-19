import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn() },
}));

import { configClient } from '../../../api/configClient';
import { MasterPlanFilters } from './MasterPlanFilters';

const EMPTY_FILTERS = {
  q: '',
  tradeDirection: '' as const,
  allocationStatus: '' as const,
  deliveryDateFrom: '',
  deliveryDateTo: '',
  portIds: [],
  carrierKeys: [],
};

const NFD_PORT_LABEL = 'Ca\u0309ng Hải Phòng';

describe('MasterPlanFilters', () => {
  it('uses each database-owned zone label exactly once in the port facet', async () => {
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
        { code: 'HAI_PHONG_NFD', label: NFD_PORT_LABEL, sortOrder: 30 },
      ],
    });

    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cảng Hải Phòng' })).toBeTruthy();
      expect(screen.getByRole('button', { name: NFD_PORT_LABEL })).toBeTruthy();
    });

    expect(screen.getByText('Chọn cảng lạch huyện…')).toBeTruthy();
    expect(screen.getByText('Chọn cảng hải phòng…')).toBeTruthy();
    expect(screen.queryByText('Cảng Cảng Hải Phòng')).toBeNull();
    expect(screen.queryByText('Chọn cảng cảng hải phòng…')).toBeNull();
  });
});
