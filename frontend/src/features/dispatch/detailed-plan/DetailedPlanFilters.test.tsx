import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { businessDateISO } from '../../../lib/format';

const TEST_ZONES = [{ code: 'LACH_HUYEN', label: 'Lạch Huyện' }, { code: 'HAI_PHONG', label: 'Cảng Hải Phòng' }];

/** Open the multi-select popover for the given visible label (Điểm nâng / hạ / trả). */
function openFacet(label: string) {
  // The trigger shows either "Chọn <label>…" (nothing selected) or
  // "Đã chọn N <label>" (some selections). Match the label either way.
  const trigger = screen.getByRole('button', { name: new RegExp(`(Chọn|Đã chọn)[^]*${label}`) });
  fireEvent.click(trigger);
  return trigger;
}

function openFilterDrawer() {
  fireEvent.click(screen.getByRole('button', { name: /^Bộ lọc/ }));
  return screen.getByRole('dialog', { name: 'Bộ lọc kế hoạch' });
}

function getPopover(label: string) {
  return screen.getByRole('listbox', { name: new RegExp(`Danh sách ${label}`, 'i') });
}

function getPicker(label: string) {
  // The popover container is the listbox's parent. Locate it via the listbox
  // rather than a fragile class selector so the test stays coupled to the
  // public accessibility tree.
  const listbox = getPopover(label);
  return listbox.parentElement as HTMLElement;
}

async function pickCheckbox(label: string, facetName: string) {
  const popover = getPopover(label);
  const checkbox = within(popover).getByRole('checkbox', { name: facetName });
  fireEvent.click(checkbox);
  return checkbox;
}

describe('DetailedPlanFilters', () => {
  it('provides visible labels and forwards dispatch-specific filter changes', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([{ id: 7, name: 'Cảng Hải Phòng' }])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([{ id: 9, name: 'ICD Mỹ Đình' }])}
        zones={TEST_ZONES}
      />,
    );

    expect(container.querySelectorAll('[data-input-wrapper]')).toHaveLength(2);
    expect(screen.getByText('Ngày vận chuyển')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hôm nay' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tất cả ngày' }).getAttribute('aria-pressed')).toBe('true');
    const dateMode = screen.getByRole('group', { name: 'Phạm vi ngày vận chuyển' });
    const selectedDateMode = within(dateMode).getByRole('button', { name: 'Tất cả ngày' });
    const selectedDateIcon = selectedDateMode.querySelector('svg');
    expect(selectedDateIcon).toBeTruthy();
    expect(selectedDateIcon?.parentElement).toBe(selectedDateMode);
    expect(within(dateMode).getByRole('button', { name: 'Hôm nay' }).querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onChange).toHaveBeenCalledWith({ date: businessDateISO() });
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả ngày' }));
    expect(onChange).toHaveBeenCalledWith({ date: '' });

    const drawer = openFilterDrawer();
    expect(document.querySelectorAll('[data-input-wrapper]')).toHaveLength(4);

    expect(screen.getByText('Tìm nhanh')).toBeTruthy();
    expect(screen.getAllByText('Ngày vận chuyển')).toHaveLength(1);
    expect(screen.getByText('Phân xe')).toBeTruthy();
    expect(screen.getByText('Điểm nâng')).toBeTruthy();
    expect(screen.getByText('Điểm hạ')).toBeTruthy();
    expect(screen.getByText('Điểm trả')).toBeTruthy();
    expect(screen.getByText('Giờ chạy')).toBeTruthy();
    expect(drawer.querySelectorAll('.detailed-plan-filters__field--direction')).toHaveLength(1);
    expect(drawer.querySelector('.detailed-plan-filters__field--direction')?.textContent).toContain('Chiều hàng');
    expect(drawer.querySelectorAll('.detailed-plan-filters__field--assignment')).toHaveLength(1);
    expect(drawer.querySelector('.detailed-plan-filters__field--assignment')?.textContent).toContain('Phân xe');
    expect(within(drawer).queryByText('Ngày vận chuyển')).toBeNull();
    expect(within(drawer).getByRole('heading', { name: 'Phân xe và giờ chạy' })).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Điểm giao nhận' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Nhập/Xuất Chiều hàng' }));
    fireEvent.click(screen.getByRole('option', { name: 'Nhập' }));
    expect(onChange).toHaveBeenCalledWith({ direction: 'IMPORT' });

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả Phân xe' }));
    fireEvent.click(screen.getByRole('option', { name: 'Chưa gán Biển số' }));
    expect(onChange).toHaveBeenCalledWith({ assignmentStatus: 'UNASSIGNED' });

    const hourFrom = screen.getByLabelText('Giờ từ');
    const hourTo = screen.getByLabelText('Giờ đến');
    expect(hourFrom.getAttribute('type')).toBe('time');
    expect(hourTo.getAttribute('type')).toBe('time');
    fireEvent.change(hourFrom, { target: { value: '07:30' } });
    fireEvent.change(hourTo, { target: { value: '09:45' } });
    expect(onChange).toHaveBeenCalledWith({ hourFrom: '07:30' });
    expect(onChange).toHaveBeenCalledWith({ hourTo: '09:45' });

    fireEvent.change(screen.getByLabelText('Tìm nhanh'), { target: { value: 'BILL-001' } });

    expect(onChange).toHaveBeenCalledWith({ q: 'BILL-001' });

    openFacet('điểm trả');
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('checkbox', { name: 'KCN Vân Trung' })).toBeTruthy());
    await pickCheckbox('điểm trả', 'KCN Vân Trung');
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [42] });
    // Popover stays open after selection — selections live inside the dropdown.
    expect(getPopover('điểm trả')).toBeTruthy();

    openFacet('điểm nâng');
    await waitFor(() => expect(within(getPopover('điểm nâng')).getByRole('checkbox', { name: 'Cảng Hải Phòng' })).toBeTruthy());
    await pickCheckbox('điểm nâng', 'Cảng Hải Phòng');
    expect(onChange).toHaveBeenCalledWith({ pickupIds: [7] });
    expect(getPopover('điểm nâng')).toBeTruthy();

    openFacet('điểm hạ');
    await waitFor(() => expect(within(getPopover('điểm hạ')).getByRole('checkbox', { name: 'ICD Mỹ Đình' })).toBeTruthy());
    await pickCheckbox('điểm hạ', 'ICD Mỹ Đình');
    expect(onChange).toHaveBeenCalledWith({ dropoffIds: [9] });
    expect(getPopover('điểm hạ')).toBeTruthy();
  });

  it('keeps an open facet popover open while toggling selections and closes on outside click', async () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    openFilterDrawer();
    openFacet('điểm trả');
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('checkbox', { name: 'KCN Vân Trung' })).toBeTruthy());
    await pickCheckbox('điểm trả', 'KCN Vân Trung');
    // Multi-select popover must stay open after a click — selections live inside.
    expect(getPopover('điểm trả')).toBeTruthy();
    // Click outside the popover to close.
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
  });

  it('closes the popover with Escape and returns focus to the trigger', async () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    openFilterDrawer();
    const trigger = openFacet('điểm trả');
    await waitFor(() => expect(within(getPopover('điểm trả')).getByRole('checkbox', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: /Danh sách điểm trả/i })).toBeNull());
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  });

  it('lets a user narrow the facet list by typing into the popover search', async () => {
    const onChange = vi.fn();
    let resolveNarrowSearch: ((items: Array<{ id: number; name: string }>) => void) | undefined;
    const loadDeliveryPointFacets = vi.fn((query?: string) => query
      ? new Promise<Array<{ id: number; name: string }>>((resolve) => { resolveNarrowSearch = resolve; })
      : Promise.resolve([{ id: 42, name: 'KCN Vân Trung' }, { id: 7, name: 'Cảng Hải Phòng' }]));
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={onChange}
        loadDeliveryPointFacets={loadDeliveryPointFacets}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    openFilterDrawer();
    openFacet('điểm trả');
    const popover = getPopover('điểm trả');
    const picker = getPicker('điểm trả');
    await waitFor(() => expect(within(popover).getByRole('checkbox', { name: 'Cảng Hải Phòng' })).toBeTruthy());
    const search = within(picker).getByLabelText('Tìm điểm trả');
    fireEvent.change(search, { target: { value: 'Mỹ' } });
    await waitFor(() => expect(loadDeliveryPointFacets).toHaveBeenCalledWith('Mỹ'));
    resolveNarrowSearch?.([{ id: 9, name: 'ICD Mỹ Đình' }]);
    await waitFor(() => expect(within(popover).getByRole('checkbox', { name: 'ICD Mỹ Đình' })).toBeTruthy());

    await pickCheckbox('điểm trả', 'ICD Mỹ Đình');
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [9] });
  });

  it('explains when an opened point picker has no matching locations', async () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    openFilterDrawer();
    openFacet('điểm trả');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Không tìm thấy điểm phù hợp.'));
  });

  it('keeps structured filters out of the results layout in a dedicated drawer', () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Bộ lọc kế hoạch' })).toBeNull();
    const drawer = openFilterDrawer();
    expect(within(drawer).getByRole('button', { name: 'Xem kết quả' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Đặt lại' })).toBeTruthy();
  });

  it('always exposes today and all-days shortcuts for transport date', () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, date: '2099-01-01' }}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    expect(screen.queryByRole('dialog', { name: 'Bộ lọc kế hoạch' })).toBeNull();
    expect(screen.getByLabelText('Ngày vận chuyển')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Phạm vi ngày vận chuyển' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hôm nay' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Tất cả ngày' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(onChange).toHaveBeenCalledWith({ date: businessDateISO() });
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả ngày' }));
    expect(onChange).toHaveBeenCalledWith({ date: '' });
  });

  it('resets drawer filters without clearing the always-visible date scope', () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, q: 'BILL-001', date: '2099-01-01', direction: 'IMPORT' }}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    const drawer = openFilterDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Đặt lại' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_DETAILED_PLAN_FILTERS,
      q: 'BILL-001',
      date: '2099-01-01',
    });
  });

  it('clears every filter back to the today-based default from one coherent toolbar action', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DetailedPlanFilters
        filters={{
          q: 'BILL-001',
          date: '2099-01-01',
          direction: 'IMPORT',
          assignmentStatus: 'UNASSIGNED',
          pickupIds: [1],
          dropoffIds: [2],
          deliveryPointIds: [3],
          hourFrom: '07:30',
          hourTo: '09:45',
          zone: 'LACH_HUYEN',
        }}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    expect(screen.getByText('Đang lọc 10 điều kiện')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xóa tất cả' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_DETAILED_PLAN_FILTERS);

    rerender(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );
    expect(screen.queryByText('Mặc định: mọi ngày vận chuyển')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xóa tất cả' })).toBeNull();
  });

  it('lets a user clear all selections from inside the popover footer', async () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, deliveryPointIds: [42] }}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
        zones={TEST_ZONES}
      />,
    );

    openFilterDrawer();
    expect(screen.getByRole('button', { name: /Đã chọn 1 điểm trả/ })).toBeTruthy();
    openFacet('điểm trả');
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ chọn tất cả' }));
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [] });
  });
});
