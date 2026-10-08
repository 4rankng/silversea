import { and, eq, inArray, isNull, ne, gte, lte } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import {
  round2dp,
  type DailyFleetProductivityResponse,
  type DailyFleetTruckRow,
  type FleetProductivityBreakdown,
  type FleetProductivityClassification,
  type MonthlyFleetProductivityResponse,
  type MonthlyFleetTruckRow,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';

/** Classify a trip into one of the four operational productivity categories. */
export function classifyTripRun(row: {
  pairKind?: string | null;
  dispatchClassification?: string | null;
  fulfillmentType?: string | null;
}): FleetProductivityClassification {
  if (row.pairKind === 'KEP' || row.dispatchClassification === 'DOUBLE') {
    return 'KEP';
  }
  if (row.pairKind === 'KET_HOP' || row.dispatchClassification === 'COMBINED') {
    return 'KET_HOP';
  }
  if (
    row.dispatchClassification === 'LCL' ||
    row.dispatchClassification === 'LCL_PICKUP' ||
    row.fulfillmentType === 'LCL_SHIPMENT'
  ) {
    return 'LAY_LE';
  }
  return 'DON';
}

/** Compute breakdown and percentages with round2dp precision. */
export function computeProductivityBreakdown(
  categories: FleetProductivityClassification[]
): FleetProductivityBreakdown {
  const totalTrips = categories.length;
  let kepTrips = 0;
  let ketHopTrips = 0;
  let layLeTrips = 0;
  let donTrips = 0;

  for (const cat of categories) {
    if (cat === 'KEP') kepTrips++;
    else if (cat === 'KET_HOP') ketHopTrips++;
    else if (cat === 'LAY_LE') layLeTrips++;
    else donTrips++;
  }

  const pctKep = totalTrips > 0 ? round2dp((kepTrips / totalTrips) * 100) : 0;
  const pctKetHop = totalTrips > 0 ? round2dp((ketHopTrips / totalTrips) * 100) : 0;
  const pctLayLe = totalTrips > 0 ? round2dp((layLeTrips / totalTrips) * 100) : 0;
  const pctDon = totalTrips > 0 ? round2dp((donTrips / totalTrips) * 100) : 0;
  const highEfficiencyPct = round2dp(pctKep + pctKetHop + pctLayLe);

  return {
    totalTrips,
    kepTrips,
    ketHopTrips,
    layLeTrips,
    donTrips,
    pctKep,
    pctKetHop,
    pctLayLe,
    pctDon,
    highEfficiencyPct,
  };
}

/** Format year and month into padded YYYY-MM boundaries. */
function getMonthDateRange(year: number, month: number): { from: string; to: string } {
  const paddedMonth = String(month).padStart(2, '0');
  const from = `${year}-${paddedMonth}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const to = `${year}-${paddedMonth}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

/**
 * 1. Báo cáo Hiệu quả Năng suất của Toàn bộ xe nội bộ trong 1 ngày.
 */
export async function getDailyFleetProductivity(date: string): Promise<DailyFleetProductivityResponse> {
  const internalTrucks = await db
    .select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      driverName: s.users.fullName,
    })
    .from(s.trucks)
    .leftJoin(s.drivers, eq(s.drivers.assignedTruckId, s.trucks.id))
    .leftJoin(s.users, eq(s.drivers.userId, s.users.id))
    .where(and(isNull(s.trucks.carrierId), isNull(s.trucks.deletedAt)))
    .orderBy(s.trucks.licensePlate);

  const totalInternalTrucks = internalTrucks.length;
  if (totalInternalTrucks === 0) {
    const emptyBreakdown = computeProductivityBreakdown([]);
    return {
      date,
      totalInternalTrucks: 0,
      activeInternalTrucks: 0,
      fleetBreakdown: emptyBreakdown,
      trucks: [],
    };
  }

  const internalTruckIds = internalTrucks.map((t) => t.id);

  const trips = await db
    .select({
      tripId: s.trips.id,
      tripCode: s.trips.tripCode,
      truckId: s.trips.truckId,
      departureDate: s.trips.departureDate,
      activeTripPairId: s.trips.activeTripPairId,
      pairKind: s.tripPairs.pairKind,
      dispatchClassification: s.shipmentFulfillments.dispatchClassification,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
    })
    .from(s.trips)
    .leftJoin(s.tripPairs, eq(s.trips.activeTripPairId, s.tripPairs.id))
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .where(
      and(
        inArray(s.trips.truckId, internalTruckIds),
        eq(s.trips.departureDate, date),
        ne(s.trips.status, 'CANCELED')
      )
    );

  const tripsByTruck = new Map<number, Array<{ code: string; cat: FleetProductivityClassification }>>();
  const allFleetCategories: FleetProductivityClassification[] = [];

  for (const trip of trips) {
    if (!trip.truckId) continue;
    const cat = classifyTripRun({
      pairKind: trip.pairKind,
      dispatchClassification: trip.dispatchClassification,
      fulfillmentType: trip.fulfillmentType,
    });
    allFleetCategories.push(cat);

    const list = tripsByTruck.get(trip.truckId) ?? [];
    list.push({ code: trip.tripCode ?? `TRIP-${trip.tripId}`, cat });
    tripsByTruck.set(trip.truckId, list);
  }

  let activeInternalTrucks = 0;
  const truckRows: DailyFleetTruckRow[] = internalTrucks.map((t) => {
    const runs = tripsByTruck.get(t.id) ?? [];
    if (runs.length > 0) activeInternalTrucks++;
    const breakdown = computeProductivityBreakdown(runs.map((r) => r.cat));
    return {
      truckId: t.id,
      licensePlate: t.licensePlate,
      driverName: t.driverName ?? null,
      breakdown,
      tripCodes: runs.map((r) => r.code),
    };
  });

  // Sort: active trucks with higher trip count first, then by license plate
  truckRows.sort((a, b) => {
    if (b.breakdown.totalTrips !== a.breakdown.totalTrips) {
      return b.breakdown.totalTrips - a.breakdown.totalTrips;
    }
    return a.licensePlate.localeCompare(b.licensePlate);
  });

  const fleetBreakdown = computeProductivityBreakdown(allFleetCategories);

  return {
    date,
    totalInternalTrucks,
    activeInternalTrucks,
    fleetBreakdown,
    trucks: truckRows,
  };
}

/**
 * 2. Báo cáo Hiệu quả Năng suất của Từng xe nội bộ trong 1 tháng.
 */
export async function getMonthlyFleetProductivity(
  year: number,
  month: number,
  truckId?: number
): Promise<MonthlyFleetProductivityResponse> {
  const { from, to } = getMonthDateRange(year, month);

  const truckConditions = [isNull(s.trucks.carrierId), isNull(s.trucks.deletedAt)];
  if (truckId != null) {
    truckConditions.push(eq(s.trucks.id, truckId));
  }

  const internalTrucks = await db
    .select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      driverName: s.users.fullName,
    })
    .from(s.trucks)
    .leftJoin(s.drivers, eq(s.drivers.assignedTruckId, s.trucks.id))
    .leftJoin(s.users, eq(s.drivers.userId, s.users.id))
    .where(and(...truckConditions))
    .orderBy(s.trucks.licensePlate);

  const totalInternalTrucks = internalTrucks.length;
  if (totalInternalTrucks === 0) {
    const emptyBreakdown = computeProductivityBreakdown([]);
    return {
      year,
      month,
      totalInternalTrucks: 0,
      activeInternalTrucks: 0,
      fleetBreakdown: emptyBreakdown,
      trucks: [],
    };
  }

  const internalTruckIds = internalTrucks.map((t) => t.id);

  const trips = await db
    .select({
      tripId: s.trips.id,
      truckId: s.trips.truckId,
      departureDate: s.trips.departureDate,
      activeTripPairId: s.trips.activeTripPairId,
      pairKind: s.tripPairs.pairKind,
      dispatchClassification: s.shipmentFulfillments.dispatchClassification,
      fulfillmentType: s.shipmentFulfillments.fulfillmentType,
    })
    .from(s.trips)
    .leftJoin(s.tripPairs, eq(s.trips.activeTripPairId, s.tripPairs.id))
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .where(
      and(
        inArray(s.trips.truckId, internalTruckIds),
        gte(s.trips.departureDate, from),
        lte(s.trips.departureDate, to),
        ne(s.trips.status, 'CANCELED')
      )
    );

  const tripsByTruck = new Map<number, FleetProductivityClassification[]>();
  const allFleetCategories: FleetProductivityClassification[] = [];

  for (const trip of trips) {
    if (!trip.truckId) continue;
    const cat = classifyTripRun({
      pairKind: trip.pairKind,
      dispatchClassification: trip.dispatchClassification,
      fulfillmentType: trip.fulfillmentType,
    });
    allFleetCategories.push(cat);

    const list = tripsByTruck.get(trip.truckId) ?? [];
    list.push(cat);
    tripsByTruck.set(trip.truckId, list);
  }

  let activeInternalTrucks = 0;
  const truckRows: MonthlyFleetTruckRow[] = internalTrucks.map((t) => {
    const cats = tripsByTruck.get(t.id) ?? [];
    if (cats.length > 0) activeInternalTrucks++;
    const breakdown = computeProductivityBreakdown(cats);
    return {
      truckId: t.id,
      licensePlate: t.licensePlate,
      driverName: t.driverName ?? null,
      breakdown,
    };
  });

  // Sort by total trips descending, then highEfficiencyPct descending
  truckRows.sort((a, b) => {
    if (b.breakdown.totalTrips !== a.breakdown.totalTrips) {
      return b.breakdown.totalTrips - a.breakdown.totalTrips;
    }
    if (b.breakdown.highEfficiencyPct !== a.breakdown.highEfficiencyPct) {
      return b.breakdown.highEfficiencyPct - a.breakdown.highEfficiencyPct;
    }
    return a.licensePlate.localeCompare(b.licensePlate);
  });

  const fleetBreakdown = computeProductivityBreakdown(allFleetCategories);

  return {
    year,
    month,
    totalInternalTrucks,
    activeInternalTrucks,
    fleetBreakdown,
    trucks: truckRows,
  };
}

/**
 * 3. Xuất file Excel Báo cáo Năng suất Xe Nội bộ theo Tháng.
 */
export async function exportMonthlyFleetProductivityXlsx(year: number, month: number): Promise<Buffer> {
  const report = await getMonthlyFleetProductivity(year, month);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Năng suất ${month}-${year}`);

  // Header info
  sheet.addRow([`BÁO CÁO HIỆU QUẢ NĂNG SUẤT ĐỘI XE NỘI BỘ - THÁNG ${month}/${year}`]);
  sheet.addRow([
    `Kỳ báo cáo: Tháng ${month}/${year}`,
    '',
    `Tổng số xe: ${report.totalInternalTrucks} xe`,
    '',
    `Số xe hoạt động: ${report.activeInternalTrucks} xe`,
    '',
    `Tổng số chuyến: ${report.fleetBreakdown.totalTrips}`,
  ]);
  sheet.addRow([]);

  // Table header
  sheet.addRow([
    'STT',
    'Biển số xe',
    'Lái xe chính',
    'Tổng số chuyến',
    'Số chuyến Kẹp',
    '% Kẹp ghép',
    'Số chuyến Kết hợp',
    '% Kết hợp',
    'Số chuyến Lấy lẻ',
    '% Lấy lẻ chuyển kho',
    'Số chuyến Đơn',
    '% Chuyến đơn',
    '% Năng suất cao',
  ]);

  let idx = 1;
  for (const row of report.trucks) {
    sheet.addRow([
      idx++,
      row.licensePlate,
      row.driverName ?? 'Chưa gán',
      row.breakdown.totalTrips,
      row.breakdown.kepTrips,
      `${row.breakdown.pctKep}%`,
      row.breakdown.ketHopTrips,
      `${row.breakdown.pctKetHop}%`,
      row.breakdown.layLeTrips,
      `${row.breakdown.pctLayLe}%`,
      row.breakdown.donTrips,
      `${row.breakdown.pctDon}%`,
      `${row.breakdown.highEfficiencyPct}%`,
    ]);
  }

  // Footer summary
  sheet.addRow([
    'TỔNG CỘNG',
    '',
    '',
    report.fleetBreakdown.totalTrips,
    report.fleetBreakdown.kepTrips,
    `${report.fleetBreakdown.pctKep}%`,
    report.fleetBreakdown.ketHopTrips,
    `${report.fleetBreakdown.pctKetHop}%`,
    report.fleetBreakdown.layLeTrips,
    `${report.fleetBreakdown.pctLayLe}%`,
    report.fleetBreakdown.donTrips,
    `${report.fleetBreakdown.pctDon}%`,
    `${report.fleetBreakdown.highEfficiencyPct}%`,
  ]);

  // Styling
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.getRow(2).font = { italic: true };
  sheet.getRow(4).font = { bold: true };
  sheet.getRow(sheet.rowCount).font = { bold: true };

  const colWidths = [6, 16, 22, 16, 14, 14, 16, 14, 16, 18, 14, 14, 18];
  colWidths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
