/**
 * SIL-1236 (KB §2.3.5 Ranh giới sửa phân công) — the row ⋯ menu's vehicle
 * verb 'Đổi nhà xe/BKS' is back on rows that own a LIVE trip: before the
 * driver's ORDER_RECEIVED the plan save is a full re-assignment the backend
 * syncs onto the trip; after it the governed dialog opens with the carrier
 * dimension locked. 'Hủy phân xe' (SIL-708) stays alongside, unchanged, and
 * the un-issued SIL-955 entry keeps its old gate (planEditable).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DispatchRowActionsMenu } from './DispatchRowActionsMenu';

function makeRow(overrides: {
  taskStatus?: 'READY' | 'DISPATCHED' | 'COMPLETED';
  dispatch?: Partial<DispatchDetailPlanRow['dispatch']>;
  lclGroup?: Record<string, unknown> | null;
} = {}): DispatchDetailPlanRow {
  const { taskStatus = 'READY', dispatch, lclGroup = null } = overrides;
  return {
    fulfillmentId: 46901,
    shipmentId: 109301,
    shipmentVersion: 1,
    shipmentCode: 'SHP-2611-00001',
    fulfillmentType: 'FCL_CONTAINER',
    cargoMode: 'FCL',
    taskStatus,
    time: { deliveryDate: '2026-11-28', runHour: 8 },
    customerRoute: { customerName: 'Công ty QA', factoryName: null, deliveryPoint: 'Kho QA', routeName: null },
    docs: { billNumber: 'BL-1236', tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: 'TSTU1234567', containerTypeLabel: '20DC', cargoWeightKg: '5000.00' },
    lcl: lclGroup == null ? null : { packageCount: 2, packageType: 'PALLET', cargoVolumeCbm: null, group: lclGroup },
    notes: { vehicleNote: null, customerNote: null },
    dispatch: {
      tripId: null,
      tripStatus: null,
      driverAccepted: false,
      carrierType: 'OWN',
      carrierName: 'SilverSea',
      externalCarrierId: null,
      externalCarrierVehicleId: null,
      assignedPlate: '15H-052.82',
      ...dispatch,
    },
    ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
    classification: 'SINGLE',
    lotFullyPlated: false,
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
  } as unknown as DispatchDetailPlanRow;
}

function renderMenu(row: DispatchDetailPlanRow, handlers: { onChangeVehicle?: (row: DispatchDetailPlanRow) => void; onCancelDispatch?: (row: DispatchDetailPlanRow) => void; onEditPlan?: (row: DispatchDetailPlanRow) => void } = {}) {
  render(
    <DispatchRowActionsMenu
      row={row}
      onEditPlan={handlers.onEditPlan ?? vi.fn()}
      onChangeVehicle={handlers.onChangeVehicle ?? vi.fn()}
      onCancelDispatch={handlers.onCancelDispatch}
      onChangeGroupTruckInline={vi.fn()}
    />,
  );
  // The trigger labels itself with the row identity (container number).
  fireEvent.click(screen.getByRole('button', { name: 'Thao tác dòng · TSTU1234567' }));
}

describe('SIL-1236 — row menu Đổi nhà xe/BKS on issued rows', () => {
  it('an issued not-yet-accepted row carries BOTH Đổi nhà xe/BKS and Hủy phân xe, and the vehicle verb opens the editor', () => {
    const onChangeVehicle = vi.fn();
    const onCancelDispatch = vi.fn();
    renderMenu(makeRow({
      taskStatus: 'DISPATCHED',
      dispatch: { tripId: 729, tripStatus: 'CREATED', driverAccepted: false },
    }), { onChangeVehicle, onCancelDispatch });

    expect(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Hủy phân xe' })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' }));
    expect(onChangeVehicle).toHaveBeenCalledTimes(1);
    expect(onCancelDispatch).not.toHaveBeenCalled();
  });

  it('an accepted (IN_TRANSIT, ORDER_RECEIVED) row still carries the vehicle verb', () => {
    renderMenu(makeRow({
      taskStatus: 'DISPATCHED',
      dispatch: { tripId: 727, tripStatus: 'IN_TRANSIT', driverAccepted: true },
    }));

    // Same menu entry — the accepted-state field locking lives in the
    // governed dialog (carrier select disabled), not in a missing verb.
    expect(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Hủy phân xe' })).toBeTruthy();
  });

  it('an un-issued assigned row keeps the SIL-955 entry and Sửa điều phối (no Hủy phân xe)', () => {
    renderMenu(makeRow({ taskStatus: 'READY' }));

    expect(screen.getByRole('menuitem', { name: 'Đổi nhà xe/BKS' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Sửa điều phối' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Hủy phân xe' })).toBeNull();
  });

  it('a grouped LCL row keeps ONE Đổi nhà xe/BKS — the group-truck edit, not the row editor', () => {
    renderMenu(makeRow({
      taskStatus: 'DISPATCHED',
      dispatch: { tripId: 729, tripStatus: 'CREATED' },
      lclGroup: { groupId: 'grp-1236', order: 1, memberCount: 2, actualTruckNo: '59H-111.11' },
    }));

    const items = screen.getAllByRole('menuitem', { name: 'Đổi nhà xe/BKS' });
    expect(items).toHaveLength(1);
  });

  it('a COMPLETED row renders no menu at all — frozen history', () => {
    const { container } = render(
      <DispatchRowActionsMenu
        row={makeRow({ taskStatus: 'COMPLETED', dispatch: { tripId: 1, tripStatus: 'COMPLETED' } })}
        onEditPlan={vi.fn()}
        onChangeGroupTruckInline={vi.fn()}
      />,
    );
    expect(container.querySelector('.dispatch-row-menu__trigger')).toBeNull();
  });
});
