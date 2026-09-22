/** Card 20260921_12 — Bảng kiểm soát phơi phiếu / tiền đường (accountant).
 *  Row grain = the trip (one phơi event). Chi hộ sums read the SAME
 *  expense_accounting_sources rows the consolidated voucher consumes, so the
 *  board total and the phiếu total match to the đồng by construction (AC5).
 *  The consolidated phiếu reuses createExpenseVoucher: one call posts ONE
 *  treasury movement against the chosen STK — the quỹ ledger adjusts through
 *  the existing engine (card 9 owns the nguồn-quỹ dimension on top). */
import { aliasedTable, and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import { hydrateExpenseAccountingSource } from './expense-accounting-source.service';
import { createExpenseVoucher, getExpenseCashTotals } from './expense-accounting-voucher.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { expenseVndSchema, TripStatus } from '@tingting/shared';
void expenseVndSchema;

type Executor = Tx | typeof db;

const carrierCustomer = aliasedTable(s.customers, 'carrier_customer');
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
  /** Card 20260921_15 — trọng tải (the container's cargo weight from intake). */
  cargoWeightKg: number | null;
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

/** Card 20260921_16: 'grouped' (default) keeps same-plate rows consecutive —
 *  kẹp-paired trips of one truck land adjacent — while 'date' is the user's
 *  explicit override back to pure chronological order. Filters apply either
 *  way; the sort choice never narrows the row set. */
export async function listPhoiPhieuRows(query: {
  dateFrom?: string; dateTo?: string; status?: string; search?: string;
  sortBy?: 'grouped' | 'date';
}): Promise<PhoiPhieuRow[]> {
  const tripConditions: (SQL | undefined)[] = [isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')];
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
    cargoWeightKg: s.shipmentContainers.cargoWeightKg,
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
    .orderBy(...(query.sortBy === 'date'
      ? [desc(s.trips.departureDate), desc(s.trips.id)]
      : [asc(s.trucks.licensePlate), desc(s.trips.departureDate), desc(s.trips.id)]))
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
  // Card 20260921_14 rework: the parent Tien-duong cell sums CONFIRMED
  // driver-entered costs for the trip — the same spine the detail dialog reads.
  const confirmedRoad = await db.select({
    tripId: s.expenseAccountingSources.tripId,
    amount: s.driverIncidentalCosts.amount,
  })
    .from(s.expenseAccountingSources)
    .innerJoin(s.driverIncidentalCosts, eq(s.driverIncidentalCosts.id, s.expenseAccountingSources.sourceId))
    .where(and(inArray(s.expenseAccountingSources.tripId, tripIds),
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'), eq(s.expenseAccountingSources.status, 'RECORDED'),
      isNotNull(s.expenseAccountingSources.confirmedAt)));
  const confirmedRoadByTrip = new Map<number, number>();
  for (const row of confirmedRoad) {
    if (row.tripId == null) continue;
    confirmedRoadByTrip.set(row.tripId, (confirmedRoadByTrip.get(row.tripId) ?? 0) + Number(row.amount));
  }
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
      cargoWeightKg: row.cargoWeightKg == null ? null : Number(row.cargoWeightKg),
      liftSite: row.liftSite,
      dropSite: row.dropSite,
      plateNumber: row.plateNumber,
      driverName: row.driverName,
      departureDate: row.departureDate,
      tripStatus: row.tripStatus,
      chiHoTra,
      chiHoThu,
      tienDuong: confirmedRoadByTrip.has(row.tripId)
        ? confirmedRoadByTrip.get(row.tripId) ?? 0
        : row.tienDuong == null ? null : Number(row.tienDuong),
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
      // Native OPS entry id — the id space the cash-voucher engine resolves
      // (source-row ids are a DIFFERENT sequence; passing them 404s or hits
      // a wrong-entry lookalike when the sequences diverge).
      nativeId: s.expenseAccountingSources.sourceId,
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
    const groups = new Map<string, Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number; amount: number }>>();
    const totalsByGroup = new Map<string, number>();
    let skipped = 0;
    const seenSourceIds = new Set<number>();
    for (const trip of tripRows) {
      const shipmentId = trip.shipmentId as number;
      const customerId = customerIdByShipment.get(shipmentId);
      if (customerId == null) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khách hàng.`);
      const shipmentSources = sources.filter((source) => source.shipmentId === shipmentId);
      if (shipmentSources.length === 0) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khoản chi hộ để lập phiếu.`);
      const entries: Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number; amount: number }> = [];
      for (const source of shipmentSources) {
        if (seenSourceIds.has(source.id)) {
          skipped += 1;
          continue;
        }
        seenSourceIds.add(source.id);
        const cash = await getExpenseCashTotals(tx, source.id);
        const chargeSide = Number(source.entryCharge ?? 0);
        const costSide = Number(source.entryAmount) - Number(source.allocatedAdvanceAmount ?? 0);
        const remaining = Math.max(args.direction === 'IN' ? chargeSide - cash.IN : costSide - cash.OUT, 0);
        if (remaining <= 0) {
          skipped += 1;
          continue;
        }
        entries.push({ sourceKind: 'OPS', sourceId: source.nativeId, expectedVersion: source.version, amount: remaining });
      }
      if (entries.length === 0) continue;
      // R3: the fan-out key is counterparty × fund kind — a mixed selection
      // produces one phiếu per kind, never one movement across kinds. The
      // fund kind rides the chosen account today; card 9 deepens it.
      const groupKey = `${customerId}`;
      const bucket = groups.get(groupKey) ?? [];
      groups.set(groupKey, [...bucket, ...entries]);
      totalsByGroup.set(groupKey, (totalsByGroup.get(groupKey) ?? 0) + entries.reduce((sum, entry) => sum + entry.amount, 0));
    }
    let grandTotal = 0;
    const issued: Array<{ id: number; code: string; total: number }> = [];
    for (const [groupKey, entries] of groups) {
      const voucher = await createExpenseVoucher(tx, args.actor, {
        direction: args.direction,
        treasuryAccountId: args.treasuryAccountId,
        valueDate: new Date().toISOString().slice(0, 10),
        physicalReference: args.physicalReference ?? `PHOI-PHIEU-${groupKey}-${tripRows.map((row) => row.tripId).join('-')}`,
        entries,
      });
      grandTotal += totalsByGroup.get(groupKey) ?? 0;
      issued.push({ id: voucher.id, code: voucher.code, total: totalsByGroup.get(groupKey) ?? 0 });
    }
    if (issued.length === 0) {
      throw new ApiError(409, 'Các dòng đã chọn không còn khoản mở để lập phiếu.');
    }
    return { voucherId: issued[0]!.id, code: issued.map((voucher) => voucher.code).join(', '), total: grandTotal, entries: issued.length, issued };
  });
}

export async function listPhoiPhieuStk(): Promise<Array<{ id: number; code: string; name: string }>> {
  return db.select({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code, name: s.treasuryAccounts.name })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), eq(s.treasuryAccounts.type, 'CASH')))
    .orderBy(asc(s.treasuryAccounts.code));
}

// ── Card 20260921_13: the accountant chi-ho detail dialog ──────────────────

export interface PhoiPhieuFeeRow {
  /** The OPS EXPENSE entry id — the id space every mutation route keys on. */
  entryId: number;
  sourceId: number;
  version: number;
  feeName: string | null;
  invoiceNumber: string | null;
  amountTra: number;
  amountThu: number | null;
  payerName: string | null;
  payerUserId: number | null;
  confirmed: boolean;
}

export async function getPhoiPhieuChiHo(tripId: number): Promise<{
  tripId: number; tripCode: string | null; shipmentId: number;
  ngayLayPhoi: string | null; trangThaiLay: string | null;
  rows: PhoiPhieuFeeRow[]; totals: { thu: number; tra: number };
}> {
  const [trip] = await db.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    shipmentId: s.trips.shipmentId,
  }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!trip || trip.shipmentId == null) throw new ApiError(404, 'Không tìm thấy chuyến.');
  const [state] = await db.select({ taken: s.tripFinancialState.phoiTakenDate, status: s.tripFinancialState.phoiTakeStatus })
    .from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId)).limit(1);
  const rows = await db.select({
    entryId: s.opsExpenseEntries.id,
    sourceId: s.expenseAccountingSources.id,
    feeName: s.opsExpenseEntries.feeName,
    invoiceNumber: s.opsExpenseEntries.invoiceNumber,
    amountTra: s.opsExpenseEntries.amount,
    amountThu: s.opsExpenseEntries.customerChargeAmount,
    paidById: s.opsExpenseEntries.paidById,
    payerName: s.users.fullName,
    confirmedAt: s.expenseAccountingSources.confirmedAt,
    version: s.expenseAccountingSources.version,
  })
    .from(s.expenseAccountingSources)
    .innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.expenseAccountingSources.sourceId))
    .leftJoin(s.users, eq(s.users.id, s.opsExpenseEntries.paidById))
    .where(and(eq(s.expenseAccountingSources.shipmentId, trip.shipmentId),
      eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.status, 'RECORDED')))
    .orderBy(asc(s.expenseAccountingSources.id));
  const feeRows: PhoiPhieuFeeRow[] = rows.map((row, index) => ({
    entryId: row.entryId,
    sourceId: row.sourceId,
    version: row.version,
    feeName: row.feeName,
    invoiceNumber: row.invoiceNumber,
    amountTra: Number(row.amountTra ?? 0),
    amountThu: row.amountThu == null ? null : Number(row.amountThu),
    payerName: row.payerName,
    payerUserId: row.paidById,
    confirmed: row.confirmedAt != null,
    ...({} as Record<string, never>),
    ordinal: index + 1,
  } as PhoiPhieuFeeRow & { ordinal: number }));
  return {
    tripId, tripCode: trip.tripCode, shipmentId: trip.shipmentId,
    ngayLayPhoi: state?.taken ?? null,
    trangThaiLay: state?.status ?? null,
    rows: feeRows,
    totals: {
      thu: feeRows.reduce((sum, row) => sum + (row.amountThu ?? 0), 0),
      tra: feeRows.reduce((sum, row) => sum + row.amountTra, 0),
    },
  };
}

export async function updatePhoiPhieuMeta(tripId: number, input: {
  ngayLayPhoi?: string | null; trangThaiLay?: string | null;
}): Promise<{ ok: true }> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: s.tripFinancialState.id })
      .from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId)).limit(1).for('update');
    if (existing) {
      await tx.update(s.tripFinancialState).set({
        ...(input.ngayLayPhoi !== undefined ? { phoiTakenDate: input.ngayLayPhoi || null } : {}),
        ...(input.trangThaiLay !== undefined ? { phoiTakeStatus: input.trangThaiLay } : {}),
        updatedAt: new Date(),
      }).where(eq(s.tripFinancialState.id, existing.id));
      return;
    }
    const [trip] = await tx.select({ shipmentId: s.trips.shipmentId }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    await tx.insert(s.tripFinancialState).values({
      tripId,
      ...(input.ngayLayPhoi ? { phoiTakenDate: input.ngayLayPhoi } : {}),
      ...(input.trangThaiLay ? { phoiTakeStatus: input.trangThaiLay } : {}),
    });
    void trip;
  });
  return { ok: true };
}

/** Remove a fee row from the dialog: VOID the source (history kept — the
 *  accounting rule) and void the entry, never a hard delete. */
export async function voidPhoiPhieuRow(tripId: number, sourceId: number, actor: AuthUser, reason: string) {
  await db.transaction(async (tx) => {
    const [source] = await tx.select().from(s.expenseAccountingSources)
      .where(and(eq(s.expenseAccountingSources.id, sourceId),
        eq(s.expenseAccountingSources.sourceKind, 'OPS'))).limit(1).for('update');
    if (!source) throw new ApiError(404, 'Không tìm thấy khoản phí chi hộ OPS.');
    await assertShipmentAccountingUnlocked(tx, source.shipmentId);
    if (source.shipmentId !== null) {
      const [linked] = await tx.select({ id: s.trips.id }).from(s.trips)
        .where(and(eq(s.trips.id, tripId), eq(s.trips.shipmentId, source.shipmentId))).limit(1);
      if (!linked) throw new ApiError(404, 'Khoản phí không thuộc chuyến này.');
    }
    if (source.confirmedAt) throw new ApiError(409, 'Khoản đã đối chiếu — dùng điều chỉnh thay vì xóa.');
    await tx.update(s.expenseAccountingSources).set({ status: 'VOIDED', updatedAt: new Date() })
      .where(eq(s.expenseAccountingSources.id, sourceId));
    await tx.update(s.opsExpenseEntries).set({ approvalStatus: 'VOIDED', updatedAt: new Date() })
      .where(eq(s.opsExpenseEntries.id, source.sourceId));
    await tx.insert(s.auditLogs).values({
      userId: actor.userId, entityType: 'expense_accounting_source', entityId: sourceId,
      message: 'VOID phoi-phieu fee row', payload: { reason, tripId },
    });
  });
  return { ok: true };
}

// ── Card 20260921_14: the accountant tiền-đường detail dialog ───────────────

export interface PhoiPhieuTienDuongRow {
  sourceId: number;
  costType: string;
  feeName: string | null;
  driverEnteredAmount: number | null;
  amount: number;
  confirmed: boolean;
  driverName: string | null;
  occurredAt: string | null;
}

export async function getPhoiPhieuTienDuong(tripId: number): Promise<{
  tripId: number; tripCode: string | null;
  rows: PhoiPhieuTienDuongRow[]; totals: { total: number; confirmed: number };
}> {
  const [trip] = await db.select({ tripId: s.trips.id, tripCode: s.trips.tripCode })
    .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến.');
  const rows = await db.select({
    id: s.driverIncidentalCosts.id,
    costType: s.driverIncidentalCosts.costType,
    feeName: s.driverIncidentalCosts.feeName,
    driverEnteredAmount: s.driverIncidentalCosts.driverEnteredAmount,
    amount: s.driverIncidentalCosts.amount,
    occurredAt: s.driverIncidentalCosts.occurredAt,
    driverName: s.drivers.name,
    confirmedAt: s.expenseAccountingSources.confirmedAt,
  })
    .from(s.driverIncidentalCosts)
    .leftJoin(s.drivers, eq(s.drivers.id, s.driverIncidentalCosts.driverId))
    .leftJoin(s.expenseAccountingSources, and(
      eq(s.expenseAccountingSources.sourceKind, 'DRIVER'),
      eq(s.expenseAccountingSources.sourceId, s.driverIncidentalCosts.id),
      eq(s.expenseAccountingSources.status, 'RECORDED'),
    ))
    .where(eq(s.driverIncidentalCosts.tripId, tripId))
    .orderBy(asc(s.driverIncidentalCosts.id));
  void s.trips;
  const feeRows: PhoiPhieuTienDuongRow[] = rows.map((row) => ({
    sourceId: row.id,
    costType: row.costType,
    feeName: row.feeName,
    driverEnteredAmount: row.driverEnteredAmount == null ? null : Number(row.driverEnteredAmount),
    amount: Number(row.amount ?? 0),
    confirmed: row.confirmedAt != null,
    driverName: row.driverName,
    occurredAt: row.occurredAt,
  }));
  const confirmedRows = feeRows.filter((row) => row.confirmed);
  return {
    tripId,
    tripCode: trip.tripCode,
    rows: feeRows,
    totals: {
      total: feeRows.reduce((sum, row) => sum + row.amount, 0),
      confirmed: confirmedRows.reduce((sum, row) => sum + row.amount, 0),
    },
  };
}

// ── Card 20260921_17: monthly phai-thu / phai-tra reports ───────────────────

export interface PhoiPhieuReportRow {
  party: string;
  tienNang: number;
  tienHa: number;
  psKhac: number;
  tongPhaiThuTra: number;
  daThuTra: number;
  conLai: number;
  ghiChu: string | null;
}

const INTERNAL_CARRIER_CODE = 'XE NHÀ — SILVER SEA';

/** Bucket an ops fee into the customer's three families via the structural
 *  category (LIFT → nâng, DROP → hạ, else → PS khác) — never by name. */
function bucketByCategory(category: string | null | undefined): 'nang' | 'ha' | 'khac' {
  if (category === 'LIFT') return 'nang';
  if (category === 'DROP') return 'ha';
  return 'khac';
}

export async function getPhoiPhieuReport(query: {
  kind: 'THU' | 'TRA'; dateFrom?: string; dateTo?: string;
  /** Card 20260921_8 — per-accountant scope. A staff id filters to trips
   *  whose truck's ACTIVE assignment names them; explicit null = unassigned
   *  only; includeUnassigned adds the unassigned bucket beside an id.
   *  Absent = no filtering (existing callers byte-compatible). */
  accountantId?: number | null; includeUnassigned?: boolean;
}): Promise<{ rows: PhoiPhieuReportRow[]; grand: PhoiPhieuReportRow }> {
  const tripConditions: (SQL | undefined)[] = [isNull(s.trips.deletedAt), ne(s.trips.status, 'CANCELED')];
  if (query.dateFrom) tripConditions.push(gte(s.trips.departureDate, query.dateFrom));
  if (query.dateTo) tripConditions.push(lte(s.trips.departureDate, query.dateTo));
  if (query.accountantId !== undefined) {
    const allAssignedTruckIds = (await db.select({ truckId: s.truckAccountantAssignments.truckId })
      .from(s.truckAccountantAssignments)
      .where(isNull(s.truckAccountantAssignments.endedAt))).map((row) => row.truckId);
    const unassignedTruckFilter = or(
      isNull(s.trips.truckId),
      notInArray(s.trips.truckId, allAssignedTruckIds.length ? allAssignedTruckIds : [0]),
    );
    if (query.accountantId === null) {
      tripConditions.push(unassignedTruckFilter);
    } else {
      const myTruckIds = (await db.select({ truckId: s.truckAccountantAssignments.truckId })
        .from(s.truckAccountantAssignments)
        .where(and(
          eq(s.truckAccountantAssignments.accountantId, query.accountantId),
          isNull(s.truckAccountantAssignments.endedAt),
        ))).map((row) => row.truckId);
      tripConditions.push(query.includeUnassigned
        ? or(inArray(s.trips.truckId, myTruckIds.length ? myTruckIds : [0]), unassignedTruckFilter)
        : inArray(s.trips.truckId, myTruckIds.length ? myTruckIds : [0]));
    }
  }

  const tripIds = (await db.select({ id: s.trips.id })
    .from(s.trips).where(and(...tripConditions))).map((row) => row.id);
  if (tripIds.length === 0) {
    return { rows: [], grand: { party: 'TỔNG CỘNG', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: null } };
  }

  const sources = await db.select({
    id: s.expenseAccountingSources.id,
    tripId: s.expenseAccountingSources.tripId,
    confirmedAt: s.expenseAccountingSources.confirmedAt,
    allocatedAdvanceAmount: s.expenseAccountingSources.allocatedAdvanceAmount,
    feeName: s.opsExpenseEntries.feeName,
    amount: s.opsExpenseEntries.amount,
    customerChargeAmount: s.opsExpenseEntries.customerChargeAmount,
    category: s.forwarderExpenseTypes.category,
  })
    .from(s.expenseAccountingSources)
    .innerJoin(s.opsExpenseEntries, eq(s.opsExpenseEntries.id, s.expenseAccountingSources.sourceId))
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(and(
      // In-trip rows scope by the trip window; NULL-trip rows (correct-route
      // linked-replacement leaves trip_id null) scope by the expense's own
      // business date so a correction can never drop money from the report.
      or(
        inArray(s.expenseAccountingSources.tripId, tripIds),
        and(
          isNull(s.expenseAccountingSources.tripId),
          query.dateFrom ? gte(s.opsExpenseEntries.paidAt, query.dateFrom) : undefined,
          query.dateTo ? lte(s.opsExpenseEntries.paidAt, query.dateTo) : undefined,
        ),
      ),
      eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.status, 'RECORDED')));

  // Party attribution.
  const tripParty = new Map<number, { name: string | null; ghiChu: string | null }>();
  if (query.kind === 'THU') {
    const parties = await db.select({
      tripId: s.trips.id, name: s.customers.name, ghiChu: s.shipments.customerNotes,
    })
      .from(s.trips).leftJoin(s.customers, eq(s.customers.id, s.trips.customerId))
      .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .where(inArray(s.trips.id, tripIds));
    for (const row of parties) tripParty.set(row.tripId, { name: row.name, ghiChu: row.ghiChu });
  } else {
    const parties = await db.select({
      tripId: s.trips.id,
      externalName: carrierCustomer.name,
      plate: s.trucks.licensePlate,
    })
      .from(s.trips)
      .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
      .leftJoin(aliasedTable(s.customers, 'carrier_customer'), eq(carrierCustomer.id, s.tripCarrierInfo.externalEntityId))
      .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId));
    for (const row of parties) {
      if (!tripParty.has(row.tripId)) {
        tripParty.set(row.tripId, {
          name: row.externalName ?? (row.plate ? INTERNAL_CARRIER_CODE : null),
          ghiChu: null,
        });
      }
    }
  }

  const groups = new Map<string, { tienNang: number; tienHa: number; psKhac: number; da: number; ghiChu: string | null }>();
  for (const source of sources) {
    // A NULL trip (the correct-route linked-replacement nulls the source's
    // trip_id) must not silently drop the money from the report — it keeps
    // reporting, bucketed under the unknown party.
    const partyInfo = source.tripId != null ? tripParty.get(source.tripId) : undefined;
    const party = partyInfo?.name ?? 'Chưa xác định';
    const bucket = groups.get(party) ?? { tienNang: 0, tienHa: 0, psKhac: 0, da: 0, ghiChu: partyInfo?.ghiChu ?? null };
    const bucketKey = bucketByCategory(source.category);
    const amount = Number(source.amount ?? 0);
    if (bucketKey === 'nang') bucket.tienNang += amount;
    else if (bucketKey === 'ha') bucket.tienHa += amount;
    else bucket.psKhac += amount;
    const cash = await getExpenseCashTotals(db as unknown as Tx, source.id);
    bucket.da += query.kind === 'THU' ? cash.IN : cash.OUT;
    groups.set(party, bucket);
  }

  const rows: PhoiPhieuReportRow[] = [...groups.entries()].map(([party, bucket]) => {
    const tong = bucket.tienNang + bucket.tienHa + bucket.psKhac;
    const conLai = tong - bucket.da;
    // Honest-and-additive: daThuTra reports the over-paid actual (may exceed
    // tong, conLai goes negative) so the FE over-pay annotation can fire.
    return { party, tienNang: bucket.tienNang, tienHa: bucket.tienHa, psKhac: bucket.psKhac,
      tongPhaiThuTra: tong, daThuTra: bucket.da, conLai, ghiChu: bucket.ghiChu };
  }).sort((a, b) => b.tongPhaiThuTra - a.tongPhaiThuTra);
  const grand = rows.reduce((acc, row) => ({
    party: 'TỔNG CỘNG', tienNang: acc.tienNang + row.tienNang, tienHa: acc.tienHa + row.tienHa,
    psKhac: acc.psKhac + row.psKhac, tongPhaiThuTra: acc.tongPhaiThuTra + row.tongPhaiThuTra,
    daThuTra: acc.daThuTra + row.daThuTra, conLai: acc.conLai + row.conLai, ghiChu: null,
  }), { party: 'TỔNG CỘNG', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: null });
  return { rows, grand };
}

/** Card 20260921_8 — the assignment board data: ACTIVE truck assignments with
 *  the accountant resolved, plus the distinct UNASSIGNED bucket (ACTIVE
 *  trucks with no active assignment) so nothing is missed. */
export async function listPhoiPhieuTruckAssignments(): Promise<{
  assignments: Array<{ truckId: number; plate: string; accountantId: number | null; accountantName: string | null; version: number }>;
  unassignedTrucks: Array<{ truckId: number; plate: string }>;
  accountants: Array<{ id: number; fullName: string | null }>;
}> {
  const assignments = await db.select({
    truckId: s.truckAccountantAssignments.truckId,
    plate: s.trucks.licensePlate,
    accountantId: s.truckAccountantAssignments.accountantId,
    accountantName: s.users.fullName,
    version: s.truckAccountantAssignments.version,
  }).from(s.truckAccountantAssignments)
    .innerJoin(s.trucks, eq(s.trucks.id, s.truckAccountantAssignments.truckId))
    .leftJoin(s.users, eq(s.users.id, s.truckAccountantAssignments.accountantId))
    .where(isNull(s.truckAccountantAssignments.endedAt))
    .orderBy(asc(s.trucks.licensePlate));
  const assignedIds = assignments.map((row) => row.truckId);
  const unassignedTrucks = assignedIds.length
    ? await db.select({ truckId: s.trucks.id, plate: s.trucks.licensePlate })
        .from(s.trucks)
        .where(and(
          eq(s.trucks.status, 'ACTIVE'),
          notInArray(s.trucks.id, assignedIds),
        )).orderBy(asc(s.trucks.licensePlate))
    : await db.select({ truckId: s.trucks.id, plate: s.trucks.licensePlate })
        .from(s.trucks)
        .where(eq(s.trucks.status, 'ACTIVE')).orderBy(asc(s.trucks.licensePlate));
  const accountants = await db.select({ id: s.users.id, fullName: s.users.fullName })
    .from(s.users)
    .where(and(eq(s.users.role, 'ACCOUNTANT'), isNull(s.users.deletedAt)))
    .orderBy(asc(s.users.fullName));
  return { assignments, unassignedTrucks, accountants };
}
