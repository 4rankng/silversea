import { TRIP_STATUS_LABELS, type TripDetail } from '@tingting/shared';
import { buildTripCode, type TripListRow, getTripDistance } from './tripHelpers';

export type TripExportFilters = {
  status?: string;
  truckId?: number;
  customerId?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

export interface TripExportOptions extends TripExportFilters {
  fetcher: (params: TripExportFilters) => Promise<{ items: TripDetail[]; total: number; pageSize: number }>;
}

const EXPORT_HEADERS = [
  'Mã', 'Khách hàng', 'Tuyến', 'Xe', 'Ngày khởi hành', 'KM',
  'Loại cont', 'Số cont', 'Dầu (L)', 'Nhà CC Dầu', 'Giá trị dầu',
  'Tổng đi đường', 'Doanh thu', 'Trạng thái',
];

const EXPORT_COLUMN_TYPES = [
  'text', 'text', 'text', 'text', 'date', 'km',
  'text', 'text', 'liters', 'text', 'currency',
  'currency', 'currency', 'text',
] as const;

/* Column indices (0-based) that should be summed in the totals row. */
const EXPORT_TOTALS_COLUMNS = [5, 8, 10, 11, 12]; // KM, Dầu (L), Giá trị dầu, Tổng đi đường, Doanh thu

export async function exportTripsToCSV(opts: TripExportOptions): Promise<void> {
  const commonParams: TripExportFilters = {
    status: opts.status,
    truckId: opts.truckId,
    customerId: opts.customerId,
    search: opts.search,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  };
  const first = await opts.fetcher({ ...commonParams });
  const allTrips = [...first.items];
  const totalPages = Math.ceil(first.total / first.pageSize);
  if (totalPages > 1) {
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, () =>
        opts.fetcher({ ...commonParams }).then((r) => r.items),
      ),
    );
    for (const items of remaining) allTrips.push(...items);
  }

  const rows = allTrips.map((t) => {
    const containers = (t as TripListRow).containers ?? [];
    const typeCodes = Array.from(new Set(containers.map((c) => c.containerTypeCode || c.containerTypeName).filter(Boolean))).join(', ');
    const numbers = containers.map((c) => c.containerNumber).join(', ');
    return [
      buildTripCode(t),
      t.customer?.name ?? '',
      t.route?.name ?? '',
      t.carrierType === 'EXTERNAL' ? (t.externalPlateNumber ?? 'Xe ngoài') : (t.truck?.licensePlate ?? ''),
      t.departureDate ?? '',
      getTripDistance(t) || '',
      typeCodes,
      numbers,
      t.fuelLiters ?? '',
      t.fuelSupplier?.name ?? '',
      t.totalFuelCost ?? '',
      (Number(t.totalRoadAllowance ?? 0) + Number(t.tollCost ?? 0)) || '',
      t.revenue ?? '',
      TRIP_STATUS_LABELS[t.status],
    ];
  });

  const { downloadCSV: downloadCSVFn } = await import('../../lib/csv');
  await downloadCSVFn(`so-chuyen-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, rows, {
    title: 'SỔ CHUYẾN ĐI',
    subtitle: subtitleParts(opts),
    columnTypes: [...EXPORT_COLUMN_TYPES],
    totalsColumns: EXPORT_TOTALS_COLUMNS,
    totalsLabel: 'TỔNG CỘNG',
  });
}

function subtitleParts(opts: TripExportOptions): string {
  const parts: string[] = [];
  if (opts.dateFrom && opts.dateTo) parts.push(`Từ ${opts.dateFrom} đến ${opts.dateTo}`);
  else if (opts.dateFrom) parts.push(`Từ ${opts.dateFrom}`);
  else if (opts.dateTo) parts.push(`Đến ${opts.dateTo}`);
  if (opts.status) parts.push(`Trạng thái: ${opts.status}`);
  if (opts.truckId) parts.push(`Xe: #${opts.truckId}`);
  if (opts.customerId) parts.push(`Khách hàng: #${opts.customerId}`);
  if (opts.search) parts.push(`Tìm kiếm: "${opts.search}"`);
  return parts.join(' · ') || 'Tất cả chuyến trong kỳ';
}
