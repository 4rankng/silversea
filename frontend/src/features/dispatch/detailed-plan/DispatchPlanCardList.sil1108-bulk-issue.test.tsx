/**
 * SIL-1108 (Mobile — Phát lệnh hàng loạt trên 390px/360px):
 * DispatchPlanCardList must render per-card selection checkboxes when
 * onToggleBulkSelection is active, enabling eligible rows and dimming
 * ineligible ones with their disabled reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DispatchPlanCardList } from './DispatchPlanCardList';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

function makeRow(overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow {
  return {
    shipmentId: 101,
    fulfillmentId: 501,
    cargoMode: 'FCL',
    classification: 'SINGLE',
    taskStatus: 'ASSIGNED',
    lotFullyPlated: true,
    docs: { billNumber: 'BL-1108-A', tradeDirection: 'IMPORT' },
    customerRoute: { customerName: 'Long Minh', factoryName: 'ASKEY-X1', deliveryPoint: 'KCN Quế Võ' },
    ports: { pickupPortName: 'Cảng Đình Vũ', dropoffPortName: 'Cảng Đình Vũ' },
    container: { containerNumber: 'RTAU4000130', containerTypeLabel: "20'DC", cargoWeightKg: '5000.00' },
    time: { runAt: '2026-11-26T08:00:00+07:00', runHour: null },
    dispatch: {
      carrierType: 'OWN',
      assignedPlate: '15H-104.03',
      assignedDriverName: 'Bùi Tiến Dũng',
      assignedDriverPhone: '0986342975',
      tripId: null,
      externalCarrierId: null,
      carrierName: 'SilverSea',
    },
    notes: {},
    estimates: { plannedRevenue: null, plannedCarrierCost: null },
    ...overrides,
  } as unknown as DispatchDetailPlanRow;
}

describe('SIL-1108 — mobile card bulk-issue selection checkboxes', () => {
  it('renders enabled checkbox for eligible assigned row and calls onToggleBulkSelection', () => {
    const onToggleBulkSelection = vi.fn();
    const eligible = makeRow({ fulfillmentId: 501, taskStatus: 'READY' });
    const completed = makeRow({
      shipmentId: 102,
      fulfillmentId: 502,
      taskStatus: 'COMPLETED',
      docs: { billNumber: 'BL-1108-B', tradeDirection: 'IMPORT' } as DispatchDetailPlanRow['docs'],
      container: { containerNumber: 'RTAU4000145', containerTypeLabel: "20'DC", cargoWeightKg: '5000.00' } as DispatchDetailPlanRow['container'],
      dispatch: {
        carrierType: 'OWN',
        assignedPlate: '15H-104.03',
        tripId: 999,
        externalCarrierId: null,
        carrierName: 'SilverSea',
      } as DispatchDetailPlanRow['dispatch'],
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DispatchPlanCardList
          items={[eligible, completed]}
          selectedBulkFulfillmentIds={new Set()}
          onToggleBulkSelection={onToggleBulkSelection}
          onEditPlan={vi.fn()}
          onChangeGroupTruckInline={vi.fn()}
          onExpandNote={vi.fn()}
          onAtomicSave={vi.fn()}
          onIssueOrder={vi.fn()}
          editRequest={null}
          onOpenRequestConsumed={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const eligibleCb = screen.getByRole('checkbox', { name: 'Chọn phát lệnh RTAU4000130' });
    const completedCb = screen.getByRole('checkbox', { name: 'Chọn phát lệnh RTAU4000145' });

    expect(eligibleCb).not.toBeDisabled();
    expect(completedCb).toBeDisabled();

    fireEvent.click(eligibleCb);
    expect(onToggleBulkSelection).toHaveBeenCalledTimes(1);
    expect(onToggleBulkSelection).toHaveBeenCalledWith(501, true, eligible);
  });
});
