/**
 * Card B 18/10 (B.1) — the FB-095 badge menu gains "Đổi nhà xe/BKS": a merged
 * Ghép-trả-ĐV cost group's BKS edits in place, PRE-FILLED from the group's
 * stored BKS thực, saving through the FB-093 `updateLclTruck` endpoint —
 * the one write that keeps the whole group (members' BKS + planned plates)
 * coherent. GP-03 (spec 23/10 §1): no "BKS báo khách" field on the ĐV side —
 * the payload never carries billingTruckNo (that is the CUS-side identity).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MonthProvider } from '../../../hooks/useMonth';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const updateLclTruckMock = vi.hoisted(() => vi.fn(async () => ({ updatedShipmentIds: [31, 32] })));
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

const groupedRow = {
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
    group: {
      groupId: 'grp-1',
      order: 1,
      memberCount: 2,
      actualTruckNo: '29C-123.45',
      billingTruckNo: '29C-123.45',
      vehicleClassCode: 'CONT20',
      vehicleClassName: 'Container 20 feet',
    },
  },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: { carrierType: null, carrierName: null, externalCarrierId: null, externalCarrierVehicleId: null, assignedPlate: null },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  isCombined: false,
  classification: 'LCL',
  lotFullyPlated: false,
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
} as unknown as DispatchDetailPlanRow;

function renderGrid(onLclTruckUpdated: () => void) {
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
            items={[groupedRow]}
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
            onUnmergeLclLot={vi.fn()}
            onLclTruckUpdated={onLclTruckUpdated}
          />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('FB-095 badge menu — Đổi nhà xe/BKS (card B 18/10, B.1)', () => {
  it('the badge menu offers Đổi nhà xe/BKS and saves the changed BKS through updateLclTruck', async () => {
    updateLclTruckMock.mockClear();
    toastMock.mockClear();
    const onLclTruckUpdated = vi.fn();
    renderGrid(onLclTruckUpdated);

    fireEvent.click(screen.getByRole('button', { name: 'Lẻ · Ghép (1/2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đổi nhà xe/BKS' }));

    // Pre-filled from the group's stored BKS — GP-03: the "BKS báo khách"
    // field is gone from the ĐV-side edit (CUS-side output only).
    const actualInput = screen.getByLabelText('BKS thực (cả nhóm ghép)') as HTMLInputElement;
    expect(actualInput.value).toBe('29C-123.45');
    expect(screen.queryByLabelText(/BKS báo khách/)).toBeNull();

    // The dispatcher changes the group's truck only.
    fireEvent.change(actualInput, { target: { value: '29C-999.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu xe nhóm' }));

    await vi.waitFor(() => expect(updateLclTruckMock).toHaveBeenCalledTimes(1));
    expect(updateLclTruckMock).toHaveBeenCalledWith({ shipmentId: 31, actualTruckNo: '29C-999.99' });
    await vi.waitFor(() => expect(onLclTruckUpdated).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    // The dialog closes after the save.
    expect(screen.queryByRole('button', { name: 'Lưu xe nhóm' })).toBeNull();
  });

  it('a save with nothing changed refuses locally with the actionable message', async () => {
    updateLclTruckMock.mockClear();
    renderGrid(vi.fn());

    fireEvent.click(screen.getByRole('button', { name: 'Lẻ · Ghép (1/2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đổi nhà xe/BKS' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu xe nhóm' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa có gì thay đổi');
    expect(updateLclTruckMock).not.toHaveBeenCalled();
  });
});
