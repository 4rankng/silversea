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

function openFilterDialog() {
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

describe('DetailedPlanFilters — the shared strip (card 20260927_152)', () => {
  it('rides the shared bar: search, the from/to fields and the day scope on the line, criteria behind Bộ lọc', () => {
    const onChange = vi.fn();
    const { container } = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    expect(container.querySelector('[data-component="detailed-plan-header"]')).toBeTruthy();
    // Card 20260926_55: the h1 matches the app chrome — 'Kế hoạch Chi tiết Xe'
    // (supersedes the _50-era 'Chi tiết lô hàng' pin; topbar context hidden).
    expect(screen.getByRole('heading', { name: 'Kế hoạch Chi tiết Xe' })).toBeTruthy();

    // Card 20260927_152: the filter plane IS the shared bar — one wrapping line
    // inside one card. The page-local two-tier header and its ribbon are gone.
    const bar = container.querySelector('.filter-bar.filter-bar--card.list-filter-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(container.querySelector('[data-component="detailed-plan-ribbon"]')).toBeNull();
    expect(screen.getByPlaceholderText('Bill, Cont, Tờ khai...')).toBeTruthy();
    // No shortcut badge: the 2026-09-27 CHIEF ruling removed every rendered
    // ⌘K/kbd affordance (the ⌘K/Ctrl+K handler below stays live and invisible).
    expect(screen.queryByText('⌘K')).toBeNull();
    // The date scope is the shared button group (operator ruling 2026-09-27) and
    // rides the bar's `presets` slot — the slot the bar gives the quick ranges
    // beside the dates they set.
    const presetGroup = screen.getByRole('tablist', { name: 'Phạm vi ngày vận chuyển' });
    expect(presetGroup.className).toContain('ds-tabs--boxed');
    expect(within(presetGroup).getByRole('tab', { name: 'Tất cả' }).getAttribute('aria-selected')).toBe('true');
    expect(bar.querySelector('.filter-bar__presets')?.contains(presetGroup)).toBe(true);
    // CHIEF 2026-09-27: two independent date fields, no range picker.
    expect(screen.getByRole('group', { name: 'Khoảng ngày vận chuyển' })).toBeTruthy();
    expect(screen.getByLabelText('Từ ngày')).toBeTruthy();
    expect(screen.getByLabelText('Đến ngày')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Khoảng ngày vận chuyển' })).toBeNull();
    // The page's own actions ride the bar's action cluster: Gán xe and Xóa lọc.
    const actions = bar.querySelector('.filter-bar__actions') as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Gán xe' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'Xóa lọc' })).toBeTruthy();
    // Every criterion the lists do NOT share lives behind ONE trigger ON the bar
    // (card 20260927_152) — the four quick facets included (operator,
    // 2026-09-27: "why don't we group them in bộ lọc"), so no band stacks four
    // dropdown rows.
    expect(within(actions).queryByRole('button', { name: /^Bộ lọc/ })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Bộ lọc' })).toBeTruthy();
    expect(container.querySelector('.detailed-plan-ribbon__quick')).toBeNull();
    expect(screen.queryByText('Ngày vận chuyển')).toBeNull();
    expect(screen.queryByText('Thời gian')).toBeNull();

    // Label-in-control: the integrated trigger text IS the accessible name —
    // now inside the shared dialog, in one group.
    const dialog = openFilterDialog();
    const quick = within(dialog).getByRole('heading', { name: 'Bộ lọc nhanh' }).parentElement as HTMLElement;
    expect(quick.className).toContain('detailed-plan-filter-panel__group');
    expect(within(quick).getByRole('button', { name: 'Khách: Tất cả' })).toBeTruthy();
    expect(within(quick).getByRole('button', { name: 'Xuất / Nhập: Tất cả' })).toBeTruthy();
    expect(within(quick).getByRole('button', { name: 'Điều xe: Tất cả' })).toBeTruthy();
    expect(within(quick).getByRole('button', { name: 'Dữ liệu: Tất cả' })).toBeTruthy();
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

  it('clicking a preset updates the date fields instantly WITHOUT opening a picker', () => {
    const onChange = vi.fn();
    const view = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Hôm nay' }));
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
    // Both fields carry the scope date (segmented: DD / MM / YYYY); no popover,
    // no merged range trigger.
    const [expectedDay, expectedMonth, expectedYear] = formatISODate(today).split('/');
    const fromDay = screen.getByLabelText('Từ ngày') as HTMLInputElement;
    expect(fromDay.value).toBe(expectedDay);
    expect((screen.getByLabelText('Tháng — Từ ngày') as HTMLInputElement).value).toBe(expectedMonth);
    expect((screen.getByLabelText('Năm — Từ ngày') as HTMLInputElement).value).toBe(expectedYear);
    const toDay = screen.getByLabelText('Đến ngày') as HTMLInputElement;
    expect(toDay.value).toBe(expectedDay);
    expect((screen.getByLabelText('Tháng — Đến ngày') as HTMLInputElement).value).toBe(expectedMonth);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('writes an explicit range through the two independent date fields (controlled flow)', () => {
    const onChange = vi.fn();
    const view = renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    // Each field commits a complete DD/MM/YYYY draft as ISO, on its own.
    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '15/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '2026-09-15', dateTo: '' });
    view.rerender(
      wrapFilters(
        <DetailedPlanFilters
          {...baseProps(onChange)}
          filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dateFrom: '2026-09-15' }}
        />,
      ),
    );
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '22/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '2026-09-15', dateTo: '2026-09-22' });
    // No picker is involved anywhere in the flow.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bounds each field by the other so an out-of-order range can never be written', () => {
    const onChange = vi.fn();
    renderFilters(
      <DetailedPlanFilters
        {...baseProps(onChange)}
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, dateFrom: '2026-09-15', dateTo: '2026-09-22' }}
      />,
    );
    // Each field carries the other's boundary, so neither the calendar nor a
    // typed date can invert the range.
    expect((screen.getByLabelText('Từ ngày') as HTMLInputElement).max).toBe('2026-09-22');
    expect((screen.getByLabelText('Đến ngày') as HTMLInputElement).min).toBe('2026-09-15');

    fireEvent.change(screen.getByLabelText('Từ ngày'), { target: { value: '25/09/2026' } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '01/09/2026' } });
    expect(onChange).not.toHaveBeenCalled();

    // A date inside the boundary is written through.
    fireEvent.change(screen.getByLabelText('Đến ngày'), { target: { value: '20/09/2026' } });
    expect(onChange).toHaveBeenLastCalledWith({ date: '', dateFrom: '2026-09-15', dateTo: '2026-09-20' });
  });

  it('maps the drawer facet selects to their filter patches and keeps labels in the triggers', () => {
    const onChange = vi.fn();
    renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);
    openFilterDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Xuất / Nhập: Tất cả' }));
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

describe('DetailedPlanFilters — Bộ lọc dialog (hours/zone/points)', () => {
  it('keeps structured filters inside Bộ lọc and off the bar', () => {
    const onChange = vi.fn();
    renderFilters(<DetailedPlanFilters {...baseProps(onChange)} />);

    const dialog = openFilterDialog();
    expect(within(dialog).getByRole('textbox', { name: 'Giờ từ' })).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Giờ đến' })).toBeTruthy();
    expect(within(dialog).getByText('Điểm nâng')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Giờ chạy và khu vực' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Điểm giao nhận' })).toBeTruthy();
    // Criteria owned elsewhere must NOT duplicate inside the dialog.
    expect(within(dialog).queryByText('Xuất / Nhập')).toBeNull();
    expect(within(dialog).queryByText('Phân xe')).toBeNull();

    const hourFrom = within(dialog).getByLabelText('Giờ từ');
    expect(hourFrom).toHaveAttribute('type', 'text');
    expect(hourFrom).toHaveAttribute('placeholder', 'HH:mm');
    fireEvent.change(hourFrom, { target: { value: '07:30' } });
    fireEvent.blur(hourFrom);
    expect(onChange).toHaveBeenCalledWith({ hourFrom: '07:30' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Đặt lại' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_DETAILED_PLAN_FILTERS,
      date: '',
    });
  });

  it('forwards zone selection and the trigger badge count', async () => {
    const onChange = vi.fn();
    renderFilters(
      <DetailedPlanFilters
        {...baseProps(onChange)}
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, zone: 'LACH_HUYEN', hourFrom: '07:30' }}
      />,
    );
    const dialog = openFilterDialog();
    expect(within(dialog).getByRole('button', { name: 'Lạch Huyện Khu vực' })).toBeTruthy();
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
    openFilterDialog();
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
    openFilterDialog();
    const trigger = screen.getByRole('button', { name: /Chọn điểm trả…/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    await pickCheckbox('điểm trả', 'KCN Vân Trung');
    expect(getPopover('điểm trả')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
  });

  it('closes the facet popover with Escape — one shared dismissal, no stranded focus', async () => {
    // The facet picker is the innermost layer and `Bộ lọc` is a shared
    // `FilterDropdown` popover: both own the same Escape dismissal
    // (`useClickOutside(…, { escapeKey: true })`), so one press leaves neither
    // layer open. That is the primitive's contract, not this page's
    // (`components/FilterDropdown.test.tsx` pins it for the trigger alone).
    renderFilters(
      <DetailedPlanFilters
        {...baseProps()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
      />,
    );
    openFilterDialog();
    const trigger = screen.getByRole('button', { name: /Chọn điểm trả…/ });
    fireEvent.click(trigger);
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Bộ lọc kế hoạch' })).toBeNull();
    // The bar itself is untouched: its trigger is still there to reopen, so the
    // dismissal never strands the dispatcher outside the filter plane.
    expect(screen.getByRole('button', { name: 'Bộ lọc' })).toBeTruthy();
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
    openFilterDialog();
    expect(screen.getByRole('button', { name: /Đã chọn 1 điểm trả/ })).toBeTruthy();
    const trigger = screen.getByRole('button', { name: /Đã chọn 1 điểm trả/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [] });
  });
});
