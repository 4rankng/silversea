import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(within(drawer).getByRole('button', { name: 'Tất cả các ngày' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Hôm nay' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Hôm sau' })).toBeTruthy();
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

  it('renders date shortcuts as explicit pressed buttons', () => {
    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Tất cả các ngày' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Hôm nay' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Hôm sau' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses the compact control tokens for the bespoke desktop carrier facet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const triggerRule = css.match(/\.master-plan-filters__facet-trigger\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const selectRule = css.match(/\.master-plan-filters__select > button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(triggerRule).toContain('min-height: var(--control-compact-h)');
    expect(triggerRule).toContain('height: var(--control-compact-h)');
    expect(triggerRule).toContain('font-size: var(--control-compact-font-size)');
    expect(triggerRule).toContain('line-height: var(--control-compact-line-height)');
    expect(selectRule).toContain('height: var(--control-compact-h)');
    expect(selectRule).toContain('min-height: var(--control-compact-h)');
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.master-plan-filters__facet-trigger\s*\{[\s\S]*?height:\s*var\(--control-touch-h\);/);
  });

  it('temporarily hides the Lạch Huyện and Hải Phòng port facets while preserving other zones', async () => {
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10 },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20 },
        { code: 'HAI_PHONG_NFD', label: NFD_PORT_LABEL, sortOrder: 30 },
        { code: 'QUANG_NINH', label: 'Quảng Ninh', sortOrder: 40 },
      ],
    });

    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cảng Quảng Ninh' })).toBeTruthy();
    });

    expect(screen.queryByRole('button', { name: 'Cảng Lạch Huyện' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cảng Hải Phòng' })).toBeNull();
    expect(screen.queryByRole('button', { name: NFD_PORT_LABEL })).toBeNull();
    expect(screen.queryByText('Chọn cảng lạch huyện…')).toBeNull();
    expect(screen.queryByText('Chọn cảng hải phòng…')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const drawer = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(within(drawer).getByRole('button', { name: 'Cảng Quảng Ninh' })).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Cảng Lạch Huyện' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Cảng Hải Phòng' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: NFD_PORT_LABEL })).toBeNull();
  });
});
