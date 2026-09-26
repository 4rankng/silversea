import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { MonthProvider } from '../../../hooks/useMonth';
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>
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
        sortDirection="asc"
        onToggleSort={vi.fn()}
        onAtomicSave={vi.fn()}
        onOpenTripReassign={vi.fn()}
        onCompleteExternalTrip={vi.fn()}
        onIssueOrder={vi.fn()}
        {...extraProps}
      />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DetailedPlanGrid', () => {
  it('DSP-6377 separates legacy task labels and multiline manual notes in the row and full view', () => {
    const manual = '- Gọi trước khi đến\n- Gặp anh Bình ở cổng 2';
    const { container } = renderGrid([row({
      notes: { vehicleNote: `Đặt đầu; Đặt đuôi; ${manual}`, customerNote: 'Khách cần bản gốc' },
    })]);
    const note = container.querySelector('.detailed-plan-grid__note') as HTMLElement;
    const tasks = within(note).getByText('ĐẶT ĐẦU; ĐẶT ĐUÔI');
    const text = within(note).getByText((_, element) => element?.textContent === manual);
    expect(tasks.closest('[data-note-section="tasks"]')).toBeTruthy();
    expect(text.closest('[data-note-section="manual"]')).toBeTruthy();
    expect(tasks.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(note);
    const dialog = screen.getByRole('dialog', { name: 'Ghi chú xe' });
    expect(within(dialog).getByText('ĐẶT ĐẦU; ĐẶT ĐUÔI')).toBeTruthy();
    expect(within(dialog).getByText((_, element) => element?.textContent === manual)).toBeTruthy();
    expect(within(dialog).queryByText('Khách cần bản gốc')).toBeNull();
  });

  it.each(['IMPORT', 'EXPORT', null] as const)('DSP-PORT-01 keeps the canonical lift/drop ports for %s', (direction) => {
    const { container } = renderGrid([row({
      docs: { billNumber: 'PORT-RETEST', tradeDirection: direction, declarationNumbers: [] },
      ports: {
        pickupPortId: 11, pickupPortName: 'Bãi lấy container A', pickupPortShortName: 'Bãi A',
        dropoffPortId: 12, dropoffPortName: 'Cảng hạ container B', dropoffPortShortName: 'Cảng B',
      },
    })]);
    const lift = container.querySelector('[data-label="Nâng hàng"]') as HTMLElement;
    const drop = container.querySelector('[data-label="Trả hàng"]') as HTMLElement;
    expect(within(lift).getByText('Bãi A')).toBeTruthy();
    expect(within(lift).getByText('Bãi lấy container A')).toBeTruthy();
    expect(within(drop).getByText('Cảng B')).toBeTruthy();
    expect(within(drop).getByText('Cảng hạ container B')).toBeTruthy();
  });

  it('DSP-PORT-01 shows missing ports honestly without using the other port', () => {
    const { container } = renderGrid([row({
      ports: { pickupPortId: null, pickupPortName: null, pickupPortShortName: null, dropoffPortId: 12, dropoffPortName: 'Cảng B', dropoffPortShortName: null },
    })]);
    expect(container.querySelector('[data-label="Nâng hàng"]')?.textContent).toBe('—');
    expect(container.querySelector('[data-label="Trả hàng"]')?.textContent).toBe('Cảng B');
  });

  it('renders the 9 operational columns with multi-line typography', () => {
    const { container } = renderGrid([row()]);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Thời gian & lịch trình ↕',
      'Khách hàng & lộ trình ↕',
      'Nâng hàng',
      'Trả hàng ↕',
      'Tuyến đường',
      'Container',
      'Điều phối',
      'Phân loại',
      'Ghi chú',
    ]);

    // Column 1: time and date together, operation below.
    expect(screen.getByText('8H 20/08/2026')).toBeTruthy();
    expect(screen.getByText('đóng hàng')).toBeTruthy();
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
      'Nâng hàng',
      'Trả hàng',
      'Tuyến đường',
      'Container',
      'Điều phối',
      'Phân loại',
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
      'ports',
      'ports',
      'documents',
      'container',
      'assignment',
      'classification',
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
    expect(screen.getByText('Chưa có số cont')).toBeTruthy();
  });

  it('shows the NHẬP badge for import rows', () => {
    renderGrid([row({ docs: { billNumber: 'B-1', tradeDirection: 'IMPORT', declarationNumbers: [] } })]);
    expect(screen.getByText('Nhập')).toBeTruthy();
    expect(screen.getByText('8H 20/08/2026')).toBeTruthy();
    expect(screen.getByText('trả hàng')).toBeTruthy();
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

  it('saves the whole editor atomically: estimates plus the dispatcher Phân loại — lot flag stays CUS-owned', async () => {
    const onAtomicSave = vi.fn().mockResolvedValue({
      fulfillmentVersion: 4,
      shipmentVersion: 5,
      classification: 'DOUBLE',
      isCombined: false,
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
      estimates: { plannedRevenue: '2500000', plannedCarrierCost: null },
      lotFullyPlated: false,
    });
    renderGrid([row({ classification: 'SINGLE' })], { onAtomicSave });

    fireEvent.click(screen.getByRole('button', { name: /sửa ô điều phối/i }));
    fireEvent.change(screen.getByLabelText('Cước thu dự kiến'), { target: { value: '2.500.000' } });
    expect(screen.getByLabelText<HTMLInputElement>('Cước thu dự kiến').value).toBe('2.500.000');
    // UUI select: open the trigger, then pick the option from the listbox —
    // fireEvent.change on a hidden native select does not drive react-aria.
    // The trigger's accessible name is "<current value> <label>".
    fireEvent.click(screen.getByRole('button', { name: 'Đơn Phân loại' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Kẹp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(onAtomicSave).toHaveBeenCalledWith(
      expect.objectContaining({ fulfillmentId: 101, version: 3, shipmentVersion: 5 }),
      expect.objectContaining({
        carrierType: 'OWN',
        plannedRevenue: 2500000,
        plannedCarrierCost: null,
        classification: 'DOUBLE',
      }),
    ));
    // Phân loại rides the save; the lot-level Đóng kết hợp flag has no
    // control in the dialog and is never sent.
    expect(onAtomicSave.mock.calls[0]![1]).not.toHaveProperty('isCombined');
    expect(screen.queryByText('Đóng kết hợp (kẹp chuyến)')).toBeNull();
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
      expect.objectContaining({ carrierType: 'OWN', classification: 'SINGLE' }),
    ));
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
    expect(within(dialog).getByLabelText('Phân loại')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước thu dự kiến')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cước trả dự kiến')).toBeTruthy();
    expect(within(dialog).getAllByText('đ')).toHaveLength(2);
    // The lot-level Đóng kết hợp checkbox is gone for good — redundant with
    // the Kết hợp classification; the flag stays CUS-owned.
    expect(within(dialog).queryByLabelText('Đóng kết hợp (kẹp chuyến)')).toBeNull();
  });

  it('keeps the dispatcher column read-like until its one full-cell trigger is clicked', () => {
    const editorCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');
    const gridCss = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    expect(editorCss).toContain('.dispatch-assignment-cell__trigger {');
    expect(editorCss).toContain('height: 100%;');
    expect(editorCss).toContain('cursor: pointer;');
    // Single-column trigger since the driver row joined the cell — every
    // child (carrier, plate, driver) spans the full trigger width.
    expect(editorCss).toMatch(/__trigger\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(editorCss).toMatch(/\.detailed-plan-grid td\.detailed-plan-grid__cell--editable::after\s*\{[^}]*min-height:\s*72px;/);
    expect(editorCss).toMatch(/\.dispatch-assignment-cell__carrier,[\s\S]*?\.dispatch-assignment-cell__driver\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
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

  it('renders an error state without the table on a cold load (nothing fetched yet)', () => {
    const onRetry = vi.fn();
    renderGrid([], { error: 'Không thể tải kế hoạch chi tiết. Vui lòng thử lại.', onRetry });
    expect(screen.getByRole('alert').textContent).toContain('Không thể tải');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps search and date scope visible while moving secondary filters into a drawer', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/DispatchDetailPlanPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const filtersSource = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx'), 'utf8');

    expect(page).toContain('dispatch-plan-page--wide');
    expect(page).toContain('<Pagination');
    expect(page).not.toContain('Tải thêm');
    // Card 20260926_50: the two-tier header replaces the _10 bar — Row 1
    // header (title+presets+range trigger), Row 2 one continuous ribbon;
    // the old date-scope/mode/shortcut chrome is gone.
    expect(filtersSource).toContain('detailed-plan-header');
    expect(filtersSource).toContain('detailed-plan-ribbon');
    expect(filtersSource).not.toContain('<ListFilterBar');
    expect(css).toContain('.detailed-plan-header {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  height: 36px;\n}');
    expect(css).toContain('.detailed-plan-ribbon {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  height: 32px;\n}');
    expect(css).not.toContain('detailed-plan-filters__date-scope-controls');
    expect(css).not.toContain('detailed-plan-filters__date-mode');
    expect(css).not.toContain('detailed-plan-filters__date-shortcut');
    expect(css).toContain('.detailed-plan-grid__row--plated {\n  background: var(--surface, #fff);');
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
    expect(css).toContain('.detailed-plan-grid__cell--schedule,\n  .detailed-plan-grid__cell--route,\n  .detailed-plan-grid__cell--ports,\n  .detailed-plan-grid__cell--notes,\n  .detailed-plan-grid__cell--editable {\n    grid-column: 1 / -1;');
    expect(css).toContain('.detailed-plan-grid__cell--classification {\n    position: absolute;');
    // SCHEDULE-LAYOUT-08: labels and long identity fields stack without
    // inherited inline separators; short cargo metadata still shares a line.
    const phoneCss = css.slice(css.indexOf('@container (max-width: 640px)'));
    expect(phoneCss).toMatch(/\.detailed-plan-grid__cell::before\s*\{[^}]*display:\s*block;[^}]*margin:\s*0 0 2px;/);
    expect(phoneCss).toMatch(/\.detailed-plan-grid__cell \.detailed-plan-grid__line\s*\{[^}]*display:\s*block;[^}]*margin-right:\s*0;[^}]*overflow-wrap:\s*break-word;/);
    expect(phoneCss).toMatch(/\.detailed-plan-grid__line \+ \.detailed-plan-grid__line::before\s*\{[^}]*content:\s*none;/);
    expect(phoneCss).toMatch(/\.detailed-plan-grid__cell--container \.detailed-plan-grid__line:not\(\.detailed-plan-grid__line--strong\)\s*\{[^}]*display:\s*inline-block;/);
    expect(phoneCss).toMatch(/\.detailed-plan-grid__documents-direction\s*\{[^}]*align-self:\s*start;[^}]*justify-self:\s*start;/);
    // SCHEDULE-LAYOUT-09: match td.cell specificity so the empty notes tail
    // actually beats the responsive display:block declaration.
    expect(css).toContain('td.detailed-plan-grid__cell--blank {\n    display: none;\n  }');
  });

  it('rides the frozen design-system controls and carries zero self-made filter chrome (card 20260926_50)', () => {
    const filtersSource = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

    // Card _50: ribbon controls ride the shared design-system family
    // (SearchableSelect combobox, InlineLabelSelect chips, DateRangePopover
    // trigger) — no self-made chrome.
    expect(filtersSource).toContain('DateRangePopover');
    expect(filtersSource).toContain('InlineLabelSelect');
    expect(filtersSource).toContain('SearchableSelect');
    // Self-made bar chrome and the dead legacy picker family are deleted clean.
    for (const dead of ['__toolbar-actions', '__status', '__field--search', 'filters__search {', '__drawer-trigger',
      '__multi-trigger', '__point-picker', '__multi-search', '__point-list', '__point-option',
      '__point-feedback', '__point-footer', '__point-search', '__zone-toggle']) {
      expect(css).not.toContain(dead);
    }
    // Drawer-interior arrangement helpers survive the cutover.
    expect(css).toContain('.detailed-plan-filters__field--zone');
    expect(css).toContain('.detailed-plan-filters__hour-control');
  });

  it('keeps point suggestions out of the filter-row layout and gives time inputs equal width', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const points = css.match(/\.detailed-plan-filters__points \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const hourControl = css.match(/\.detailed-plan-filters__hour-control \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(points).toContain('position: relative');
    expect(points).toContain('min-width: 0');
    expect(hourControl).toContain('flex: 1 1 0');
  });

  it('clicks a branch row through the grid wiring: decompose fires and the editor opens', async () => {
    const onEnsureFulfillment = vi.fn(async (branch: DispatchDetailPlanRow) => (
      { ...branch, fulfillmentId: 999, version: 1 }
    ));
    renderGrid([row({ fulfillmentId: null as unknown as number })], { onEnsureFulfillment });

    // Integration gate: the click must reach the cell's handler through the
    // grid's prop chain (QA closed-row repro: silent no-op on the live cut).
    fireEvent.click(screen.getByRole('button', { name: /Sửa ô điều phối/ }));
    expect(await screen.findByText(/Chỉnh sửa điều phối/)).toBeTruthy();
    expect(onEnsureFulfillment).toHaveBeenCalledTimes(1);
  });

  it('renders the Phát lệnh action inside the Ghi chú cell, not the assignment cell', () => {
    const { container } = renderGrid([row({
      taskStatus: 'READY',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345' },
    })]);
    const notesCell = container.querySelector('.detailed-plan-grid__cell--notes') as HTMLElement;
    const assignmentCell = container.querySelector('.detailed-plan-grid__cell--editable') as HTMLElement;
    const note = notesCell.querySelector('.detailed-plan-grid__note') as HTMLElement;
    const action = within(notesCell).getByRole('button', { name: /Phát lệnh/ });
    expect(within(assignmentCell).queryByRole('button', { name: /Phát lệnh/ })).toBeNull();
    // Customer ruling: the action sits BENEATH the notes inside the cell.
    expect(action.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it('VID-DSP-02 releases directly from the Ghi chú action without a scheduling dialog', async () => {
    const onIssueOrder = vi.fn().mockResolvedValue({});
    renderGrid([row({
      taskStatus: 'READY',
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: '51C-12345' },
    })], { onIssueOrder });
    fireEvent.click(screen.getByRole('button', { name: /Phát lệnh/ }));
    await waitFor(() => expect(onIssueOrder).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Chọn nhanh ngày|KHUNG GIỜ/)).toBeNull();
  });

  it('renders the Hoàn thành action inside the Ghi chú cell for in-flight external rows', () => {
    const onCompleteExternalTrip = vi.fn();
    const { container } = renderGrid([row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Carrier QA', externalCarrierId: 9, externalCarrierVehicleId: null, assignedPlate: 'E2E-QA1', tripId: 77, tripStatus: 'CREATED' },
    })], { onCompleteExternalTrip });
    const notesCell = container.querySelector('.detailed-plan-grid__cell--notes') as HTMLElement;
    fireEvent.click(within(notesCell).getByRole('button', { name: /Hoàn thành/ }));
    expect(onCompleteExternalTrip).toHaveBeenCalledTimes(1);
  });

  it('renders no row action for an already-issued own row', () => {
    const { container } = renderGrid([row({
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345', tripId: 55, tripStatus: 'CREATED' },
    })]);
    const notesCell = container.querySelector('.detailed-plan-grid__cell--notes') as HTMLElement;
    expect(within(notesCell).queryByRole('button', { name: /Phát lệnh|Hoàn thành/ })).toBeNull();
  });
});

// QA-001 (appointment minutes): the schedule cell renders the full +07
// "HH:mm dd/mm/yyyy" from time.runAt — same formatter as the overview grid
// (formatAppointmentGroupLine) — with the hour-int fallback for older rows
// and an explicit em-dash when no time source exists. Own describe block so
// the QA-010 carrier-status lane can add coverage here without collisions.
describe('DetailedPlanGrid — QA-001 appointment minutes', () => {
  it('SCHEDULE-LAYOUT-03 keeps exact Vietnam time/date together with the operation below', () => {
    const { container } = renderGrid([row({ time: { deliveryDate: '2026-09-11', runAt: '2026-09-10T17:45:00.000Z', runHour: 0 } })]);
    const schedule = container.querySelector('.ops-schedule')!;
    expect(schedule.firstElementChild).toHaveTextContent('00:45 11/09/2026');
    expect(schedule.lastElementChild).toHaveTextContent('đóng hàng');
    expect(schedule.lastElementChild?.textContent).not.toContain('11/09/2026');
  });

  it('falls back to the hour-int render for rows without runAt', () => {
    renderGrid([row({ time: { deliveryDate: '2026-09-11', runHour: 20 } })]);

    expect(screen.getByText('20H 11/09/2026')).toBeTruthy();
  });

  it('SCHEDULE-LAYOUT-04 keeps a known date without inventing a time', () => {
    renderGrid([row({ time: { deliveryDate: '2026-09-11', runHour: null } })]);

    expect(screen.getByText('— 11/09/2026')).toBeTruthy();
  });

  it('SCHEDULE-LAYOUT-04 preserves a fully unknown schedule and direction', () => {
    const { container } = renderGrid([row({ time: { deliveryDate: null, runHour: null }, docs: { billNumber: 'UNKNOWN', tradeDirection: null, declarationNumbers: [] } })]);
    const schedule = container.querySelector('.ops-schedule')!;
    expect(schedule.firstElementChild).toHaveTextContent(/^—$/);
    expect(schedule.lastElementChild).toHaveTextContent(/^—$/);
  });

  it('SCHEDULE-LAYOUT-05 preserves a different transport date without splitting the appointment', () => {
    const { container } = renderGrid([row({ time: { deliveryDate: '2026-09-12', runAt: '2026-09-11T13:45:00.000Z', runHour: 20 } })]);
    const schedule = container.querySelector('.ops-schedule')!;
    expect(schedule.firstElementChild).toHaveTextContent('20:45 11/09/2026');
    expect(schedule.lastElementChild).toHaveTextContent('đóng hàng · Ngày vận chuyển: 12/09/2026');
  });
});

// QA-001 AC4: the header toggle must visibly flip — the active column glyph
// tracks the direction (▲ ascending / ▼ descending), not a static marker.
describe('DetailedPlanGrid — header sort direction', () => {
  it('shows ▲ for an ascending active column and ▼ once flipped to descending', () => {
    const ascView = renderGrid([row()], { sortKey: 'runHour', sortDirection: 'asc' });
    expect(screen.getByRole('button', { name: 'Sắp xếp theo giờ chạy' })).toHaveTextContent('▲');
    ascView.unmount();

    renderGrid([row()], { sortKey: 'runHour', sortDirection: 'desc' });
    expect(screen.getByRole('button', { name: 'Sắp xếp theo giờ chạy' })).toHaveTextContent('▼');
  });

  it('mirrors the flip on the delivery-point column and announces it via aria-sort', () => {
    const { container } = renderGrid([row()], { sortKey: 'deliveryPoint', sortDirection: 'desc' });
    expect(screen.getByRole('button', { name: 'Sắp xếp theo điểm trả' })).toHaveTextContent('▼');
    const sortedHeaders = container.querySelectorAll('th[aria-sort]');
    expect(sortedHeaders).toHaveLength(1);
    expect(sortedHeaders[0]).toHaveAttribute('aria-sort', 'descending');
  });

  // Grouping runs by customer is one of the three orderings the dispatch spec
  // calls out, and it needs its own control: the customer header used to fire
  // the delivery-point sort, so there was no way to bundle a customer's runs.
  it('sorts by customer from the customer header', () => {
    const onToggleSort = vi.fn();
    renderGrid([row()], { sortKey: 'customer', sortDirection: 'asc', onToggleSort });
    const button = screen.getByRole('button', { name: 'Sắp xếp theo khách hàng' });
    expect(button).toHaveTextContent('▲');
    fireEvent.click(button);
    expect(onToggleSort).toHaveBeenCalledWith('customer');
  });

  // The delivery-point control belongs on the column that shows the drop, not
  // on the customer column.
  it('puts the delivery-point sort on the Trả hàng header', () => {
    const { container } = renderGrid([row()], { sortKey: 'deliveryPoint', sortDirection: 'asc' });
    const sortedHeader = container.querySelector('th[aria-sort]')!;
    expect(sortedHeader).toHaveTextContent('Trả hàng');
  });
});

// Duplicate-key regression (20260914_1): branch rows ride the wire with a
// null fulfillmentId; keying <tr> on it flooded the console with
// "Encountered two children with the same key, null" on every render. Every
// row must key on a stable unique identity instead.
describe('DetailedPlanGrid — unique row keys', () => {
  it('renders multiple fulfillment-less branch rows without duplicate-key warnings', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderGrid([
        row({ fulfillmentId: null as unknown as number, shipmentContainerId: 501, container: { containerNumber: null, containerTypeLabel: '20DC', cargoWeightKg: null } }),
        row({ fulfillmentId: null as unknown as number, shipmentContainerId: 502, container: { containerNumber: null, containerTypeLabel: '20DC', cargoWeightKg: null } }),
      ]);

      // Header row + both branch rows render — nothing dropped.
      expect(screen.getAllByRole('row')).toHaveLength(3);
      expect(screen.getAllByText('Chưa có số cont')).toHaveLength(2);
      const duplicateKeyWarnings = errorSpy.mock.calls
        .filter((call) => String(call[0]).includes('same key'));
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('keeps fulfillment and branch rows keyed apart in one grid', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderGrid([
        row({ fulfillmentId: 101 }),
        row({ fulfillmentId: null as unknown as number, shipmentContainerId: 501, container: { containerNumber: null, containerTypeLabel: '20DC', cargoWeightKg: null } }),
      ]);
      expect(screen.getAllByRole('row')).toHaveLength(3);
      expect(errorSpy.mock.calls.filter((call) => String(call[0]).includes('same key'))).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// Compact phone cards (QA-011): an all-empty notes cell (no notes, no row
// action) collapses at the card tiers via the --blank modifier, so phone
// cards stop reserving a labelled blank band. Any content — a note or the
// Phát lệnh/Hoàn thành action — keeps the cell present.
describe('DetailedPlanGrid — blank notes cell collapse', () => {
  it('marks the notes cell blank when there are no notes and no row action', () => {
    const { container } = renderGrid([row({
      notes: { vehicleNote: null, customerNote: null },
    })]);
    expect(container.querySelector('.detailed-plan-grid__cell--notes.detailed-plan-grid__cell--blank')).toBeTruthy();
  });

  it('keeps the notes cell present for vehicle notes', () => {
    const { container } = renderGrid([row()]);
    expect(container.querySelector('.detailed-plan-grid__cell--blank')).toBeNull();
  });

  it('keeps the notes cell present when only the row action renders', () => {
    // PLATED_NOT_ISSUED: plate assigned, order not yet issued.
    const { container } = renderGrid([row({
      notes: { vehicleNote: null, customerNote: null },
      dispatch: { ...row().dispatch, assignedPlate: '15H-104.03' },
    })]);
    expect(container.querySelector('.detailed-plan-grid__cell--blank')).toBeNull();
    expect(screen.getByRole('button', { name: /Phát lệnh/ })).toBeTruthy();
  });
});

// Secondary-info contrast (QA-007): --text-secondary/--text-tertiary are
// undefined app-wide, so each rule's FALLBACK is the computed color. Muted
// operational lines (Giờ times, weights, customer notes) and the editor's
// placeholder copy must resolve to the WCAG-passing slate-500 (4.76:1 on
// white, 4.55:1 on the hover tint) — never back to the 2.5:1 pale grays.
// Decorative middot separators stay lighter by design (exempt).
describe('DetailedPlanGrid — secondary text contrast pins', () => {
  it('resolves muted operational lines to the contrast-passing fallback', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const muted = css.match(/\.detailed-plan-grid__line--muted \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(muted.match(/color:\s*([^;]+);/)?.[1]).toBe('var(--text-secondary, #64748b)');
  });

  it('Tuyến cell shows the route, then the destination, then an explicit missing label — never a silent dash', () => {
    // Route present: strong line.
    const withRoute = renderGrid([row()]);
    const routeCell = withRoute.container.querySelector<HTMLElement>('td[data-label="Tuyến đường"]')!;
    expect(routeCell.textContent).toContain('LH — Biên Hòa');

    // No route but a known destination: the destination orients the row,
    // muted — the same context CUS shows for this lot.
    const withDestination = renderGrid([row({
      customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương', routeName: null },
    })]);
    const destinationCell = withDestination.container.querySelector<HTMLElement>('td[data-label="Tuyến đường"]')!;
    expect(destinationCell.textContent).toContain('Kho Bình Dương');
    expect(destinationCell.textContent).not.toContain('LH — Biên Hòa');

    // Genuinely unknown: an explicit data label, never a bare dash.
    const unknown = renderGrid([row({
      customerRoute: { customerName: 'Công ty ABC', factoryName: null, deliveryPoint: null, routeName: null },
    })]);
    const unknownCell = unknown.container.querySelector<HTMLElement>('td[data-label="Tuyến đường"]')!;
    expect(unknownCell.textContent).toContain('Chưa có tuyến đường');
    expect(unknownCell.textContent).not.toContain('—');
    expect(unknownCell.textContent).not.toContain('Kho Bình Dương');
  });

  it('resolves the editor placeholder copy to the contrast-passing fallback', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');
    const placeholder = css.match(/\.dispatch-assignment-cell__plate\.is-placeholder,[\s\S]*?\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(placeholder.match(/color:\s*([^;]+);/)?.[1]).toBe('var(--text-tertiary, #64748b)');
  });
});

describe('allocation editor mounts on every press (20260916_9)', () => {
  function PressHost({ initialRow }: { initialRow: DispatchDetailPlanRow }) {
    const [items, setItems] = useState<DispatchDetailPlanRow[]>([initialRow]);
    const [autoOpen, setAutoOpen] = useState<number | null>(null);
    const consume = vi.fn(() => setAutoOpen(null));
    const ensure = vi.fn(async (current: DispatchDetailPlanRow) => {
      const fresh = { ...current, fulfillmentId: 98, version: 1 };
      setItems([fresh]);
      setAutoOpen(98);
      return fresh;
    });
    return (
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MonthProvider>
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
          sortDirection="asc"
          onToggleSort={vi.fn()}
          onAtomicSave={vi.fn()}
          onOpenTripReassign={vi.fn()}
          onCompleteExternalTrip={vi.fn()}
          onIssueOrder={vi.fn()}
          onEnsureFulfillment={ensure}
          autoOpenFulfillmentId={autoOpen}
          onAutoOpenConsumed={consume}
        />
          </MonthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }

  it('mounts the editor on press 1 (branch decompose) and on every later press', async () => {
    const branch = {
      ...row({ fulfillmentId: undefined }),
      shipmentContainerId: 55,
    } as DispatchDetailPlanRow;
    render(<PressHost initialRow={branch} />);
    const trigger = () => screen.getByRole('button', { name: 'Sửa ô điều phối MSCU1234567' });

    // Press 1 — decompose path, then the editor must mount on the fresh row.
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Chỉnh sửa điều phối/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Chỉnh sửa điều phối/ })).toBeNull());

    // Presses 2-3 — direct path after the row gained its fulfillment.
    for (let round = 2; round <= 3; round++) {
      fireEvent.click(trigger());
      await waitFor(() => expect(screen.getByRole('dialog', { name: /Chỉnh sửa điều phối/ })).toBeTruthy(), { timeout: 1500 });
      fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: /Chỉnh sửa điều phối/ })).toBeNull());
    }
  });
});

it('opens OPS recovery instructions without editing the driver note', () => {
  renderGrid([row({ notes: { vehicleNote: null, customerNote: null, opsRecoveryNotes: ['Khách trả theo chứng từ\nGiữ bản gốc'] } })]);
  fireEvent.click(screen.getByRole('button', { name: /OPS:\s*Khách trả theo chứng từ/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Giữ bản gốc');
});

describe('DetailedPlanGrid — background-refresh resilience (P1 dispatch-detail mount regression)', () => {
  it('keeps the table and its inline editors mounted when a background refresh fails (items already loaded)', async () => {
    // Post-cut#4 repro (QA _58 block): a transient failure on the 30s
    // auto-refresh tick collapsed the whole grid to the error branch —
    // rows vanished and the open inline editor died with them. Stale data
    // must stay on screen with a non-blocking banner instead.
    const onRetry = vi.fn();
    renderGrid([row(), row({ fulfillmentId: 102 })], {
      error: 'Không thể tải kế hoạch chi tiết. Vui lòng thử lại.',
      onRetry,
    });
    // Both rows survive (identified by container number — the row identity
    // the dispatchers read).
    expect(screen.getAllByText('MSCU1234567').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('row').length).toBeGreaterThan(2);
    // The failure is announced but never as a table replacement…
    expect(screen.getByRole('alert')).toBeTruthy();
    // …and the retry affordance rides the banner, not a full-surface swap.
    fireEvent.click(screen.getByRole('button', { name: /Thử lại/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // The editor-affordance column (assignment) stays interactive: the first
    // row still exposes its plate control.
    expect(screen.queryAllByRole('row').length).toBeGreaterThan(2);
  });

  it('keeps the filter bar mounted in every state so the drive can always find Tìm nhanh', () => {
    const filters = { ...EMPTY_DETAILED_PLAN_FILTERS, q: 'MSCU' };
    // Error state…
    const errorRender = renderGrid([row()], {
      filters,
      error: 'Không thể tải kế hoạch chi tiết. Vui lòng thử lại.',
    });
    expect(screen.getByLabelText('Tìm nhanh')).toBeTruthy();
    errorRender.unmount();
    // …loading state…
    const loadingRender = renderGrid([], { filters, loading: true });
    expect(screen.getByLabelText('Tìm nhanh')).toBeTruthy();
    loadingRender.unmount();
    // …and the data state.
    renderGrid([row()], { filters });
    expect(screen.getByLabelText('Tìm nhanh')).toBeTruthy();
  });
});
