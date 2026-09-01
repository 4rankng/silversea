// XLSX worksheet export for the CUS shipments workboard.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01
// structural split: paginated collection of every matching row (bypassing the
// board's 20-row page size) plus the seven-column worksheet mapping.

import {
  SHIPMENT_STATUS_LABELS,
  ShipmentCusBucket,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import { listCusShipmentWorkspace } from '../../../api/shipmentClient';
import { downloadCSV } from '../../../lib/csv';
import {
  cargoModeLabel,
  derivePrimaryShipmentSignal,
  directionLabel,
  formatDate,
  formatQuantity,
  vehicleReadinessLabel,
  worksheetQuantity,
} from './cusUtils';

/** Board filters that scope the export; pagination + sort are export-owned. */
export interface CusWorksheetFilters {
  searchSuffix?: string;
  transportDateFrom?: string;
  transportDateTo?: string;
  direction?: 'IMPORT' | 'EXPORT';
  bucket?: ShipmentCusBucket;
}

const EXPORT_PAGE_SIZE = 100;

const CUS_WORKSHEET_HEADERS = [
  'Khách hàng & nhà máy',
  'Chứng từ',
  'Phân loại & hãng tàu',
  'Tổng quan hàng hóa',
  'Lịch trình & điều xe',
  'Ghi chú',
  'Trạng thái',
] as const;

/** Walk every page of the filtered workspace (100 rows per request). */
export async function collectCusWorksheetItems(filters: CusWorksheetFilters): Promise<ShipmentCusWorkspaceListItem[]> {
  const exportItems: ShipmentCusWorkspaceListItem[] = [];
  let exportPage = 1;
  let exportTotalPages = 1;
  do {
    const response = await listCusShipmentWorkspace({
      page: exportPage,
      limit: EXPORT_PAGE_SIZE,
      searchSuffix: filters.searchSuffix || undefined,
      transportDateFrom: filters.transportDateFrom || undefined,
      transportDateTo: filters.transportDateTo || undefined,
      direction: filters.direction || undefined,
      bucket: filters.bucket || undefined,
    });
    exportItems.push(...response.items);
    exportTotalPages = response.totalPages;
    exportPage += 1;
  } while (exportPage <= exportTotalPages);
  return exportItems;
}

/** Map one row to the worksheet's seven multi-line columns. */
export function mapCusWorksheetRow(item: ShipmentCusWorkspaceListItem): string[] {
  return [
    [item.customerName ?? '—', item.effectiveFactoryNames.length > 0 ? item.effectiveFactoryNames.join(' + ') : item.factoryName ?? '', item.routeName ?? item.deliveryLocation ?? ''].filter(Boolean).join('\n'),
    [item.billOrBookNumber ?? '', item.declarationNumber ?? ''].filter(Boolean).join('\n'),
    [directionLabel(item.direction), item.shippingLineName ?? '', item.isCombined ? 'Đóng kết hợp' : ''].filter(Boolean).join('\n'),
    [cargoModeLabel(item.cargoMode), item.containerSummary || worksheetQuantity(item), item.weightKg != null ? `${formatQuantity(item.weightKg)} kg` : '', item.volumeCbm ? `${formatQuantity(item.volumeCbm)} CBM` : ''].filter(Boolean).join('\n'),
    [item.transportDate ? formatDate(item.transportDate) : 'Chưa chốt ngày', vehicleReadinessLabel(item)].filter(Boolean).join('\n'),
    [item.customerNotes ?? '', item.operationalNotes ?? ''].filter((line) => line.trim() !== '').join('\n'),
    [item.bucket === ShipmentCusBucket.NEW ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel, derivePrimaryShipmentSignal(item)?.label ?? ''].filter(Boolean).join('\n'),
  ];
}

/** Collect + download the worksheet. Returns the exported row count. */
export async function exportCusWorksheet(filters: CusWorksheetFilters): Promise<number> {
  const exportItems = await collectCusWorksheetItems(filters);
  await downloadCSV(
    `ke-hoach-lo-hang-${new Date().toISOString().slice(0, 10)}.xlsx`,
    [...CUS_WORKSHEET_HEADERS],
    exportItems.map(mapCusWorksheetRow),
    {
      title: 'Tổng quan lô hàng',
      subtitle: `${exportItems.length.toLocaleString('vi-VN')} lô hàng`,
      columnTypes: ['text', 'text', 'text', 'text', 'text', 'text', 'text'],
      hideTotals: true,
    },
  );
  return exportItems.length;
}
