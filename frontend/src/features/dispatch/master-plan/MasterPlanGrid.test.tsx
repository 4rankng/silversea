import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { MasterPlanGrid } from './MasterPlanGrid';
import { MasterPlanFilters } from './MasterPlanFilters';

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
  routeName: 'LH — Biên Hòa',
  factoryName: 'Nhà máy XYZ',
  blNumber: 'BL-2026-001',
  bookingRef: null,
  shippingLineName: 'Maersk',
  tradeDirection: 'IMPORT',
  pickupLocation: 'Cảng Cát Lái',
  deliveryLocation: 'Kho Bình Dương',
  expectedDeliveryDate: '2026-08-20',
  customsCutoffAt: '2026-08-01T05:00:00.000Z',
  operationalNotes: 'Giao giờ hành chính',
  containerCount20: 1,
  containerCount40: 2,
  containerTypeSummary: '2 x 40HC + 1 x 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  appointmentGroups: [],
  containerPortGroups: [
    { pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '2 x 40HC + 1 x 20DC' },
  ],
  ...overrides,
} as ShipmentListItem);

describe('MasterPlanGrid', () => {
  it('renders lift and drop locations from each container group instead of the legacy lot fields', () => {
    const fixture = {
      ...item({ pickupLocation: null, deliveryLocation: null }),
      containerPortGroups: [
        { pickupPortName: 'TC - HICT', dropoffPortName: 'Nhà máy Bắc Giang', containerSummary: '1 x 40DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Kho Long Biên', containerSummary: '1 x 20DC' },
      ],
    } as ShipmentListItem;

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    expect(screen.getAllByText('Nâng:')).toHaveLength(2);
    expect(screen.getAllByText('Hạ:')).toHaveLength(2);
    expect(screen.getByText('TC - HICT · 1 x 40DC')).toBeTruthy();
    expect(screen.getByText('Nhà máy Bắc Giang · 1 x 40DC')).toBeTruthy();
    expect(screen.getByText('Cảng Hải Phòng · 1 x 20DC')).toBeTruthy();
    expect(screen.getByText('Kho Long Biên · 1 x 20DC')).toBeTruthy();
    expect(screen.queryByText('Nâng: —')).toBeNull();
  });

  it('does not project legacy lot locations when no container-port data is available', () => {
    const fixture = item({
      pickupLocation: 'Địa điểm nâng cũ theo lô',
      deliveryLocation: 'Địa điểm hạ cũ theo lô',
      // Keep rolling deploys safe when an older API response lacks the additive field.
      containerPortGroups: undefined as unknown as ShipmentListItem['containerPortGroups'],
    });

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    expect(screen.getByText('Nâng:')).toBeTruthy();
    expect(screen.getByText('Hạ:')).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Nâng: Địa điểm nâng cũ theo lô')).toBeNull();
    expect(screen.queryByText('Hạ: Địa điểm hạ cũ theo lô')).toBeNull();
  });

  it('renders one "Giờ:" line per per-container appointment group (EPIC 2.4 mapping)', () => {
    const onAllocate = vi.fn();
    const fixture = item({
      // 2 containers with 2 different close/return instants — the master plan
      // must surface BOTH, not collapse to a single shipment-level hour.
      appointmentGroups: [
        { at: '2026-08-24T04:00:00.000Z', localDate: '2026-08-24', factoryName: 'Sunrise', factoryShortName: 'Sunrise', factoryFullName: 'Nhà máy Sunrise', containerSummary: '1 x 40DC' },
        { at: '2026-08-25T04:00:00.000Z', localDate: '2026-08-25', factoryName: 'Sunrise', factoryShortName: 'Sunrise', factoryFullName: 'Nhà máy Sunrise', containerSummary: '1 x 40DC' },
      ],
    });
    render(<MasterPlanGrid items={[fixture]} onAllocate={onAllocate} />);

    // The API carries a Vietnam business date and the formatter fixes the
    // time to ICT, so this remains stable in a UTC CI runner and in a browser
    // opened from another timezone.
    const renderedText = screen.getByText(/11:00 24\/8\/2026 · Sunrise · 1 x 40DC/);
    expect(renderedText).toBeTruthy();
    expect(screen.getByText(/11:00 25\/8\/2026 · Sunrise · 1 x 40DC/)).toBeTruthy();
    // Both lines start with the "Giờ:" prefix.
    const scheduleCell = renderedText.closest('td');
    expect(scheduleCell).toBeTruthy();
    const gioLines = within(scheduleCell!).getAllByText(/Giờ:/);
    expect(gioLines.length).toBe(2);
  });

  it('falls back to the shipment-level closingAt when no per-container appointments exist', () => {
    const onAllocate = vi.fn();
    const fixture = item({
      appointmentGroups: [],
      closingAt: '2026-08-23T08:00:00.000Z', // 15:00 ICT, 08:00 UTC
      plannedReturnAt: null,
    });
    render(<MasterPlanGrid items={[fixture]} onAllocate={onAllocate} />);
    // Host-TZ-independent: the seed 08:00 UTC maps to either 8H or 15H
    // depending on the runner's TZ; assert the value is one of those two.
    const cell = screen.getByText(/Lịch cont sớm nhất: 20\/08\/2026/).closest('td');
    const gioLine = within(cell!).getByText(/Giờ: \d{1,2}H/);
    expect(gioLine.textContent).toMatch(/Giờ: (8H|15H)/);
  });

  it('renders all 7 docx columns for a READY_FOR_DISPATCH row', () => {
    const onAllocate = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={onAllocate} />);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & nhà máy',
      'Chứng từ & hãng tàu',
      'Địa điểm nâng/hạ',
      'Tổng quan hàng hóa',
      'Ghi chú',
      'Phân bổ nhà xe',
    ]);

    expect(screen.getByText(/Lịch cont sớm nhất: 20\/08\/2026/)).toBeTruthy();
    expect(screen.getByText(/Hạn hoàn tất hải quan:/)).toBeTruthy();
    expect(screen.getByText('Công ty ABC')).toBeTruthy();
    // P8: route and shipping line are the primary (strong) identity lines.
    expect(screen.getByText('Lộ trình: LH — Biên Hòa')).toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('Maersk')).toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('BL-2026-001')).toBeTruthy();
    expect(screen.getByText('Nhập')).toBeTruthy();
    expect(screen.getByText('Nâng:')).toBeTruthy();
    expect(screen.getByText('Cảng Cát Lái · 2 x 40HC + 1 x 20DC')).toBeTruthy();
    expect(screen.getByText('Hạ:')).toBeTruthy();
    expect(screen.getByText('Kho Bình Dương · 2 x 40HC + 1 x 20DC')).toBeTruthy();
    const cargoCell = screen.getByText('2 x 40HC').closest('td');
    expect(cargoCell).toBeTruthy();
    expect(screen.getByText('1 x 20DC').closest('td')).toBe(cargoCell);
    expect(screen.getByText(/41\.000,75 kg/)).toBeTruthy();
    expect(screen.getByText('Giao giờ hành chính')).toBeTruthy();
    expect(screen.getByText('Công ty ABC')).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('BL-2026-001')).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText(/Lịch cont sớm nhất: 20\/08\/2026/)).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('2 x 40HC')).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('1 x 20DC')).not.toHaveClass('master-plan-grid__line--strong');
    const liftLocationBlock = screen.getByText('Cảng Cát Lái · 2 x 40HC + 1 x 20DC').closest('.master-plan-grid__location-block') as HTMLElement | null;
    const dropLocationBlock = screen.getByText('Kho Bình Dương · 2 x 40HC + 1 x 20DC').closest('.master-plan-grid__location-block') as HTMLElement | null;
    expect(liftLocationBlock).toBeTruthy();
    expect(dropLocationBlock).toBeTruthy();
    expect(within(liftLocationBlock!).getByText('Nâng:')).not.toHaveClass('master-plan-grid__line--strong');
    expect(within(liftLocationBlock!).getByText('Cảng Cát Lái · 2 x 40HC + 1 x 20DC')).not.toHaveClass('master-plan-grid__line--strong');
    expect(within(dropLocationBlock!).getByText('Hạ:')).not.toHaveClass('master-plan-grid__line--strong');
    expect(within(liftLocationBlock!).getByText('Nâng:')).toHaveClass('master-plan-grid__location-label--lift');
    expect(within(dropLocationBlock!).getByText('Hạ:')).toHaveClass('master-plan-grid__location-label--drop');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__location-label--lift {\n  color: var(--accent-ink);\n}');
    expect(css).toContain('.master-plan-grid__location-label--drop {\n  color: var(--info-text);\n}');
    expect(css).toContain('.master-plan-grid__location-value {\n  color: var(--fg-1);\n  font-weight: 400;\n}');
    expect(screen.getByText('Maersk')).toHaveClass('master-plan-grid__line--strong');
    const allocationTrigger = screen.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    expect(screen.getByText('Chưa phân bổ').closest('button')).toBe(allocationTrigger);
    expect(allocationTrigger.closest('td')?.classList.contains('master-plan-grid__cell--action')).toBe(true);
  });

  it('anchors the direction pill at the lower-right of the document cell', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__documents-direction { grid-area: direction; align-self: end; justify-self: end; }');
    expect(css).toContain('"carrier carrier"');
    expect(css).toContain('". direction"');
  });

  it('prioritizes schedule space over the compact document and allocation columns on desktop', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const widthFor = (column: string) => Number(css.match(new RegExp(`\\.master-plan-grid__col--${column}\\s*\\{\\s*width:\\s*(\\d+(?:\\.\\d+)?)%`))?.[1] ?? 0);

    const scheduleWidth = widthFor('schedule');
    const widths = ['schedule', 'customer', 'documents', 'locations', 'cargo', 'notes', 'allocation'].map(widthFor);

    expect(scheduleWidth).toBe(22);
    expect(scheduleWidth).toBeGreaterThan(widthFor('documents'));
    expect(scheduleWidth).toBeGreaterThan(widthFor('allocation'));
    expect(widths.reduce((total, width) => total + width, 0)).toBe(100);
  });

  it('wraps operational values instead of truncating them in compact table columns', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const lineRule = css.match(/\.master-plan-grid__line \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(lineRule).toContain('white-space: normal');
    expect(lineRule).toContain('overflow-wrap: anywhere');
    expect(lineRule).not.toContain('text-overflow: ellipsis');
    expect(lineRule).not.toContain('overflow: hidden');
  });

  it('normalizes older container-summary separators while keeping each type on its own line', () => {
    render(<MasterPlanGrid items={[item({ containerTypeSummary: '1 * 40HC + 1×20HC' })]} onAllocate={vi.fn()} />);

    expect(screen.getByText('1 x 40HC')).toBeTruthy();
    expect(screen.getByText('1 x 20HC')).toBeTruthy();
  });

  it('uses the allocation values as the full-cell edit trigger without a separate edit button', () => {
    render(
      <MasterPlanGrid
        items={[item({
          allocationStatus: 'FULLY_ALLOCATED',
          carrierAllocationSummary: [
            { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 0, count40: 2 },
            { carrierType: 'EXTERNAL', externalCarrierId: 77, carrierLabel: 'HÀ AN', count20: 1, count40: 0 },
          ],
        })]}
        onAllocate={vi.fn()}
      />,
    );

    expect(screen.getByText((_, element) =>
      Boolean(element?.className.includes('master-plan-grid__chip')) && element?.textContent === "SilverSea: 2x40'")).toBeTruthy();
    expect(screen.getByText((_, element) =>
      Boolean(element?.className.includes('master-plan-grid__chip')) && element?.textContent === "HÀ AN: 1x20'")).toBeTruthy();
    const trigger = screen.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    expect(trigger.querySelectorAll('.master-plan-grid__chip')).toHaveLength(2);
    expect(screen.queryByText('Sửa phân bổ')).toBeNull();
    expect(screen.queryByText('Phân bổ', { exact: true })).toBeNull();
  });

  it('fires onAllocate with the row payload and its allocation trigger', () => {
    const onAllocate = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={onAllocate} />);
    const trigger = screen.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    fireEvent.click(trigger);
    expect(onAllocate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), trigger);
  });

  it('opens the in-place container detail action with the shipment row and its trigger', () => {
    const onViewContainers = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} onViewContainers={onViewContainers} />);

    const trigger = screen.getByRole('button', { name: 'Xem chi tiết container của SS-000100' });
    fireEvent.click(trigger);

    expect(onViewContainers).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), trigger);
  });

  it('opens the allocation editor when the blank cell surface is clicked', () => {
    const onAllocate = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={onAllocate} />);
    const trigger = screen.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    const cell = trigger.closest('td');

    expect(cell).toBeTruthy();
    fireEvent.click(cell!);
    expect(onAllocate).toHaveBeenCalledTimes(1);
    expect(onAllocate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), trigger);
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps the allocation editor full-width with visible focus and a touch-safe mobile target', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const triggerRule = css.match(/\.master-plan-grid__allocation-trigger \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(triggerRule).toContain('width: 100%');
    expect(triggerRule).toContain('text-align: left');
    expect(css).toContain('.master-plan-grid__allocation-trigger:focus-visible');
    expect(css).toContain('min-height: 44px');
  });

  it('keeps the per-row container detail action compact on desktop and touch-safe on narrow screens', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__container-detail-trigger');
    expect(css).toContain('min-height: 28px');
    expect(css).toMatch(/@container \(max-width: 900px\)[\s\S]*?\.master-plan-grid__container-detail-trigger\s*\{[\s\S]*?min-height:\s*44px;/);
  });

  it('labels every shipment field group for the stacked narrow-screen layout', () => {
    render(<MasterPlanGrid items={[item()]} onAllocate={vi.fn()} />);

    expect(screen.getAllByRole('cell').map((cell) => cell.getAttribute('data-label'))).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & nhà máy',
      'Chứng từ & hãng tàu',
      'Địa điểm nâng/hạ',
      'Tổng quan hàng hóa',
      'Ghi chú',
      'Phân bổ nhà xe',
    ]);
  });

  it('wraps long allocation carrier labels inside their cell instead of truncating them', () => {
    render(
      <MasterPlanGrid
        items={[item({
          allocationStatus: 'FULLY_ALLOCATED',
          carrierAllocationSummary: [
            {
              carrierType: 'EXTERNAL',
              externalCarrierId: 77,
              carrierLabel: 'Công ty Cổ phần Giao nhận Vận tải Container Quốc tế Đại Dương Xanh Miền Bắc',
              count20: 0,
              count40: 1,
            },
          ],
        })]}
        onAllocate={vi.fn()}
      />,
    );

    expect(screen.getByText("Công ty Cổ phần Giao nhận Vận tải Container Quốc tế Đại Dương Xanh Miền Bắc: 1x40'")).toBeTruthy();

    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const chipRule = css.match(/\.master-plan-grid__chip \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(chipRule).toContain('max-inline-size: 100%');
    expect(chipRule).toContain('white-space: normal');
    expect(chipRule).toContain('overflow-wrap: anywhere');
    expect(chipRule).not.toContain('text-overflow: ellipsis');
    expect(chipRule).not.toContain('overflow: hidden');
  });

  it('keeps the mobile record surface stable while scrolling and uses one semantic text scale', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('.master-plan-grid__row:hover');
    expect(css).toContain('background: color-mix(in srgb, var(--fg-1) 2%, var(--surface))');
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css).toContain('@container (max-width: 599px)');
    expect(css).toContain('.master-plan-grid__cell:nth-child(4),\n  .master-plan-grid__cell:nth-child(5)');
    expect(css).toContain('color: var(--fg-1)');
    expect(css).toContain('color: var(--fg-2)');
    expect(css).toContain('color: var(--fg-3)');
  });
});

describe('MasterPlanFilters', () => {
  it('propagates every filter control change', () => {
    const onChange = vi.fn();
    render(<MasterPlanFilters filters={{ q: '', tradeDirection: '', allocationStatus: '', deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [] }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Tìm kiếm lô hàng'), { target: { value: 'BL-9' } });
    expect(onChange).toHaveBeenLastCalledWith({ q: 'BL-9' });

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả Chiều hàng' }));
    fireEvent.click(screen.getByRole('option', { name: 'Nhập' }));
    expect(onChange).toHaveBeenLastCalledWith({ tradeDirection: 'IMPORT' });

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả trạng thái Phân xe' }));
    fireEvent.click(screen.getByRole('option', { name: 'Chưa phân xe' }));
    expect(onChange).toHaveBeenLastCalledWith({ allocationStatus: 'NOT_ALLOCATED' });

    fireEvent.change(screen.getByLabelText('Từ ngày giao'), { target: { value: '2026-08-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateFrom: '2026-08-01' });

    fireEvent.change(screen.getByLabelText('Đến ngày giao'), { target: { value: '2026-08-31' } });
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateTo: '2026-08-31' });
  });

  it('keeps the complete delivery-date range and create action in one responsive control group', () => {
    const { container } = render(
      <MasterPlanFilters
        filters={{ q: '', tradeDirection: '', allocationStatus: '', deliveryDateFrom: '', deliveryDateTo: '', portIds: [], carrierKeys: [] }}
        onChange={vi.fn()}
        action={<button type="button">Tạo lô hàng</button>}
      />,
    );
    expect(container.querySelector('[role="group"][aria-label="Khoảng ngày giao"]')).toBeTruthy();
    expect(container.querySelector('.master-plan-filters__actions')?.textContent).toBe('Tạo lô hàng');

    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('display: flex');
    expect(css).toContain('flex-wrap: wrap');
    expect(css).toContain('flex: 0 1 360px');
    expect(css).toContain('flex: 0 0 132px');
    expect(css).toContain('flex: 0 0 180px');
    expect(css).toContain('flex: 0 0 auto');
    expect(css).toContain('grid-template-columns: minmax(132px, 1fr) auto minmax(132px, 1fr)');
    expect(css).toContain('.master-plan-filters__date-inputs');
    expect(css).toContain('.master-plan-filters__date-range');
    expect(css).toContain('.master-plan-filters__actions');
    expect(css).toContain('.drawer.master-plan-filters__drawer');
    expect(css).toContain('max-width: 100%');
    expect(css).toContain('padding: calc(18px + env(safe-area-inset-top, 0px)) 20px 14px;');
    expect(css).toContain('padding: 12px 20px calc(12px + env(safe-area-inset-bottom, 0px));');
  });

  it('keeps filters as a flat toolbar instead of nesting them in another surface', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const toolbar = css.match(/\.master-plan-filters \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(toolbar).not.toMatch(/\bpadding\s*:/);
    expect(toolbar).not.toMatch(/\bborder(?:-radius)?\s*:/);
    expect(toolbar).not.toMatch(/\bbackground\s*:/);
  });

  it('keeps the master plan edge-to-edge on wide application screens without a manual reload control', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/MasterPlanPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/DispatchPlanPage.css'), 'utf8');

    expect(page).not.toContain('Tải lại');
    expect(page).not.toContain('dispatch-plan-page__toolbar');
    expect(page).not.toContain('<PageHeader');
    expect(page).toContain('action={(');
    expect(page).toContain('dispatch-plan-page--wide');
    expect(css).toContain('max-width: 1400px');
    expect(css).toContain('.dispatch-plan-page--wide {\n  gap: 12px;\n  max-width: none;');
    expect(css).toContain('.app-main:not(.driver-mode) .app-body > .dispatch-plan-page--wide');
  });
});
