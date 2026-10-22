// Cards 191026181942 (cus-tongquan-*): the Tổng quan row's cargo wording,
// CBM suppression, muted zero-allocation signal, and the shared NameCell.
// Thin-cast fixture precedent: cusQuickEditModel.test.ts.
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { CusShipmentRow } from './CusShipmentRow';

const access = (mode: string) => ({ mode, reason: `reason:${mode}` });

function makeItem(overrides: {
  cargoMode?: 'FCL' | 'LCL';
  direction?: 'IMPORT' | 'EXPORT';
  containerSummary?: string | null;
  weightKg?: string | null;
  volumeCbm?: string | null;
  vehicleReadiness?: string;
  missingCarrierContainers?: number;
  totalContainers?: number;
  customerName?: string | null;
  routeName?: string | null;
} = {}): ShipmentCusWorkspaceListItem {
  const {
    cargoMode = 'LCL',
    direction = 'IMPORT',
    containerSummary = '',
    weightKg = '1200',
    volumeCbm = null,
    vehicleReadiness = 'READY',
    missingCarrierContainers = 0,
    totalContainers = 0,
    customerName = 'LONG MINH',
    routeName = 'Vân Trung, Bắc Ninh',
  } = overrides;
  return {
    id: 7,
    version: 3,
    bucket: 'NEW',
    bucketLabel: 'Mới',
    cargoMode,
    direction,
    customerName,
    routeName,
    deliveryLocation: null,
    effectiveFactoryNames: [],
    factoryName: 'Factory A',
    isAdHoc: false,
    billOrBookNumber: 'BL123',
    declarationNumber: null,
    declarationNumbers: [],
    shippingLineName: null,
    isCombined: false,
    containerSummary,
    weightKg,
    volumeCbm,
    packageCount: 12,
    packageType: 'Pallet',
    customerNotes: null,
    operationalNotes: null,
    appointmentGroups: [],
    plannedReturnAt: null,
    closingAt: null,
    raw: { isAdHoc: false },
    fieldAccess: {
      factoryName: access('EDITABLE'),
      blNumber: access('EDITABLE'),
      bookingRef: access('EDITABLE'),
      declarationNumber: access('EDITABLE'),
      tradeDirection: access('EDITABLE'),
      shippingLineName: access('EDITABLE'),
      packageCount: access('EDITABLE'),
      packageType: access('EDITABLE'),
      cargoWeightKg: access('EDITABLE'),
      cargoVolumeCbm: access('EDITABLE'),
      customerNotes: access('EDITABLE'),
      operationalNotes: access('EDITABLE'),
    },
    operational: {
      scheduleReadiness: 'READY',
      vehicleReadiness,
      totalContainers,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers,
      missingPlateContainers: 0,
      orderIssuedContainers: 0,
      transportDateEditable: true,
      deletable: true,
    },
    finance: { isLoss: false, hasPendingRecovery: false },
    documentCustody: { status: 'CUSTOMER' },
    accountingConfirmation: { status: 'PENDING' },
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
  } as unknown as ShipmentCusWorkspaceListItem;
}

function renderRow(item: ShipmentCusWorkspaceListItem, dateFilter: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter>
      <table>
        <tbody>
          <CusShipmentRow
            item={item}
            dateFrom={dateFilter.from ?? ''}
            dateTo={dateFilter.to ?? ''}
            editing={false}
            quickEditOpen={false}
            savingQuickEdit={false}
            onStartQuickEdit={vi.fn()}
            onOpenDetail={vi.fn()}
          />
        </tbody>
      </table>
    </MemoryRouter>,
  );
}

describe('CusShipmentRow — card 191026181942 (tổng quan hàng lẻ)', () => {
  // Card 261022213755c (TiepVu 22/10-2): the direction badge itself names
  // the cargo mode for LCL lots — "Nhập lẻ"/"Xuất lẻ" in the same
  // cus-direction-badge pill, FCL rows keep the plain "Nhập"/"Xuất".
  it.each([
    { cargoMode: 'LCL', direction: 'IMPORT', expected: 'Nhập lẻ' },
    { cargoMode: 'LCL', direction: 'EXPORT', expected: 'Xuất lẻ' },
    { cargoMode: 'FCL', direction: 'IMPORT', expected: 'Nhập' },
    { cargoMode: 'FCL', direction: 'EXPORT', expected: 'Xuất' },
  ] as const)('direction badge reads "$expected" for $cargoMode $direction', ({ cargoMode, direction, expected }) => {
    const { container } = renderRow(makeItem({ cargoMode, direction }));
    const badge = container.querySelector('.cus-direction-badge')!;
    expect(badge.textContent).toBe(expected);
  });

  it('R3 names the LCL lot cargo object in the day-filter empty state', () => {
    renderRow(makeItem({ cargoMode: 'LCL', containerSummary: null }), { from: '2026-10-19', to: '2026-10-19' });
    expect(screen.getByText('Không có hàng lẻ chạy ngày đã chọn')).toBeTruthy();
    expect(screen.queryByText('Không có cont chạy ngày đã chọn')).toBeNull();
  });

  it('R3 keeps the cont wording for a container lot', () => {
    renderRow(makeItem({ cargoMode: 'FCL', containerSummary: null, weightKg: null }), { from: '2026-10-19', to: '2026-10-19' });
    expect(screen.getByText('Không có cont chạy ngày đã chọn')).toBeTruthy();
  });

  it('R4a suppresses the CBM segment when the lot carries no volume — no "— CBM"', () => {
    const { container } = renderRow(makeItem({ cargoMode: 'LCL', volumeCbm: null }));
    const metrics = container.querySelector('.cus-cargo-summary__weight')!;
    expect(metrics.textContent).toBe('1,2 tấn');
    expect(metrics.textContent).not.toContain('CBM');
  });

  it('R4a keeps the CBM segment when a volume exists', () => {
    const { container } = renderRow(makeItem({ cargoMode: 'LCL', volumeCbm: '3.5' }));
    expect(container.querySelector('.cus-cargo-summary__weight')!.textContent).toBe('1,2 tấn · 3,5 CBM');
  });

  it('R4b renders the muted "Chưa phân xe" signal for an unallocated containerless lot', () => {
    const { container } = renderRow(makeItem({
      cargoMode: 'LCL',
      vehicleReadiness: 'WAITING_CARRIER',
      missingCarrierContainers: 0,
    }));
    const signal = container.querySelector('.cus-row-actions__signal')!;
    expect(signal.textContent).toBe('Chưa phân xe');
    expect(signal.className).toContain('cus-attention-label--info');
    expect(screen.queryByText('Thiếu nhà xe 0 cont')).toBeNull();
  });

  it('R5 customer and route names ride the shared NameCell (accessible full name)', () => {
    renderRow(makeItem({ customerName: 'LONG MINH', routeName: 'Vân Trung, Bắc Ninh' }));
    const customer = screen.getByText('LONG MINH');
    expect(customer.className).toContain('name-cell');
    expect(customer.getAttribute('title')).toBe('LONG MINH');
    expect(customer.getAttribute('aria-label')).toBe('LONG MINH');
    const route = screen.getByText('Vân Trung, Bắc Ninh');
    expect(route.className).toContain('name-cell');
    expect(route.getAttribute('aria-label')).toBe('Vân Trung, Bắc Ninh');
  });
});
