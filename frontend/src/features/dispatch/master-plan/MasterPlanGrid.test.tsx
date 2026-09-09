import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
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
      ...item({ pickupLocation: null, deliveryLocation: null, containerTypeSummary: null }),
      containerPortGroups: [
        { pickupPortName: 'TC - HICT', dropoffPortName: 'Nhà máy Bắc Giang', containerSummary: '1 x 40DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Kho Long Biên', containerSummary: '1 x 20DC' },
      ],
    } as ShipmentListItem;

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Cảng nâng' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Cảng hạ' })).toBeTruthy();
    expect(screen.getByText('TC - HICT')).toBeTruthy();
    expect(screen.getByText('Nhà máy Bắc Giang')).toBeTruthy();
    expect(screen.getByText('Cảng Hải Phòng')).toBeTruthy();
    expect(screen.getByText('Kho Long Biên')).toBeTruthy();
    // Per-type summary lines render under the port name, in both port columns.
    expect(screen.getAllByText('1 x 40DC')).toHaveLength(2);
    expect(screen.getAllByText('1 x 20DC')).toHaveLength(2);
    expect(screen.queryByText('Nâng:')).toBeNull();
  });

  it('aggregates container counts across per-day groups for the same (pickup → dropoff) pair', () => {
    // Same (pickup, dropoff) across 3 days, each day carrying 1 x 40DC; the
    // dispatch row must show the TOTAL (3 x 40DC), not three "1 x 40DC" lines.
    const fixture = item({
      containerPortGroups: [
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Cảng Tân Cảng 128 Hải Phòng', containerSummary: '1 x 40DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Cảng Tân Cảng 128 Hải Phòng', containerSummary: '1 x 40DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Cảng Tân Cảng 128 Hải Phòng', containerSummary: '1 x 40DC' },
      ],
    });

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    // Aggregated to a single (lift, drop) pair — one block in each port column.
    expect(screen.getByText('Cảng Hải Phòng')).toBeTruthy();
    expect(screen.getByText('Cảng Tân Cảng 128 Hải Phòng')).toBeTruthy();
    expect(screen.getAllByText('3 x 40DC')).toHaveLength(2);
    // The per-day "1 x 40DC" duplicates must not appear.
    expect(screen.queryByText('1 x 40DC')).toBeNull();
  });

  it('sums heterogeneous container-type counts across groups and keeps each unique (pickup → dropoff) pair separate', () => {
    // First pair splits across 2 days with two different container types.
    // Second pair is a different (pickup, dropoff) and must remain a separate
    // pair (it does NOT merge with the first pair's pickup even though the
    // pickup name is identical).
    const fixture = item({
      containerPortGroups: [
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Cảng Tân Cảng 128 Hải Phòng', containerSummary: '2 x 40DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Cảng Tân Cảng 128 Hải Phòng', containerSummary: '1 x 20DC' },
        { pickupPortName: 'Cảng Hải Phòng', dropoffPortName: 'Bãi SITC', containerSummary: '2 x 40DC' },
      ],
    });

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    // Two unique pairs → two blocks per column; shared pickup name appears twice.
    expect(screen.getAllByText('Cảng Hải Phòng')).toHaveLength(2);
    expect(screen.getByText('Cảng Tân Cảng 128 Hải Phòng')).toBeTruthy();
    expect(screen.getByText('Bãi SITC')).toBeTruthy();
    // Pair 1 aggregates 2 x 40DC + 1 x 20DC (both port columns); pair 2 adds
    // its own 2 x 40DC block. Scoped per column so the cargo summary does not
    // interfere with the counts.
    const liftCell = screen.getAllByText('Cảng Hải Phòng')[0].closest('td');
    expect(within(liftCell!).getAllByText('2 x 40DC')).toHaveLength(2);
    // The drop column hosts both pair blocks in one cell: Tân Cảng carries
    // 2 x 40DC + 1 x 20DC, Bãi SITC carries its own 2 x 40DC.
    const dropCell = screen.getByText('Cảng Tân Cảng 128 Hải Phòng').closest('td');
    expect(within(dropCell!).getAllByText('2 x 40DC')).toHaveLength(2);
    expect(within(dropCell!).getAllByText('1 x 20DC')).toHaveLength(1);
  });

  it('renders separated port values at the regular location weight', () => {
    const fixture = item({
      containerPortGroups: [
        { pickupPortName: 'Cảng Cát Lái', dropoffPortName: 'Kho Bình Dương', containerSummary: '1 x 40DC' },
      ],
    });

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    const value = screen.getByText('Cảng Cát Lái');
    // jsdom does not resolve CSS variables, so assert the explicit regular
    // weight rather than relying on inherited styles.
    expect(value.className).toContain('master-plan-grid__location-value');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const valueRule = css.match(/\.master-plan-grid__location-value \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(valueRule).toContain('font-weight: 400');
  });

  it('does not project legacy lot locations when no container-port data is available', () => {
    const fixture = item({
      pickupLocation: 'Địa điểm nâng cũ theo lô',
      deliveryLocation: 'Địa điểm hạ cũ theo lô',
      // Keep rolling deploys safe when an older API response lacks the additive field.
      containerPortGroups: undefined as unknown as ShipmentListItem['containerPortGroups'],
    });

    render(<MasterPlanGrid items={[fixture]} onAllocate={vi.fn()} />);

    expect(screen.getByRole('columnheader', { name: 'Cảng nâng' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Cảng hạ' })).toBeTruthy();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Địa điểm nâng cũ theo lô')).toBeNull();
    expect(screen.queryByText('Địa điểm hạ cũ theo lô')).toBeNull();
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
    // Each container appointment is a two-row block: "HH:mm d/m/yyyy" leads
    // and the "factory · containers" line indents beneath it.
    expect(screen.getByText('11:00 24/8/2026')).toBeTruthy();
    expect(screen.getByText('11:00 25/8/2026')).toBeTruthy();
    expect(screen.getAllByText('Sunrise · 1 x 40DC')).toHaveLength(2);
    // The "Giờ:" label is gone; only the HH:mm value leads each block.
    const scheduleCell = screen.getByText('11:00 24/8/2026').closest('td');
    expect(scheduleCell).toBeTruthy();
    expect(within(scheduleCell!).queryAllByText(/Giờ:/).length).toBe(0);
    expect(within(scheduleCell!).getAllByText('Sunrise · 1 x 40DC').length).toBe(2);
  });

  it('falls back to the shipment-level closingAt when no per-container appointments exist', () => {
    const onAllocate = vi.fn();
    const fixture = item({
      appointmentGroups: [],
      closingAt: '2026-08-23T08:00:00.000Z', // 15:00 ICT, 08:00 UTC
      plannedReturnAt: null,
    });
    render(<MasterPlanGrid items={[fixture]} onAllocate={onAllocate} />);
    // Host-TZ-independent: the seed 08:00 UTC maps to 8H, 15H (ICT), or 16H
    // in the repository's Asia/Singapore agent environment.
    const cell = screen.getByText('20/08/2026').closest('td');
    const hourLine = within(cell!).getByText(/^\d{1,2}H$/);
    expect(hourLine.textContent).toMatch(/^(8H|15H|16H)$/);
  });

  it('renders all 8 dispatch columns for a READY_FOR_DISPATCH row', () => {
    const onAllocate = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={onAllocate} />);

    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual([
      'Thời gian & lịch trình',
      'Khách hàng & nhà máy',
      'Tuyến đường & hãng tàu',
      'Cảng nâng',
      'Cảng hạ',
      'Tổng quan hàng hóa',
      'Phân bổ nhà xe',
      'Ghi chú',
    ]);

    expect(screen.getByText('20/08/2026')).toBeTruthy();
    expect(screen.getByText(/Hạn hoàn tất hải quan:/)).toBeTruthy();
    expect(screen.getByText('Công ty ABC')).toBeTruthy();
    // T2.1: customer → factories → bill number, with customer and bill bold.
    expect(screen.getByText('Công ty ABC')).toHaveClass('master-plan-grid__line--strong');
    // Bill number is now the 3rd line in Customer & Factory column (bold).
    expect(screen.getByText('BL-2026-001')).toHaveClass('master-plan-grid__line--strong');
    // Route name moved to Route & Shipping column (bold).
    expect(screen.getByText('LH — Biên Hòa')).toHaveClass('master-plan-grid__line--strong');
    expect(screen.queryByText('Lộ trình: LH — Biên Hòa')).toBeNull();
    expect(screen.getByText('Maersk')).toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('Nhập')).toBeTruthy();
    expect(screen.getByText('Cảng Cát Lái')).toBeTruthy();
    expect(screen.getByText('Kho Bình Dương')).toBeTruthy();
    // Port blocks split each container type onto its own line under the port name.
    const liftPortCell = screen.getByText('Cảng Cát Lái').closest('td');
    const dropPortCell = screen.getByText('Kho Bình Dương').closest('td');
    expect(liftPortCell).toHaveAttribute('data-label', 'Cảng nâng');
    expect(dropPortCell).toHaveAttribute('data-label', 'Cảng hạ');
    expect(within(liftPortCell!).getByText('2 x 40HC')).toBeTruthy();
    expect(within(liftPortCell!).getByText('1 x 20DC')).toBeTruthy();
    expect(screen.getByText('Cảng Cát Lái')).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText('Kho Bình Dương')).not.toHaveClass('master-plan-grid__line--strong');
    const cargoCell = Array.from(document.querySelectorAll('td')).find((td) => td.getAttribute('data-label') === 'Tổng quan hàng hóa');
    expect(cargoCell).toBeTruthy();
    expect(within(cargoCell!).getByText('2 x 40HC')).not.toHaveClass('master-plan-grid__line--strong');
    expect(within(cargoCell!).getByText('1 x 20DC')).not.toHaveClass('master-plan-grid__line--strong');
    expect(screen.getByText(/41\.000,75 kg/)).toBeTruthy();
    expect(screen.getByText('Giao giờ hành chính')).toBeTruthy();
    expect(screen.getByText('20/08/2026')).not.toHaveClass('master-plan-grid__line--strong');
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__location-value {\n  color: var(--fg-1);\n  font-weight: 400;\n}');
    expect(screen.getByText('Maersk')).toHaveClass('master-plan-grid__line--strong');
    const allocationTrigger = screen.getByRole('button', { name: 'Chỉnh sửa phân bổ nhà xe' });
    expect(screen.getByText('Chưa phân bổ').closest('button')).toBe(allocationTrigger);
    expect(allocationTrigger.closest('td')?.classList.contains('master-plan-grid__cell--action')).toBe(true);
  });

  it('anchors the direction pill at the right of the carrier line', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__route-shipping-direction { grid-area: direction; align-self: end; justify-self: end; }');
    expect(css).toContain('"carrier direction"');
  });

  it('rebalances schedule against route-shipping and allocation on desktop', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    const widthFor = (column: string) => Number(css.match(new RegExp(`\\.master-plan-grid__col--${column}\\s*\\{\\s*width:\\s*(\\d+(?:\\.\\d+)?)%`))?.[1] ?? 0);

    const scheduleWidth = widthFor('schedule');
    const widths = ['schedule', 'customer', 'route-shipping', 'lift-port', 'drop-port', 'cargo', 'notes', 'allocation'].map(widthFor);

    // 2b023521 rebalanced the grid toward route/shipping (16%) +
    // allocation (12%); schedule is now 15% (was 22%) — the trip window
    // still gets dedicated room but route/shipping wins on the wireframe.
    expect(scheduleWidth).toBe(15);
    expect(widthFor('route-shipping')).toBe(16);
    expect(widthFor('allocation')).toBe(12);
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

  it('hides the "Ghi chú" column when both operationalNotes and factoryNotes are empty', () => {
    render(
      <MasterPlanGrid
        items={[item({ operationalNotes: null, factoryNotes: null })]}
        onAllocate={vi.fn()}
      />,
    );

    const notesCell = document.querySelector('td.master-plan-grid__cell[data-label="Ghi chú"]');
    expect(notesCell).toBeTruthy();
    // The cell is rendered but contains no "—" placeholder text and no note lines.
    expect(notesCell!.querySelectorAll('.master-plan-grid__line--notes')).toHaveLength(0);
    expect(notesCell!.textContent?.trim()).toBe('');
  });

  it('hides the "Ghi chú" cell placeholder when only one of the note fields is present', () => {
    render(
      <MasterPlanGrid
        items={[item({ operationalNotes: 'Giao giờ HC', factoryNotes: null })]}
        onAllocate={vi.fn()}
      />,
    );

    expect(screen.getByText('Giao giờ HC')).toBeTruthy();
    // The "—" placeholder for the missing factoryNotes line must not appear.
    const notesCell = document.querySelector('td.master-plan-grid__cell[data-label="Ghi chú"]');
    expect(notesCell).toBeTruthy();
    expect(notesCell!.textContent).not.toContain('—');
  });

  it('truncates long factory notes and provides a "Chi tiết" trigger opening the full note modal', () => {
    const longNote = '3. Lưu ý cần chú ý khi đóng/ trả hàng tại nhà máy - Lái xe đăng ký bảo vệ vào đóng/ trả cho công ty Long Minh- Trước khi vào đóng/ trả hàng lái xe gọi đúng SĐT';
    render(
      <MasterPlanGrid
        items={[item({ factoryNotes: longNote })]}
        onAllocate={vi.fn()}
      />,
    );

    // Truncated text is rendered in the cell
    expect(screen.getByText(/NM: 3\. Lưu ý cần chú ý/)).toBeTruthy();
    // The "Xem chi tiết" button is visible
    const detailBtn = screen.getByRole('button', { name: 'Xem chi tiết ghi chú nhà máy' });
    expect(detailBtn).toBeTruthy();
    expect(detailBtn.textContent).toBe('Xem chi tiết');

    // Click "Chi tiết" to open the modal
    fireEvent.click(detailBtn);

    // Modal dialog opens
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ghi chú nhà máy' })).toBeTruthy();
    expect(screen.getByText(longNote)).toBeTruthy();

    // Close the modal via the close button
    const closeBtns = screen.getAllByRole('button', { name: 'Đóng' });
    fireEvent.click(closeBtns[0]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('allows copying full note to clipboard from the note modal', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const longNote = 'Nghiêm cấm hút thuốc trong địa phận công ty - Hàng đóng điện tử yêu cầu vỏ đẹp, sàn chắc khỏe.';
    render(
      <MasterPlanGrid
        items={[item({ factoryNotes: longNote })]}
        onAllocate={vi.fn()}
      />,
    );

    const detailBtn = screen.getByRole('button', { name: 'Xem chi tiết ghi chú nhà máy' });
    fireEvent.click(detailBtn);

    const copyBtn = screen.getByRole('button', { name: 'Sao chép' });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith(longNote);
  });

  it('truncates long operational notes with Chi tiết button and allows switching to edit mode from the modal', () => {
    const longOpNote = 'Lái xe chú ý liên hệ thủ kho trước 30 phút để chuẩn bị bốc xếp hàng hóa cẩn thận, không làm rách bao bì.';
    const onUpdateNotes = vi.fn();
    render(
      <MasterPlanGrid
        items={[item({ operationalNotes: longOpNote })]}
        onAllocate={vi.fn()}
        onUpdateNotes={onUpdateNotes}
      />,
    );

    const detailBtn = screen.getByRole('button', { name: 'Xem chi tiết ghi chú điều hành' });
    expect(detailBtn).toBeTruthy();
    fireEvent.click(detailBtn);

    // In modal, "Sửa ghi chú" button appears
    expect(screen.getByRole('heading', { name: 'Ghi chú điều hành' })).toBeTruthy();
    const editBtn = screen.getByRole('button', { name: 'Sửa ghi chú' });
    fireEvent.click(editBtn);

    // Modal is closed and textarea editor appears
    expect(screen.queryByRole('dialog')).toBeNull();
    const textarea = screen.getByLabelText('Ghi chú điều phối') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe(longOpNote);
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
      'Tuyến đường & hãng tàu',
      'Cảng nâng',
      'Cảng hạ',
      'Tổng quan hàng hóa',
      'Phân bổ nhà xe',
      'Ghi chú',
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
    expect(css).toContain('.master-plan-grid__cell--lift-port,\n  .master-plan-grid__cell--drop-port');
    expect(css).toContain('color: var(--fg-1)');
    expect(css).toContain('color: var(--fg-2)');
    expect(css).toContain('color: var(--fg-3)');
  });

  // User-reported 2026-09-09 (tablet screenshot): in the 600-900px container
  // band, the action cell (Phân bổ nhà xe) was forced to full-width but cell 8
  // (Ghi chú) auto-flowed into the next row's left column alone, leaving the
  // right half empty and drawing a half-width border-top below the action
  // cell. The fix mirrors the ≤599px rule into the 600-900px band.
  it('spans the notes cell full-width in the 600-900px band so action + notes read as a paired footer', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

    // 600-900px band exists and pins the span for cell 8
    expect(css).toMatch(
      /@container \(min-width: 600px\) and \(max-width: 900px\)[\s\S]*?\.master-plan-grid__cell:nth-child\(8\)\s*\{[\s\S]*?grid-column:\s*1 \/ -1/,
    );

    // The full-width span drops the inline-start that would otherwise
    // double the card's left edge.
    expect(css).toMatch(
      /@container \(min-width: 600px\) and \(max-width: 900px\)[\s\S]*?\.master-plan-grid__cell:nth-child\(8\)\s*\{[\s\S]*?border-inline-start:\s*0/,
    );

    // The ≤599px rule still owns the same selector (parity check).
    expect(css).toMatch(
      /@container \(max-width: 599px\)[\s\S]*?\.master-plan-grid__cell:nth-child\(8\)[\s\S]*?grid-column:\s*1 \/ -1/,
    );

    // Action cell stays full-width in BOTH bands (sanity).
    expect(css).toMatch(
      /@container \(max-width: 599px\)[\s\S]*?\.master-plan-grid__cell--action[\s\S]*?grid-column:\s*1 \/ -1/,
    );
    expect(css).toMatch(
      /@container \(min-width: 600px\) and \(max-width: 900px\)[\s\S]*?\.master-plan-grid__cell--action[\s\S]*?grid-column:\s*1 \/ -1/,
    );
  });

  // Polish 2026-09-09 (PM seq-151 visual-quality gate): the action cell
  // holds a 44px trigger (action + notes footer pair landed at 5324b1ad),
  // so without a matching floor the notes cell below would render at its
  // natural text height (40-50px) — a 14-24px rhythm pop. The
  // notes-trigger must hit the same 44px touch target inside the
  // ≤900px card view so empty/short notes ground to the action cell.
  it('grounds the notes-trigger to the 44px touch floor inside the ≤900px card view', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

    expect(css).toMatch(
      /@container \(max-width: 900px\)[\s\S]*?\.master-plan-grid__notes-trigger\s*\{[\s\S]*?min-height:\s*44px/,
    );

    // Desktop table view stays untouched — only the card view pins the floor.
    const desktopNotesTriggerRule = css.match(/\.master-plan-grid__notes-trigger \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(desktopNotesTriggerRule).not.toMatch(/min-height/);
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
    fireEvent.click(screen.getByRole('option', { name: 'Chờ phân xe' }));
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
    expect(css).toContain('flex: 0 1 608px');
    expect(css).toContain('flex: 0 0 132px');
    expect(css).toContain('flex: 0 0 180px');
    expect(css).toContain('flex: 0 0 auto');
    expect(css).toContain('grid-template-columns: minmax(132px, 1fr) auto minmax(132px, 1fr)');
    expect(css).toContain('.master-plan-filters__date-inputs');
    expect(css).toContain('.master-plan-filters__date-range');
    expect(css).toContain('grid-template-columns: minmax(280px, 360px) max-content');
    expect(css).toContain('.master-plan-filters__date-action');
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
