/**
 * SIL-1166 (KB K3.79/K4.31) — sau gộp lô lẻ (rev-group) the PHÂN LOẠI column
 * on /dispatch-detail shows the tag "Lẻ · Ghép (k/N)" for every merged row.
 *
 * Pins:
 * - a rev-merged lot (Gộp hàng — dimension 'REV') renders the chip format
 *   "Lẻ · Ghép (k/N)" and its tag is a STATIC span: the cost group's action
 *   badge (Xem nhóm / Hủy ghép) never arms for a rev group;
 * - the rev row keeps its ungrouped-row verbs in the ⋯ menu (Gộp hàng on,
 *   the cost group's Thêm lô vào nhóm / Tách nhóm off) — the display-only
 *   invariant;
 * - a cost group keeps exactly its pre-SIL-1166 interactive badge.
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

import { DetailedPlanGrid } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

const baseRow = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 201,
  version: 1,
  shipmentId: 31,
  shipmentVersion: 1,
  shipmentCode: 'SS-000300',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  classification: 'LCL',
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

const revGroupRow = (order: 1 | 2): DispatchDetailPlanRow => baseRow({
  shipmentId: order === 1 ? 31 : 32,
  lcl: {
    packageCount: 5,
    packageType: 'PALLET',
    cargoVolumeCbm: '4.000',
    group: {
      dimension: 'REV',
      groupId: '325a8b99-rev',
      order,
      memberCount: 2,
      actualTruckNo: '29C-333.33',
      billingTruckNo: '51C-000.01',
      vehicleClassCode: '5T',
      vehicleClassName: 'Xe 5 tấn',
    },
  },
});

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

const cellText = () => (cell('Phân loại').textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SIL-1166 — rev-group tag in PHÂN LOẠI', () => {
  it('rev-merged rows read "Lẻ · Ghép (k/N)" — order 1/2 then 2/2 (K3.79/K4.31)', () => {
    renderGrid([revGroupRow(1), revGroupRow(2)]);
    const cells = document.querySelectorAll('[data-label="Phân loại"]');
    expect((cells[0].textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('Lẻ · Ghép (1/2)');
    expect((cells[1].textContent ?? '').replace(/\s+/g, ' ').trim()).toBe('Lẻ · Ghép (2/2)');
  });

  it('the rev tag is a STATIC span even on a fully wired page — no cost badge, rev title', () => {
    renderGrid([revGroupRow(1)], {
      onUnmergeLclLot: vi.fn(),
      onUnmergeLclGroup: vi.fn(),
      onChangeGroupTruck: vi.fn(),
    });
    const tag = within(cell('Phân loại')).getByText('Ghép (1/2)');
    expect(tag.tagName).toBe('SPAN');
    expect(tag.getAttribute('title')).toContain('Ghép thu cước');
    expect(screen.queryByRole('button', { name: /Ghép \(/ })).toBeNull();
  });

  it('the rev row keeps its ungrouped-row verbs: Gộp hàng on, the cost group verbs off', () => {
    renderGrid([revGroupRow(1)], {
      onUnmergeLclLot: vi.fn(),
      onUnmergeLclGroup: vi.fn(),
      onStartLclMerge: vi.fn(),
      onDeleteLot: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    expect(screen.getByRole('menuitem', { name: /Gộp hàng/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Thêm lô vào nhóm/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Tách nhóm/ })).toBeNull();
  });

  it('a cost group keeps the interactive badge and the ĐV title', () => {
    renderGrid([baseRow({
      lcl: {
        packageCount: 5,
        packageType: 'PALLET',
        cargoVolumeCbm: '4.000',
        group: {
          groupId: 'g-cost', order: 1, memberCount: 3,
          actualTruckNo: '29C-123.45', billingTruckNo: '29C-123.45',
          vehicleClassCode: '5T', vehicleClassName: 'Xe 5 tấn',
        },
      },
    })], { onUnmergeLclLot: vi.fn() });
    expect(cellText()).toBe('Lẻ · Ghép (1/3)');
    const tag = screen.getByRole('button', { name: 'Ghép (1/3)' });
    expect(tag.getAttribute('title')).toContain('Ghép trả ĐV');
  });

  it('an ungrouped lot stays a bare "Lẻ" — no joiner, no tag', () => {
    renderGrid([baseRow()]);
    expect(cellText()).toBe('Lẻ');
  });
});
