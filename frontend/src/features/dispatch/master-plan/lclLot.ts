import type { ShipmentListItem } from '../../../api/shipmentClient';

/**
 * Single source of truth for "this lot is hàng lẻ on Kế hoạch Tổng quát".
 *
 * The Sản lượng chip's "Lẻ: N lô" counts lots with an ACTIVE LCL_SHIPMENT
 * fulfillment (computeDispatchSummaryForSet, backend) — the same fulfillment
 * the "Gán xe nhóm" carrier write rides (persistLclCostCarrier). The row
 * checkbox and the client-side Loại hàng filter must key off exactly that
 * fact, projected per row as `hasActiveLclShipment`, so a lot counted by the
 * header always shows a checkbox and a filtered view can never disagree with
 * the chip. `cargoMode === 'LCL'` stays as the fallback for payloads from an
 * older backend (the FB-091 mocked-fixture shape).
 */
export function isLclLotRow(
  item: Pick<ShipmentListItem, 'cargoMode' | 'hasActiveLclShipment'>,
): boolean {
  return item.hasActiveLclShipment ?? item.cargoMode === 'LCL';
}

/**
 * SIL-708 (id 708) — the flag chip's visible text and its hover detail, one
 * source for the grid's cargo cell and the phone card's Loại token so the two
 * surfaces can never disagree. The Ghép half keys off the same costGroupId
 * the CHỌN checkbox disables on (SIL-589, id 689 — that logic is untouched;
 * this only names what the flag says).
 */
export function lclLotFlag(
  item: Pick<ShipmentListItem, 'cargoMode' | 'hasActiveLclShipment' | 'costGroupId' | 'actualTruckNo'>,
): { label: string; title: string } {
  return item.costGroupId != null
    ? {
        label: 'Lẻ · Ghép',
        title: `Lô hàng lẻ đã ghép trả ĐV cùng nhóm${item.actualTruckNo ? ` — BKS thực ${item.actualTruckNo}` : ''}`,
      }
    : { label: 'Lẻ', title: 'Lô hàng lẻ (LCL) — chưa ghép nhóm' };
}
