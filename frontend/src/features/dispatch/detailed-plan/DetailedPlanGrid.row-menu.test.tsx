/**
 * DIS-09 (card 211026130015) — "Đổi nhà xe/BKS" moves to the ROW MENU (⋯) of
 * every assigned task on the main dispatch screen (Kế hoạch Chi tiết Xe):
 * one click from the row opens the SAME pre-filled group-truck edit the
 * badge modal owns — no badge-first detour. An issued task additionally gets
 * "Phân xe lại" (the governed trip reassignment dialog) so every assigned row
 * carries its truck-change affordance. Unassigned and completed rows render
 * no menu (nothing to change / frozen history).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MonthProvider } from '../../../hooks/useMonth';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const updateLclTruckMock = vi.hoisted(() => vi.fn(async () => ({ updatedShipmentIds: [109225, 109226] })));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../../../api/dispatchPlanningClient', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateLclTruck: updateLclTruckMock,
}));
vi.mock('../../../components/shared/Toast', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useToastOptional: () => ({ toast: toastMock }),
}));

import { DetailedPlanGrid } from './DetailedPlanGrid';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

function makeRow(overrides: {
  lclGroup?: Record<string, unknown> | null;
  dispatch?: Record<string, unknown>;
  taskStatus?: 'READY' | 'DISPATCHED' | 'COMPLETED';
} = {}): DispatchDetailPlanRow {
  const { lclGroup, dispatch, taskStatus = 'READY' } = overrides;
  return {
    fulfillmentId: 46862,
    version: 1,
    shipmentId: 109225,
    shipmentVersion: 1,
    shipmentCode: 'SHP-2610-03538',
    fulfillmentType: 'LCL_SHIPMENT',
    cargoMode: 'LCL',
    taskStatus,
    time: { deliveryDate: '2026-10-21', runHour: 8 },
    customerRoute: { customerName: 'Công ty Lẻ', factoryName: 'Kho Q.7', deliveryPoint: 'Kho Q.7', routeName: null },
    docs: { billNumber: 'BL-DIS09', tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: '1922.00' },
    lcl: lclGroup === undefined
      ? {
        packageCount: 5,
        packageType: 'PALLET',
        cargoVolumeCbm: '4.000',
        group: {
          groupId: 'grp-dis09',
          order: 1,
          memberCount: 2,
          actualTruckNo: '29X-QA482D',
          billingTruckNo: '29X-QA482D',
          vehicleClassCode: 'CONT20',
          vehicleClassName: 'Container 20 feet',
        },
      }
      : (lclGroup
        ? { packageCount: 5, packageType: 'PALLET', cargoVolumeCbm: null, group: lclGroup }
        : null),
    notes: { vehicleNote: null, customerNote: null },
    dispatch: {
      carrierType: 'EXTERNAL',
      carrierName: 'Nhà xe ngoài QA',
      externalCarrierId: 12,
      externalCarrierVehicleId: 34,
      assignedPlate: '29X-QA482D',
      tripId: null,
      tripStatus: null,
      ...dispatch,
    },
    ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
    isCombined: false,
    classification: 'LCL',
    lotFullyPlated: false,
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
  } as unknown as DispatchDetailPlanRow;
}

function renderGrid(row: DispatchDetailPlanRow, props: { onOpenTripReassign?: (tripId: number) => void; onLclTruckUpdated?: () => void; onOpenPair?: (row: DispatchDetailPlanRow) => void; onUnmergeLclGroup?: (groupId: string) => void; onDeleteLot?: (row: DispatchDetailPlanRow) => void } = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <MonthProvider>
          <DetailedPlanGrid
            filters={EMPTY_DETAILED_PLAN_FILTERS}
            onFilterChange={vi.fn()}
            loadDeliveryPointFacets={vi.fn()}
            loadPickupPortFacets={vi.fn()}
            loadDropoffPortFacets={vi.fn()}
            items={[row]}
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
            onOpenTripReassign={props.onOpenTripReassign ?? vi.fn()}
            onCompleteExternalTrip={vi.fn()}
            onIssueOrder={vi.fn()}
            onOpenPair={props.onOpenPair}
            onUnmergeLclLot={vi.fn()}
            onUnmergeLclGroup={props.onUnmergeLclGroup}
            onDeleteLot={props.onDeleteLot}
            onLclTruckUpdated={props.onLclTruckUpdated}
          />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DIS-09 — row menu Đổi nhà xe/BKS (card 211026130015)', () => {
  it('the assigned grouped row carries a ⋯ row menu whose item opens the PRE-FILLED truck edit directly', async () => {
    updateLclTruckMock.mockClear();
    toastMock.mockClear();
    const onLclTruckUpdated = vi.fn();
    renderGrid(makeRow(), { onLclTruckUpdated });

    // The row menu exists on the row — one click from the row, no badge.
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' }));

    // The edit form is already open and pre-filled from the group's BKS pair.
    const actualInput = screen.getByLabelText('BKS thực (cả nhóm ghép)') as HTMLInputElement;
    const billingInput = screen.getByLabelText('BKS báo khách (riêng lô này)') as HTMLInputElement;
    expect(actualInput.value).toBe('29X-QA482D');
    expect(billingInput.value).toBe('29X-QA482D');

    fireEvent.change(actualInput, { target: { value: '29X-QA9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu xe nhóm' }));

    await vi.waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 109225, actualTruckNo: '29X-QA9999' });
    await vi.waitFor(() => expect(onLclTruckUpdated).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('an issued assigned row also carries Phân xe lại through the governed reassignment dialog', () => {
    const onOpenTripReassign = vi.fn();
    renderGrid(makeRow({
      taskStatus: 'DISPATCHED',
      dispatch: { tripId: 9001, tripStatus: 'IN_TRANSIT' },
    }), { onOpenTripReassign });

    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Phân xe lại' }));

    expect(onOpenTripReassign).toHaveBeenCalledWith(9001);
  });

  it('a grouped row that is also issued offers BOTH actions in the same menu', () => {
    renderGrid(makeRow({
      taskStatus: 'DISPATCHED',
      dispatch: { tripId: 9002, tripStatus: 'CREATED' },
    }));

    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    expect(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Phân xe lại' })).toBeTruthy();
  });

  it('an unassigned row (no carrier on the plan) still gets the menu — "Sửa điều phối" is the assign verb', () => {
    renderGrid(makeRow({
      lclGroup: null,
      dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
    }));
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    expect(screen.getByRole('menuitem', { name: 'Sửa điều phối' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeNull();
  });

  it('a completed assigned row renders no row menu (frozen history)', () => {
    renderGrid(makeRow({ taskStatus: 'COMPLETED', dispatch: { tripId: 9003, tripStatus: 'COMPLETED' } }));
    expect(screen.queryByRole('button', { name: /Thao tác dòng/ })).toBeNull();
  });

  it('owner redesign 23/10 — the menu carries Ghép chuyến, Tách nhóm and the LAST-position danger Xóa lô', () => {
    renderGrid(makeRow(), { onOpenPair: vi.fn(), onUnmergeLclGroup: vi.fn(), onDeleteLot: vi.fn() } as never);
    fireEvent.click(screen.getByRole('button', { name: /Thao tác dòng/ }));
    const items = screen.getAllByRole('menuitem');
    const deleteItem = items.find((item) => item.textContent === 'Xóa lô');
    expect(deleteItem).toBeTruthy();
    expect(deleteItem).toHaveClass('dispatch-row-menu__item--danger');
    // Xóa lô rides LAST — a destructive tap must cross the group's hairline.
    expect(items[items.length - 1]).toBe(deleteItem);
    expect(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeTruthy();
  });
});
