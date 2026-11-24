// XLSX worksheet export for the dispatch master-plan board (/dispatch).
//
// Card 081026093510 — the "Xuất file Excel" action must be data-driven:
// enabled whenever the dispatcher's filtered view holds >= 1 row, disabled
// with a "Không có dữ liệu để xuất" explanation at 0 rows (the enable/disable
// wiring lives in pages/MasterPlanPage.tsx). Like the /shipments "Tải XLSX"
// precedent (features/shipments/cus/cusExport.ts) the export walks EVERY page
// of the filtered set — bypassing the board's 20-row page size — and maps each
// lot through the SAME helpers MasterPlanGrid renders with, so the sheet can
// never disagree with the screen (including the single-day narrowing the
// board applies when deliveryDateFrom === deliveryDateTo).

import { listShipments, type ShipmentListItem } from '../../../api/shipmentClient';
import { downloadCSV } from '../../../lib/csv';
import { formatDateTimeShort, formatNumber } from '../../../lib/format';
import { displayNote } from '../../shipments/cus/cusUtils';
import {
  aggregateContainerPortGroupLines,
  cargoCellLines,
  formatContainerSummaryLines,
  scheduleBlocks,
} from './MasterPlanGrid';
import { isLclLotRow, lclLotFlag } from './lclLot';
import { masterPlanListParams, type MasterPlanFilters } from './useDispatchMasterPlan';

const EXPORT_PAGE_SIZE = 100;

/** The board's 8 grouped columns, in grid order (MasterPlanGrid <thead>). */
export const MASTER_PLAN_EXPORT_HEADERS = [
  'Thời gian & lịch trình',
  'Khách hàng & nhà máy',
  'Tuyến đường & hãng tàu',
  'Cảng nâng',
  'Cảng hạ',
  'Tổng quan hàng hóa',
  'Phân bổ nhà xe',
  'Ghi chú',
] as const;

/** Walk every page of the filtered board (100 rows per request). The list
 *  response carries `total`, not `totalPages` — derive the page count from it,
 *  exactly like the hook's `Math.ceil(total / PAGE_SIZE)`. */
export async function collectMasterPlanExportItems(filters: MasterPlanFilters): Promise<ShipmentListItem[]> {
  const exportItems: ShipmentListItem[] = [];
  let exportPage = 1;
  let exportTotalPages = 1;
  do {
    const response = await listShipments(masterPlanListParams(filters, exportPage, EXPORT_PAGE_SIZE));
    exportItems.push(...response.items);
    exportTotalPages = Math.max(1, Math.ceil(response.total / EXPORT_PAGE_SIZE));
    exportPage += 1;
  } while (exportPage <= exportTotalPages);
  return exportItems;
}

function allocationLines(item: ShipmentListItem): string[] {
  // K4.6 (SIL-951, KB): the sheet mirrors the board cell — 'Chưa phân xe'.
  if (item.carrierAllocationSummary.length === 0) return ['Chưa phân xe'];
  return item.carrierAllocationSummary.map((entry) => {
    const counts = [
      entry.count20 > 0 ? `${entry.count20}x20'` : null,
      entry.count40 > 0 ? `${entry.count40}x40'` : null,
    ].filter(Boolean).join(' · ');
    return counts ? `${entry.carrierLabel}: ${counts}` : entry.carrierLabel;
  });
}

/** Map one lot to the worksheet's eight multi-line columns — the exact text
 *  the grid cells show (named placeholders included, design §1). */
export function mapMasterPlanExportRow(item: ShipmentListItem, scheduleDate?: string | null): string[] {
  const scheduleLines: string[] = [];
  for (const block of scheduleBlocks(item, scheduleDate ?? null)) {
    if (block.head) scheduleLines.push(block.head);
    if (block.sub) scheduleLines.push(block.sub);
  }
  if ((item.containersMissingAppointment ?? 0) > 0 && (item.containerTotal ?? 0) > 0) {
    scheduleLines.push(`Cảnh báo: Còn ${item.containersMissingAppointment}/${item.containerTotal} cont chưa chốt ngày đóng trả`);
  }
  if (item.customsCutoffAt) {
    scheduleLines.push(`Hạn hoàn tất hải quan: ${formatDateTimeShort(item.customsCutoffAt)}`);
  }

  const liftLines: string[] = [];
  const dropLines: string[] = [];
  for (const line of aggregateContainerPortGroupLines(item, scheduleDate ?? null)) {
    const target = line.direction === 'lift' ? liftLines : dropLines;
    target.push(line.portName, ...(line.containerSummary ? formatContainerSummaryLines(line.containerSummary) : []));
  }

  // K4.6 (SIL-951, QA 24/11): the sheet mirrors the board. On an LCL lot the
  // MERGED badge ('NHẬP LẺ' / 'XUẤT LẺ') is the direction — the board's route
  // line drops its own 'Nhập'/'Xuất' word there, so the sheet drops it too
  // and the direction is printed ONCE (the old sheet kept the loose word and
  // had no badge at all — the very 'pill + word' pair KB K4.6 forbids).
  const lclLot = isLclLotRow(item);
  const lclBadge = lclLot ? lclLotFlag(item).label : null;

  return [
    scheduleLines.join('\n'),
    [
      item.customerName ?? '—',
      item.factoryNames && item.factoryNames.length > 0 ? item.factoryNames.join(' + ') : item.factoryName ?? '—',
      `${item.blNumber || item.bookingRef || '—'}${item.isAdHoc ? ' · Chạy ngoài' : ''}`,
    ].join('\n'),
    [
      item.routeName ?? '—',
      ...(lclLot
        ? []
        : [item.tradeDirection === 'IMPORT' ? 'Nhập' : item.tradeDirection === 'EXPORT' ? 'Xuất' : '—']),
      item.shippingLineName ?? '—',
    ].join('\n'),
    liftLines.join('\n'),
    dropLines.join('\n'),
    // The cargo cell carries the badge on top of the cargo lines — the same
    // order the board's Tổng quan hàng hóa cell shows.
    [lclBadge, ...cargoCellLines(item, scheduleDate).map((line) => line.text)]
      .filter((line): line is string => line != null && line !== '')
      .join('\n'),
    allocationLines(item).join('\n'),
    [
      displayNote(item.operationalNotes),
      ...(item.opsRecoveryNotes ?? []).map((note) => `OPS: ${note}`),
      item.factoryNotes ? `NM: ${item.factoryNotes}` : '',
    ].filter((line) => line.trim() !== '').join('\n'),
  ];
}

/** Collect + download the worksheet. Returns the exported lot count. */
export async function exportMasterPlanWorksheet(filters: MasterPlanFilters, scheduleDate?: string | null): Promise<number> {
  const exportItems = await collectMasterPlanExportItems(filters);
  await downloadCSV(
    `ke-hoach-tong-quat-${new Date().toISOString().slice(0, 10)}.xlsx`,
    [...MASTER_PLAN_EXPORT_HEADERS],
    exportItems.map((item) => mapMasterPlanExportRow(item, scheduleDate)),
    {
      title: 'Kế hoạch Tổng quát',
      subtitle: `${formatNumber(exportItems.length)} lô hàng`,
      columnTypes: MASTER_PLAN_EXPORT_HEADERS.map(() => 'text' as const),
      hideTotals: true,
    },
  );
  return exportItems.length;
}
