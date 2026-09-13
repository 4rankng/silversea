/**
 * ShipmentDetailPage view-model helpers, extracted to keep the page under its
 * frozen LOC ceiling (structure guard). Pure formatting + the carrier
 * allocation grouping that feeds the "Nhà xe" section — no React, no queries.
 * Date formatting goes through lib/format (the structure guard's canonical
 * home); only formatVnd (not a date formatter) lives here.
 */
import type {
  ShipmentDetail as ShipmentDetailData,
  ShipmentCarrierAllocationGroup,
} from '../../../api/shipmentClient';

export function formatVnd(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

export function allocationSummaryFromDetail(data: ShipmentDetailData): ShipmentCarrierAllocationGroup[] {
  const grouped = new Map<string, ShipmentCarrierAllocationGroup>();
  const containerById = new Map(data.containers.map((container) => [container.id, container]));
  for (const assignment of data.carrierAssignments) {
    if (!assignment.carrierType) continue;
    // Group by carrier FIRST (20260912_2: a 45'HC — or a row without a
    // resolvable container — is still a real assignment; the section must
    // not fall back to "Chưa phân nhà xe"). The 20/40 buckets only feed the
    // chip counts, which hide zeros anyway.
    const container = assignment.shipmentContainerId != null
      ? containerById.get(assignment.shipmentContainerId)
      : undefined;
    const rawLabel = container
      ? `${assignment.containerTypeCode ?? ''} ${assignment.containerTypeName ?? ''}`.toUpperCase()
      : '';
    const bucket = rawLabel.includes('20') ? 'count20' : rawLabel.includes('40') ? 'count40' : null;
    const key = `${assignment.carrierType}:${assignment.externalCarrierId ?? 'own'}`;
    const current = grouped.get(key) ?? {
      carrierType: assignment.carrierType,
      externalCarrierId: assignment.externalCarrierId,
      carrierName: assignment.carrierType === 'OWN' ? 'Đội xe nội bộ SilverSea' : assignment.externalCarrierName,
      count20: 0,
      count40: 0,
    };
    if (bucket) current[bucket] += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()];
}
