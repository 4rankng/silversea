import { localDateInBusinessZone } from '@tingting/shared';
import type { ShipmentCusWorkspaceContainerLine } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import {
  carrierOptionKey,
  type CarrierAllocationOption,
} from '../../../components/shipment/CarrierAllocationSummary';

export const OWN_CARRIER_KEY = 'OWN';

export interface AllocationRow {
  key: string;
  carrierKey: string;
  count20: string;
  count40: string;
}

export interface AllocationDayGroup {
  dateKey: string; // "YYYY-MM-DD" or "__UNSCHEDULED__" or "__ALL__"
  dateLabel: string; // "DD/MM/YYYY" or "Chưa chốt ngày đóng/trả"
  factoryName?: string | null;
  demand: { count20: number; count40: number };
  rows: AllocationRow[];
}

export interface DayValidationResult {
  assigned20: number;
  assigned40: number;
  remaining20: number;
  remaining40: number;
  isOver: boolean;
  isComplete: boolean;
  state: 'complete' | 'partial' | 'error';
  rowIssues: Array<{
    carrier: string | null;
    count20: string | null;
    count40: string | null;
  }>;
  errors: string[];
}

export interface OverallValidationResult {
  totalAssigned20: number;
  totalAssigned40: number;
  totalRemaining20: number;
  totalRemaining40: number;
  dayResults: DayValidationResult[];
  hasErrors: boolean;
  overallState: 'complete' | 'partial' | 'error';
  allErrors: string[];
}

export function toEmptyRow(carrierKey = OWN_CARRIER_KEY): AllocationRow {
  return { key: crypto.randomUUID(), carrierKey, count20: '', count40: '' };
}

export function formatLocalDateVi(dateStr: string | null | undefined): string {
  if (!dateStr || dateStr === '__UNSCHEDULED__' || dateStr === '__ALL__') {
    return 'Chưa chốt ngày đóng/trả';
  }
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function parseContainerSummaryDemand(summary: string | null | undefined): { count20: number; count40: number } {
  if (!summary) return { count20: 0, count40: 0 };
  let count20 = 0;
  let count40 = 0;
  for (const part of summary.split(/\s*\+\s*/)) {
    const match = part.trim().match(/^(\d+)\s*(?:\*|×|x)\s*(.*)$/i);
    if (!match) continue;
    const count = Number(match[1]) || 0;
    const type = match[2]?.trim() || '';
    if (/^20(?:\D|$)/i.test(type)) {
      count20 += count;
    } else if (/^40(?:\D|$)/i.test(type)) {
      count40 += count;
    }
  }
  return { count20, count40 };
}

export function buildInitialDayGroups(shipment: ShipmentListItem): AllocationDayGroup[] {
  const total20 = shipment.containerCount20;
  const total40 = shipment.containerCount40;

  // If shipment has appointmentGroups, group by localDate
  if (shipment.appointmentGroups && shipment.appointmentGroups.length > 0) {
    const dayMap = new Map<string, {
      dateKey: string;
      dateLabel: string;
      factoryNames: Set<string>;
      count20: number;
      count40: number;
    }>();

    for (const group of shipment.appointmentGroups) {
      const dateKey = group.localDate || '__UNSCHEDULED__';
      const existing = dayMap.get(dateKey) ?? {
        dateKey,
        dateLabel: formatLocalDateVi(dateKey),
        factoryNames: new Set<string>(),
        count20: 0,
        count40: 0,
      };
      if (group.factoryShortName || group.factoryName) {
        existing.factoryNames.add(group.factoryShortName ?? group.factoryName ?? '');
      }
      const parsed = parseContainerSummaryDemand(group.containerSummary);
      existing.count20 += parsed.count20;
      existing.count40 += parsed.count40;
      dayMap.set(dateKey, existing);
    }

    const groups: AllocationDayGroup[] = [];
    let sumGroup20 = 0;
    let sumGroup40 = 0;

    for (const item of dayMap.values()) {
      sumGroup20 += item.count20;
      sumGroup40 += item.count40;
      const factory = [...item.factoryNames].filter(Boolean).join(' · ');
      groups.push({
        dateKey: item.dateKey,
        dateLabel: item.dateLabel,
        factoryName: factory || undefined,
        demand: { count20: item.count20, count40: item.count40 },
        rows: [toEmptyRow()],
      });
    }

    // Check if there are unscheduled containers remaining
    const remaining20 = Math.max(0, total20 - sumGroup20);
    const remaining40 = Math.max(0, total40 - sumGroup40);
    if ((remaining20 > 0 || remaining40 > 0) && !dayMap.has('__UNSCHEDULED__')) {
      groups.push({
        dateKey: '__UNSCHEDULED__',
        dateLabel: 'Chưa chốt ngày đóng/trả',
        demand: { count20: remaining20, count40: remaining40 },
        rows: [toEmptyRow()],
      });
    }

    if (groups.length > 0) {
      // If we only have 1 group and there are existing summary allocations, prefill them
      if (groups.length === 1 && shipment.carrierAllocationSummary.length > 0) {
        groups[0]!.rows = shipment.carrierAllocationSummary.map((entry) => ({
          key: crypto.randomUUID(),
          carrierKey: carrierOptionKey(entry.carrierType, entry.externalCarrierId),
          count20: entry.count20 > 0 ? String(entry.count20) : '',
          count40: entry.count40 > 0 ? String(entry.count40) : '',
        }));
      }
      return groups;
    }
  }

  // Fallback: single day group for the whole lot
  const rows: AllocationRow[] = shipment.carrierAllocationSummary.length > 0
    ? shipment.carrierAllocationSummary.map((entry) => ({
        key: crypto.randomUUID(),
        carrierKey: carrierOptionKey(entry.carrierType, entry.externalCarrierId),
        count20: entry.count20 > 0 ? String(entry.count20) : '',
        count40: entry.count40 > 0 ? String(entry.count40) : '',
      }))
    : [toEmptyRow()];

  return [{
    dateKey: '__ALL__',
    dateLabel: formatLocalDateVi(shipment.expectedDeliveryDate) !== 'Chưa chốt ngày đóng/trả'
      ? formatLocalDateVi(shipment.expectedDeliveryDate)
      : 'Toàn bộ lô hàng',
    demand: { count20: total20, count40: total40 },
    rows,
  }];
}

export function syncDayGroupsWithContainers(
  containers: ShipmentCusWorkspaceContainerLine[],
): AllocationDayGroup[] {
  if (containers.length === 0) return [];

  const dayMap = new Map<string, {
    dateKey: string;
    dateLabel: string;
    demand20: number;
    demand40: number;
    assignments: Map<string, { count20: number; count40: number }>;
  }>();

  for (const cont of containers) {
    const dateKey = cont.customerAppointmentAt
      ? (localDateInBusinessZone(cont.customerAppointmentAt) ?? '__UNSCHEDULED__')
      : '__UNSCHEDULED__';

    const is20 = Boolean(cont.containerTypeLabel && /^20(?:\D|$)/i.test(cont.containerTypeLabel));
    const is40 = Boolean(cont.containerTypeLabel && /^40(?:\D|$)/i.test(cont.containerTypeLabel));

    const dayEntry = dayMap.get(dateKey) ?? {
      dateKey,
      dateLabel: formatLocalDateVi(dateKey),
      demand20: 0,
      demand40: 0,
      assignments: new Map(),
    };

    if (is20) dayEntry.demand20 += 1;
    else if (is40) dayEntry.demand40 += 1;
    else dayEntry.demand40 += 1; // default to 40' if unspecified

    if (cont.carrierType) {
      const carrierKey = carrierOptionKey(cont.carrierType, cont.externalCarrierId);
      const cur = dayEntry.assignments.get(carrierKey) ?? { count20: 0, count40: 0 };
      if (is20) cur.count20 += 1;
      else cur.count40 += 1;
      dayEntry.assignments.set(carrierKey, cur);
    }

    dayMap.set(dateKey, dayEntry);
  }

  const groups: AllocationDayGroup[] = [];
  // Sort dates: real dates chronologically, __UNSCHEDULED__ at the end
  const sortedEntries = [...dayMap.entries()].sort(([a], [b]) => {
    if (a === '__UNSCHEDULED__') return 1;
    if (b === '__UNSCHEDULED__') return -1;
    return a.localeCompare(b);
  });

  for (const [dateKey, dayEntry] of sortedEntries) {
    const rows: AllocationRow[] = [];
    for (const [carrierKey, counts] of dayEntry.assignments) {
      rows.push({
        key: crypto.randomUUID(),
        carrierKey,
        count20: counts.count20 > 0 ? String(counts.count20) : '',
        count40: counts.count40 > 0 ? String(counts.count40) : '',
      });
    }
    if (rows.length === 0) {
      rows.push(toEmptyRow());
    }
    groups.push({
      dateKey,
      dateLabel: dayEntry.dateLabel,
      demand: { count20: dayEntry.demand20, count40: dayEntry.demand40 },
      rows,
    });
  }

  return groups;
}

export function validateDayGroups(
  days: AllocationDayGroup[],
  totalDemand: { count20: number; count40: number },
  options: CarrierAllocationOption[],
): OverallValidationResult {
  const optionByKey = new Map(options.map((o) => [o.key, o]));
  const validCount = (v: string) => v.trim() === '' || /^\d+$/.test(v.trim());
  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

  let totalAssigned20 = 0;
  let totalAssigned40 = 0;
  const allErrors: string[] = [];

  const dayResults: DayValidationResult[] = days.map((day) => {
    let dayAssigned20 = 0;
    let dayAssigned40 = 0;
    const dayCarrierCounts = new Map<string, number>();

    day.rows.forEach((r) => {
      dayCarrierCounts.set(r.carrierKey, (dayCarrierCounts.get(r.carrierKey) ?? 0) + 1);
      dayAssigned20 += num(r.count20);
      dayAssigned40 += num(r.count40);
    });

    totalAssigned20 += dayAssigned20;
    totalAssigned40 += dayAssigned40;

    const remaining20 = day.demand.count20 - dayAssigned20;
    const remaining40 = day.demand.count40 - dayAssigned40;
    const isOver = dayAssigned20 > day.demand.count20 || dayAssigned40 > day.demand.count40;
    const isComplete = dayAssigned20 === day.demand.count20 && dayAssigned40 === day.demand.count40;

    const isSingleDay = days.length <= 1;
    const prefix = isSingleDay ? '' : `${day.dateLabel}: `;

    const dayErrors: string[] = [];
    if (dayAssigned20 > day.demand.count20) {
      dayErrors.push(`${prefix}Container 20' vượt số lượng: gán ${dayAssigned20}/${day.demand.count20}.`);
    }
    if (dayAssigned40 > day.demand.count40) {
      dayErrors.push(`${prefix}Container 40' vượt số lượng: gán ${dayAssigned40}/${day.demand.count40}.`);
    }

    const seenDuplicateCarriers = new Set<string>();
    const rowIssues = day.rows.map((row) => {
      const option = optionByKey.get(row.carrierKey);
      let carrier: string | null = null;
      let count20: string | null = null;
      let count40: string | null = null;

      if (!option) carrier = 'Chọn một nhà xe hợp lệ.';
      else if (option.isActive === false) carrier = 'Nhà xe này đang ngưng hoạt động.';
      else if ((dayCarrierCounts.get(row.carrierKey) ?? 0) > 1) {
        carrier = isSingleDay ? 'Nhà xe này đã có ở một dòng khác.' : 'Nhà xe này đang bị lặp trong ngày này.';
        if (!seenDuplicateCarriers.has(row.carrierKey)) {
          seenDuplicateCarriers.add(row.carrierKey);
          dayErrors.push(`${prefix}Nhà xe "${option.label}" đang bị lặp. Mỗi nhà xe chỉ được nhập một dòng${isSingleDay ? '.' : ' trong một ngày.'}`);
        }
      }

      if (!validCount(row.count20)) count20 = 'Nhập số nguyên từ 0 trở lên.';
      if (!validCount(row.count40)) count40 = 'Nhập số nguyên từ 0 trở lên.';

      if (!count20 && dayAssigned20 > day.demand.count20 && num(row.count20) > 0) {
        count20 = `Tổng đang vượt ${dayAssigned20 - day.demand.count20} container 20'.`;
      }
      if (!count40 && dayAssigned40 > day.demand.count40 && num(row.count40) > 0) {
        count40 = `Tổng đang vượt ${dayAssigned40 - day.demand.count40} container 40'.`;
      }

      return { carrier, count20, count40 };
    });

    const hasDayRowIssues = rowIssues.some((issue) => issue.carrier || issue.count20 || issue.count40);
    const state: 'complete' | 'partial' | 'error' = (isOver || hasDayRowIssues)
      ? 'error'
      : isComplete
        ? 'complete'
        : 'partial';

    allErrors.push(...dayErrors);

    return {
      assigned20: dayAssigned20,
      assigned40: dayAssigned40,
      remaining20,
      remaining40,
      isOver,
      isComplete,
      state,
      rowIssues,
      errors: dayErrors,
    };
  });

  const totalRemaining20 = totalDemand.count20 - totalAssigned20;
  const totalRemaining40 = totalDemand.count40 - totalAssigned40;
  const totalIsOver = totalAssigned20 > totalDemand.count20 || totalAssigned40 > totalDemand.count40;
  const hasErrors = totalIsOver || dayResults.some((d) => d.state === 'error');
  const overallState: 'complete' | 'partial' | 'error' = hasErrors
    ? 'error'
    : (totalRemaining20 === 0 && totalRemaining40 === 0)
      ? 'complete'
      : 'partial';

  return {
    totalAssigned20,
    totalAssigned40,
    totalRemaining20,
    totalRemaining40,
    dayResults,
    hasErrors,
    overallState,
    allErrors,
  };
}
