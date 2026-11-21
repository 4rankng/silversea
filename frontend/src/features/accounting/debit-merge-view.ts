// SIL-876 (hotfix CR-009.1) — the shared view layer of the ONE Ghép bộ Debit
// grid: BOTH surfaces (/accounting/ghep-bo-debit and /shipments-debit) open on
// the NEWEST lot first and carry the same search + date-range semantics, so a
// lot found on one screen sits at the same rank on the other.
//
// Sort law (QA 21/11): mặc định mới nhất lên đầu — trang 1 là các lô gần
// hiện tại, never the September-first ledger the ASC board served. The key is
// the lot's Ngày (deliveryDate); lots without a date are the OLDEST (a date
// can't be newer than a known one), and the id breaks ties (later lots newer).
// Filter law: search matches Số Bill/Booking, container number, Khách hàng —
// the ticket's Bill/Cont/KH triple; the date range bounds Ngày (a lot with no
// date sits OUTSIDE any bounded range — it cannot be proven inside it).
import type { DebitMergeItem } from '@tingting/shared';

const OLDEST_DATE_KEY = '0000-00-00';

export function sortDebitMergeRowsDesc(rows: DebitMergeItem[]): DebitMergeItem[] {
  return [...rows].sort((a, b) => {
    const aKey = a.deliveryDate ?? OLDEST_DATE_KEY;
    const bKey = b.deliveryDate ?? OLDEST_DATE_KEY;
    if (aKey !== bKey) return bKey.localeCompare(aKey);
    return b.shipmentId - a.shipmentId;
  });
}

export interface DebitMergeViewFilter {
  /** Bill / container / customer needle; '' = no search. */
  search: string;
  /** ISO 'YYYY-MM-DD' bounds on deliveryDate; '' = open side. */
  dateFrom: string;
  dateTo: string;
}

export function filterDebitMergeRows(rows: DebitMergeItem[], filter: DebitMergeViewFilter): DebitMergeItem[] {
  const needle = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.dateFrom !== '' && (row.deliveryDate == null || row.deliveryDate < filter.dateFrom)) return false;
    if (filter.dateTo !== '' && (row.deliveryDate == null || row.deliveryDate > filter.dateTo)) return false;
    if (needle === '') return true;
    return [row.billOrBookNumber, row.customerName, ...row.containers.map((container) => container.containerNumber)]
      .some((value) => value != null && value.toLowerCase().includes(needle));
  });
}
