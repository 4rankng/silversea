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
