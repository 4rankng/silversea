import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { businessDateISO, formatISODate } from '../../../lib/format';

const TEST_ZONES = [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }, { code: 'HAI_PHONG', label: 'Cảng Hải Phòng' }];

/** useTripOptions needs a react-query context (customer catalog bootstrap). */
function renderFilters(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Common props so each test lists only what it varies. */
function baseProps(onChange = vi.fn()) {
  return {
    filters: { ...EMPTY_DETAILED_PLAN_FILTERS },
    onChange,
    loadDeliveryPointFacets: vi.fn().mockResolvedValue([]),
    loadPickupPortFacets: vi.fn().mockResolvedValue([]),
    loadDropoffPortFacets: vi.fn().mockResolvedValue([]),
    zones: TEST_ZONES,
  };
}

function openFilterDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
  return screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch' });
}

function getPopover(label: string) {
  return screen.getByRole('listbox', { name: new RegExp(`Danh sách ${label}`, 'i') });
}

function getPicker(label: string) {
  const listbox = getPopover(label);
  return listbox.parentElement as HTMLElement;
}

async function pickCheckbox(label: string, facetName: string) {
  const popover = getPopover(label);
  const option = within(popover).getByRole('option', { name: facetName });
  fireEvent.click(option);
  return option;
}

describe('DetailedPlanFilters — two-tier header (card 20260926_50)', () => {
  it('renders row 1 (title + presets adjacent to the range trigger) and row 2 as one ribbon', () => {
    const onChange = vi.fn();
    const { container } = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    expect(container.querySelector('[data-component="detailed-plan-header"]')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    const presetGroup = screen.getByRole('group', { name: 'Phạm vi ngày vận chuyển' });
    expect(presetGroup.querySelector('.detailed-plan-header__preset')).toBeTruthy();
    expect(within(presetGroup).getByRole('button', { name: 'Tất cả' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Khoảng ngày vận chuyển' })).toBeTruthy();
    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
    expect(screen.queryByText('Thời gian')).toBeNull();

    const ribbon = container.querySelector('[data-component="detailed-plan-ribbon"]');
    expect(ribbon).toBeTruthy();
    expect(screen.getByPlaceholderText('Bill, Cont, Tờ khai...')).toBeTruthy();
    // Label-in-control: the integrated trigger text IS the accessible name.
    expect(screen.getByRole('button', { name: 'Khách: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hướng: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Điều xe: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dữ liệu: Tất cả' })).toBeTruthy();
    expect(within(ribbon as HTMLElement).getByRole('button', { name: 'Xóa lọc' })).toBeTruthy();
  });

  it('clicking a preset updates the trigger value instantly WITHOUT opening the picker', () => {
    const onChange = vi.fn();
    const view = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    expect(screen.queryByRole('dialog', { name: 'Khoảng ngày vận chuyển' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onChange).toHaveBeenCalledWith({ date: businessDateISO(), dateFrom: '', dateTo: '' });

    const today = businessDateISO();
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DetailedPlanFilters
          {...baseProps()}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, date: today }}
        />
      </QueryClientProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Khoảng ngày vận chuyển' });
    expect(trigger.textContent).toContain(`${formatISODate(today)} - ${formatISODate(today)}`);
    expect(screen.queryByRole('dialog', { name: 'Khoảng ngày vận chuyển' })).toBeNull();
  });

  it('writes an explicit range through the dual-calendar popover (controlled flow)', () => {
    const onChange = vi.fn();
    const view = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Khoảng ngày vận chuyển' }));
    const popover = screen.getByRole('dialog', { name: 'Khoảng ngày vận chuyển' });
    const fromPanel = popover.querySelector('.date-range__panel[data-side="from"]') as HTMLElement;
    const toPanel = popover.querySelector('.date-range__panel[data-side="to"]') as HTMLElement;
    expect(fromPanel).toBeTruthy();
    expect(toPanel).toBeTruthy();
    // Controlled component: the parent applies each pick, then the rerender
    // feeds the value back before the second side is chosen.
    fireEvent.click(within(fromPanel).getByRole('button', { name: '15 Tháng 9 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '2026-09-15', dateTo: '' });
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DetailedPlanFilters
          {...baseProps(onChange)}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dateFrom: '2026-09-15' }}
        />
      </QueryClientProvider>,
    );
    const reopened = screen.getByRole('dialog', { name: 'Khoảng ngày vận chuyển' });
    fireEvent.click(within(reopened.querySelector('.date-range__panel[data-side="to"]') as HTMLElement).getByRole('button', { name: '22 Tháng 9 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '2026-09-15', dateTo: '2026-09-22' });

    fireEvent.click(within(reopened).getByRole('button', { name: 'Xóa' }));
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '', dateTo: '' });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Xong' }));
    expect(screen.queryByRole('dialog', { name: 'Khoảng ngày vận chuyển' })).toBeNull();
  });

  it('maps ribbon selects to their filter patches and keeps labels in the triggers', () => {
    const onChange = vi.fn();
    renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hướng: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Nhập' }));
    expect(onChange).toHaveBeenCalledWith({ direction: 'IMPORT' });

    fireEvent.click(screen.getByRole('button', { name: 'Điều xe: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Chưa điều xe' }));
    expect(onChange).toHaveBeenCalledWith({ assignmentStatus: 'UNASSIGNED' });

    fireEvent.click(screen.getByRole('button', { name: 'Dữ liệu: Tất cả' }));
    fireEvent.click(screen.getByRole('option', { name: 'Thiếu dữ liệu' }));
    expect(onChange).toHaveBeenCalledWith({ dataStatus: 'MISSING' });
  });

  it('keeps Xóa lọc disabled at default and resets every filter when enabled', () => {
    const onChange = vi.fn();
    const { rerender } = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);
    const clearButton = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(clearButton).toBeDisabled();
    fireEvent.click(clearButton);
    expect(onChange).not.toHaveBeenCalled();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <DetailedPlanFilters
          {...baseProps(onChange)}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dataStatus: 'MISSING' }}
        />
      </QueryClientProvider>,
    );
    const enabled = screen.getByRole('button', { name: 'Xóa lọc' });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    expect(onChange).toHaveBeenCalledWith(EMPTY_DETAILED_PLAN_FILTERS);
  });
});

describe('DetailedPlanFilters — advanced drawer (hours/zone/points)', () => {
  it('keeps structured filters in the drawer and off the ribbon', () => {
    const onChange = vi.fn();
    renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    const drawer = openFilterDrawer();
    expect(within(drawer).getByRole('textbox', { name: 'Giờ từ' })).toBeTruthy();
    expect(within(drawer).getByRole('textbox', { name: 'Giờ đến' })).toBeTruthy();
    expect(within(drawer).getByText('Điểm nâng')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Giờ chạy và khu vực' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Điểm giao nhận' })).toBeTruthy();
    // Ribbon-owned filters must NOT duplicate inside the drawer.
    expect(within(drawer).queryByText('Chiều hàng')).toBeNull();
    expect(within(drawer).queryByText('Phân xe')).toBeNull();

    const hourFrom = within(drawer).getByLabelText('Giờ từ');
    expect(hourFrom).toHaveAttribute('type', 'text');
    expect(hourFrom).toHaveAttribute('placeholder', 'HH:mm');
    fireEvent.change(hourFrom, { target: { value: '07:30' } });
    fireEvent.blur(hourFrom);
    expect(onChange).toHaveBeenCalledWith({ hourFrom: '07:30' });

    fireEvent.click(within(drawer).getByRole('button', { name: 'Đặt lại' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_DETAILED_PLAN_FILTERS,
      date: '',
    });
  });

  it('forwards zone selection and drawer badge counts', async () => {
    const onChange = vi.fn();
    renderFilters(
      <DetailedPlanFilters
        {...baseProps(onChange)}
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, zone: 'LACH_HUYEN', hourFrom: '07:30' }}
      />,
    );
    const drawer = openFilterDrawer();
    expect(within(drawer).getByRole('button', { name: 'Lạch Huyện Khu vực' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bộ lọc, 2 đang áp dụng' })).toBeTruthy();
  });

  it('keeps the latest facet suggestions when an earlier search resolves later (DSP-FU-005)', async () => {
    let resolveEarlier!: (items: Array<{ id: number; name: string }>) => void;
    const loadDeliveryPointFacets = vi.fn((query?: string) => query === 'Mỹ'
      ? new Promise<Array<{ id: number; name: string }>>((resolve) => { resolveEarlier = resolve; })
      : Promise.resolve(query === 'Mỹ Đình' ? [{ id: 9, name: 'ICD Mỹ Đình' }] : []));
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        loadDeliveryPointFacets={loadDeliveryPointFacets}
      />,
    );
    openFilterDrawer();
    const trigger = screen.getByRole('button', { name: /Đã chọn 0 điểm trả|Chọn điểm trả…/ });
    fireEvent.click(trigger);
    const search = within(getPicker('điểm trả')).getByLabelText(/Tìm điểm trả/);
    fireEvent.change(search, { target: { value: 'Mỹ' } });
    await waitFor(() => expect(loadDeliveryPointFacets).toHaveBeenCalledWith('Mỹ'));
    fireEvent.change(search, { target: { value: 'Mỹ Đình' } });
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('option', { name: 'ICD Mỹ Đình' })).toBeInTheDocument());
    resolveEarlier([{ id: 8, name: 'Mỹ Tho' }]);
    expect(within(getPopover('điểm trả')).getByRole('option', { name: 'ICD Mỹ Đình' })).toBeInTheDocument();
  });

  it('keeps an open facet popover open while toggling selections and closes on outside click', async () => {
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
      />,
    );
    openFilterDrawer();
    const trigger = screen.getByRole('button', { name: /Chọn điểm trả…/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    await pickCheckbox('điểm trả', 'KCN Vân Trung');
    expect(getPopover('điểm trả')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
  });

  it('closes the popover with Escape and returns focus to the trigger', async () => {
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
      />,
    );
    openFilterDrawer();
    const trigger = screen.getByRole('button', { name: /Chọn điểm trả…/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  });

  it('lets a user clear all selections from inside the popover footer', async () => {
    const onChange = vi.fn();
    renderFilters(
      <DetailedPlanFilters
        {...baseProps(onChange)}
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, deliveryPointIds: [42] }}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
      />,
    );
    openFilterDrawer();
    expect(screen.getByRole('button', { name: /Đã chọn 1 điểm trả/ })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: /Đã chọn 1 điểm trả/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [] });
  });
});
