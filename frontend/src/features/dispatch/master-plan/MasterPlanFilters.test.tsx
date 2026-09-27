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

describe('dispatch allocation filter buckets (card 20260925_5)', () => {
  const filtersSource = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanFilters.tsx'), 'utf8');
  const hookSource = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/useDispatchMasterPlan.ts'), 'utf8');

  it('drops Đang phân xe and offers the merged buckets in customer order', () => {
    expect(filtersSource).toContain("label: 'Chờ phân xe'");
    expect(filtersSource).toContain("label: 'Chờ phân nhà xe'");
    expect(filtersSource).toContain("label: 'Đã phân xong'");
    expect(filtersSource).not.toContain("label: 'Đang phân xe'");
  });

  it('sends the filter-only PENDING_CARRIER bucket and never the dropped status', () => {
    expect(hookSource).toContain('ShipmentAllocationFilter');
    expect(filtersSource).toContain('PENDING_CARRIER');
  });
});

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
    expect(within(drawer).getByRole('heading', { name: 'Nhà xe' })).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: 'Tất cả các ngày' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Hôm nay' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Hôm sau' })).toBeNull();
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

  it('drops the redundant date preset shortcuts (filter-bar law §5 — the date inputs cover them)', () => {
    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Tất cả các ngày' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hôm nay' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hôm sau' })).toBeNull();
  });

  it('hosts the page primary action inside the same toolbar row as the filters (case QA-2026-09-27-02)', () => {
    render(
      <MasterPlanFilters
        filters={EMPTY_FILTERS}
        onChange={vi.fn()}
        action={<button type="button" className="btn btn--primary btn--sm">Tạo lô hàng</button>}
      />,
    );

    // The action now lives inside the master-plan-filters shell, in a
    // dedicated actions slot. No standalone toolbar row exists above the
    // filters anymore.
    const trigger = screen.getByRole('button', { name: 'Bộ lọc' });
    const toolbar = trigger.closest('.master-plan-filters') as HTMLElement;
    expect(toolbar).toBeTruthy();
    const action = within(toolbar).getByRole('button', { name: 'Tạo lô hàng' });
    expect(action).toBeTruthy();
    const slots = toolbar.querySelectorAll('.master-plan-filters__actions');
    expect(slots.length).toBe(1);
    expect(within(slots[0] as HTMLElement).getByRole('button', { name: 'Tạo lô hàng' })).toBe(action);

    // The action slot is the LAST child so margin-left: auto keeps it flush
    // right; the Bộ lọc trigger is its left neighbor.
    const slot = slots[0] as HTMLElement;
    expect(slot.previousElementSibling).toBe(trigger);

    // The toolbar itself is one flex row; the advanced fields stay in the
    // DOM but are hidden by the CSS contract — they live in the drawer that
    // opens via the Bộ lọc trigger. jsdom doesn't always apply stylesheets,
    // so the CSS contract is pinned separately in MasterPlanGrid.test.tsx.
    const advancedFields = toolbar.querySelector('.master-plan-filters__advanced-fields') as HTMLElement | null;
    expect(advancedFields).toBeTruthy();
  });

  it('renders the Bộ lọc count badge whenever an advanced filter is applied (case QA-2026-09-27-02)', () => {
    render(
      <MasterPlanFilters
        filters={{ ...EMPTY_FILTERS, allocationStatus: 'NOT_ALLOCATED', deliveryDateFrom: '2026-08-01', portIds: [7] }}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: /Bộ lọc/ });
    expect(within(trigger).getByText('3')).toBeTruthy();
  });

  it('uses the compact control tokens for the bespoke desktop carrier facet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const triggerRule = css.match(/\.master-plan-filters__facet-trigger\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const selectRule = css.match(/\.master-plan-filters__select > button\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(triggerRule).toContain('min-height: var(--control-compact-h)');
    expect(triggerRule).toContain('height: var(--control-compact-h)');
    expect(triggerRule).toContain('font-size: var(--control-compact-font-size)');
    expect(triggerRule).toContain('line-height: var(--control-compact-line-height)');
    // Shared selects own their dimensions; this view sizes only its bespoke facet.
    expect(selectRule).not.toMatch(/(?:min-)?height:/);
    // Compact mobile contract (ticket 6770b9cb): the phone facet trigger is
    // 32px/11px at ≤640px instead of the old ≤767px 44px touch rule.
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.master-plan-filters__facet-trigger\s*\{[\s\S]*?height:\s*var\(--control-mobile-h\);/);
  });

  it('uses configured visibility for legacy port facets while preserving other zones', async () => {
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({
      items: [
        { code: 'LACH_HUYEN', label: 'Lạch Huyện', sortOrder: 10, showPortFacet: false },
        { code: 'HAI_PHONG', label: 'Cảng Hải Phòng', sortOrder: 20, showPortFacet: false },
        { code: 'HAI_PHONG_NFD', label: NFD_PORT_LABEL, sortOrder: 30, showPortFacet: false },
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
  it('keeps custom hidden zones hidden after renaming and shows a legacy label when configured', async () => {
    const items = [
      { code: 'ZONE_HIDDEN', label: 'Khu vực kiểm thử', sortOrder: 10, showPortFacet: false },
      { code: 'ZONE_VISIBLE', label: 'Lạch Huyện', sortOrder: 20, showPortFacet: true },
      { code: 'ZONE_DEFAULT', label: 'Mới', sortOrder: 30 },
    ];
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items });
    const first = render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cảng Mới' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cảng Khu vực kiểm thử' })).toBeNull();
    first.unmount();
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items: items.map(zone => zone.code === 'ZONE_HIDDEN' ? { ...zone, label: 'Đã đổi tên' } : zone) });
    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const drawer = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(within(drawer).queryByRole('button', { name: 'Cảng Đã đổi tên' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
  });

});
