/**
 * FB-095 (card 181026145610) — the "Ghép (i/N)" tag (SIL-589: classification span giữ "Lẻ", tag chỉ nhóm) on Kế hoạch Chi
 * tiết Xe was a static tooltip: QA (dungnv, R23) clicked it and found no way
 * to undo a mistaken "Gán xe nhóm". The badge is now the group's action
 * surface: clicking it opens the group menu (Xem nhóm: members / trucks) with
 * the "Hủy ghép" action, which the page confirms before calling the server.
 *
 * Pinned here through the real grid:
 * - the badge opens the group menu listing the members (Số Bill/Booking) and
 *   raises `onUnmergeLclLot` with the leaving lot's identity when the menu's
 *   "Hủy ghép" is chosen;
 * - without the page wiring the badge stays a static tag (parity with the
 *   SPEC §4 "Tách nhóm" button);
 * - FCL rows never get the badge.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const group = {
  groupId: 'grp-9',
  memberCount: 2,
  actualTruckNo: '29C-333.33',
  billingTruckNo: '29C-333.33',
  vehicleClassCode: '5T',
  vehicleClassName: 'Xe 5 tấn',
};

const groupedRow = (
  shipmentId: number,
  bill: string,
  order: number | null,
  over: Partial<DispatchDetailPlanRow> = {},
): DispatchDetailPlanRow => ({
  fulfillmentId: shipmentId,
  version: 1,
  shipmentId,
  shipmentVersion: 1,
  shipmentCode: 'SS-000300',
  fulfillmentType: 'LCL_SHIPMENT',
  cargoMode: 'LCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-20', runHour: 8 },
  customerRoute: { customerName: 'Công ty Lẻ', factoryName: 'Kho Q.7', deliveryPoint: 'Kho Q.7', routeName: null },
  docs: { billNumber: bill, tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '1922.00' },
  lcl: {
    packageCount: 5,
    packageType: 'PALLET',
    cargoVolumeCbm: '4.000',
    group: { ...group, order },
  },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  lotFullyPlated: false,
  ...over,
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

describe('FB-095 — the group badge opens Xem nhóm / Hủy ghép', () => {
  it('lists the group members and raises onUnmergeLclLot with the leaving lot (FB095-UI-01)', () => {
    const onUnmergeLot = vi.fn();
    renderGrid([
      groupedRow(31, 'CL4C-01', 1),
      groupedRow(32, 'CL4C-02', 2),
    ], { onUnmergeLclLot: onUnmergeLot });

    // The badge is the trigger — QA clicked the badge itself.
    fireEvent.click(screen.getByRole('button', { name: 'Ghép (1/2)' }));

    const menu = screen.getByRole('dialog', { name: 'Nhóm ghép trả ĐV · Lẻ (1/2)' });
    // Xem nhóm: the group facts and its members with their business keys.
    expect(within(menu).getByText(/29C-333\.33/)).toBeTruthy();
    expect(within(menu).getByText(/Lô 1 · CL4C-01/)).toBeTruthy();
    expect(within(menu).getByText(/Lô 2 · CL4C-02/)).toBeTruthy();

    fireEvent.click(within(menu).getByRole('button', { name: 'Hủy ghép' }));
    expect(onUnmergeLot).toHaveBeenCalledWith({ shipmentId: 31, order: 1, memberCount: 2 });
  });

  it('offers the action on member rows too and keeps the tooltip on the badge', () => {
    const onUnmergeLot = vi.fn();
    renderGrid([
      groupedRow(31, 'CL4C-01', 1),
      groupedRow(32, 'CL4C-02', 2),
    ], { onUnmergeLclLot: onUnmergeLot });

    const badge = screen.getByRole('button', { name: 'Ghép (2/2)' });
    expect(badge.getAttribute('title')).toContain('Ghép trả ĐV · BKS 29C-333.33');
    fireEvent.click(badge);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Nhóm ghép trả ĐV · Lẻ (2/2)' }))
      .getByRole('button', { name: 'Hủy ghép' }));
    expect(onUnmergeLot).toHaveBeenCalledWith({ shipmentId: 32, order: 2, memberCount: 2 });
  });

  it('keeps the badge a static tag when the page does not wire the action', () => {
    renderGrid([groupedRow(31, 'CL4C-01', 1), groupedRow(32, 'CL4C-02', 2)]);
    const badge = screen.getByText('Ghép (1/2)');
    expect(badge.tagName).toBe('SPAN');
    fireEvent.click(badge);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('marks members that live on other pages (the plan is server-paginated)', () => {
    const onUnmergeLot = vi.fn();
    renderGrid([groupedRow(31, 'CL4C-01', 1)], { onUnmergeLclLot: onUnmergeLot });

    fireEvent.click(screen.getByRole('button', { name: 'Ghép (1/2)' }));
    const menu = screen.getByRole('dialog', { name: 'Nhóm ghép trả ĐV · Lẻ (1/2)' });
    expect(within(menu).getByText(/Lô 1 · CL4C-01/)).toBeTruthy();
    expect(within(menu).getByText('Còn 1 thành viên ở trang khác')).toBeTruthy();
  });

  it('FCL rows never get the badge — even when stale LCL group data rides along', () => {
    renderGrid([groupedRow(31, 'CL4C-01', 1, { cargoMode: 'FCL' })], { onUnmergeLclLot: vi.fn() });
    expect(screen.queryByText(/Ghép \(/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Ghép \(/ })).toBeNull();
  });
});

// Card 191026100010 (DV-B1-03) — "Đổi BKS nhóm" sau "Gán xe nhóm": menu nhóm
// có action đổi BKS (page owns dialog + refetch); unwired thì không nút chết.
describe('Card 191026100010 — group menu Đổi BKS nhóm (DV-B1-03)', () => {
  it('raises onChangeGroupTruck with the anchored row and closes the menu', async () => {
    const onChangeGroupTruck = vi.fn();
    renderGrid([
      groupedRow(31, 'CL4C-01', 1),
      groupedRow(32, 'CL4C-02', 2),
    ], { onUnmergeLclLot: vi.fn(), onChangeGroupTruck });

    // Any member row's badge anchors the menu; the action raises THAT row.
    fireEvent.click(screen.getByRole('button', { name: 'Ghép (2/2)' }));
    const menu = screen.getByRole('dialog', { name: 'Nhóm ghép trả ĐV · Lẻ (2/2)' });
    fireEvent.click(within(menu).getByRole('button', { name: 'Đổi BKS nhóm' }));

    expect(onChangeGroupTruck).toHaveBeenCalledTimes(1);
    expect(onChangeGroupTruck.mock.calls[0]![0]).toMatchObject({ shipmentId: 32 });
    // The menu closes (exit animation) so the page-owned dialog owns the screen.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('omits the action when the page does not wire it', () => {
    renderGrid([groupedRow(31, 'CL4C-01', 1)], { onUnmergeLclLot: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Ghép (1/2)' }));
    const menu = screen.getByRole('dialog', { name: 'Nhóm ghép trả ĐV · Lẻ (1/2)' });
    expect(within(menu).queryByRole('button', { name: 'Đổi BKS nhóm' })).toBeNull();
  });
});
