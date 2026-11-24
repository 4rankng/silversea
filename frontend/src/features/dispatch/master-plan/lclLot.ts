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
 *
 * K4.6 (SIL-951, QA 24/11): the chip is the MERGED direction+mode badge the
 * KB names — 'NHẬP LẺ' / 'XUẤT LẺ' — not a bare 'Lẻ' pill beside a loose
 * 'Nhập'/'Xuất' word elsewhere on the row. The trade direction therefore
 * rides the chip and the route line drops its own direction word on LCL
 * rows (the grid renders one fact once).
 *
 * K10.38 (SIL-972): a merged row's label carries the group counts the KB
 * names — `· Ghép (k/N)` with k = the lot's 1-based group order
 * (`costGroupOrder`) and N = the group's LIVE member count
 * (`costGroupMemberCount`, soft-deleted members excluded). The counts render
 * only when the wire carries them (older payloads degrade to `· Ghép`).
 */
export function lclLotFlag(
  item: Pick<ShipmentListItem, 'cargoMode' | 'hasActiveLclShipment' | 'costGroupId' | 'costGroupOrder' | 'costGroupMemberCount' | 'actualTruckNo' | 'tradeDirection'>,
): { label: string; title: string } {
  const direction = item.tradeDirection === 'IMPORT'
    ? 'NHẬP LẺ'
    : item.tradeDirection === 'EXPORT'
      ? 'XUẤT LẺ'
      : 'HÀNG LẺ';
  if (item.costGroupId == null) {
    return { label: direction, title: 'Lô hàng lẻ (LCL) — chưa ghép nhóm' };
  }
  const counts = item.costGroupOrder != null && item.costGroupMemberCount != null
    ? ` (${item.costGroupOrder}/${item.costGroupMemberCount})`
    : '';
  return {
    label: `${direction} · Ghép${counts}`,
    title: `Lô hàng lẻ đã ghép trả ĐV cùng nhóm${item.actualTruckNo ? ` — BKS thực ${item.actualTruckNo}` : ''}`,
  };
}

export interface LclLotGroupReasonFields {
  costGroupId?: string | null;
  costGroupOrder?: number | null;
  costGroupPrincipalRef?: string | null;
  revGroupId?: string | null;
  revGroupOrder?: number | null;
}

/**
 * K10.38 (SIL-972) — the row's 0₫/100% money reason, one line per merged
 * dimension. The FB-093 law: Lô 1 (order 1) carries the group's whole money
 * ("giữ 100%"), members 2..N drop to 0₫. The REV member line speaks the BE's
 * own tag (`LCL_REV_MERGE_TAG`); the COST member line cites the principal's
 * Số Bill when the wire carries it (`costGroupPrincipalRef`). Empty for an
 * ungrouped lot — no group, no reason.
 */
export function lclLotGroupReasons(item: LclLotGroupReasonFields): string[] {
  const reasons: string[] = [];
  if (item.costGroupId != null) {
    reasons.push((item.costGroupOrder ?? 1) > 1
      ? `0₫ cước trả ĐV — Lô 1 giữ 100%${item.costGroupPrincipalRef ? ` (Ghép cùng Bill ${item.costGroupPrincipalRef})` : ''}`
      : 'Lô 1 giữ 100% cước trả ĐV');
  }
  if (item.revGroupId != null) {
    reasons.push((item.revGroupOrder ?? 1) > 1
      ? '0₫ cước thu — Ghép thu cước cùng Lô 1'
      : 'Lô 1 giữ 100% cước thu khách');
  }
  return reasons;
}
