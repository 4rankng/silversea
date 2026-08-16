import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { businessDateISO } from '../../../lib/format';

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
      />,
    );

    expect(container.querySelectorAll('[data-input-wrapper]')).toHaveLength(7);

    expect(screen.getByText('Tìm nhanh')).toBeTruthy();
    expect(screen.getByText('Phân xe')).toBeTruthy();
    expect(screen.getByText('Điểm nâng')).toBeTruthy();
    expect(screen.getByText('Điểm hạ')).toBeTruthy();
    expect(screen.getByText('Điểm trả')).toBeTruthy();
    expect(screen.getByText('Giờ chạy')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Tìm nhanh'), { target: { value: 'BILL-001' } });
    fireEvent.change(screen.getByLabelText('Phân xe'), { target: { value: 'UNASSIGNED' } });

    expect(onChange).toHaveBeenCalledWith({ q: 'BILL-001' });
    expect(onChange).toHaveBeenCalledWith({ assignmentStatus: 'UNASSIGNED' });

    fireEvent.focus(screen.getByLabelText('Tìm điểm trả'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'KCN Vân Trung' }));
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [42] });
    expect(screen.queryByRole('option', { name: 'KCN Vân Trung' })).toBeNull();

    fireEvent.focus(screen.getByLabelText('Tìm điểm nâng'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cảng Hải Phòng' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'Cảng Hải Phòng' }));
    expect(onChange).toHaveBeenCalledWith({ pickupIds: [7] });
    expect(screen.queryByRole('option', { name: 'Cảng Hải Phòng' })).toBeNull();

    fireEvent.focus(screen.getByLabelText('Tìm điểm hạ'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'ICD Mỹ Đình' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'ICD Mỹ Đình' }));
    expect(onChange).toHaveBeenCalledWith({ dropoffIds: [9] });
    expect(screen.queryByRole('option', { name: 'ICD Mỹ Đình' })).toBeNull();
  });

  it('closes an open point picker with Escape or focus loss', async () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      />,
    );

    const pointSearch = screen.getByLabelText('Tìm điểm trả');
    fireEvent.focus(pointSearch);
    await waitFor(() => expect(pointSearch.getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(screen.getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.keyDown(pointSearch, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: 'KCN Vân Trung' })).toBeNull();
    await waitFor(() => expect(pointSearch.getAttribute('aria-expanded')).toBe('false'));

    fireEvent.focus(pointSearch);
    await waitFor(() => expect(screen.getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.blur(pointSearch);
    expect(screen.queryByRole('option', { name: 'KCN Vân Trung' })).toBeNull();
  });

  it('lets a keyboard user choose the active point result', async () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      />,
    );

    const pointSearch = screen.getByLabelText('Tìm điểm trả');
    fireEvent.focus(pointSearch);
    await waitFor(() => expect(screen.getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.keyDown(pointSearch, { key: 'ArrowDown' });
    expect(pointSearch.getAttribute('aria-activedescendant')).toContain('42');
    fireEvent.keyDown(pointSearch, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [42] });
    expect(screen.queryByRole('option', { name: 'KCN Vân Trung' })).toBeNull();
  });

  it('resets keyboard navigation when a narrower point search replaces the results', async () => {
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
      />,
    );

    const pointSearch = screen.getByLabelText('Tìm điểm trả');
    fireEvent.focus(pointSearch);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Cảng Hải Phòng' })).toBeTruthy());
    fireEvent.keyDown(pointSearch, { key: 'ArrowDown' });
    fireEvent.keyDown(pointSearch, { key: 'ArrowDown' });
    expect(pointSearch.getAttribute('aria-activedescendant')).toContain('7');

    fireEvent.change(pointSearch, { target: { value: 'Mỹ' } });
    fireEvent.keyDown(pointSearch, { key: 'ArrowDown' });
    expect(pointSearch.getAttribute('aria-activedescendant')).toBeNull();
    resolveNarrowSearch?.([{ id: 9, name: 'ICD Mỹ Đình' }]);
    await waitFor(() => expect(screen.getByRole('option', { name: 'ICD Mỹ Đình' })).toBeTruthy());
    expect(pointSearch.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(pointSearch, { key: 'ArrowDown' });
    fireEvent.keyDown(pointSearch, { key: 'Enter' });

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
      />,
    );

    fireEvent.focus(screen.getByLabelText('Tìm điểm trả'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Không tìm thấy điểm phù hợp.'));
  });

  it('keeps advanced filters compact but discoverable on a phone viewport', () => {
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={vi.fn()}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Thêm bộ lọc' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Ẩn bộ lọc' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('returns a changed transport date to today', () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={{ ...EMPTY_DETAILED_PLAN_FILTERS, date: '2099-01-01' }}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Về hôm nay' }));
    expect(onChange).toHaveBeenCalledWith({ date: businessDateISO() });
  });
});
