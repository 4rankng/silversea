import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DispatchPlanCardList } from './DispatchPlanCardList';

/**
 * K2.31 (SIL-934, QA 24/11) — the dispatch grid carries a Moóc column.
 *
 * The desktop grid got the column (7a97a61a), but the <640px phone card —
 * the only surface a driver on a phone sees — carried no moóc anywhere, so
 * the assigned trailer (15R-103.08 on trip 580) was invisible on mobile.
 * The card's top line now names it next to the plate, with the trailer type
 * in the title (one short fact, never a second line).
 */

const editorProps = {
  onAtomicSave: vi.fn(),
  onCompleteExternalTrip: vi.fn(),
  onIssueOrder: vi.fn(),
  editRequest: null,
  onOpenRequestConsumed: vi.fn(),
};

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  fulfillmentId: 101,
  version: 3,
  shipmentId: 11,
  shipmentVersion: 5,
  shipmentCode: 'SS-000200',
  fulfillmentType: 'FCL_CONTAINER',
  cargoMode: 'FCL',
  taskStatus: 'READY',
  time: { deliveryDate: '2026-10-24', runHour: 8 },
  customerRoute: { customerName: 'Công ty ABC', factoryName: 'Nhà máy XYZ', deliveryPoint: 'Kho Bình Dương' },
  docs: { billNumber: 'BL-2026-010', tradeDirection: 'EXPORT', declarationNumbers: [] },
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '40HC', cargoWeightKg: '21500.00' },
  notes: { vehicleNote: 'Giao giờ hành chính', customerNote: 'Gặp anh Hùng' },
  dispatch: {
    carrierType: 'OWN',
    carrierName: 'SilverSea',
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: '15E-012.34',
    assignedDriverName: 'Nguyễn Văn Hải',
    assignedDriverPhone: '0984912234',
  },
  ports: { pickupPortId: null, pickupPortName: 'Cảng Cát Lái', dropoffPortId: null, dropoffPortName: 'Kho Sóng Thần' },
  estimates: { plannedRevenue: null, plannedCarrierCost: null },
  classification: 'SINGLE',
  lotFullyPlated: true,
  plannedEndAt: null,
  ...overrides,
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
        {...editorProps}
      />
    </QueryClientProvider>,
  );
};

describe('SIL-934 / K2.31 — the phone card names the run’s moóc', () => {
  it('reads the assigned trailer next to the plate, with its type in the title', () => {
    renderCards([row({
      dispatch: {
        ...row().dispatch,
        assignedPlate: '15H-052.82',
        assignedTrailerPlate: '15R-103.08',
        assignedTrailerType: '40FT',
      },
    })]);
    const trailer = document.querySelector('.dpcard__trailer') as HTMLElement;
    expect(trailer).not.toBeNull();
    expect(trailer.textContent).toBe('Moóc 15R-103.08');
    expect(trailer.getAttribute('title')).toContain('40FT');
    // The plate keeps its own slot — the moóc never replaces it.
    expect(document.querySelector('.dpcard__plate')?.textContent).toBe('15H-052.82');
  });

  it('a row without a moóc carries no moóc line at all', () => {
    renderCards([row()]);
    expect(document.querySelector('.dpcard__trailer')).toBeNull();
  });
});
