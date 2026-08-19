import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  it('keeps search and cargo direction in the phone toolbar while opening advanced filters in a drawer', () => {
    const onChange = vi.fn();
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items: [] });
    render(
      <MasterPlanFilters
        filters={{ ...EMPTY_FILTERS, q: 'BL-001', allocationStatus: 'NOT_ALLOCATED', deliveryDateFrom: '2026-08-01', portIds: [7] }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText('Tìm kiếm lô hàng')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tất cả Chiều hàng' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bộ lọc, 3 đang áp dụng' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc, 3 đang áp dụng' }));
    const drawer = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(within(drawer).getByRole('heading', { name: 'Phân xe và ngày giao' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Cảng và nhà xe' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Đặt lại' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Xem kết quả' })).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Đặt lại' }));
    expect(onChange).toHaveBeenLastCalledWith({
      allocationStatus: '',
      deliveryDateFrom: '',
      deliveryDateTo: '',
      portIds: [],
      carrierKeys: [],
    });
  });

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
