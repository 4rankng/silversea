import { createHash } from 'node:crypto';
import { and, desc, eq, gt, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { recordedTripRevenue, getPnlReport } from './pnl.service';
import { resolveFinancialReportingPolicyForMonth } from './financial-reporting-policy.service';

export const PROFITABILITY_DIMENSIONS = [
  'CUSTOMER', 'ROUTE', 'TRUCK', 'DISPATCHER', 'SALESPERSON', 'MONTH', 'YEAR', 'CONTAINER',
] as const;
export type ProfitabilityDimension = typeof PROFITABILITY_DIMENSIONS[number];
export type LowMarginState = 'LOW_MARGIN' | 'OK' | 'UNCONFIGURED' | 'NOT_COMPARABLE';
const MAX_PROFITABILITY_GROUPS = 5_000;

export function classifyLowMargin(input: {
  revenue: number;
  profit: number;
  thresholdRatio: number | null;
}): { marginRatio: number | null; alertState: LowMarginState } {
  if (!Number.isFinite(input.revenue) || input.revenue <= 0) {
    return { marginRatio: null, alertState: 'NOT_COMPARABLE' };
  }
  const marginRatio = input.profit / input.revenue;
  if (input.thresholdRatio == null) return { marginRatio, alertState: 'UNCONFIGURED' };
  return {
    marginRatio,
    alertState: marginRatio < input.thresholdRatio ? 'LOW_MARGIN' : 'OK',
  };
}

function vietnamBusinessDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

type DimensionInput = {
  dimension: ProfitabilityDimension;
  key: string | number | null;
  label: string | null;
  metadata?: Record<string, unknown>;
};

export function buildProfitabilityAttributionSnapshot(input: {
  completedBusinessDate: string;
  customer: { id: number; name: string };
  route: { id: number; name: string };
  truck: { id: string | number; name: string } | null;
  dispatcher: { id: number; name: string } | null;
  salesperson: { id: number; name: string } | null;
  container: { id: string | number; name: string } | null;
}): Array<DimensionInput & { attributionStatus: 'ATTRIBUTED' | 'MISSING' }> {
  const month = input.completedBusinessDate.slice(0, 7);
  const year = input.completedBusinessDate.slice(0, 4);
  const dimension = (
    name: ProfitabilityDimension,
    value: { id: string | number; name: string } | null,
    metadata: Record<string, unknown> = {},
  ) => ({
    dimension: name,
    key: value == null ? 'MISSING_ATTRIBUTION' : String(value.id),
    label: value == null ? 'Thiếu phân bổ' : value.name,
    attributionStatus: value == null ? 'MISSING' as const : 'ATTRIBUTED' as const,
    metadata,
  });
  return [
    dimension('CUSTOMER', input.customer),
    dimension('ROUTE', input.route),
    dimension('TRUCK', input.truck),
    dimension('DISPATCHER', input.dispatcher),
    dimension('SALESPERSON', input.salesperson),
    dimension('MONTH', { id: month, name: month }),
    dimension('YEAR', { id: year, name: year }),
    dimension('CONTAINER', input.container),
  ];
}

/** Captures immutable money and all eight attribution dimensions for one posting. */
export async function captureProfitabilityAttributionSnapshot(
  tx: Tx,
  tripId: number,
  financialPostingId: number,
) {
  const [existing] = await tx.select().from(s.profitabilitySnapshots)
    .where(eq(s.profitabilitySnapshots.financialPostingId, financialPostingId)).limit(1);
  if (existing) return existing;

  const [trip] = await tx.select({
    id: s.trips.id,
    shipmentId: s.trips.shipmentId,
    customerId: s.trips.customerId,
    customerName: s.customers.name,
    routeId: s.trips.routeId,
    routeName: s.routes.name,
    truckId: s.trips.truckId,
    truckPlate: s.trucks.licensePlate,
    carrierType: s.trips.carrierType,
    externalPlate: s.trips.externalPlateNumber,
    completedAt: s.trips.completedAt,
    revenue: s.trips.revenue,
    vatRate: s.trips.vatRate,
    customerCommission: s.trips.customerCommission,
    totalCost: s.trips.totalCost,
    externalFreightCost: s.trips.externalFreightCost,
  }).from(s.trips)
    .innerJoin(s.customers, eq(s.customers.id, s.trips.customerId))
    .innerJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .where(eq(s.trips.id, tripId)).limit(1);
  if (!trip?.completedAt) throw new ApiError(409, 'Chuyến chưa có ngày hoàn thành để chụp lợi nhuận');

  const effectiveAt = trip.completedAt;
  const [dispatcher] = trip.shipmentId == null ? [] : await tx.select({
    id: s.users.id,
    name: s.users.fullName,
    username: s.users.username,
  }).from(s.dispatchHandoffs)
    .innerJoin(s.users, eq(s.users.id, s.dispatchHandoffs.acceptedBy))
    .where(and(
      eq(s.dispatchHandoffs.shipmentId, trip.shipmentId),
      eq(s.dispatchHandoffs.status, 'ACCEPTED'),
      lte(s.dispatchHandoffs.resolvedAt, effectiveAt),
    ))
    .orderBy(desc(s.dispatchHandoffs.resolvedAt), desc(s.dispatchHandoffs.id)).limit(1);

  const salespersonRows = await tx.select({
    id: s.users.id,
    name: s.users.fullName,
    username: s.users.username,
    shipmentId: s.salespersonAssignments.shipmentId,
  }).from(s.salespersonAssignments)
    .innerJoin(s.users, eq(s.users.id, s.salespersonAssignments.salespersonUserId))
    .where(and(
      eq(s.salespersonAssignments.customerId, trip.customerId),
      trip.shipmentId == null
        ? isNull(s.salespersonAssignments.shipmentId)
        : or(eq(s.salespersonAssignments.shipmentId, trip.shipmentId), isNull(s.salespersonAssignments.shipmentId)),
      lte(s.salespersonAssignments.effectiveFrom, effectiveAt),
      or(isNull(s.salespersonAssignments.effectiveTo), gt(s.salespersonAssignments.effectiveTo, effectiveAt)),
    ))
    .orderBy(sql`${s.salespersonAssignments.shipmentId} is not null desc`, desc(s.salespersonAssignments.version))
    .limit(1);
  const salesperson = salespersonRows[0];

  const containers = trip.shipmentId == null ? [] : await tx.select({
    id: s.shipmentContainers.id,
    containerNumber: s.shipmentContainers.containerNumber,
  }).from(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, trip.shipmentId));
  // Trip-level money cannot be divided over multiple containers without a
  // direct financial line. Only a single-container shipment is attributable.
  const container = containers.length === 1 && containers[0].containerNumber
    ? { id: containers[0].id, name: containers[0].containerNumber }
    : null;
  const truck = trip.carrierType === 'EXTERNAL'
    ? (trip.externalPlate ? { id: `EXTERNAL:${trip.externalPlate}`, name: trip.externalPlate } : null)
    : (trip.truckId && trip.truckPlate ? { id: trip.truckId, name: trip.truckPlate } : null);
  const completedBusinessDate = vietnamBusinessDate(effectiveAt);
  const dimensions = buildProfitabilityAttributionSnapshot({
    completedBusinessDate,
    customer: { id: trip.customerId, name: trip.customerName },
    route: { id: trip.routeId, name: trip.routeName },
    truck,
    dispatcher: dispatcher ? { id: dispatcher.id, name: dispatcher.name || 'Nhân viên điều hành' } : null,
    salesperson: salesperson ? { id: salesperson.id, name: salesperson.name || 'Nhân viên kinh doanh' } : null,
    container,
  });
  const revenue = recordedTripRevenue(trip);
  const directCost = trip.carrierType === 'EXTERNAL'
    ? Number(trip.externalFreightCost ?? 0)
    : Number(trip.totalCost ?? 0);
  const missingCount = dimensions.filter(item => item.attributionStatus === 'MISSING').length;
  const [snapshot] = await tx.insert(s.profitabilitySnapshots).values({
    financialPostingId,
    tripId,
    shipmentId: trip.shipmentId,
    completedBusinessDate,
    revenue: String(revenue),
    directCost: String(directCost),
    sharedOverhead: '0',
    profit: String(revenue - directCost),
    attributionStatus: missingCount === 0 ? 'COMPLETE' : 'MISSING_ATTRIBUTION',
  }).returning();
  await tx.insert(s.profitabilitySnapshotDimensions).values(dimensions.map(item => ({
    snapshotId: snapshot.id,
    dimension: item.dimension,
    dimensionKey: String(item.key),
    dimensionLabel: item.label ?? 'Thiếu phân bổ',
    attributionStatus: item.attributionStatus,
    metadata: item.metadata ?? {},
  })));
  return snapshot;
}

export async function getProfitabilityReport(input: {
  month: number;
  year: number;
  dimension: ProfitabilityDimension | 'VEHICLE';
  page?: number;
  limit?: number;
  lowMarginOnly?: boolean;
  /** Internal export override; HTTP callers remain capped by route pagination. */
  internalLimit?: number;
}, q: typeof db | Tx = db) {
  const dimension = input.dimension === 'VEHICLE' ? 'TRUCK' : input.dimension;
  if (!PROFITABILITY_DIMENSIONS.includes(dimension)) throw new ApiError(400, 'Chiều báo cáo lợi nhuận không hợp lệ');
  const page = Math.max(1, input.page ?? 1);
  const maximumLimit = input.internalLimit ?? 100;
  const limit = Math.min(maximumLimit, Math.max(1, input.limit ?? 50));
  const start = `${input.year}-${String(input.month).padStart(2, '0')}-01`;
  const nextMonth = input.month === 12 ? 1 : input.month + 1;
  const nextYear = input.month === 12 ? input.year + 1 : input.year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  const policy = await resolveFinancialReportingPolicyForMonth({ month: input.month, year: input.year }, q);
  const thresholdRatio = policy.lowMarginThresholdRatio;
  const reportScope = and(
    eq(s.profitabilitySnapshotDimensions.dimension, dimension),
    gte(s.profitabilitySnapshots.completedBusinessDate, start),
    lt(s.profitabilitySnapshots.completedBusinessDate, end),
  );
  const groupedRows = await q.select({
    key: s.profitabilitySnapshotDimensions.dimensionKey,
    label: s.profitabilitySnapshotDimensions.dimensionLabel,
    attributionStatus: s.profitabilitySnapshotDimensions.attributionStatus,
    revenue: sql<string>`sum(${s.profitabilitySnapshots.revenue}::numeric)`,
    directCost: sql<string>`sum(${s.profitabilitySnapshots.directCost}::numeric)`,
    sharedOverhead: sql<string>`sum(${s.profitabilitySnapshots.sharedOverhead}::numeric)`,
    profit: sql<string>`sum(${s.profitabilitySnapshots.profit}::numeric)`,
    tripCount: sql<number>`count(*)`,
    tripIds: sql<number[]>`array_agg(distinct ${s.profitabilitySnapshots.tripId})`,
  }).from(s.profitabilitySnapshots)
    .innerJoin(s.profitabilitySnapshotDimensions, eq(s.profitabilitySnapshotDimensions.snapshotId, s.profitabilitySnapshots.id))
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.id, s.profitabilitySnapshots.financialPostingId),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .where(reportScope)
    .groupBy(
      s.profitabilitySnapshotDimensions.dimensionKey,
      s.profitabilitySnapshotDimensions.dimensionLabel,
      s.profitabilitySnapshotDimensions.attributionStatus,
    )
    .limit(MAX_PROFITABILITY_GROUPS + 1);
  if (groupedRows.length > MAX_PROFITABILITY_GROUPS) {
    throw new ApiError(409, `Báo cáo vượt quá ${MAX_PROFITABILITY_GROUPS.toLocaleString('vi-VN')} nhóm. Vui lòng thu hẹp kỳ hoặc chiều phân tích.`);
  }
  const [aggregate] = await q.select({
    revenue: sql<string>`coalesce(sum(${s.profitabilitySnapshots.revenue}::numeric), 0)`,
    directCost: sql<string>`coalesce(sum(${s.profitabilitySnapshots.directCost}::numeric), 0)`,
    sharedOverhead: sql<string>`coalesce(sum(${s.profitabilitySnapshots.sharedOverhead}::numeric), 0)`,
    profit: sql<string>`coalesce(sum(${s.profitabilitySnapshots.profit}::numeric), 0)`,
    snapshottedTrips: sql<number>`count(distinct ${s.profitabilitySnapshots.id})`,
    missingAttribution: sql<number>`count(distinct case when ${s.profitabilitySnapshotDimensions.attributionStatus} = 'MISSING' then ${s.profitabilitySnapshots.id} end)`,
    totalGroups: sql<number>`count(distinct (${s.profitabilitySnapshotDimensions.dimensionKey}, ${s.profitabilitySnapshotDimensions.dimensionLabel}, ${s.profitabilitySnapshotDimensions.attributionStatus}))`,
  }).from(s.profitabilitySnapshots)
    .innerJoin(s.profitabilitySnapshotDimensions, eq(s.profitabilitySnapshotDimensions.snapshotId, s.profitabilitySnapshots.id))
    .innerJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.id, s.profitabilitySnapshots.financialPostingId),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    ))
    .where(reportScope);
  const pnl = await getPnlReport(input.month, input.year, q);
  const fleetAllocationByTrip = new Map(
    pnl.tripDetails.map((trip) => [trip.id, Number(trip.allocatedFleetFixedCost ?? 0)]),
  );
  const projectedRows = groupedRows.map((row) => {
    const allocatedFleetFixedCost = row.tripIds.reduce(
      (sum, tripId) => sum + (fleetAllocationByTrip.get(Number(tripId)) ?? 0),
      0,
    );
    const revenue = Number(row.revenue);
    const directCost = Number(row.directCost);
    const sharedOverhead = Number(row.sharedOverhead) + allocatedFleetFixedCost;
    const profit = Number(row.profit) - allocatedFleetFixedCost;
    return {
      key: row.key,
      label: row.label,
      attributionStatus: row.attributionStatus,
      revenue,
      directCost,
      sharedOverhead,
      allocatedFleetFixedCost,
      profit,
      tripCount: Number(row.tripCount),
      sourceTripIds: row.tripIds.map(Number).sort((a, b) => a - b).slice(0, 20),
      ...classifyLowMargin({ revenue, profit, thresholdRatio }),
      attributionNote: row.attributionStatus === 'MISSING'
        ? 'Thiếu chiều phân bổ nguồn; số liệu vẫn giữ đúng chuyến và chi phí đội xe đã phân bổ.'
        : 'Biên lợi nhuận gồm chi phí trực tiếp và chi phí đội xe được phân bổ theo doanh thu chuyến đã ghi nhận.',
    };
  }).sort((a, b) => (
    b.profit - a.profit
    || String(a.key).localeCompare(String(b.key))
    || String(a.label).localeCompare(String(b.label))
    || String(a.attributionStatus).localeCompare(String(b.attributionStatus))
  ));
  const filteredRows = input.lowMarginOnly
    ? (thresholdRatio == null ? [] : projectedRows.filter((row) => row.alertState === 'LOW_MARGIN'))
    : projectedRows;
  const rows = filteredRows.slice((page - 1) * limit, page * limit);
  const allocatedFleetFixedCost = projectedRows.reduce((sum, row) => sum + row.allocatedFleetFixedCost, 0);
  const totals = {
    revenue: Number(aggregate?.revenue ?? 0),
    directCost: Number(aggregate?.directCost ?? 0),
    sharedOverhead: Number(aggregate?.sharedOverhead ?? 0) + allocatedFleetFixedCost,
    profit: Number(aggregate?.profit ?? 0) - allocatedFleetFixedCost,
  };
  const totalGroups = filteredRows.length;
  const unallocatedSharedOverhead = Number(pnl.maintenanceExpensesTotal ?? 0)
    + Number(pnl.companyExpenses ?? 0)
    + Number(pnl.unallocatedFleetFixedCostTotal ?? 0);
  const otherIncome = Number(pnl.otherIncome ?? 0);
  const reportedNetProfit = totals.profit - unallocatedSharedOverhead + otherIncome;
  const expectedNetProfit = Number(pnl.netProfit);
  const payload = {
    requestedPeriod: { month: input.month, year: input.year },
    resolvedPeriod: { start, endExclusive: end },
    dimension: input.dimension,
    page,
    limit,
    totalGroups,
    totalPages: Math.max(1, Math.ceil(totalGroups / limit)),
    items: rows,
    totals,
    lowMarginPolicy: {
      status: policy.status,
      source: policy.source,
      policyVersionId: policy.policyVersionId,
      publicVersion: policy.publicVersion,
      effectiveFrom: policy.effectiveFrom,
      thresholdRatio,
      thresholdPercent: policy.lowMarginThresholdPercent,
      filter: input.lowMarginOnly ? 'LOW_MARGIN' : 'ALL',
      totals: classifyLowMargin({
        revenue: totals.revenue,
        profit: totals.profit,
        thresholdRatio,
      }),
      note: policy.status === 'UNCONFIGURED'
        ? 'Chưa cấu hình ngưỡng cảnh báo biên lợi nhuận cho kỳ báo cáo.'
        : 'Cảnh báo chỉ phân loại báo cáo; không thay đổi doanh thu, chi phí hoặc lợi nhuận đã ghi nhận.',
    },
    unallocated: {
      key: 'SHARED_OVERHEAD',
      label: 'Chi phí dùng chung chưa phân bổ',
      amount: unallocatedSharedOverhead,
      otherIncome,
      components: {
        maintenance: Number(pnl.maintenanceExpensesTotal ?? 0),
        companyExpenses: Number(pnl.companyExpenses ?? 0),
        fleetFixedCost: Number(pnl.unallocatedFleetFixedCostTotal ?? 0),
      },
    },
    sourceCoverage: {
      snapshottedTrips: Number(aggregate?.snapshottedTrips ?? 0),
      pnlTrips: pnl.tripCount,
      missingAttribution: Number(aggregate?.missingAttribution ?? 0),
    },
    reconciliation: {
      expectedNetProfit,
      reportedNetProfit,
      difference: reportedNetProfit - expectedNetProfit,
      status: Math.abs(reportedNetProfit - expectedNetProfit) <= 1 ? 'RECONCILED' : 'PARTIAL',
      note: 'Chi phí đội xe phân bổ theo doanh thu chuyến nằm trong từng nhóm; phần chưa phân bổ, bảo dưỡng và chi phí công ty được giữ riêng.',
    },
  };
  const definitionVersion = 'profitability-v4';
  return {
    ...payload,
    asOf: new Date().toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
    definitionVersion,
    consistency: 'BEST_EFFORT' as const,
    checksum: createHash('sha256')
      .update(JSON.stringify({ definitionVersion, payload }))
      .digest('hex'),
  };
}

export async function exportProfitabilityReport(input: {
  month: number;
  year: number;
  dimension: ProfitabilityDimension | 'VEHICLE';
  lowMarginOnly?: boolean;
}): Promise<Buffer> {
  const first = await db.transaction(async (tx) => getProfitabilityReport({
      ...input,
      page: 1,
      limit: MAX_PROFITABILITY_GROUPS,
      internalLimit: MAX_PROFITABILITY_GROUPS,
    }, tx), { isolationLevel: 'repeatable read', accessMode: 'read only' });
  const items = first.items;

  const ExcelJSModule = await import('exceljs');
  const ExcelJS = (ExcelJSModule as unknown as { default?: typeof ExcelJSModule }).default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lợi nhuận');
  sheet.columns = [
    { header: 'Nhóm phân tích', key: 'label', width: 28 },
    { header: 'Số chuyến', key: 'tripCount', width: 14 },
    { header: 'Mã chuyến nguồn', key: 'sourceTripIds', width: 28 },
    { header: 'Doanh thu', key: 'revenue', width: 20 },
    { header: 'Chi phí trực tiếp', key: 'directCost', width: 20 },
    { header: 'Chi phí đội xe phân bổ', key: 'allocatedFleetFixedCost', width: 22 },
    { header: 'Lợi nhuận', key: 'profit', width: 20 },
    { header: 'Biên lợi nhuận', key: 'marginRatio', width: 18 },
    { header: 'Phân loại cảnh báo', key: 'alertState', width: 24 },
    { header: 'Tình trạng phân bổ', key: 'attributionStatus', width: 22 },
    { header: 'Ghi chú nguồn', key: 'attributionNote', width: 48 },
  ];
  for (const item of items) {
    sheet.addRow({
      label: item.label ?? 'Thiếu phân bổ',
      tripCount: item.tripCount,
      sourceTripIds: item.sourceTripIds.join(', '),
      revenue: Number(item.revenue),
      directCost: Number(item.directCost),
      allocatedFleetFixedCost: item.allocatedFleetFixedCost,
      profit: Number(item.profit),
      marginRatio: item.marginRatio,
      alertState: ({
        LOW_MARGIN: 'Biên lợi nhuận thấp',
        OK: 'Đạt ngưỡng',
        UNCONFIGURED: 'Chưa cấu hình ngưỡng',
        NOT_COMPARABLE: 'Không thể so sánh',
      } as const)[item.alertState],
      attributionStatus: item.attributionStatus === 'MISSING' ? 'Thiếu phân bổ' : 'Đã phân bổ',
      attributionNote: item.attributionNote,
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn('revenue').numFmt = '#,##0';
  sheet.getColumn('directCost').numFmt = '#,##0';
  sheet.getColumn('allocatedFleetFixedCost').numFmt = '#,##0';
  sheet.getColumn('profit').numFmt = '#,##0';
  sheet.getColumn('marginRatio').numFmt = '0.0%';
  sheet.addRow([]);
  sheet.addRow(['Ngưỡng cảnh báo', first.lowMarginPolicy.thresholdRatio]);
  sheet.addRow(['Phiên bản chính sách', first.lowMarginPolicy.publicVersion ?? 'Chưa cấu hình']);
  sheet.addRow(['Phiên bản định nghĩa', first.definitionVersion]);
  sheet.addRow(['Thời điểm dữ liệu', first.asOf]);
  sheet.addRow(['Mã đối chiếu', first.checksum]);
  sheet.addRow(['Ghi chú', first.lowMarginPolicy.note]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
