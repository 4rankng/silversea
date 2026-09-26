import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { businessDateISO, formatISODate } from '../../../lib/format';
import { MonthProvider, useMonth } from '../../../hooks/useMonth';

const TEST_ZONES = [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }, { code: 'HAI_PHONG', label: 'Cảng Hải Phòng' }];

function MonthProbe() {
  const { month, year } = useMonth();
  return <span data-testid="month-probe">{`${month}/${year}`}</span>;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

/** Router + query + month context: useNavigate, useTripOptions and useMonth
 *  all need their providers (Gán xe sets the master-plan month scope). */
function wrapFilters(ui: React.ReactElement, initialEntry = '/dispatch-detail') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <MonthProvider>
          <Routes>
            <Route path="/dispatch-detail" element={<>{ui}<MonthProbe /><LocationProbe /></>} />
            <Route path="/dispatch" element={<><span>dispatch-landed</span><MonthProbe /><LocationProbe /></>} />
          </Routes>
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

function renderFilters(ui: React.ReactElement) {
  return render(wrapFilters(ui));
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
    // Card 20260926_55: the h1 matches the app chrome — 'Kế hoạch Chi tiết Xe'
    // (supersedes the _50-era 'Chi tiết lô hàng' pin; topbar context hidden).
    expect(screen.getByRole('heading', { name: 'Kế hoạch Chi tiết Xe' })).toBeTruthy();
    const presetGroup = screen.getByRole('group', { name: 'Phạm vi ngày vận chuyển' });
    expect(presetGroup.querySelector('.detailed-plan-header__preset')).toBeTruthy();
    expect(within(presetGroup).getByRole('button', { name: 'Tất cả' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Khoảng ngày vận chuyển' })).toBeTruthy();
    // + Gán xe primary rides Row 1's right end (ruling c).
    expect(screen.getByRole('button', { name: 'Gán xe' })).toBeTruthy();
    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
    expect(screen.queryByText('Thời gian')).toBeNull();

    const ribbon = container.querySelector('[data-component="detailed-plan-ribbon"]');
    expect(ribbon).toBeTruthy();
    expect(screen.getByPlaceholderText('Bill, Cont, Tờ khai...')).toBeTruthy();
    // ⌘K badge rides the search field (ruling a).
    expect(screen.getByText('⌘K')).toBeTruthy();
    // Label-in-control: the integrated trigger text IS the accessible name.
    expect(screen.getByRole('button', { name: 'Khách: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hướng: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Điều xe: Tất cả' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dữ liệu: Tất cả' })).toBeTruthy();
    expect(within(ribbon as HTMLElement).getByRole('button', { name: 'Xóa lọc' })).toBeTruthy();
  });

  it('Gán xe hands the active date scope to the master plan', async () => {
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, date: '2026-09-15' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gán xe' }));
    expect(await screen.findByText('dispatch-landed')).toBeTruthy();
    expect(screen.getByTestId('location-probe').textContent).toBe('/dispatch');
    // The month context carries the filter's scope month (9/2026).
    expect(screen.getByTestId('month-probe').textContent).toBe('9/2026');
  });

  it('⌘K focuses the quick search', () => {
    renderFilters(<DetailedPlanFilters {...baseProps()} />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText('Tìm nhanh'));
  });

  it('clicking a preset updates the trigger value instantly WITHOUT opening the picker', () => {
    const onChange = vi.fn();
    const view = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    expect(screen.queryByRole('dialog', { name: 'Khoảng ngày vận chuyển' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onChange).toHaveBeenCalledWith({ date: businessDateISO(), dateFrom: '', dateTo: '' });

    const today = businessDateISO();
    view.rerender(
      wrapFilters(
        <DetailedPlanFilters
          {...baseProps()}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, date: today }}
        />,
      ),
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
      wrapFilters(
        <DetailedPlanFilters
          {...baseProps(onChange)}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dateFrom: '2026-09-15' }}
        />,
      ),
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

    rerender(
      wrapFilters(
        <DetailedPlanFilters
          {...baseProps(onChange)}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dataStatus: 'MISSING' }}
        />,
      ),
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
