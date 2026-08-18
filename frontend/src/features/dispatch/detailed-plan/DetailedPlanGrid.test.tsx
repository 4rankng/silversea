import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
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
      onAssignCarrier={vi.fn()}
      onSaveEstimates={vi.fn()}
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

  it('anchors the direction pill at the lower-right of the document cell', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    expect(css).toContain('.detailed-plan-grid__documents-direction { grid-area: direction; align-self: end; justify-self: end; }');
    expect(css).toContain('". direction"');
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

    expect(screen.getByText('51C-123.45')).toBeTruthy();
    expect(screen.queryByText('Đã phân xe')).toBeNull();
  });

  it('renders the vendor placeholder hint for unassigned EXTERNAL rows', () => {
    renderGrid([row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 77, externalCarrierVehicleId: null, assignedPlate: null },
    })]);
    expect(screen.getByText('CUS sẽ bổ sung')).toBeTruthy();
    expect(screen.getByText('Nhà xe Việt')).toBeTruthy();
  });

  it('shows a combined-lot tag when the shipment was marked for combined transport', () => {
    renderGrid([row({ isCombined: true })]);

    expect(screen.getByText('ĐÓNG KẾT HỢP')).toBeTruthy();
  });

  it('keeps carrier and vehicle assignment alongside editable operational fee estimates', async () => {
    const onSaveEstimates = vi.fn().mockResolvedValue({
      version: 4,
      plannedRevenue: '2500000',
      plannedCarrierCost: null,
    });
    renderGrid([row()], { onSaveEstimates });

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '2500000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onSaveEstimates).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101 }),
      { plannedRevenue: 2500000, plannedCarrierCost: null },
    ));
  });

  it('opens one four-field edit dialog from the full Điều phối cell', async () => {
    const { container } = renderGrid([row()]);
    const dispatchCell = container.querySelector<HTMLElement>('td[data-label="Điều phối"]');
    expect(dispatchCell).toBeTruthy();

    const trigger = screen.queryByRole('button', { name: /sửa ô điều phối/i });
    expect(trigger).toBeTruthy();
    if (!trigger) return;
    expect(dispatchCell?.querySelectorAll('button')).toHaveLength(1);
    expect(trigger).toHaveClass('dispatch-assignment-cell__trigger');
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa điều phối' });
    expect(within(dialog).getByLabelText('Nhà xe')).toBeTruthy();
    expect(within(dialog).getByLabelText('Xe / biển số')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước thu dự kiến')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước trả dự kiến')).toBeTruthy();
  });

  it('keeps the dispatcher column read-like until its one full-cell trigger is clicked', () => {
    const plateCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/PlateAssignmentCell.css'), 'utf8');
    const gridCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(plateCss).toContain('.dispatch-assignment-cell__trigger {');
    expect(plateCss).toContain('height: 100%;');
    expect(plateCss).toContain('cursor: pointer;');
    expect(plateCss).toContain('.dispatch-assignment-dialog__fields {');
    expect(gridCss).not.toContain('.fulfillment-estimate-cell__value {');
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

  it('keeps search and date scope visible while moving secondary filters into a drawer', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DispatchDetailPlanPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(page).toContain('dispatch-plan-page--wide');
    expect(page).toContain('<Pagination');
    expect(page).not.toContain('Tải thêm');
    expect(css).toContain('.detailed-plan-filters {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-end;');
    expect(css).toContain('.detailed-plan-filters__field--search {\n  flex: 0 1 360px;\n  width: min(100%, 360px);');
    expect(css).toContain('.detailed-plan-filters__date-scope-controls {\n  display: flex;\n  align-items: center;');
    expect(css).toContain('.detailed-plan-filters__date-scope .detailed-plan-filters__date {\n  flex: 0 1 140px;\n  width: 140px;');
    expect(css).toContain('.detailed-plan-filters__date-shortcut.is-active {');
    expect(css).toContain('.detailed-plan-filters__date-scope-controls {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('.drawer.detailed-plan-filter-drawer { max-width: 430px; }');
    expect(css).toContain('.detailed-plan-filter-panel__fields {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);');
    expect(css).not.toContain('detailed-plan-filters__advanced');
    expect(css).not.toContain('detailed-plan-filters__primary-row');
    expect(css).not.toContain('detailed-plan-filters__secondary-row');
    expect(css).toContain('.detailed-plan-filters__points {\n  position: relative;');
    expect(css).toContain('.detailed-plan-grid__cell::before');
    expect(css).toContain('content: attr(data-label)');
  });

  it('keeps the detailed filters flat instead of nesting another card surface', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const toolbar = css.match(/\.detailed-plan-filters \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(toolbar).not.toMatch(/\bpadding\s*:/);
    expect(toolbar).not.toMatch(/\bborder(?:-radius)?\s*:/);
    expect(toolbar).not.toMatch(/\bbackground\s*:/);
  });

  it('keeps point suggestions out of the filter-row layout and gives time inputs equal width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const toolbar = css.match(/\.detailed-plan-filters \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const points = css.match(/\.detailed-plan-filters__points \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const picker = css.match(/\.detailed-plan-filters__point-picker \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const hourControl = css.match(/\.detailed-plan-filters__hour-control \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(toolbar).toContain('align-items: flex-end');
    expect(points).toContain('position: relative');
    expect(points).toContain('min-width: 0');
    expect(picker).toContain('position: absolute');
    expect(picker).toContain('z-index: 20');
    expect(hourControl).toContain('flex: 1 1 0');
  });

  it('lets shared compact controls own dropdown typography', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const multiTrigger = css.match(/\.detailed-plan-filters__multi-trigger \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(css).not.toContain('.detailed-plan-filters__select button p');
    expect(multiTrigger).toContain('font-size: var(--fs-xs, 12px)');
    expect(css).toContain('detailed-plan-filter-drawer .detailed-plan-filters__multi-trigger { font-size: 14px; }');
  });

  it('keeps filter actions beside search without creating another toolbar band', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const actions = css.match(/\.detailed-plan-filters__toolbar-actions \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const clear = css.match(/\.detailed-plan-filters__clear \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(actions).toContain('display: flex');
    expect(actions).toContain('align-items: center');
    expect(actions).not.toMatch(/\bbackground\s*:/);
    expect(clear).toContain('flex: 0 0 auto');
  });
});
