/** Card 20260921_12 — Bảng kiểm soát phơi phiếu / tiền đường (accountant).
 *  Row grain = the trip (one phơi event). Chi hộ sums read the SAME
 *  expense_accounting_sources rows the consolidated voucher consumes, so the
 *  board total and the phiếu total match to the đồng by construction (AC5).
 *  The consolidated phiếu reuses createExpenseVoucher: one call posts ONE
 *  treasury movement against the chosen STK — the quỹ ledger adjusts through
 *  the existing engine (card 9 owns the nguồn-quỹ dimension on top). */
import { aliasedTable, and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import { hydrateExpenseAccountingSource } from './expense-accounting-source.service';
import { createExpenseVoucher, getExpenseCashTotals } from './expense-accounting-voucher.service';
import { expenseVndSchema, TripStatus } from '@tingting/shared';
void expenseVndSchema;

type Executor = Tx | typeof db;

const liftPort = aliasedTable(s.ports, 'lift_port');
const dropPort = aliasedTable(s.ports, 'drop_port');

export interface PhoiPhieuRow {
  tripId: number;
  tripCode: string | null;
  shipmentId: number;
  shipmentCode: string | null;
  billOrBooking: string | null;
  customerName: string | null;
  routeName: string | null;
  containerNumber: string | null;
  containerTypeLabel: string | null;
  liftSite: string | null;
  dropSite: string | null;
  plateNumber: string | null;
  driverName: string | null;
  departureDate: string | null;
  tripStatus: string | null;
  /** Chi hộ Phải trả = what SS pays the field (Σ source amount). */
  chiHoTra: number | null;
  /** Chi hộ Phải thu = what is collected from the customer (Σ charges). */
  chiHoThu: number | null;
  tienDuong: number | null;
  cusDispatchNotes: string[];
  driverNote: string | null;
  confirmable: boolean;
  openSources: Array<{ sourceId: number; expectedVersion: number; remaining: number }>;
}

function billOrBookingOf(direction: string | null, bl: string | null, booking: string | null): string | null {
  if (direction === 'IMPORT') return bl ?? booking;
  if (direction === 'EXPORT') return booking ?? bl;
  return bl ?? booking;
}

export async function listPhoiPhieuRows(query: {
  dateFrom?: string; dateTo?: string; status?: string; search?: string;
}): Promise<PhoiPhieuRow[]> {
  const tripConditions: SQL[] = [isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')];
  if (query.dateFrom) tripConditions.push(gte(s.trips.departureDate, query.dateFrom));
  if (query.dateTo) tripConditions.push(lte(s.trips.departureDate, query.dateTo));
  if (query.status) tripConditions.push(eq(s.trips.status, query.status as TripStatus));
  const search = query.search?.trim();
  if (search) {
    const needle = `%${search}%`;
    tripConditions.push(or(
      ilike(s.trips.tripCode, needle),
      ilike(s.shipmentContainers.containerNumber, needle),
      ilike(s.customers.name, needle),
    )!);
  }

  const rows = await db.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    departureDate: s.trips.departureDate,
    tripStatus: s.trips.status,
    tienDuong: s.tripFinancialState.totalRoadAllowance,
    tripNotes: s.trips.notes,
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    customerName: s.customers.name,
    customerNote: s.shipments.customerNotes,
    operationalNotes: s.shipments.operationalNotes,
    routeName: s.routes.name,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeLabel: s.containerTypes.name,
    liftSite: liftPort.name,
    dropSite: dropPort.name,
    plateNumber: s.trucks.licensePlate,
    driverName: s.drivers.name,
  })
    .from(s.trips)
    .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(s.routes, eq(s.routes.id, s.trips.routeId))
    .leftJoin(s.tripFinancialState, eq(s.tripFinancialState.tripId, s.trips.id))
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id,
      sql`(select fc.shipment_container_id from shipment_fulfillments fc where fc.id = ${s.trips.fulfillmentId} limit 1)`))
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .leftJoin(aliasedTable(s.ports, 'lift_port'), eq(liftPort.id, s.shipmentContainers.pickupPortId))
    .leftJoin(aliasedTable(s.ports, 'drop_port'), eq(dropPort.id, s.shipmentContainers.dropoffPortId))
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
    .where(and(...tripConditions))
    .orderBy(desc(s.trips.departureDate), desc(s.trips.id))
    .limit(300);
  if (rows.length === 0) return [];

  const shipmentIds = [...new Set(rows.map((row) => row.shipmentId))];
  const tripIds = rows.map((row) => row.tripId);

  // Chi hộ sums + open sources per shipment: the SAME rows the voucher reads.
  const sources = await db.select({
    id: s.expenseAccountingSources.id,
    shipmentId: s.expenseAccountingSources.shipmentId,
    version: s.expenseAccountingSources.version,
    confirmedAt: s.expenseAccountingSources.confirmedAt,
    allocatedAdvanceAmount: s.expenseAccountingSources.allocatedAdvanceAmount,
    amount: s.opsExpenseEntries.amount,
    customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
  })
    .from(s.expenseAccountingSources)
    .innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.expenseAccountingSources.sourceId))
    .where(and(inArray(s.expenseAccountingSources.shipmentId, shipmentIds),
      eq(s.expenseAccountingSources.status, 'RECORDED'), eq(s.expenseAccountingSources.sourceKind, 'OPS')));
  const dispatchNotes = await loadDispatchExpenseNotes(shipmentIds);
  const shipDispatchNotes = dispatchNotes;

  // Driver notes: latest NOTE progress event per trip.
  const driverNotes = await db.select({ tripId: s.driverProgressEvents.tripId, note: s.driverProgressEvents.note, createdAt: s.driverProgressEvents.createdAt })
    .from(s.driverProgressEvents)
    .where(and(inArray(s.driverProgressEvents.tripId, tripIds), eq(s.driverProgressEvents.eventType, 'NOTE')))
    .orderBy(desc(s.driverProgressEvents.createdAt));

  const byShipment = new Map<number, typeof sources>();
  for (const source of sources) {
    const bucket = byShipment.get(source.shipmentId) ?? [];
    bucket.push(source);
    byShipment.set(source.shipmentId, bucket);
  }
  void shipDispatchNotes;
  const noteByTrip = new Map<number, string>();
  for (const event of driverNotes) {
    if (!noteByTrip.has(event.tripId) && event.note) noteByTrip.set(event.tripId, event.note);
  }

  const out: PhoiPhieuRow[] = [];
  for (const row of rows) {
    const shipmentSources = byShipment.get(row.shipmentId) ?? [];
    const chiHoTra = shipmentSources.length ? shipmentSources.reduce((sum, source) => sum + Number(source.amount ?? 0), 0) : null;
    const chiHoThu = shipmentSources.length
      ? shipmentSources.reduce((sum, source) => sum + Number(source.customerChargeAmount ?? 0), 0)
      : null;
    const openSources: PhoiPhieuRow['openSources'] = [];
    for (const source of shipmentSources) {
      if (!source.confirmedAt) continue;
      const remaining = Number(source.amount ?? 0) - Number(source.allocatedAdvanceAmount ?? 0);
      if (remaining > 0) openSources.push({ sourceId: source.id, expectedVersion: source.version, remaining });
    }
    const cusDispatchNotes = [row.customerNote, row.operationalNotes, ...(shipDispatchNotes.get(row.shipmentId) ?? [])]
      .filter((value): value is string => Boolean(value && value.trim()));
    const dropName = row.dropSite;
    out.push({
      tripId: row.tripId,
      tripCode: row.tripCode,
      shipmentId: row.shipmentId,
      shipmentCode: row.shipmentCode,
      billOrBooking: billOrBookingOf(row.tradeDirection, row.blNumber, row.bookingRef),
      customerName: row.customerName,
      routeName: row.routeName,
      containerNumber: row.containerNumber,
      containerTypeLabel: row.containerTypeLabel,
      liftSite: row.liftSite,
      dropSite: row.dropSite,
      plateNumber: row.plateNumber,
      driverName: row.driverName,
      departureDate: row.departureDate,
      tripStatus: row.tripStatus,
      chiHoTra,
      chiHoThu,
      tienDuong: row.tienDuong == null ? null : Number(row.tienDuong),
      cusDispatchNotes,
      driverNote: noteByTrip.get(row.tripId) ?? row.tripNotes ?? null,
      confirmable: openSources.length > 0,
      openSources,
    });
  }
  return out;
}


export interface PhoiPhieuVoucherInput {
  tripIds: number[];
  direction: 'IN' | 'OUT';
  treasuryAccountId: number;
  physicalReference?: string;
  actor: AuthUser;
}

/** Consolidated phiếu: one createExpenseVoucher call over every open OPS
 *  source of the selected trips — ONE treasury movement adjusts the quỹ. */
export async function createPhoiPhieuVoucher(args: PhoiPhieuVoucherInput): Promise<{ voucherId: number; code: string; total: number; entries: number }> {
  if (!Array.isArray(args.tripIds) || args.tripIds.length === 0) {
    throw new ApiError(400, 'Chưa chọn dòng nào để lập phiếu.');
  }
  return db.transaction(async (tx) => {
    const tripRows = await tx.select({
      tripId: s.trips.id,
      shipmentId: s.trips.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
    })
      .from(s.trips)
      .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .where(and(inArray(s.trips.id, args.tripIds), isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')));
    if (tripRows.length !== args.tripIds.length) throw new ApiError(404, 'Có chuyến không còn hợp lệ.');
    const shipmentIds = tripRows.map((row) => row.shipmentId).filter((id): id is number => id != null);

    const sources = await tx.select({
      id: s.expenseAccountingSources.id,
      shipmentId: s.expenseAccountingSources.shipmentId,
      version: s.expenseAccountingSources.version,
      allocatedAdvanceAmount: s.expenseAccountingSources.allocatedAdvanceAmount,
      entryAmount: s.opsExpenseEntries.amount,
      entryCharge: s.opsExpenseEntries.customerChargeAmount,
    })
      .from(s.expenseAccountingSources)
      .innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.expenseAccountingSources.sourceId))
      .where(and(inArray(s.expenseAccountingSources.shipmentId, shipmentIds),
        eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.status, 'RECORDED')));
    // The voucher engine is one-counterparty-per-phiếu: group the selection by
    // customer and issue one consolidated voucher per group.
    const customerIdByShipment = new Map<number, number>();
    const tripCustomer: Array<{ shipmentId: number; customerId: number | null }> = await tx
      .select({ shipmentId: s.shipments.id, customerId: s.shipments.customerId })
      .from(s.shipments).where(inArray(s.shipments.id, shipmentIds));
    for (const row of tripCustomer) {
      if (row.shipmentId != null && row.customerId != null) customerIdByShipment.set(row.shipmentId, row.customerId);
    }
    const groups = new Map<number, Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number; amount: number }>>();
    const totalsByGroup = new Map<number, number>();
    let skipped = 0;
    for (const trip of tripRows) {
      const shipmentId = trip.shipmentId as number;
      const customerId = customerIdByShipment.get(shipmentId);
      if (customerId == null) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khách hàng.`);
      const shipmentSources = sources.filter((source) => source.shipmentId === shipmentId);
      if (shipmentSources.length === 0) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khoản chi hộ để lập phiếu.`);
      const entries: Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number; amount: number }> = [];
      for (const source of shipmentSources) {
        const cash = await getExpenseCashTotals(tx, source.id);
        const chargeSide = Number(source.entryCharge ?? 0);
        const costSide = Number(source.entryAmount) - Number(source.allocatedAdvanceAmount ?? 0);
        const remaining = Math.max(args.direction === 'IN' ? chargeSide - cash.IN : costSide - cash.OUT, 0);
        if (remaining <= 0) {
          skipped += 1;
          continue;
        }
        entries.push({ sourceKind: 'OPS', sourceId: source.id, expectedVersion: source.version, amount: remaining });
      }
      if (entries.length === 0) continue;
      const bucket = groups.get(customerId) ?? [];
      groups.set(customerId, [...bucket, ...entries]);
      totalsByGroup.set(customerId, (totalsByGroup.get(customerId) ?? 0) + entries.reduce((sum, entry) => sum + entry.amount, 0));
    }
    let grandTotal = 0;
    let voucherCount = 0;
    for (const [customerId, entries] of groups) {
      const voucher = await createExpenseVoucher(tx, args.actor, {
        direction: args.direction,
        treasuryAccountId: args.treasuryAccountId,
        valueDate: new Date().toISOString().slice(0, 10),
        physicalReference: args.physicalReference ?? `PHOI-PHIEU-C${customerId}-${tripRows.map((row) => row.tripId).join('-')}`,
        entries,
      });
      grandTotal += totalsByGroup.get(customerId) ?? 0;
      voucherCount += 1;
    }
    if (voucherCount === 0) {
      throw new ApiError(409, 'Các dòng đã chọn không còn khoản mở để lập phiếu.');
    }
    return { voucherId: groups.size, code: `${voucherCount} phiếu`, total: grandTotal, entries: voucherCount };
  });
}

export async function listPhoiPhieuStk(): Promise<Array<{ id: number; code: string; name: string }>> {
  return db.select({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code, name: s.treasuryAccounts.name })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), eq(s.treasuryAccounts.type, 'CASH')))
    .orderBy(asc(s.treasuryAccounts.code));
}
