import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DispatchPlanCardList } from './DispatchPlanCardList';

/**
 * K3.98 (SIL-932, QA 24/11 — /dispatch-detail) — ONE muted 'Chưa phân xe'
 * for every row that owns no vehicle.
 *
 * The desktop Điều phối cell was unified in SIL-932: a row with NO carrier
 * reads 'Chưa phân xe' on the carrier line and nothing else. The <640px phone
 * card kept a SECOND label source — the 'Chờ biển' chip (SIL-935 / KB §7.2.1
 * K7.20) — and rendered it for EVERY external row without a plate, including
 * the carrier-less ones that own no vehicle at all. 'Chờ biển' names an
 * external vehicle that IS assigned but has no plate yet; on a carrier-less
 * row it is a second, wrong label for the same state QA counted mixed.
 *
 * These cases pin the card to the desktop law:
 *   - carrier-less row (OWN or EXTERNAL) → the muted 'Chưa phân xe', NO chip;
 *   - external row WITH a carrier and no plate → the single 'Chờ bổ sung
 *     biển' head label while unissued (SIL-1157 / K4.71 one-label law); the
 *     K7.20 'Chờ biển' pill stays the answer for ISSUED runs (sil935 pin).
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

const carrierLessRow = (carrierType: 'OWN' | 'EXTERNAL') => row({
  dispatch: {
    carrierType,
    carrierName: null,
    externalCarrierId: null,
    externalCarrierVehicleId: null,
    assignedPlate: null,
    assignedDriverName: null,
    assignedDriverPhone: null,
  },
});

describe('SIL-932 / K3.98 — the phone card reads ONE unassigned label', () => {
  it('a carrier-less OWN row reads the muted Chưa phân xe and never the Chờ biển chip', () => {
    renderCards([carrierLessRow('OWN')]);
    const info = document.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('Chưa phân xe');
    expect(info.textContent).not.toContain('Chờ biển');
  });

  it('a carrier-less EXTERNAL row reads the muted Chưa phân xe, not the Chờ biển chip', () => {
    // The shape QA counted on the page (RTAU1234582 & friends): an external
    // row with NO carrier owns no vehicle — 'Chờ biển' would be a second,
    // wrong label for the same state.
    renderCards([carrierLessRow('EXTERNAL')]);
    const info = document.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')?.textContent).toBe('Chưa phân xe');
    expect(info.textContent).not.toContain('Chờ biển');
  });

  it('an EXTERNAL row WITH a carrier and no plate reads the single unified Đã gán nhà xe · Chờ biển label (K4.71, SIL-1157)', () => {
    renderCards([row({
      dispatch: {
        carrierType: 'EXTERNAL',
        carrierName: 'Công ty TNHH vận tải Tuấn Vinh',
        externalCarrierId: 44,
        externalCarrierVehicleId: null,
        assignedPlate: null,
        assignedDriverName: 'Nguyễn Văn Toản',
        assignedDriverPhone: '0984912234',
      },
    })]);
    const card = document.querySelector('li.dpcard') as HTMLElement;
    const info = card.querySelector('.dpcard__info') as HTMLElement;
    expect(info.querySelector('.dpcard__plate')).toBeNull();
    // SIL-1157 (KB Ch.4 §4.1.3 K4.71): an unissued pending-plate card wears
    // ONE label — the head chip. The 'Chờ biển' pill was the second,
    // duplicate label QA counted (K7.20's pill stays the answer for ISSUED
    // runs — pinned in DetailedPlanGrid.sil935-cho-bien.test). QA 28/11
    // UX-05 superseded the chip's 'Chờ bổ sung biển' wording with the
    // counters'/filters' unified 'Đã gán nhà xe · Chờ biển'.
    expect(info.textContent).not.toContain('Chờ biển');
    expect(card.querySelector('.dpcard__issue')?.textContent).toBe('Đã gán nhà xe · Chờ biển');
  });
});
