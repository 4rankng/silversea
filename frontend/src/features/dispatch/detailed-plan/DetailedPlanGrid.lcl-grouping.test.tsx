/**
 * FB-092 — LCL rows on Kế hoạch Chi tiết Xe: the 3-line CONTAINER cell, the
 * "Ghép (i/N)" tag (SIL-589 dedupe), and the selection checkbox that feeds the page's
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
    expect(within(containerCell).getByText('1,922 tấn · 4 CBM')).toBeTruthy();
    // The group tag names the lot's place in its group.
    expect(within(cell('Phân loại')).getByText('Ghép (1/3)')).toBeTruthy();
    // SIL-589: the tag carries NO "Lẻ ·" prefix — one label voice per cell
    // (the classification span owns the kind word; the tag only names the
    // group). The old duplicated prefix read as two labels stacked above a
    // vertically-wrapped pill.
    const classificationText = (cell('Phân loại').textContent ?? '').replace(/\s+/g, ' ');
    expect(classificationText).not.toContain('Lẻ ·');
    expect(classificationText).toContain('Ghép (1/3)');
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

    const checkbox = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' });
    // LclSelectCheckbox (9e806f53) renders a button[role=checkbox] with
    // aria-checked — the old HTMLInputElement `.checked` contract died with it.
    expect(checkbox).toHaveAttribute('aria-checked', 'true');
    // FCL rows never get a tickable one — exactly one selection checkbox
    // exists (spec 23/10 §2: FCL rides the column dimmed, not selectable).
    expect(screen.getAllByRole('checkbox', { name: /Chọn lô/ })).toHaveLength(1);
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(31, false);
  });

  it('spec 23/10 §2 — the CHỌN column is the FIRST cell and only exists while the page wires the mode', () => {
    const onToggle = vi.fn();
    const fcl = baseRow({
      shipmentId: 32, cargoMode: 'FCL', fulfillmentType: 'FCL_CONTAINER',
      container: { containerNumber: 'MSCU7654321', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' },
      lcl: null,
    });
    const { unmount } = renderGrid([baseRow(), fcl], { onToggleLclSelection: onToggle });

    // The leading CHỌN header + the LCL tick in the first cell of its row;
    // the FCL row's tick is dimmed (aria-disabled) and carries the cont copy.
    expect(screen.getByRole('columnheader', { name: /Chọn/ })).toBeTruthy();
    // SIL-174: the header's text-content reads exactly "Chọn lô" — the same
    // structure as /dispatch (visible "Chọn" + sr-only " lô"; the old
    // sr-only-first markup read "Chọn lô Chọn").
    const selectHeader = screen.getByRole('columnheader', { name: /Chọn/ });
    expect(selectHeader.textContent).toBe('Chọn lô');
    const lclTick = screen.getByRole('checkbox', { name: 'Chọn lô BL-LCL-1' });
    expect(lclTick.closest('td')).toBe(lclTick.closest('tr')!.querySelector('td'));
    const fclTick = screen.getByRole('checkbox', { name: /MSCU7654321 không tham gia gộp hàng/ });
    expect(fclTick).toHaveAttribute('aria-disabled', 'true');
    unmount();

    // Without the mode wiring (the page's default), no column, no ticks.
    renderGrid([baseRow()]);
    expect(screen.queryByRole('columnheader', { name: /Chọn/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Chọn lô/ })).toBeNull();
  });
});

describe('SPEC 18/10/2026 §4 — Tách nhóm', () => {
  it('offers one group action on Lô 1 and none on member rows (row ⋯ menu)', () => {
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

    // Owner redesign 23/10: Tách nhóm rides the row ⋯ menu — open both and
    // only Lô 1's menu carries the item.
    const menus = screen.getAllByRole('button', { name: /Thao tác dòng/ });
    expect(menus).toHaveLength(2);
    fireEvent.click(menus[0]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tách nhóm' }));
    expect(onUnmerge).toHaveBeenCalledWith('grp-1');

    fireEvent.click(menus[1]!);
    expect(screen.queryByRole('menuitem', { name: 'Tách nhóm' })).toBeNull();
  });

  it('hides the menu item when the page does not wire it', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    expect(screen.queryByRole('menuitem', { name: 'Tách nhóm' })).toBeNull();
  });
});

describe('FB-092 — line helpers', () => {
  it('joins each half only when present', () => {
    expect(lclCargoLine(baseRow({ lcl: { packageCount: 7, packageType: null, cargoVolumeCbm: null, group: null } }))).toBe('7');
    expect(lclCargoLine(baseRow({ lcl: { packageCount: null, packageType: 'KIỆN', cargoVolumeCbm: null, group: null } }))).toBe('KIỆN');
    expect(lclCargoLine(baseRow({ lcl: null }))).toBeNull();
    // CBM optional: the weight renders alone.
    expect(lclMeasureLine(baseRow({ lcl: { packageCount: null, packageType: null, cargoVolumeCbm: null, group: null } }))).toBe('1,922 tấn');
    // Pre-FB-092 wire shape falls back to the shared weight column.
    expect(lclMeasureLine(baseRow({ lcl: null }))).toBe('1,922 tấn');
  });
});


