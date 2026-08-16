import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentListItem } from '../../../api/shipmentClient';

import { MasterPlanGrid } from './MasterPlanGrid';
import { MasterPlanFilters } from './MasterPlanFilters';

const item = (overrides: Partial<ShipmentListItem> = {}): ShipmentListItem => ({
  id: 1,
  shipmentCode: 'SS-000100',
  customerName: 'Công ty ABC',
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
  containerTypeSummary: '2 * 40HC + 1 * 20DC',
  totalCargoWeightKg: 41000.75,
  allocationStatus: 'NOT_ALLOCATED',
  carrierAllocationSummary: [],
  ...overrides,
} as ShipmentListItem);

describe('MasterPlanGrid', () => {
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

    expect(screen.getByText(/Giao: 20\/08\/2026/)).toBeTruthy();
    expect(screen.getByText(/Hạn hoàn tất hải quan:/)).toBeTruthy();
    expect(screen.getByText('Công ty ABC')).toBeTruthy();
    expect(screen.getByText('BL-2026-001')).toBeTruthy();
    expect(screen.getByText('Nhập')).toBeTruthy();
    expect(screen.getByText(/Nâng: Cảng Cát Lái/)).toBeTruthy();
    expect(screen.getByText(/Hạ: Kho Bình Dương/)).toBeTruthy();
    expect(screen.getByText('2 * 40HC + 1 * 20DC')).toBeTruthy();
    expect(screen.getByText(/41\.000,75 kg/)).toBeTruthy();
    expect(screen.getByText('Giao giờ hành chính')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phân bổ' })).toBeTruthy();
  });

  it('renders allocation chips and edit label when fully allocated', () => {
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
    expect(screen.getByRole('button', { name: 'Sửa phân bổ' })).toBeTruthy();
  });

  it('fires onAllocate with the row payload and its allocation trigger', () => {
    const onAllocate = vi.fn();
    render(<MasterPlanGrid items={[item()]} onAllocate={onAllocate} />);
    const trigger = screen.getByRole('button', { name: 'Phân bổ' });
    fireEvent.click(trigger);
    expect(onAllocate).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), trigger);
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

  it('keeps allocation chips inside their table cell instead of letting a long carrier label overflow', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('.master-plan-grid__chip {');
    expect(css).toContain('max-inline-size: 100%');
    expect(css).toContain('text-overflow: ellipsis');
  });
});

describe('MasterPlanFilters', () => {
  it('propagates every filter control change', () => {
    const onChange = vi.fn();
    render(<MasterPlanFilters filters={{ q: '', tradeDirection: '', allocationStatus: '', deliveryDateFrom: '', deliveryDateTo: '' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Tìm kiếm lô hàng'), { target: { value: 'BL-9' } });
    expect(onChange).toHaveBeenLastCalledWith({ q: 'BL-9' });

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả Chiều hàng' }));
    fireEvent.click(screen.getByRole('option', { name: 'Nhập' }));
    expect(onChange).toHaveBeenLastCalledWith({ tradeDirection: 'IMPORT' });

    fireEvent.click(screen.getByRole('button', { name: 'Tất cả trạng thái Trạng thái phân bổ' }));
    fireEvent.click(screen.getByRole('option', { name: 'Chưa phân xe' }));
    expect(onChange).toHaveBeenLastCalledWith({ allocationStatus: 'NOT_ALLOCATED' });

    fireEvent.change(screen.getByLabelText('Ngày giao từ'), { target: { value: '2026-08-01' } });
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateFrom: '2026-08-01' });

    fireEvent.change(screen.getByLabelText('Ngày giao đến'), { target: { value: '2026-08-31' } });
    expect(onChange).toHaveBeenLastCalledWith({ deliveryDateTo: '2026-08-31' });
  });

  it('keeps the complete delivery-date range in one responsive control group', () => {
    const { container } = render(<MasterPlanFilters filters={{ q: '', tradeDirection: '', allocationStatus: '', deliveryDateFrom: '', deliveryDateTo: '' }} onChange={vi.fn()} />);
    expect(container.querySelector('[role="group"][aria-label="Khoảng ngày giao"]')).toBeTruthy();

    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');
    expect(css).toContain('grid-template-columns: minmax(320px, 1.3fr) minmax(140px, 0.5fr) minmax(208px, 0.72fr) minmax(420px, 1.18fr)');
    expect(css).toContain('@container (max-width: 1180px)');
    expect(css).toContain('grid-template-columns: max-content minmax(132px, 1fr) auto minmax(132px, 1fr)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)');
    expect(css).toContain('.master-plan-filters__date-label {\n    grid-column: 1 / -1;');
    expect(css).toContain('.master-plan-filters__date-range');
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
    expect(page).toContain('dispatch-plan-page--wide');
    expect(css).toContain('max-width: 1400px');
    expect(css).toContain('.dispatch-plan-page--wide {\n  gap: 12px;\n  max-width: none;');
    expect(css).toContain('.app-main:not(.driver-mode) .app-body > .dispatch-plan-page--wide');
  });
});
