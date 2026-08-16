import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

import { DetailedPlanGrid } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-08-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: 'Giao giờ hành chính', customerNote: 'Gặp anh Hùng' },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

function renderGrid(items: DispatchDetailPlanRow[], extraProps: Record<string, unknown> = {}) {
  return render(
    <DetailedPlanGrid
      filters={EMPTY_DETAILED_PLAN_FILTERS}
      onFilterChange={vi.fn()}
      loadDeliveryPointFacets={vi.fn().mockResolvedValue([])}
      loadPickupPortFacets={vi.fn().mockResolvedValue([])}
      loadDropoffPortFacets={vi.fn().mockResolvedValue([])}
      items={items}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      assignmentError={null}
      lotBanner={null}
      onClearLotBanner={vi.fn()}
      sortKey={null}
      onToggleSort={vi.fn()}
      onAssignPlate={vi.fn()}
      {...extraProps}
    />,
  );
}

describe('DetailedPlanGrid', () => {
  it('renders the 6 spec columns with multi-line typography', () => {
    const { container } = renderGrid([row()]);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Thời gian & lịch trình ↕',
      'Khách hàng & lộ trình ↕',
      'Chứng từ',
      'Container',
      'Ghi chú',
      'Điều phối',
    ]);

    // Column 1: bold date line + muted hour line
    expect(screen.getByText('Giao: 20/08/2026')).toBeTruthy();
    expect(screen.getByText('Giờ: 8H')).toBeTruthy();
    // Column 2: KH/factory/delivery point
    expect(screen.getByText('KH: Công ty ABC')).toBeTruthy();
    expect(screen.getByText('Nhà máy: Nhà máy XYZ')).toBeTruthy();
    expect(screen.getByText('Điểm trả: Kho Bình Dương')).toBeTruthy();
    // Column 3: bill + badge
    expect(screen.getByText('Bill: BL-2026-010')).toBeTruthy();
    expect(screen.getByText('XUẤT')).toBeTruthy();
    // Column 4: container stack
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
    expect(screen.getByText('40HC')).toBeTruthy();
    expect(screen.getByText(/21\.500 kg/)).toBeTruthy();
    // Column 5: notes
    expect(screen.getByText('Xe: Giao giờ hành chính')).toBeTruthy();
    expect(screen.getByText('Khách: Gặp anh Hùng')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('td')).map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & lộ trình',
      'Chứng từ',
      'Container',
      'Ghi chú',
      'Điều phối',
    ]);
  });

  it('renders container-less LCL rows with package/weight instead', () => {
    renderGrid([row({
      cargoMode: 'LCL',
      fulfillmentType: 'LCL_SHIPMENT',
      container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '3200.00' },
    })]);

    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();
    expect(screen.queryByText('MSCU1234567')).toBeNull();
    expect(screen.getByText(/3\.200 kg/)).toBeTruthy();
  });

  it('shows "Chưa có số" for a missing container number', () => {
    renderGrid([row({ container: { containerNumber: null, containerTypeLabel: '20DC', cargoWeightKg: null } })]);
    expect(screen.getByText('Chưa có số')).toBeTruthy();
  });

  it('shows the NHẬP badge for import rows', () => {
    renderGrid([row({ docs: { billNumber: 'B-1', tradeDirection: 'IMPORT', declarationNumbers: [] } })]);
    expect(screen.getByText('NHẬP')).toBeTruthy();
    // Import rows label the date line "Nhận" instead of "Giao" (spec §3 col 1).
    expect(screen.getByText('Nhận: 20/08/2026')).toBeTruthy();
  });

  it('shows the lot flag only when a fully plated lot has no visible plate in this row', () => {
    const { container } = renderGrid([row({ lotFullyPlated: true })]);
    expect(screen.getByText('Đã phân xe')).toBeTruthy();
    expect(container.querySelector('.detailed-plan-grid__row--plated')).toBeTruthy();
  });

  it('does not repeat the fully plated status when the assigned plate is already visible', () => {
    renderGrid([row({
      lotFullyPlated: true,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-123.45' },
    })]);

    expect(screen.getByRole('button', { name: /51C-123\.45/i })).toBeTruthy();
    expect(screen.queryByText('Đã phân xe')).toBeNull();
  });

  it('renders the vendor placeholder hint for unassigned EXTERNAL rows', () => {
    renderGrid([row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 77, externalCarrierVehicleId: null, assignedPlate: null },
    })]);
    expect(screen.getByText('CUS sẽ bổ sung')).toBeTruthy();
    expect(screen.getByText('Nhà xe Việt')).toBeTruthy();
  });

  it('surfaces assignment errors and the lot banner', () => {
    renderGrid([row()], { assignmentError: 'Tác vụ điều xe đã thay đổi. Vui lòng tải lại.' });
    expect(screen.getByRole('alert').textContent).toContain('tải lại');

    renderGrid([row()], { lotBanner: 'Lô SS-000200 đã phân xe đủ.' });
    expect(screen.getByText('Lô SS-000200 đã phân xe đủ.')).toBeTruthy();
  });

  it('renders an empty state when there are no rows', () => {
    renderGrid([]);
    expect(screen.getByText('Không có dòng kế hoạch nào')).toBeTruthy();
  });

  it('renders an error state without the table', () => {
    const onRetry = vi.fn();
    renderGrid([row()], { error: 'Không thể tải kế hoạch chi tiết. Vui lòng thử lại.', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('Không thể tải');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses the available dispatch canvas before collapsing its filter rail', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DispatchDetailPlanPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(page).toContain('dispatch-plan-page--wide');
    expect(css).toContain('grid-template-columns: minmax(280px, 1.6fr) repeat(3, minmax(132px, 0.7fr)) repeat(3, minmax(180px, 1fr)) minmax(170px, 0.9fr)');
    expect(css).toContain('@container (max-width: 1599px)');
    expect(css).toContain('@container (max-width: 1000px)');
    expect(css).toContain('.detailed-plan-grid__cell::before');
    expect(css).toContain('content: attr(data-label)');
  });
});
