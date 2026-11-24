/**
 * SIL-893 — [Phát lệnh hàng loạt] select column on the DetailedPlanGrid:
 *   • the header hosts the select-all over ONLY the eligible rows ('Đã điều
 *     xe' yet to release) — aria-checked reports all/mixed/none;
 *   • ineligible rows ('Chưa phân xe', 'Đã phát lệnh', 'Đã hoàn thành') keep
 *     their dimmed checkbox with the reason as its title, whatever the
 *     header does.
 */
import { fireEvent, render, screen } from '@testing-library/react';
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

import { DetailedPlanGrid } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';
import { ToastProvider } from '../../../components/shared/Toast';

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
  docs: { billNumber: 'BL-1', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345' },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...overrides,
} as DispatchDetailPlanRow);

/** Two eligible + two blocked rows — the eligibility spread the mode gates. */
function bulkRows() {
  return [
    row({ fulfillmentId: 101, docs: { billNumber: 'BL-1', tradeDirection: 'EXPORT', declarationNumbers: [] } }),
    row({
      fulfillmentId: 102,
      docs: { billNumber: 'BL-2', tradeDirection: 'EXPORT', declarationNumbers: [] },
      container: { containerNumber: 'TEMU7654321', containerTypeLabel: '20DC', cargoWeightKg: '18000.00' },
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Thanh Phong', externalCarrierId: 8, externalCarrierVehicleId: null, assignedPlate: null },
    }),
    row({
      fulfillmentId: 103,
      docs: { billNumber: 'BL-3', tradeDirection: 'IMPORT', declarationNumbers: [] },
      container: { containerNumber: 'MSCU5555555', containerTypeLabel: '40HC', cargoWeightKg: '22000.00' },
      dispatch: { carrierType: 'EXTERNAL', carrierName: 'Nhà xe Hoàng Long', externalCarrierId: 9, externalCarrierVehicleId: 5, assignedPlate: null },
    }),
    row({
      fulfillmentId: 104,
      docs: { billNumber: 'BL-4', tradeDirection: 'EXPORT', declarationNumbers: [] },
      taskStatus: 'DISPATCHED',
      dispatch: { carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: '51C-12345', tripId: 77 },
    }),
    row({
      fulfillmentId: 105,
      docs: { billNumber: 'BL-5', tradeDirection: 'EXPORT', declarationNumbers: [] },
      dispatch: { carrierType: 'OWN', carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }),
  ];
}

const SELECT_ALL = 'Chọn tất cả dòng đủ điều kiện';
const rowBox = (bill: string) => screen.getByRole('checkbox', { name: `Chọn phát lệnh lô ${bill}` });

function renderBulkGrid(
  items: DispatchDetailPlanRow[],
  selected: ReadonlySet<number> = new Set(),
  onToggleBulkSelection: (id: number, next: boolean, row: DispatchDetailPlanRow) => void = vi.fn(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <MonthProvider>
          <ToastProvider>
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
              onCompleteExternalTrip={vi.fn()}
              onIssueOrder={vi.fn()}
              selectedBulkFulfillmentIds={selected}
              onToggleBulkSelection={onToggleBulkSelection}
            />
          </ToastProvider>
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DetailedPlanGrid — bulk release select-all (SIL-893)', () => {
  it('the header select-all ticks ONLY the eligible rows; blocked rows stay dimmed with reasons', () => {
    const rows = bulkRows();
    const onToggleBulkSelection = vi.fn();
    renderBulkGrid(rows, new Set(), onToggleBulkSelection);

    const selectAll = screen.getByRole('checkbox', { name: SELECT_ALL });
    expect(selectAll.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(selectAll);

    expect(onToggleBulkSelection).toHaveBeenCalledTimes(3);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(101, true, rows[0]);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(102, true, rows[1]);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(103, true, rows[2]);
    expect(onToggleBulkSelection).not.toHaveBeenCalledWith(104, true, expect.anything());
    expect(onToggleBulkSelection).not.toHaveBeenCalledWith(105, true, expect.anything());

    // Blocked rows: disabled + the reason on the control itself.
    expect(rowBox('BL-4').getAttribute('aria-disabled')).toBe('true');
    expect(rowBox('BL-4').getAttribute('title')).toBe('Đã phát lệnh rồi.');
    expect(rowBox('BL-5').getAttribute('aria-disabled')).toBe('true');
    expect(rowBox('BL-5').getAttribute('title')).toBe('Lô chưa được điều xe — gán xe trước khi phát lệnh.');
    // Eligible rows: armed.
    expect(rowBox('BL-1').getAttribute('aria-disabled')).toBeNull();
  });

  it('all eligible picked: the header reads checked and a second click releases the whole set', () => {
    const rows = bulkRows();
    const onToggleBulkSelection = vi.fn();
    renderBulkGrid(rows, new Set([101, 102, 103]), onToggleBulkSelection);

    const selectAll = screen.getByRole('checkbox', { name: SELECT_ALL });
    expect(selectAll.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(selectAll);

    expect(onToggleBulkSelection).toHaveBeenCalledTimes(3);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(101, false, rows[0]);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(102, false, rows[1]);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(103, false, rows[2]);
  });

  it('a row tick hands the page that row (SIL-898 — the pick carries its snapshot for cross-search release)', () => {
    const rows = bulkRows();
    const onToggleBulkSelection = vi.fn();
    renderBulkGrid(rows, new Set(), onToggleBulkSelection);

    fireEvent.click(rowBox('BL-2'));

    expect(onToggleBulkSelection).toHaveBeenCalledTimes(1);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(102, true, rows[1]);
  });

  it('a subset picks report mixed on the header', () => {
    renderBulkGrid(bulkRows(), new Set([101]));

    expect(screen.getByRole('checkbox', { name: SELECT_ALL }).getAttribute('aria-checked')).toBe('mixed');
  });

  it('without eligible rows the header stays inert (nothing to select)', () => {
    const onToggleBulkSelection = vi.fn();
    renderBulkGrid([bulkRows()[3], bulkRows()[4]], new Set(), onToggleBulkSelection);

    const selectAll = screen.getByRole('checkbox', { name: SELECT_ALL });
    expect(selectAll.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(selectAll);
    expect(onToggleBulkSelection).not.toHaveBeenCalled();
  });

  it('SIL-909: the header keeps its full "Phát lệnh" caption (wraps in the 48px rail, never clipped away)', () => {
    renderBulkGrid(bulkRows());

    const caption = document.querySelector('.detailed-plan-grid__select-all span');
    expect(caption?.textContent).toBe('Phát lệnh');
  });
});
