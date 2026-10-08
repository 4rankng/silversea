import { describe, expect, it } from 'vitest';
import { selectPairCandidates } from './pairCandidates';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

// Card 353 (user P1 05/10): "Lệnh ghép cùng" must list the SAME-LOT sibling
// first ("đúng 2 lệnh đã phát của cùng lô") — the old inline filter ordered by
// whatever the grid window held, so stale windows hid the partner and
// unrelated rows could appear above it.
const row = (over: Partial<DispatchDetailPlanRow> & { tripId: number; shipmentId: number }): DispatchDetailPlanRow =>
  ({
    shipmentId: over.shipmentId,
    dispatch: {
      tripId: over.tripId,
      carrierType: 'OWN',
      pairKind: null,
      tripStatus: 'CREATED',
      ...(over.dispatch ?? {}),
    },
    docs: { billNumber: `BL-${over.shipmentId}`, tradeDirection: 'IMPORT', declarationNumbers: [] },
    container: { containerNumber: `CONT-${over.tripId}`, containerTypeLabel: null, cargoWeightKg: null },
    customerRoute: { customerName: 'KH', factoryName: null, deliveryPoint: null },
  } as unknown as DispatchDetailPlanRow);

describe('selectPairCandidates (card 353)', () => {
  const base = row({ tripId: 1, shipmentId: 100 });
  const sibling = row({ tripId: 2, shipmentId: 100 });
  const otherLot = row({ tripId: 3, shipmentId: 200 });
  const canceled = row({ tripId: 4, shipmentId: 100, dispatch: { tripStatus: 'CANCELED' } as never });
  const paired = row({ tripId: 5, shipmentId: 100, dispatch: { pairKind: 'KEP' } as never });
  const external = row({ tripId: 6, shipmentId: 100, dispatch: { carrierType: 'EXTERNAL' } as never });

  it('lists the same-lot sibling first and keeps cross-lot rows after (KẾT HỢP)', () => {
    const out = selectPairCandidates([otherLot, sibling, base], base);
    expect(out.map((r) => r.dispatch.tripId)).toEqual([2, 3]);
  });

  it('excludes the base row, canceled, paired, external, and trip-less rows', () => {
    const tripless = row({ tripId: 7, shipmentId: 100, dispatch: { tripId: null } as never });
    const out = selectPairCandidates([base, sibling, canceled, paired, external, tripless], base);
    expect(out.map((r) => r.dispatch.tripId)).toEqual([2]);
  });

  it('a closed dialog (null base) still lists unpaired rows, same-lot grouping moot', () => {
    const out = selectPairCandidates([otherLot, sibling], null);
    expect(out.map((r) => r.dispatch.tripId)).toEqual([3, 2]);
  });
});
