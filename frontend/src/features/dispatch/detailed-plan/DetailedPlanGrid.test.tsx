import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

// The editor dialog mounts the note composer, which pulls the tag pool via
// react-query; pin the hook so grid tests stay provider-free.
const useTaskTagsMock = vi.fn(() => ({
  tags: [
    { id: 1, label: 'Đặt đầu' },
    { id: 2, label: 'Đặt đuôi' },
  ],
  isLoading: false,
  error: null,
}));
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => useTaskTagsMock(),
  useCreateDispatchTaskTag: () => ({
    createTag: vi.fn(async (label: string) => ({ id: 99, label })),
    isCreating: false,
  }),
}));

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
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương', routeName: 'LH — Biên Hòa' },
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
      presence={null}
      zones={[]}
      sortKey={null}
      onToggleSort={vi.fn()}
      onAtomicSave={vi.fn()}
      onOpenTripReassign={vi.fn()}
      onIssueOrder={vi.fn()}
      {...extraProps}
    />,
  );
}

describe('DetailedPlanGrid', () => {
  it('renders the 8 spec columns with multi-line typography', () => {
    const { container } = renderGrid([row()]);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Thời gian & lịch trình ↕',
      'Khách hàng & lộ trình ↕',
      'Tuyến đường',
      'Container',
      'Điều phối',
      'Phân loại',
      'Tác vụ',
      'Ghi chú',
    ]);

    // Column 1: bold date line + muted hour line
    expect(screen.getByText('Giao: 20/08/2026')).toBeTruthy();
    expect(screen.getByText('Giờ: 8H')).toBeTruthy();
    // Column 2: KH/factory/delivery point
    // T2.3 follows the master-plan order: customer, factory, then the
    // emphasized route without a redundant label.
    expect(screen.getByText('Công ty ABC')).toBeTruthy();
    expect(screen.getByText('Nhà máy XYZ')).toBeTruthy();
    expect(screen.getByText('LH — Biên Hòa')).toBeTruthy();
    expect(screen.queryByText('Lộ trình: LH — Biên Hòa')).toBeNull();
    // Column 3: bill + badge
    expect(screen.getByText('Bill: BL-2026-010')).toBeTruthy();
    const directionBadge = screen.getByText('Xuất');
    expect(directionBadge.classList.contains('rounded-full')).toBe(true);
    // Status chips are text-only (2026-09-08 de-blob): tone via text color.
    expect(directionBadge.classList.contains('bg-transparent')).toBe(true);
    expect(directionBadge.classList.contains('text-utility-neutral-700')).toBe(true);
    expect(directionBadge.classList.contains('text-xs')).toBe(true);
    // Column 4: container stack
    expect(screen.getByText('MSCU1234567')).toBeTruthy();
    expect(screen.getByText('40HC')).toBeTruthy();
    expect(screen.getByText(/21\.500 kg/)).toBeTruthy();
    // Column 7 (last): notes after atomic dispatch and classification.
    expect(screen.getByText('Xe: Giao giờ hành chính')).toBeTruthy();
    expect(screen.getByText('Khách: Gặp anh Hùng')).toBeTruthy();
    expect(Array.from(container.querySelectorAll('td')).map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & lộ trình',
      'Tuyến đường',
      'Container',
      'Điều phối',
      'Phân loại',
      'Tác vụ',
      'Ghi chú',
    ]);
  });

  it('anchors the direction pill and quiet combined note on one document footer line', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    expect(css).toContain('.detailed-plan-grid__documents-direction { grid-area: direction; align-self: end; justify-self: end; }');
    expect(css).toContain('"combined direction"');
    expect(css).toContain('.detailed-plan-grid__combined-note');
    expect(css).toContain('font-weight: 400;');
    expect(css).toContain('white-space: nowrap;');
  });

  it('gives every fixed-layout desktop column an explicit share of exactly 100%', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const columnNames = [
      'schedule',
      'route',
      'documents',
      'container',
      'assignment',
      'classification',
      'task-tags',
      'notes',
    ];

    const widths = columnNames.map((columnName) => {
      const match = css.match(new RegExp(`\\.detailed-plan-grid__col--${columnName}\\s*\\{\\s*width:\\s*(\\d+(?:\\.\\d+)?)%;\\s*\\}`));
      expect(match, `${columnName} column must own an explicit percentage width`).toBeTruthy();
      return Number(match?.[1] ?? 0);
    });

    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);
    expect(widths[columnNames.indexOf('classification')]).toBeGreaterThanOrEqual(8);
    expect(css).toMatch(/\.detailed-plan-grid thead th\s*\{[^}]*line-height:\s*var\(--ops-table-header-line-height\);/);
    expect(css).toContain('@container (max-width: 900px)');
  });

  it('keeps the desktop Phân loại header as a complete label', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const headerRule = css.match(/\.detailed-plan-grid thead th:last-child \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(headerRule).toContain('white-space: nowrap;');
    expect(headerRule).toContain('overflow-wrap: normal;');
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
    expect(screen.getByText('Nhập')).toBeTruthy();
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

  it('opens governed reassignment for a dispatched trip that has not departed', () => {
    const onOpenTripReassign = vi.fn();
    renderGrid([row({
      taskStatus: 'DISPATCHED',
      dispatch: {
        carrierType: 'OWN',
        carrierName: 'SilverSea',
        externalCarrierId: null,
        externalCarrierVehicleId: null,
        assignedPlate: '51C-123.45',
        tripId: 77,
        tripStatus: 'CREATED',
      },
    })], { onOpenTripReassign });

    fireEvent.click(screen.getByRole('button', { name: 'Phân xe lại MSCU1234567' }));
    expect(onOpenTripReassign).toHaveBeenCalledWith(77);
    expect(screen.queryByRole('dialog', { name: /Chỉnh sửa điều phối/i })).toBeNull();
  });

  it('renders the vendor placeholder hint for unassigned EXTERNAL rows', () => {
    renderGrid([row({
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Việt', externalCarrierId: 77, externalCarrierVehicleId: null, assignedPlate: null },
    })]);
    expect(screen.getByText('CUS sẽ bổ sung')).toBeTruthy();
    expect(screen.getByText('Nhà xe Việt')).toBeTruthy();
  });

  it('shows a quiet combined-lot note in the documents cell', () => {
    renderGrid([row({ isCombined: true })]);

    const note = screen.getByText('Kết hợp');
    expect(note).toHaveClass('detailed-plan-grid__combined-note');
    expect(note).toHaveAttribute('title', 'Đóng kết hợp');
    expect(screen.queryByText('ĐÓNG KẾT HỢP')).toBeNull();
  });

  it('saves the whole editor atomically: estimates only — classification/lot flag are CUS-owned', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 5,
      classification: 'SINGLE',
      isCombined: false,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: '2500000', plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderGrid([row({ classification: 'SINGLE' })], { onAtomicSave });

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '2.500.000' } });
    expect(screen.getByLabelText<HTMLInputElement>('Cước thu dự kiến').value).toBe('2.500.000');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 3, shipmentVersion: 5 }),
      expect.objectContaining({
        carrierType: 'OWN',
        plannedRevenue: 2500000,
        plannedCarrierCost: null,
      }),
    ));
    // The editor no longer sends (or renders) the CUS-owned controls.
    expect(onAtomicSave.mock.calls[0]![1]).not.toHaveProperty('classification');
    expect(onAtomicSave.mock.calls[0]![1]).not.toHaveProperty('isCombined');
    expect(screen.queryByText('Đóng kết hợp (kẹp chuyến)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Đơn Phân loại' })).toBeNull();
  });

  it('saves without blocking on classification — the default Đơn is always present', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 5,
      classification: 'SINGLE',
      isCombined: false,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: null, plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderGrid([row({ classification: 'SINGLE' })], { onAtomicSave });

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ carrierType: 'OWN' }),
    ));
    expect(onAtomicSave.mock.calls[0]![1]).not.toHaveProperty('classification');
  });

  it('renders the classification column with the fresh-container default Đơn', () => {
    renderGrid([row({ classification: 'SINGLE' })]);
    expect(screen.getByText('Đơn')).toBeTruthy();
  });

  it('uses one regular-weight neutral tag treatment for every saved classification', () => {
    const { container } = renderGrid([
      row({ fulfillmentId: 101, classification: 'SINGLE' }),
      row({ fulfillmentId: 102, classification: 'DOUBLE' }),
      row({ fulfillmentId: 103, classification: 'COMBINED' }),
      row({ fulfillmentId: 104, classification: 'LCL' }),
    ]);

    for (const label of ['Đơn', 'Kẹp', 'Kết hợp', 'Lẻ']) {
      expect(screen.getByText(label).className).toBe('detailed-plan-grid__classification');
    }

    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    expect(css).toContain('font-size: var(--ops-table-supporting-size);');
    expect(css).toContain('font-weight: 400;');
    expect(css).not.toContain('.detailed-plan-grid__classification--paired');
    expect(container.querySelectorAll('.detailed-plan-grid__classification')).toHaveLength(4);
  });

  it('opens one atomic edit dialog from the full Điều phối cell', async () => {
    const { container } = renderGrid([row({ classification: 'SINGLE' })]);
    const dispatchCell = container.querySelector<HTMLElement>('td[data-label="Điều phối"]');
    expect(dispatchCell).toBeTruthy();

    const trigger = screen.queryByRole('button', { name: /sửa ô điều phối/i });
    expect(trigger).toBeTruthy();
    if (!trigger) return;
    expect(dispatchCell?.querySelectorAll('button')).toHaveLength(1);
    expect(trigger).toHaveClass('dispatch-assignment-cell__trigger');
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: /Chỉnh sửa điều phối.*MSCU1234567/ });
    expect(within(dialog).getByLabelText('Nhà xe')).toBeTruthy();
    expect(within(dialog).getByLabelText('Xe / biển số')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước thu dự kiến')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước trả dự kiến')).toBeTruthy();
    expect(within(dialog).getAllByText('đ')).toHaveLength(2);
    // CUS-owned controls are gone from the dispatch editor entirely.
    expect(within(dialog).queryByLabelText('Phân loại')).toBeNull();
    expect(within(dialog).queryByLabelText('Đóng kết hợp (kẹp chuyến)')).toBeNull();
  });

  it('keeps the dispatcher column read-like until its one full-cell trigger is clicked', () => {
    const editorCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');
    const gridCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(editorCss).toContain('.dispatch-assignment-cell__trigger {');
    expect(editorCss).toContain('height: 100%;');
    expect(editorCss).toContain('cursor: pointer;');
    expect(editorCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(editorCss).toMatch(/\.detailed-plan-grid td\.detailed-plan-grid__cell--editable::after\s*\{[^}]*min-height:\s*72px;/);
    expect(editorCss).toMatch(/\.dispatch-assignment-cell__carrier,[\s\S]*?\.dispatch-assignment-cell__plate\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
    expect(editorCss).toMatch(/@container \(max-width:\s*900px\)[\s\S]*?td\.detailed-plan-grid__cell--editable::after\s*\{[^}]*display:\s*none;/);
    expect(editorCss).toContain('.dispatch-assignment-dialog__fields {');
    expect(editorCss).toMatch(/\.dispatch-assignment-dialog__fields > \.dispatch-assignment-dialog__check\s*\{[^}]*display:\s*flex;/);
    // The grid's mobile `.detailed-plan-grid__cell::before` label rule has
    // equal class specificity; the editable cell must win on `td` so its
    // trigger covers the whole cell — not just below a stray label strip.
    expect(editorCss).toMatch(/td\.detailed-plan-grid__cell--editable::before\s*\{\s*display:\s*none/);
    // Keyboard focus must never switch the trigger to relative positioning:
    // that shrink wraps it and un-clicks the bottom of the cell.
    expect(editorCss).not.toMatch(/:focus-visible\s*\{[^}]*position:\s*relative/);
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

  it('hides the "Ghi chú" placeholders when both vehicleNote and customerNote are empty', () => {
    renderGrid([row({ notes: { vehicleNote: null, customerNote: null } })]);

    const notesCell = document.querySelector('td.detailed-plan-grid__cell--notes');
    expect(notesCell).toBeTruthy();
    // The "—" placeholders must NOT appear to avoid UI clutter.
    expect(notesCell!.textContent?.trim()).toBe('');
    // No "Xe:" or "Khách:" labels are rendered for empty notes.
    expect(notesCell!.querySelectorAll('.detailed-plan-grid__line--notes, .detailed-plan-grid__line--muted')).toHaveLength(0);
  });

  it('hides the missing "Ghi chú" line when only one of the note fields is present', () => {
    renderGrid([row({ notes: { vehicleNote: 'Giao giờ HC', customerNote: null } })]);

    const notesCell = document.querySelector('td.detailed-plan-grid__cell--notes');
    expect(notesCell).toBeTruthy();
    expect(screen.getByText('Xe: Giao giờ HC')).toBeTruthy();
    // The "Khách: —" placeholder for the missing customerNote must not appear.
    expect(notesCell!.textContent).not.toContain('—');
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
    expect(css).toContain('.detailed-plan-filters__date-mode {\n  display: grid;\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n  flex: 0 1 316px;\n  min-width: 292px;\n  /* Match the sm input height so the toolbar labels baseline-align. */\n  height: 34px;');
    expect(css).not.toContain('repeat(2, minmax(0, 1fr));\n  flex: 0 1 248px');
    const activeDateShortcut = css.match(/\.detailed-plan-filters__date-shortcut\.is-active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(activeDateShortcut).toContain('background: var(--background-color-primary, #fff);');
    expect(activeDateShortcut).toContain('border-color: var(--color-fg-primary, var(--text-primary, #101828));');
    expect(activeDateShortcut).toContain('box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);');
    expect(activeDateShortcut).not.toContain('background-color-brand-primary');
    expect(css).toContain('.detailed-plan-grid__row--plated {\n  background: var(--surface, #fff);');
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

  it('condenses phone records into a two-column decision layout without shrinking the dispatch target', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(css).toContain('@container (max-width: 640px)');
    expect(css).toMatch(/\.detailed-plan-grid__row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toContain('.detailed-plan-grid__cell--schedule,\n  .detailed-plan-grid__cell--route,\n  .detailed-plan-grid__cell--notes,\n  .detailed-plan-grid__cell--editable {\n    grid-column: 1 / -1;');
    expect(css).toContain('.detailed-plan-grid__cell--classification {\n    position: absolute;');
    expect(css).toContain('.detailed-plan-grid__cell--documents,\n  .detailed-plan-grid__cell--container {\n    padding-block: 10px;');
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
