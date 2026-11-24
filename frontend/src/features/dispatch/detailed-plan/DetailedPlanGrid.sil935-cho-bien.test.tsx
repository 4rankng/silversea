// SIL-935 (KB §7.2.1 K7.20) — the 'Chờ biển' chip names the external-carrier
// awaiting-plate state on the dispatch line (/dispatch-detail): the desktop
// Điều phối cell (where QA saw only '4GS | Đã phát lệnh') and the <640px
// phone card (whose plate line was silently absent for external rows).
// OWN-fleet rows and carrier-less rows keep their exact prior shapes.
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MonthProvider } from '../../../hooks/useMonth';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DetailedPlanGrid } from './DetailedPlanGrid';
import { DispatchPlanCardList } from './DispatchPlanCardList';
import { EMPTY_DETAILED_PLAN_FILTERS } from './useDispatchDetailPlan';

const externalRow = (over: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 1175,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'DISPATCHED',
  time: { deliveryDate: '2026-11-25', runHour: 8 },
  customerRoute: { customerName: 'Long Minh', factoryName: 'ASKEY-XƯỞNG 1', deliveryPoint: 'ASKEY-XƯỞNG 1' },
  docs: { billNumber: 'QA-C-2411-01', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSKU9999000', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: {
    carrierType: 'EXTERNAL',
    carrierName: '4GS',
    externalCarrierId: 4,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    tripId: 573,
    tripStatus: 'CREATED',
  },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE',
  lotFullyPlated: false,
  plannedEndAt: null,
  ...over,
} as DispatchDetailPlanRow);

function renderGrid(items: DispatchDetailPlanRow[]) {
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
          />
        </MonthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const renderCards = (items: DispatchDetailPlanRow[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DispatchPlanCardList
        items={items}
        onEditPlan={vi.fn()}
        onChangeGroupTruckInline={vi.fn()}
        onExpandNote={vi.fn()}
        onDeleteLot={vi.fn()}
        onAtomicSave={vi.fn()}
        onCompleteExternalTrip={vi.fn()}
        onIssueOrder={vi.fn()}
        editRequest={null}
        onOpenRequestConsumed={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

describe('SIL-935 — dòng điều vận hiển thị chip Chờ biển', () => {
  it('grid: xe ngoài 4GS chưa có biển → chip Chờ biển trong ô Điều phối', () => {
    renderGrid([externalRow()]);
    const cell = document.querySelector('td[data-label="Điều phối"]') as HTMLElement;
    expect(within(cell).getByText('4GS')).toBeTruthy();
    expect(within(cell).getByText('Chờ biển')).toBeTruthy();
  });

  it('grid: xe ngoài ĐÃ có biển → không chip (biển số là câu trả lời)', () => {
    renderGrid([externalRow({
      dispatch: {
        carrierType: 'EXTERNAL', carrierName: '4GS', externalCarrierId: 4,
        externalCarrierVehicleId: 9, assignedPlate: '29K-999.99', tripId: 573, tripStatus: 'CREATED',
      },
    })]);
    expect(screen.getByText('29K-999.99')).toBeTruthy();
    expect(screen.queryByText('Chờ biển')).toBeNull();
  });

  it('grid: đội nội bộ và dòng chưa phân xe giữ nguyên dáng cũ — không chip', () => {
    renderGrid([
      externalRow({
        dispatch: {
          carrierType: 'OWN', carrierName: 'SilverSea', externalCarrierId: null,
          externalCarrierVehicleId: null, assignedPlate: null, tripId: null, tripStatus: null,
        },
      }),
      externalRow({
        container: { containerNumber: 'TEMU7654321', containerTypeLabel: '20DC', cargoWeightKg: null },
        dispatch: {
          carrierType: null, carrierName: null, externalCarrierId: null,
          externalCarrierVehicleId: null, assignedPlate: null, tripId: null, tripStatus: null,
        },
      }),
    ]);
    expect(screen.queryByText('Chờ biển')).toBeNull();
    expect(screen.getAllByText('Chưa phân xe').length).toBeGreaterThanOrEqual(2);
  });

  it('card <640px: xe ngoài chưa biển → chip Chờ biển trên card', () => {
    renderCards([externalRow()]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    // The card mounts a hidden editor cell too — both views carry the state.
    expect(within(card).getAllByText('4GS').length).toBeGreaterThanOrEqual(1);
    expect(within(card).getAllByText('Chờ biển').length).toBeGreaterThanOrEqual(1);
  });

  it('card <640px: xe ngoài có biển → plate line như cũ, không chip', () => {
    renderCards([externalRow({
      dispatch: {
        carrierType: 'EXTERNAL', carrierName: '4GS', externalCarrierId: 4,
        externalCarrierVehicleId: 9, assignedPlate: '29K-999.99', tripId: 573, tripStatus: 'CREATED',
      },
    })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    expect(within(card).getAllByText('29K-999.99').length).toBeGreaterThanOrEqual(1);
    expect(within(card).queryAllByText('Chờ biển')).toHaveLength(0);
  });
});
