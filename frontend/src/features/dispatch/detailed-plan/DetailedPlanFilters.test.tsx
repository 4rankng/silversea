import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DetailedPlanFilters } from './DetailedPlanFilters';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

describe('DetailedPlanFilters', () => {
  it('provides visible labels and forwards dispatch-specific filter changes', async () => {
    const onChange = vi.fn();
    render(
      <DetailedPlanFilters
        filters={EMPTY_DETAILED_PLAN_FILTERS}
        onChange={onChange}
        loadDeliveryPointFacets={vi.fn().mockResolvedValue([{ id: 42, name: 'KCN Vân Trung' }])}
        loadPickupPortFacets={vi.fn().mockResolvedValue([{ id: 7, name: 'Cảng Hải Phòng' }])}
        loadDropoffPortFacets={vi.fn().mockResolvedValue([{ id: 9, name: 'ICD Mỹ Đình' }])}
      />,
    );

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

    await waitFor(() => expect(screen.getByRole('option', { name: 'KCN Vân Trung' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'KCN Vân Trung' }));
    expect(onChange).toHaveBeenCalledWith({ deliveryPointIds: [42] });

    await waitFor(() => expect(screen.getByRole('option', { name: 'Cảng Hải Phòng' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'Cảng Hải Phòng' }));
    expect(onChange).toHaveBeenCalledWith({ pickupIds: [7] });

    await waitFor(() => expect(screen.getByRole('option', { name: 'ICD Mỹ Đình' })).toBeTruthy());
    fireEvent.click(screen.getByRole('option', { name: 'ICD Mỹ Đình' }));
    expect(onChange).toHaveBeenCalledWith({ dropoffIds: [9] });
  });
});
