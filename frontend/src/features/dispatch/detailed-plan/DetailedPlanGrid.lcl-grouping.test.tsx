/**
 * FB-092 — LCL rows on Kế hoạch Chi tiết Xe: the 3-line CONTAINER cell, the
 * "Lẻ · Ghép (i/N)" tag, and the selection checkbox that feeds the page's
 * gán-xe-nhóm flow. FCL rows must stay on their container demand lines.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MonthProvider } from '../../../hooks/useMonth';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const useTaskTagsMock = vi.fn(() => ({ tags: [], isLoading: false, error: null }));
vi.mock('./useDispatchTaskTags', () => ({
  useDispatchTaskTags: () => useTaskTagsMock(),
  useCreateDispatchTaskTag: () => ({ createTag: vi.fn(), isCreating: false }),
}));

import { DetailedPlanGrid, lclCargoLine, lclMeasureLine } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

const baseRow = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 201,
  version: 1,
  shipmentId: 31,
  shipmentVersion: 1,
  shipmentCode: 'SS-000300',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: 'Kho Q.7', deliveryPoint: 'Kho Q.7', routeName: null },
  docs: { billNumber: 'BL-LCL-1', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '1922.00' },
  lcl: {
    packageCount: 5,
    packageType: 'PALLET',
    cargoVolumeCbm: '4.000',
    group: null,
  },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
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

function cell(label: string) {
  const found = document.querySelector(`[data-label="${label}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`no cell with data-label="${label}"`);
  return found;
}

describe('FB-092 — LCL CONTAINER cell', () => {
  it('renders the three lines: Lẻ · Xe {class} / cargo / measures (FB092-01)', () => {
    renderGrid([baseRow({
      lcl: {
        packageCount: 5,
        packageType: 'PALLET',
        cargoVolumeCbm: '4.000',
        group: {
          groupId: 'g1', order: 1, memberCount: 3,
          actualTruckNo: '29C-123.45', billingTruckNo: '29C-123.45',
          vehicleClassCode: '5T', vehicleClassName: 'Xe 5 tấn',
        },
      },
    })]);
    const containerCell = cell('Container');
    expect(within(containerCell).getByText('Lẻ · Xe 5T')).toBeTruthy();
    expect(within(containerCell).getByText('5 PALLET')).toBeTruthy();
    expect(within(containerCell).getByText('1.922 kg · 4 CBM')).toBeTruthy();
    // The group tag names the lot's place in its group.
    expect(within(cell('Phân loại')).getByText('Lẻ · Ghép (1/3)')).toBeTruthy();
  });

  it('shows plain "Lẻ" without a class and drops the missing halves (FB092-01)', () => {
    renderGrid([baseRow({
      container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null },
      lcl: { packageCount: null, packageType: null, cargoVolumeCbm: null, group: null },
    })]);
    const containerCell = cell('Container');
    expect(within(containerCell).getByText('Lẻ')).toBeTruthy();
    expect(within(containerCell).getAllByText('—')).toHaveLength(2);
  });

  it('keeps an FCL row on its container demand lines', () => {
    renderGrid([baseRow({
      cargoMode: 'FCL',
      fulfillmentType: 'FCL_CONTAINER',
      container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
      lcl: null,
    })]);
    const containerCell = cell('Container');
    expect(within(containerCell).getByText('MSCU1234567')).toBeTruthy();
    expect(within(containerCell).queryByText(/Lẻ/)).toBeNull();
  });
});

describe('FB-092 — LCL selection', () => {
  it('offers a checkbox on LCL rows only and reports toggles (FB092-02)', () => {
    const onToggle = vi.fn();
    const fcl = baseRow({
      shipmentId: 32, cargoMode: 'FCL', fulfillmentType: 'FCL_CONTAINER',
      container: { containerNumber: 'MSCU7654321', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' },
      lcl: null,
    });
    renderGrid([baseRow(), fcl], {
      selectedLclShipmentIds: new Set([31]),
      onToggleLclSelection: onToggle,
    });

    const checkbox = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    // FCL rows never get one — exactly one selection checkbox exists.
    expect(screen.getAllByRole('checkbox', { name: /Chọn lô/ })).toHaveLength(1);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(31, false);
  });
});

describe('SPEC 18/10/2026 §4 — Tách nhóm', () => {
  it('offers one group action on Lô 1 and none on member rows', () => {
    const onUnmerge = vi.fn();
    const group = {
      groupId: 'grp-1',
      memberCount: 2,
      actualTruckNo: '29C-123.45',
      billingTruckNo: '29C-123.45',
      vehicleClassCode: '5T',
      vehicleClassName: 'Xe 5 tấn',
    };
    renderGrid([
      baseRow({ shipmentId: 31, lcl: { packageCount: 5, packageType: 'PALLET', cargoVolumeCbm: '4.000', group: { ...group, order: 1 } } }),
      baseRow({ shipmentId: 32, lcl: { packageCount: 4, packageType: 'PALLET', cargoVolumeCbm: '3.000', group: { ...group, order: 2 } } }),
    ], { onUnmergeLclGroup: onUnmerge });

    const actions = screen.getAllByRole('button', { name: 'Tách nhóm' });
    expect(actions).toHaveLength(1);
    fireEvent.click(actions[0]!);
    expect(onUnmerge).toHaveBeenCalledWith('grp-1');
  });

  it('hides the action when the page does not wire it', () => {
    renderGrid([baseRow({
      lcl: {
        packageCount: 5, packageType: 'PALLET', cargoVolumeCbm: '4.000',
        group: {
          groupId: 'grp-1', order: 1, memberCount: 2,
          actualTruckNo: '29C-123.45', billingTruckNo: '29C-123.45',
          vehicleClassCode: '5T', vehicleClassName: 'Xe 5 tấn',
        },
      },
    })]);
    expect(screen.queryByRole('button', { name: 'Tách nhóm' })).toBeNull();
  });
});

describe('FB-092 — line helpers', () => {
  it('joins each half only when present', () => {
    expect(lclCargoLine(baseRow({ lcl: { packageCount: 7, packageType: null, cargoVolumeCbm: null, group: null } }))).toBe('7');
    expect(lclCargoLine(baseRow({ lcl: { packageCount: null, packageType: 'KIỆN', cargoVolumeCbm: null, group: null } }))).toBe('KIỆN');
    expect(lclCargoLine(baseRow({ lcl: null }))).toBeNull();
    // CBM optional: the weight renders alone.
    expect(lclMeasureLine(baseRow({ lcl: { packageCount: null, packageType: null, cargoVolumeCbm: null, group: null } }))).toBe('1.922 kg');
    // Pre-FB-092 wire shape falls back to the shared weight column.
    expect(lclMeasureLine(baseRow({ lcl: null }))).toBe('1.922 kg');
  });
});


