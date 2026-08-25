// Customer feedback L2 (24/08/2026) — helpers that recompute the "Tổng quan
// hàng hóa" and "Lịch trình & điều xe" cells by day, when a date filter is
// applied. Shared by the CUS /shipments page and the dispatch master-plan grid.

export interface AppointmentGroup {
  at: string;
  localDate: string;
  containerSummary: string;
  [key: string]: unknown;
}

/**
 * Returns the appointmentGroups whose `localDate` falls inside
 * [fromDate, toDate] (both optional, inclusive). When neither is set, returns
 * the original list unchanged.
 */
export function filterAppointmentGroupsByDate<T extends AppointmentGroup>(
  groups: T[] | undefined | null,
  fromDate: string,
  toDate: string,
): T[] {
  if (!groups || groups.length === 0) return [];
  if (!fromDate && !toDate) return groups;
  return groups.filter((group) => {
    if (fromDate && group.localDate < fromDate) return false;
    if (toDate && group.localDate > toDate) return false;
    return true;
  });
}

/**
 * Sums the per-appointment container summaries into a single
 * "1x20DC + 2x40HC" style string. Quantities for the same type label across
 * multiple appointments on the same day are merged. Returns "" if no
 * per-group summary was usable.
 */
export function aggregateContainerSummary<T extends AppointmentGroup>(
  groups: T[],
): string {
  if (!groups || groups.length === 0) return '';
  const merged = new Map<string, number>();
  const labelPattern = /^(\d+)\s*[x*×]\s*(.+)$/i;
  for (const group of groups) {
    if (!group.containerSummary) continue;
    for (const piece of group.containerSummary.split(/\s*\+\s*/)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const match = trimmed.match(labelPattern);
      if (match) {
        const qty = Number(match[1]);
        const label = match[2].trim();
        if (Number.isFinite(qty) && qty > 0) {
          merged.set(label, (merged.get(label) ?? 0) + qty);
        }
      } else {
        // Free-form summary (e.g. LCL) — keep verbatim and dedupe by string.
        merged.set(trimmed, (merged.get(trimmed) ?? 0) + 1);
      }
    }
  }
  if (merged.size === 0) return '';
  return Array.from(merged.entries())
    .map(([label, qty]) => `${qty}x${label}`)
    .join(' + ');
}
