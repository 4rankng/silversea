// SIL-1157 (KB Ch.4 §4.1.3 K4.71 — HOT-03 card parity, QA retest5 27/11) —
// the <640px phone card reads the SAME three status branches as the desktop
// Điều phối cell, one label per state:
//   • chưa phân xe (no carrier) → the single muted 'Chưa phân xe';
//   • đã phân xe chưa biển → xe nhà: carrier name + 'Chờ chọn xe' (never
//     'Chưa phân xe'); xe ngoài: the single 'Chờ bổ sung biển' the head chip
//     already carries (no duplicate 'Chờ biển' pill);
//   • đã có biển → the plate itself, no waiting label.
// The QA defect: xe nhà chưa biển printed 'Chưa phân xe' on the card, and an
// external pending-plate card wore 'Chờ bổ sung biển' + a 'Chờ biển' pill at
// the same time. Scoping note: the card mounts a hidden plan editor (desktop
// cell) for its ⋯ dialog — positives assert inside `.dpcard__info` /
// `.dpcard__issue`, negatives scan the whole card (both surfaces agree).
import { render, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DispatchPlanCardList } from './DispatchPlanCardList';

const baseRow = (over: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 1175,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-11-28', runHour: 8 },
  customerRoute: { customerName: 'Long Minh', factoryName: 'ASKEY-XƯỞNG 1', deliveryPoint: 'ASKEY-XƯỞNG 1' },
  docs: { billNumber: 'R3K-KH2', tradeDirection: 'IMPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSKU9999000', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: null, customerNote: null },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    assignedDriverName: null,
    assignedDriverPhone: null,
    tripId: null,
    tripStatus: null,
  },
  ports: { pickupPortId: null, pickupPortName: null, dropoffPortId: null, dropoffPortName: null },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE',
  lotFullyPlated: false,
  plannedEndAt: null,
  ...over,
} as DispatchDetailPlanRow);

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

describe('SIL-1157 / K4.71 — phone card status branches', () => {
  it('xe nhà đã gán chưa biển: SilverSea + Chờ chọn xe, never Chưa phân xe', () => {
    renderCards([baseRow()]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const info = card.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('SilverSea');
    expect(within(info).getByText('Chờ chọn xe')).toBeTruthy();
    expect(card.textContent).not.toContain('Chưa phân xe');
    expect(card.textContent).not.toContain('Chờ biển');
  });

  it('xe ngoài đã gán chưa biển, chưa phát lệnh: ONE label Chờ bổ sung biển, no Chờ biển pill', () => {
    renderCards([baseRow({
      dispatch: {
        carrierType: 'EXTERNAL',
        carrierName: 'KHÁCH TỰ VC',
        externalCarrierId: 4,
        externalCarrierVehicleId: null,
        assignedPlate: null,
        assignedDriverName: null,
        assignedDriverPhone: null,
        tripId: null,
        tripStatus: null,
      },
    })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const info = card.querySelector('.dpcard__info') as HTMLElement;
    expect(card.querySelector('.dpcard__issue')?.textContent).toBe('Chờ bổ sung biển');
    expect(within(info).queryByText('Chờ biển')).toBeNull();
    expect(within(info).queryByText('Chờ bổ sung biển')).toBeNull();
    expect(card.textContent).not.toContain('Chờ biển');
  });

  it('đã có biển: plate is the answer — no waiting label anywhere', () => {
    renderCards([baseRow({ dispatch: { ...baseRow().dispatch, assignedPlate: '15E-012.34' } })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const info = card.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('15E-012.34');
    expect(card.textContent).not.toContain('Chờ chọn xe');
    expect(card.textContent).not.toContain('Chờ biển');
    expect(card.textContent).not.toContain('Chờ bổ sung biển');
    expect(card.textContent).not.toContain('Chưa phân xe');
  });
});
