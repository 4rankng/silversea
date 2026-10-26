import type { ShipmentListItem } from '../../../api/shipmentClient';
import {
  formatDateTimeShort,
  formatISODate,
  formatNumber,
  formatVolumeCbm,
  formatWeight,
} from '../../../lib/format';
import {
  formatAppointmentGroupLine,
} from '../../shipments/cus/cusUtils';
import { resolveLiftDropPoints } from '../../shipments/liftDropPoints';

/**
 * Owner redesign 23/10 (master-plan lane) — the pure per-row value composers
 * of the /dispatch board, shared by the table (MasterPlanGrid) and the phone
 * card list (MasterPlanCardList) so the two layouts can never drift in what a
 * lot's facts say (the detailed-plan precedent: DispatchPlanCellValues.ts).
 * MasterPlanGrid re-exports this surface, so existing importers (the XLSX
 * export, the tests) keep their paths.
 */

/** Schedule blocks: one per container appointment — the ICT line leads in the
 *  canonical padded shape and the "factory · containers" line indents beneath
 *  it. No per-container appointments → ONE canonical lot-level datetime line
 *  (card 20260921_23: no more dateless "15H" fragments). */
export type ScheduleBlock = { head: string | null; sub: string | null };

export function scheduleBlocks(item: ShipmentListItem, scheduleDate?: string | null): ScheduleBlock[] {
  if (!item.appointmentGroups?.length) {
    // Lot-level fallback: the delivery date plus the close/return instant —
    // both in canonical shapes, never an hour-only fragment (card 20260921_23).
    const fallbackInstant = item.plannedReturnAt ?? item.closingAt;
    const instantLine = fallbackInstant ? formatDateTimeShort(fallbackInstant) : null;
    const dateLine = item.expectedDeliveryDate ? formatISODate(item.expectedDeliveryDate) : null;
    const blocks: ScheduleBlock[] = [];
    if (dateLine) blocks.push({ head: dateLine, sub: null });
    if (instantLine && instantLine !== '—') blocks.push({ head: instantLine, sub: null });
    return blocks;
  }
  const groups = scheduleDate
    ? item.appointmentGroups.filter((group) => group.localDate === scheduleDate)
    : item.appointmentGroups;
  return groups.map((group) => {
    const factory = group.factoryName?.trim();
    return {
      head: formatAppointmentGroupLine(group.at, group.localDate),
      sub: factory ? `${factory} · ${group.containerSummary}` : group.containerSummary,
    };
  });
}

/** SIL-507 retry (26/10) — the day's distinct appointment factory names (the
 *  lead segment of every schedule block's sub line, under the SAME
 *  single-day filter `scheduleBlocks` applies). The phone card's route line
 *  carries them so an appointment's factory never vanishes off the 3-dòng
 *  card; the desktop table keeps the full head+sub stack. */
export function scheduleFactoryNames(item: ShipmentListItem, scheduleDate?: string | null): string[] {
  const groups = scheduleDate
    ? (item.appointmentGroups ?? []).filter((group) => group.localDate === scheduleDate)
    : item.appointmentGroups ?? [];
  const names: string[] = [];
  for (const group of groups) {
    const factory = group.factoryName?.trim();
    if (factory && !names.includes(factory)) names.push(factory);
  }
  return names;
}

/** Cutoff proximity: orange within 3 days, red when overdue/today. */
export function cutoffUrgency(iso: string | null | undefined): 'none' | 'soon' | 'urgent' {
  if (!iso) return 'none';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'none';
  const days = (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (days < 1) return 'urgent';
  if (days <= 3) return 'soon';
  return 'none';
}

/**
 * The API uses ` + ` to keep the grouped container demand machine-readable.
 * Render each type as its own operational line, while accepting summaries from
 * an older backend that still used `*` or `×` during a rolling deployment.
 */
export function formatContainerSummaryLines(summary: string | null): string[] {
  // Missing cargo demand names the missing fact instead of a bare '—'
  // (design §1: empty values name the field).
  if (!summary) return ['Chưa có cont'];

  return summary
    .split(/\s*\+\s*/)
    .map((part) => part.trim().replace(/^(\d+)\s*(?:\*|×|x)\s*/i, '$1 x '))
    .filter(Boolean);
}

/** Owner redesign 23/10 ("Nâng/Trả/Container đủ 1 dòng"): the per-type lines
 *  join back onto ONE operational run — "1 x 40DC + 1 x 20DC" — so the port
 *  and cargo cells hold a single ellipsized line (title carries the whole
 *  value) instead of wrapping the demand into a second row. */
export function formatContainerSummaryLine(summary: string | null): string {
  return formatContainerSummaryLines(summary).join(' + ');
}

/** Parsed container-type demand bucket: type label → count.
 *  Insertion order is preserved so the formatted output stays deterministic. */
type ContainerTypeCounts = Map<string, number>;

/**
 * Parse a `containerSummary` string ("1 x 40DC + 1 x 20DC") into a type→count
 * map. Accepts `*` / `×` / `x` separators (rolling-deployment tolerance).
 * Returns null for empty/invalid input so callers can keep the original
 * `null` semantics instead of forcing a fake zero.
 */
function parseContainerTypeCounts(summary: string | null | undefined): ContainerTypeCounts | null {
  if (!summary) return null;
  const counts: ContainerTypeCounts = new Map();
  const parts = summary.split(/\s*\+\s*/);
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)\s*(?:\*|×|x)\s*([A-Za-z0-9]+)\s*$/);
    if (!match) continue;
    const qty = Number.parseInt(match[1], 10);
    const type = match[2];
    if (!Number.isFinite(qty) || qty <= 0) continue;
    counts.set(type, (counts.get(type) ?? 0) + qty);
  }
  return counts.size > 0 ? counts : null;
}

/** Render a type→count map back to the operational "1 x 40DC + 1 x 20DC"
 *  shape. Insertion order is preserved so the first appearance order drives
 *  the line order (matches the CUS workspace contract). */
function formatContainerTypeCounts(counts: ContainerTypeCounts): string {
  return Array.from(counts.entries())
    .map(([type, qty]) => `${qty} x ${type}`)
    .join(' + ');
}

export type ContainerPortGroupLine = {
  direction: 'lift' | 'drop';
  label: 'Nâng' | 'Hạ';
  portName: string;
  containerSummary: string | null;
};

type ContainerPortGroupKey = string;

/**
 * Lift/drop lines for one row's Cảng nâng / Cảng hạ columns.
 *
 * LCL — its two sites, no aggregation (see the branch below).
 *
 * FCL — the backend exposes one `containerPortGroup` per appointment instant
 * (per-day when a lot splits across close/return dates), so a single shipment
 * can carry N groups for the SAME (pickup → dropoff) pair — each with a partial
 * container count. Dispatch needs the TOTAL demand per lift/drop pair, not the
 * per-day split. We aggregate groups by (pickup, dropoff) and sum the
 * container-type counts so each port column reads "Cảng HP · 3 x 40DC" instead
 * of three "1 x 40DC" lines.
 *
 * Customer feedback L2 (24/08/2026) — for FCL, when `scheduleDate` is set, only
 * groups whose `localDate` matches are aggregated, so the cảng cells reflect only
 * the conts running on that day.
 *
 * An LCL lot owns no container (LCL + container is refused at intake), so it has
 * no container port pair to aggregate. Its two columns name the lot's OWN
 * lift/drop points instead, and those SWAP with the trade direction — FB-105 §3,
 * the one rule every surface shares (`resolveLiftDropPoints`): Nhập khẩu reads
 * "Kho lấy hàng (CFS/Cảng)" under Cảng nâng and "Nhà máy" under Cảng hạ; Xuất
 * khẩu the reverse. The warehouse is `pickupWarehouseSiteId` (projected as
 * `pickupWarehouseSiteName`), the factory is the lot's operational site (the
 * same column the detailed-plan "Điểm trả" facet filters on, projected here as
 * `factoryName`). A side whose catalog site was never picked falls back to the
 * lot's stored free text (`pickupLocation` / `deliveryLocation`) and otherwise
 * reads "—", never "Chưa có cont" (FB-091: a container placeholder on a lot that
 * can never have a container names a false fact).
 *
 * A single-day filter does not blank these: an LCL lot's schedule IS its
 * `expectedDeliveryDate` (`resolveEffectiveFulfillmentDate`), so both sites
 * stay true on every day the lot appears.
 */
export function aggregateContainerPortGroupLines(item: ShipmentListItem, scheduleDate?: string | null): ContainerPortGroupLine[] {
  if (item.cargoMode === 'LCL') {
    // FB-105 §3 — the sides swap with the direction, so resolve them through the
    // shared rule instead of assuming Nhập (lift = kho) for every lot.
    const points = resolveLiftDropPoints({
      cargoMode: 'LCL',
      tradeDirection: item.tradeDirection,
      warehouseName: item.pickupWarehouseSiteName,
      factoryName: item.factoryName,
      liftFallback: item.pickupLocation,
      dropFallback: item.deliveryLocation,
    });
    return [
      { direction: 'lift', label: 'Nâng', portName: points.lift ?? '—', containerSummary: null },
      { direction: 'drop', label: 'Hạ', portName: points.drop ?? '—', containerSummary: null },
    ];
  }
  const allGroups = item.containerPortGroups ?? [];
  const containerPortGroups = scheduleDate
    ? allGroups.filter((group) => group.localDate === scheduleDate)
    : allGroups;
  if (containerPortGroups.length === 0) {
    if (allGroups.length === 0) {
      return [
        { direction: 'lift', label: 'Nâng', portName: 'Chưa có cont', containerSummary: null },
        { direction: 'drop', label: 'Hạ', portName: 'Chưa có cont', containerSummary: null },
      ];
    }
    // Date filter active but no conts on that day — same named placeholder,
    // never a bare '—' (design §1).
    return [
      { direction: 'lift', label: 'Nâng', portName: 'Chưa có cont', containerSummary: null },
      { direction: 'drop', label: 'Hạ', portName: 'Chưa có cont', containerSummary: null },
    ];
  }

  const aggregated = new Map<ContainerPortGroupKey, {
    pickup: string | null;
    dropoff: string | null;
    counts: ContainerTypeCounts;
  }>();

  for (const group of containerPortGroups) {
    const key = `${group.pickupPortName ?? ''}__${group.dropoffPortName ?? ''}`;
    const existing = aggregated.get(key);
    if (existing) {
      const parsed = parseContainerTypeCounts(group.containerSummary);
      if (parsed) {
        for (const [type, qty] of parsed.entries()) {
          existing.counts.set(type, (existing.counts.get(type) ?? 0) + qty);
        }
      }
    } else {
      aggregated.set(key, {
        pickup: group.pickupPortName,
        dropoff: group.dropoffPortName,
        counts: parseContainerTypeCounts(group.containerSummary) ?? new Map(),
      });
    }
  }

  return Array.from(aggregated.values()).flatMap((entry) => {
    const liftName = entry.pickup ?? '—';
    const dropName = entry.dropoff ?? '—';
    const summary = entry.counts.size > 0 ? formatContainerTypeCounts(entry.counts) : null;
    return [
      { direction: 'lift' as const, label: 'Nâng' as const, portName: liftName, containerSummary: summary },
      { direction: 'drop' as const, label: 'Hạ' as const, portName: dropName, containerSummary: summary },
    ];
  });
}

/** Single-day cargo line (customer feedback L2): when a single-day filter is
 * applied, the cargo cell shows that day's cont count merged from
 * `appointmentGroups` instead of the master lô totals; null when the day has
 * no groups or no parseable summary (caller falls back to the lot summary). */
export function dayContainerSummary(item: ShipmentListItem, scheduleDate?: string | null): string | null {
  const dayGroups = scheduleDate
    ? (item.appointmentGroups ?? []).filter((g) => g.localDate === scheduleDate)
    : [];
  if (dayGroups.length === 0) return null;
  const merged = new Map<string, number>();
  for (const group of dayGroups) {
    for (const piece of (group.containerSummary || '').split(/\s*\+\s*/)) {
      const trimmed = piece.trim();
      const match = trimmed.match(/^(\d+)\s*[x*×]\s*(.+)$/i);
      if (match) {
        const qty = Number(match[1]);
        const label = match[2].trim();
        merged.set(label, (merged.get(label) ?? 0) + qty);
      }
    }
  }
  if (merged.size === 0) return null;
  return Array.from(merged.entries())
    .map(([label, qty]) => `${qty} x ${label}`)
    .join(' + ');
}

/** One rendered line of the Tổng quan hàng hóa cell. `muted` marks the
 *  supporting measure line under the composition line; `empty` marks a line that
 *  rendered no value, which the phone record card collapses (`data-empty`). The
 *  flag is explicit rather than inferred from the text: two lines can carry the
 *  same placeholder, and a custom `FormatValueOptions.empty` label must not
 *  silently stop collapsing. */
export type CargoCellLine = { text: string; muted: boolean; empty: boolean; identity?: boolean };/**
 * Cargo-cell lines, in render order — the ONE source both the grid and the XLSX
 * export read, so the sheet can never disagree with the screen.
 *
 * LCL (FB-091) — a containerless lot has no container demand to print, so the
 * cell states the lot's own CUS cargo fields instead of "Chưa có cont":
 * `[số lượng] [loại bao bì]` over `[tấn] · [CBM]`, e.g.
 * `5 PALLET` / `1,922 tấn · 4 CBM`. CBM is optional for LCL (helpdesk
 * 2026-10-13), so each measure joins the line only when the lot has one;
 * a lot that entered neither keeps "—" rather than a bare unit.
 *
 * FCL — the container-type demand lines (narrowed to the active day when a
 * single-day filter is on) plus the lot's aggregated weight.
 */
export function cargoCellLines(item: ShipmentListItem, scheduleDate?: string | null): CargoCellLine[] {
  if (item.cargoMode === 'LCL') {
    const demand = [item.packageCount != null ? formatNumber(item.packageCount) : null, item.packageType?.trim() || null]
      .filter(Boolean)
      .join(' ');
    const measures = [
      item.cargoWeightKg ? formatWeight(item.cargoWeightKg) : null,
      item.cargoVolumeCbm ? formatVolumeCbm(item.cargoVolumeCbm) : null,
    ].filter(Boolean).join(' · ');
    return [
      { text: demand || '—', muted: false, empty: !demand },
      { text: measures || '—', muted: true, empty: !measures },
    ];
  }
  const weight = formatWeight(item.totalCargoWeightKg);
  const containerSummarySource = dayContainerSummary(item, scheduleDate) ?? item.containerTypeSummary;
  return [
    ...formatContainerSummaryLines(containerSummarySource)
      // Real container demand carries the shared identity weight (DIS-08,
      // card 211026180428); the 'Chưa có cont' placeholder names a MISSING
      // fact and stays regular. `!!` mirrors formatContainerSummaryLines'
      // own emptiness check so a '' summary can never bold the placeholder.
      .map((text): CargoCellLine => ({ text, muted: false, empty: false, identity: !!containerSummarySource })),
    { text: weight, muted: true, empty: item.totalCargoWeightKg == null },
  ];
}

/** Review M2 (this lane): the row's container-demand visibility and the
 *  allocation roster string — ONE implementation shared by the table row and
 *  the phone card so the two layouts can never disagree on what shows. */

/** The "Chi tiết container" affordance's visibility law: a lot with a real
 *  container demand (legacy count columns OR containerTotal, and not the
 *  named-missing-fact placeholder) offers the container peek. */
export function hasContainerDemand(item: ShipmentListItem): boolean {
  return Boolean(
    (item.containerTotal != null
      ? item.containerTotal > 0
      : ((item.containerCount20 ?? 0) + (item.containerCount40 ?? 0) > 0))
    && item.containerTypeSummary !== 'Chưa có cont',
  );
}

/** The allocation roster as one operational run: "Nhà xe: 2x20' · 1x40'" —
 *  joined with ' · ' in summary order; empty when nothing is allocated. */
export function formatCarrierAllocationChips(item: ShipmentListItem): string {
  return item.carrierAllocationSummary.map((entry) => {
    const counts = [
      entry.count20 > 0 ? `${entry.count20}x20'` : null,
      entry.count40 > 0 ? `${entry.count40}x40'` : null,
    ].filter(Boolean).join(' · ');
    return counts ? `${entry.carrierLabel}: ${counts}` : entry.carrierLabel;
  }).join(' · ');
}
