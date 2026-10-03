import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/configClient', () => ({
  configClient: { getDispatchZones: vi.fn() },
}));

vi.mock('../../../api/shipmentClient', () => ({
  listZonePortFacets: vi.fn(),
}));

import { configClient } from '../../../api/configClient';
import { listZonePortFacets } from '../../../api/shipmentClient';
import { businessDateISO } from '../../../lib/format';
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
  it('keeps the shared criteria in the bar and opens the rest behind Bộ lọc', () => {
    const onChange = vi.fn();
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items: [] });
    render(
      <MasterPlanFilters
        filters={{ ...EMPTY_FILTERS, q: 'BL-001', allocationStatus: 'NOT_ALLOCATED', deliveryDateFrom: '2026-08-01', portIds: [7] }}
        onChange={onChange}
      />,
    );

    // The bar carries the criteria every list shares (the search field and the
    // from/to group); every master-plan criterion sits behind `Bộ lọc`.
    expect(screen.getByLabelText('Tìm kiếm lô hàng')).toBeTruthy();
    expect(screen.getAllByLabelText('Từ ngày')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Tất cả Xuất / Nhập' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' })).toBeNull();

    // allocationStatus + portIds applied. The delivery date is the bar's own
    // control, so it is no longer a dialog criterion and does not count.
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(within(dialog).getByRole('button', { name: 'Tất cả Xuất / Nhập' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Chờ phân xe Phân xe' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Nhà xe' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Tất cả các ngày' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Hôm nay' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Hôm sau' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Đặt lại' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Áp dụng' })).toBeTruthy();

    // `Đặt lại` clears exactly the criteria the dialog holds.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    expect(onChange).toHaveBeenLastCalledWith({
      tradeDirection: '',
      allocationStatus: '',
      portIds: [],
      carrierKeys: [],
    });
  });

  it('carries the quick delivery-date scope on the bar (operator 2026-10-02 — card 20261002_258)', () => {
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items: [] });
    const onChange = vi.fn();
    const view = render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={onChange} />);

    // The quick scope rides the bar beside the dates it sets — the same three
    // segments the Chi tiết screen carries (operator, 2026-10-02: "làm như bên
    // Chi tiết, để nút truy cập nhanh Hôm nay/sau/tất cả"). It supersedes the
    // old §5 exemption ("the date inputs cover them") on THIS surface only.
    const today = businessDateISO();
    const tomorrow = businessDateISO(new Date(Date.now() + 86_400_000));
    expect(screen.getByRole('tab', { name: 'Hôm nay' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Hôm sau' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Tất cả' })).toBeTruthy();

    // Segments set the same state the from/to fields set; Tất cả clears it.
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm nay' }));
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateFrom: today, deliveryDateTo: today });
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm sau' }));
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateFrom: tomorrow, deliveryDateTo: tomorrow });
    fireEvent.click(screen.getByRole('tab', { name: 'Tất cả' }));
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateFrom: '', deliveryDateTo: '' });

    // The active segment mirrors the applied filter; a custom range picks none.
    view.rerender(<MasterPlanFilters filters={{ ...EMPTY_FILTERS, deliveryDateFrom: today, deliveryDateTo: today }} onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Hôm nay' }).getAttribute('aria-selected')).toBe('true');
    view.rerender(<MasterPlanFilters filters={{ ...EMPTY_FILTERS, deliveryDateFrom: '2026-08-01', deliveryDateTo: '2026-08-10' }} onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'Hôm nay' }).getAttribute('aria-selected')).toBe('false');
  });

  it('hosts the page primary action inside the same toolbar row as the filters (case QA-2026-09-27-02)', () => {
    const { container } = render(
      <MasterPlanFilters
        filters={EMPTY_FILTERS}
        onChange={vi.fn()}
        action={<button type="button" className="btn btn--primary btn--sm">Tạo lô hàng</button>}
      />,
    );

    // The action rides the shared bar's actions slot, so it shares the strip's
    // one row instead of owning a toolbar row of its own. No standalone
    // toolbar row exists above the filters anymore.
    const bar = container.querySelector('.filter-bar.list-filter-bar') as HTMLElement | null;
    expect(bar).toBeTruthy();
    const action = within(bar as HTMLElement).getByRole('button', { name: 'Tạo lô hàng' });
    const slot = bar!.querySelector('.filter-bar__actions') as HTMLElement | null;
    expect(slot).toBeTruthy();
    expect(within(slot as HTMLElement).getByRole('button', { name: 'Tạo lô hàng' })).toBe(action);
  });

  it('renders the Bộ lọc count badge whenever a dialog criterion is applied (case QA-2026-09-27-02)', () => {
    render(
      <MasterPlanFilters
        filters={{ ...EMPTY_FILTERS, allocationStatus: 'NOT_ALLOCATED', deliveryDateFrom: '2026-08-01', portIds: [7] }}
        onChange={vi.fn()}
      />,
    );

    // allocationStatus + portIds; the delivery date is the bar's own control.
    const trigger = screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' });
    expect(within(trigger).getByText('2')).toBeTruthy();
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

    // The zone facets are dialog criteria now (card 20260927_152): the
    // visibility rule must still hold inside `Bộ lọc`.
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cảng Quảng Ninh' })).toBeTruthy();
    });

    expect(within(dialog).queryByRole('button', { name: 'Cảng Lạch Huyện' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Cảng Hải Phòng' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: NFD_PORT_LABEL })).toBeNull();
    expect(within(dialog).queryByText('Chọn cảng lạch huyện…')).toBeNull();
    expect(within(dialog).queryByText('Chọn cảng hải phòng…')).toBeNull();
  });
  it('keeps custom hidden zones hidden after renaming and shows a legacy label when configured', async () => {
    const items = [
      { code: 'ZONE_HIDDEN', label: 'Khu vực kiểm thử', sortOrder: 10, showPortFacet: false },
      { code: 'ZONE_VISIBLE', label: 'Lạch Huyện', sortOrder: 20, showPortFacet: true },
      { code: 'ZONE_DEFAULT', label: 'Mới', sortOrder: 30 },
    ];
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items });
    const first = render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(await within(dialog).findByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cảng Mới' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Cảng Khu vực kiểm thử' })).toBeNull();
    first.unmount();
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({ items: items.map(zone => zone.code === 'ZONE_HIDDEN' ? { ...zone, label: 'Đã đổi tên' } : zone) });
    render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const renamed = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });
    expect(await within(renamed).findByRole('button', { name: 'Cảng Lạch Huyện' })).toBeTruthy();
    expect(within(renamed).queryByRole('button', { name: 'Cảng Đã đổi tên' })).toBeNull();
  });

  it('scopes each zone facet to its own ports and never clears a sibling zone', async () => {
    vi.mocked(configClient.getDispatchZones).mockResolvedValue({
      items: [
        { code: 'ZONE_A', label: 'Lạch Huyện', sortOrder: 10, showPortFacet: true },
        { code: 'ZONE_B', label: 'Quảng Ninh', sortOrder: 20, showPortFacet: true },
      ],
    });
    vi.mocked(listZonePortFacets).mockImplementation(async (code: string) => ({
      items: code === 'ZONE_A'
        ? [{ id: 11, name: 'Cảng A', code: null }]
        : [{ id: 22, name: 'Cảng B', code: null }],
    }));

    const onChange = vi.fn();
    const { rerender } = render(<MasterPlanFilters filters={EMPTY_FILTERS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bộ lọc' }));
    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch tổng quát' });

    // Pick a port under zone A: only ids this zone lists may reach the wire.
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Cảng Lạch Huyện' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Cảng A' }));
    expect(onChange).toHaveBeenLastCalledWith({ portIds: [11] });

    rerender(<MasterPlanFilters filters={{ ...EMPTY_FILTERS, portIds: [11] }} onChange={onChange} />);
    // Zone B never listed port 11, so it must not claim the selection…
    expect(within(dialog).getByRole('button', { name: 'Cảng Quảng Ninh' })).toBeTruthy();
    // …while zone A carries it as its own chip.
    expect(within(dialog).getByRole('button', { name: '1 đã chọn' })).toBeTruthy();

    // Clearing zone B merges: A's selection survives the write.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cảng Quảng Ninh' }));
    const zoneBPopover = await screen.findByRole('dialog', { name: 'Chọn Cảng Quảng Ninh' });
    fireEvent.click(within(zoneBPopover).getByRole('button', { name: 'Bỏ chọn' }));
    expect(onChange).toHaveBeenLastCalledWith({ portIds: [11] });
  });

});
