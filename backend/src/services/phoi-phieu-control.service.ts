/** Card 20260921_12 — Bảng kiểm soát phơi phiếu / tiền đường (accountant).
 *  Row grain = the trip (one phơi event). Chi hộ sums read the SAME
 *  expense_accounting_sources rows the consolidated voucher consumes, so the
 *  board total and the phiếu total match to the đồng by construction (AC5).
 *  The consolidated phiếu reuses createExpenseVoucher: one call posts ONE
 *  treasury movement against the chosen STK — the quỹ ledger adjusts through
 *  the existing engine (card 9 owns the nguồn-quỹ dimension on top). */
import { createHash } from 'node:crypto';
import { aliasedTable, and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { loadDispatchExpenseNotes } from './dispatch-expense-notes.service';
import { createExpenseVoucher, getExpenseCashTotals, getExpenseCashTotalsBatch } from './expense-accounting-voucher.service';
import { FUND_SOURCES } from './treasury-fund-book.service';
import { propagateRecordedExpense } from './source-change.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { expenseVndSchema, sumExcludingNegative, TripStatus } from '@tingting/shared';
void expenseVndSchema;

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
  /** Card 20260921_15 — trọng lượng HÀNG (the cargo weight from intake). */
  cargoWeightKg: number | null;
  /** Card 20260928_172 — TRỌNG TẢI CONTAINER: the type's rated capacity, which
   *  is what the PM asked for and is NOT the cargo weight above. null = the
   *  type has no rating, and the UI prints "—" instead of guessing. */
  containerPayloadKg: number | null;
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
  /** Case QA-2026-09-24-01: per-direction eligible-entry counts (approved ∧
   *  remaining>0) — the toolbar counter previews exactly what the voucher
   *  will consume. */
  eligibleIn: number;
  eligibleOut: number;
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
  // A live trip of a soft-deleted shipment is orphaned data - never listed.
  const tripConditions: (SQL | undefined)[] = [
    isNull(s.trips.deletedAt),
    isNull(s.shipments.deletedAt),
    ne(s.trips.status, 'CANCELED'),
  ];
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
    containerPayloadKg: s.containerTypes.payloadKg,
    liftSite: liftPort.name,
    dropSite: dropPort.name,
    plateNumber: s.trucks.licensePlate,
    driverName: s.drivers.name,
  })
    .from(s.trips)
    .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))
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
    // Card 20260928_172 criterion 3. The WINDOW is always chosen in date order,
    // so `limit(300)` returns the same row SET whichever display order the board
    // asks for. Grouping becomes a display-order rule (below), never a
    // re-ordering of this query: an ORDER BY before this LIMIT let the two modes
    // return different 300-row windows, which is exactly what the card forbids —
    // and what this function's own doc comment already promised.
    .orderBy(desc(s.trips.departureDate), desc(s.trips.id))
    .limit(300);
  if (rows.length === 0) return [];

  // Card 20260928_172 criteria 2+3: repeated plates adjacent, date order kept
  // INSIDE each plate group. This sorts the already-selected window, so the row
  // identity SET is identical to `sortBy='date'` — the property criterion 3 asks
  // to be proven, and the reason the grouping cannot live in the query. A
  // comparator returning 0 leans on V8's stable sort, i.e. the window's own date
  // order within a group; null plates go last, matching the `asc` NULLS-LAST the
  // SQL used before.
  const displayRows = query.sortBy === 'date' ? rows : [...rows].sort((a, b) => {
    const aPlate = a.plateNumber;
    const bPlate = b.plateNumber;
    if (aPlate === bPlate) return 0;
    if (aPlate == null) return 1;
    if (bPlate == null) return -1;
    return aPlate < bPlate ? -1 : 1;
  });

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
  const confirmedRoadRows = new Map<number, Array<{ amount: string }>>();
  for (const row of confirmedRoad) {
    if (row.tripId == null) continue;
    const bucket = confirmedRoadRows.get(row.tripId) ?? [];
    bucket.push({ amount: row.amount });
    confirmedRoadRows.set(row.tripId, bucket);
  }
  // Card 20260928_197 — the driver cost amount is signed, so a negative row
  // must leave the Tien-duong cell exactly as if it did not exist. The map is
  // set only for trips that still hold a counted row, so a trip whose rows are
  // all negative reads "chưa xác định" (null) rather than a known 0.
  for (const [tripId, bucket] of confirmedRoadRows) {
    if (bucket.some((row) => Number(row.amount) >= 0)) {
      confirmedRoadByTrip.set(tripId, sumExcludingNegative(bucket, (row) => row.amount));
    }
  }
  // Eligible-set preview (case QA-2026-09-24-01): the per-source cash ledger
  // grouped once for the listed rows, mirroring getExpenseCashTotals.
  const boardSourceIds = [...sources.map((source) => source.id)];
  const cashRows = boardSourceIds.length > 0 ? await db.select({
    sourceId: s.expenseCashAllocations.expenseAccountingSourceId,
    direction: s.treasuryMovements.direction,
    paid: sql<string>`sum(${s.expenseCashAllocations.amount})`,
  })
    .from(s.expenseCashAllocations)
    .innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
    .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
    .where(inArray(s.expenseCashAllocations.expenseAccountingSourceId, boardSourceIds))
    .groupBy(s.expenseCashAllocations.expenseAccountingSourceId, s.treasuryMovements.direction) : [];
  const cashBySource = new Map<number, { IN: number; OUT: number }>();
  for (const row of cashRows) {
    const slot = cashBySource.get(row.sourceId) ?? { IN: 0, OUT: 0 };
    if (row.direction === 'IN') slot.IN += Number(row.paid);
    else slot.OUT += Number(row.paid);
    cashBySource.set(row.sourceId, slot);
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
  for (const row of displayRows) {
    const shipmentSources = byShipment.get(row.shipmentId) ?? [];
    // Card 20260928_197 — `amount` is signed; a negative row leaves the chi-hộ
    // total exactly as if it did not exist (`sumExcludingNegative`). A lot whose
    // rows are ALL negative still has rows, so the cell stays a known 0 —
    // "we looked and there is no money" stays distinct from "chưa xác định".
    const chiHoTra = shipmentSources.length ? sumExcludingNegative(shipmentSources, (source) => source.amount ?? 0) : null;
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
    // Eligible-set preview counts (case QA-2026-09-24-01): approved ∧
    // remaining>0 per direction — the same set the consolidated voucher
    // consumes, so the toolbar preview equals the voucher contents.
    let eligibleIn = 0;
    let eligibleOut = 0;
    for (const source of shipmentSources) {
      const cash = cashBySource.get(source.id) ?? { IN: 0, OUT: 0 };
      if (source.confirmedAt == null) continue;
      if (Math.max(Number(source.customerChargeAmount ?? 0) - cash.IN, 0) > 0) eligibleIn += 1;
      if (Math.max(Number(source.amount ?? 0) - Number(source.allocatedAdvanceAmount ?? 0) - cash.OUT, 0) > 0) eligibleOut += 1;
    }
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
      containerPayloadKg: row.containerPayloadKg == null ? null : Number(row.containerPayloadKg),
      liftSite: row.liftSite,
      dropSite: row.dropSite,
      plateNumber: row.plateNumber,
      driverName: row.driverName,
      departureDate: row.departureDate,
      tripStatus: row.tripStatus,
      chiHoTra,
      chiHoThu,
      eligibleIn,
      eligibleOut,
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

/** Card 20260928_170 — the reference the phơi-phiếu screen generates for itself.
 *
 *  The screen never sends a `physicalReference`, so this fallback is what every
 *  consolidated phiếu used to carry. It joined EVERY selected trip id, and the
 *  treasury authority (`normalizeTreasuryPhysicalReference`, treasury.service.ts)
 *  rejects anything over 160 chars — so "tích chọn All" could never issue a
 *  phiếu on a lot with enough trips. Ticket "All" itself.
 *
 *  The reference is also the uniqueness key
 *  (`lockApplicationOwnedUniqueness` keys on treasuryAccountId + direction +
 *  physicalReference), so the fallback must be DETERMINISTIC: the ids are
 *  sorted before hashing, and a too-long value is hashed rather than truncated —
 *  two different selections can never collide on a truncated prefix. This
 *  mirrors `expenseVoucherCode`, the house pattern on the sibling path. */
export function phoiPhieuPhysicalReference(groupKey: string, tripIds: number[]): string {
  const selection = [...tripIds].sort((a, b) => a - b).join('-');
  const raw = `PHOI-PHIEU-${groupKey}-${selection}`;
  return raw.length <= 150
    ? raw
    : `PHOI-PHIEU-${createHash('sha256').update(raw).digest('hex')}`;
}

/** Consolidated phiếu: one createExpenseVoucher call over every open OPS
 *  source of the selected trips — ONE treasury movement adjusts the quỹ. */
export async function createPhoiPhieuVoucher(args: PhoiPhieuVoucherInput, outer?: Tx): Promise<{ voucherId: number; code: string; total: number; entries: number }> {
  if (!Array.isArray(args.tripIds) || args.tripIds.length === 0) {
    throw new ApiError(400, 'Chưa chọn dòng nào để lập phiếu.');
  }
  const run = async (tx: Tx) => {
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
        eq(s.expenseAccountingSources.sourceKind, 'OPS'), eq(s.expenseAccountingSources.status, 'RECORDED'),
        // Case QA-2026-09-24-01: only APPROVED (confirmedAt) chi-hộ sources
        // enter the consolidated phiếu — the contract wording is verbatim
        // ("Chỉ những khoản ĐÃ DUYỆT mới đủ điều kiện được đưa vào phiếu chi").
        isNotNull(s.expenseAccountingSources.confirmedAt)));
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
    const seenSourceIds = new Set<number>();
    // Card 20260927_147 — the row loop below needs one source's recorded cash totals to
    // decide its remaining amount; read the whole selection once instead of once per source.
    const cashBySourceId = await getExpenseCashTotalsBatch(tx, sources.map((source) => source.id));
    for (const trip of tripRows) {
      const shipmentId = trip.shipmentId as number;
      const customerId = customerIdByShipment.get(shipmentId);
      const shipmentSources = sources.filter((source) => source.shipmentId === shipmentId);
      if (shipmentSources.length === 0) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khoản chi hộ để lập phiếu.`);
      const entries: Array<{ sourceKind: 'OPS'; sourceId: number; expectedVersion: number; amount: number }> = [];
      for (const source of shipmentSources) {
        if (customerId == null) throw new ApiError(409, `Lô ${trip.shipmentCode ?? shipmentId} chưa có khách hàng.`);
        if (seenSourceIds.has(source.id)) {
          continue;
        }
        seenSourceIds.add(source.id);
        const cash = cashBySourceId.get(source.id) ?? { IN: 0, OUT: 0 };
        const chargeSide = Number(source.entryCharge ?? 0);
        const costSide = Number(source.entryAmount) - Number(source.allocatedAdvanceAmount ?? 0);
        const remaining = Math.max(args.direction === 'IN' ? chargeSide - cash.IN : costSide - cash.OUT, 0);
        if (remaining <= 0) {
          continue;
        }
        entries.push({ sourceKind: 'OPS', sourceId: source.nativeId, expectedVersion: source.version, amount: remaining });
      }
      // Chi hộ leg groups by its counterparty — the customer (the engine is
      // one-counterparty-per-phiếu).
      if (entries.length > 0 && customerId != null) {
        const key = `ops:${customerId}`;
        const bucket = groups.get(key) ?? [];
        groups.set(key, [...bucket, ...entries]);
        // Card 20260928_197 — the voucher group total drops negative rows via
        // the shared rule. Entries are `remaining` amounts (already floored at
        // 0 upstream), so this is a guard, not a behaviour change today.
        totalsByGroup.set(key, (totalsByGroup.get(key) ?? 0) + sumExcludingNegative(entries, (entry) => entry.amount));
      }
    }
    let grandTotal = 0;
    const issued: Array<{ id: number; code: string; total: number }> = [];
    for (const [groupKey, entries] of groups) {
      const voucher = await createExpenseVoucher(tx, args.actor, {
        direction: args.direction,
        treasuryAccountId: args.treasuryAccountId,
        valueDate: new Date().toISOString().slice(0, 10),
        physicalReference: args.physicalReference ?? phoiPhieuPhysicalReference(groupKey, tripRows.map((row) => row.tripId)),
        entries,
      });
      grandTotal += totalsByGroup.get(groupKey) ?? 0;
      issued.push({ id: voucher.id, code: voucher.code, total: totalsByGroup.get(groupKey) ?? 0 });
    }
    if (issued.length === 0) {
      throw new ApiError(409, 'Các dòng đã chọn không còn khoản mở để lập phiếu.');
    }
    return { voucherId: issued[0]!.id, code: issued.map((voucher) => voucher.code).join(', '), total: grandTotal, entries: issued.length, issued };
  };
  return outer ? run(outer) : db.transaction(run);
}

/** Card 20260928_167/170 — the STK field offers the TWO fund sources only.
 *  `type='CASH'` alone also matched accounts nobody assigned a fund to
 *  (`fund_code IS NULL`), and the voucher engine then refuses that choice
 *  (`assertTreasuryFundAssigned`, treasury.service.ts), so the board could
 *  offer an STK the accountant can never post against. `FUND_SOURCES` is the
 *  same constant the fund book groups by, so the two cannot disagree about
 *  what a fund source is. */
export async function listPhoiPhieuStk(): Promise<Array<{ id: number; code: string; name: string }>> {
  return db.select({ id: s.treasuryAccounts.id, code: s.treasuryAccounts.code, name: s.treasuryAccounts.name })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), eq(s.treasuryAccounts.type, 'CASH'),
      inArray(s.treasuryAccounts.fundCode, [...FUND_SOURCES])))
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
      // Card 20260928_197 — `tra` is the signed cost side: a negative row must
      // leave Tổng trả exactly as if it did not exist. `thu` is the receivable
      // side (customerChargeAmount) and is NOT signed, so it keeps its add.
      tra: sumExcludingNegative(feeRows, (row) => row.amountTra),
    },
  };
}

export async function updatePhoiPhieuMeta(tripId: number, input: {
  ngayLayPhoi?: string | null; trangThaiLay?: string | null;
}, outer?: Tx): Promise<{ ok: true }> {
  const run = async (tx: Tx): Promise<{ ok: true }> => {
    const [existing] = await tx.select({ id: s.tripFinancialState.id })
      .from(s.tripFinancialState).where(eq(s.tripFinancialState.tripId, tripId)).limit(1).for('update');
    if (existing) {
      await tx.update(s.tripFinancialState).set({
        ...(input.ngayLayPhoi !== undefined ? { phoiTakenDate: input.ngayLayPhoi || null } : {}),
        ...(input.trangThaiLay !== undefined ? { phoiTakeStatus: input.trangThaiLay } : {}),
        updatedAt: new Date(),
      }).where(eq(s.tripFinancialState.id, existing.id));
      return { ok: true };
    }
    const [trip] = await tx.select({ shipmentId: s.trips.shipmentId }).from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
    await tx.insert(s.tripFinancialState).values({
      tripId,
      ...(input.ngayLayPhoi ? { phoiTakenDate: input.ngayLayPhoi } : {}),
      ...(input.trangThaiLay ? { phoiTakeStatus: input.trangThaiLay } : {}),
    });
    void trip;
    return { ok: true };
  };
  return outer ? run(outer) : db.transaction(run);
}
/** Remove a fee row from the dialog: VOID the source (history kept — the
 *  accounting rule) and void the entry, never a hard delete. */
export async function voidPhoiPhieuRow(tripId: number, sourceId: number, actor: AuthUser, reason: string, outer?: Tx) {
  const run = async (tx: Tx) => {
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
    if (source.linkedTripExpenseId) {
      await tx.update(s.tripExpenses).set({ approvalStatus: 'VOIDED', updatedAt: new Date() })
        .where(eq(s.tripExpenses.id, source.linkedTripExpenseId));
      await propagateRecordedExpense(tx, { expenseId: source.linkedTripExpenseId });
    }
    await tx.insert(s.auditLogs).values({
      userId: actor.userId, entityType: 'expense_accounting_source', entityId: sourceId,
      message: 'VOID phoi-phieu fee row', payload: { reason, tripId },
    });
    return { ok: true };
  };
  return outer ? run(outer) : db.transaction(run);
}

// ── Card 20260921_14: the accountant tiền-đường detail dialog ───────────────

export interface PhoiPhieuTienDuongRow {
  sourceId: number;
  version: number;
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
    version: s.expenseAccountingSources.version,
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
    version: row.version ?? 1,
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
      // Card 20260928_197 — the driver cost amount is signed, so a negative row
      // must leave both road-fee totals exactly as if it did not exist. A trip
      // holding only negative rows still holds rows, so both cells read a known
      // 0 rather than "chưa xác định" — the same distinction the totals below
      // made before the column became signed.
      total: sumExcludingNegative(feeRows, (row) => row.amount),
      confirmed: sumExcludingNegative(confirmedRows, (row) => row.amount),
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
  /** Card 20260928_173 AC2/AC3 "số lượng" — how many times this subject
   *  transacted inside the filtered period: the distinct trips carrying one of
   *  its recorded movements, plus each trip-less movement of its own (a
   *  correct-route linked replacement carries money with no trip to hang on).
   *  Also the AC2 sort key, so the repeat customers land next to each other. */
  soLuong: number;
  /** AC3 — the subject's RECEIVABLE leg in the period (cash IN on its own
   *  movements). Paired with cash OUT by the voucher eligibility set at
   *  `:270-271` and with the board's `chiHoThu`; one side is what the table
   *  already prints, and the other was dropped until AC3 asked for both. */
  phaiThu: number;
  /** AC3 — the subject's PAYABLE leg in the period (cash OUT). */
  phaiTra: number;
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
    return { rows: [], grand: { party: 'TỔNG CỘNG', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: null, soLuong: 0, phaiThu: 0, phaiTra: 0 } };
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

  const groups = new Map<string, { tienNang: number; tienHa: number; psKhac: number; da: number; ghiChu: string | null; soLuong: number; phaiThu: number; phaiTra: number; movements: Set<string> }>();
  for (const source of sources) {
    // A NULL trip (the correct-route linked-replacement nulls the source's
    // trip_id) must not silently drop the money from the report — it keeps
    // reporting, bucketed under the unknown party.
    const partyInfo = source.tripId != null ? tripParty.get(source.tripId) : undefined;
    const party = partyInfo?.name ?? 'Chưa xác định';
    const bucket = groups.get(party) ?? {
      tienNang: 0, tienHa: 0, psKhac: 0, da: 0, ghiChu: partyInfo?.ghiChu ?? null,
      soLuong: 0, phaiThu: 0, phaiTra: 0, movements: new Set<string>(),
    };
    const bucketKey = bucketByCategory(source.category);
    // Card 20260928_197 — the signed cost side drops negative rows; `da` (the
    // recorded cash allocation) is a separate money flow and keeps its add.
    // The row still creates the party bucket so its cash is still reported.
    const amount = sumExcludingNegative([source], (row) => row.amount ?? 0);
    if (bucketKey === 'nang') bucket.tienNang += amount;
    else if (bucketKey === 'ha') bucket.tienHa += amount;
    else bucket.psKhac += amount;
    // SAFETY: `getExpenseCashTotals` takes a transaction handle so its caller can
    // read inside the same tx; `db` is the module-level handle, which satisfies that
    // parameter at runtime. The cast only bridges drizzle's `Tx` vs `typeof db`
    // types — it does not change which connection the query runs on.
    const cash = await getExpenseCashTotals(db as unknown as Tx, source.id);
    bucket.da += query.kind === 'THU' ? cash.IN : cash.OUT;
    // Card 20260928_173 AC3 — a subject that moves on BOTH sides of the ledger
    // in one period must be one row carrying both figures, not a receivable row
    // plus a payable row. `getExpenseCashTotals` always returned both sides; the
    // old loop kept only the side its own table prints and dropped the other.
    // Recording both here is additive: `da` above — and therefore `tongPhaiThuTra`,
    // `conLai` and the TỔNG CỘNG — keep their exact meaning and value.
    bucket.phaiThu += cash.IN;
    bucket.phaiTra += cash.OUT;
    // AC2/AC3 `số lượng`: one per trip the subject transacted on, with a
    // trip-less movement counted as its own transaction. The Set is what makes
    // a lot with several fees on one trip read as ONE transaction, matching
    // "xhd nhiều lần 1 tháng" rather than "fee line nhiều lần".
    bucket.movements.add(source.tripId != null ? `trip:${source.tripId}` : `source:${source.id}`);
    groups.set(party, bucket);
  }

  const rows: PhoiPhieuReportRow[] = [...groups.entries()].map(([party, bucket]) => {
    const tong = bucket.tienNang + bucket.tienHa + bucket.psKhac;
    const conLai = tong - bucket.da;
    // Honest-and-additive: daThuTra reports the over-paid actual (may exceed
    // tong, conLai goes negative) so the FE over-pay annotation can fire.
    return { party, tienNang: bucket.tienNang, tienHa: bucket.tienHa, psKhac: bucket.psKhac,
      tongPhaiThuTra: tong, daThuTra: bucket.da, conLai, ghiChu: bucket.ghiChu,
      soLuong: bucket.movements.size, phaiThu: bucket.phaiThu, phaiTra: bucket.phaiTra };
  })
    // Card 20260928_173 AC2 — the PM's order: "Ưu tiên thứ tự, với những khách
    // xhd nhiều lần 1 tháng, được ưu tiên xếp nối tiếp" — the subjects that
    // transacted most come first, so the repeat customers sit side by side. The
    // name is the tiebreaker the PM's own ruling asks for: without it two
    // subjects with the same count could swap places between two renders of one
    // period. `localeCompare(…, 'vi')` is total and stable, so equal names
    // cannot reorder either — and the grouping above already merged them.
    .sort((a, b) => b.soLuong - a.soLuong || a.party.localeCompare(b.party, 'vi'));
  const grand = rows.reduce((acc, row) => ({
    party: 'TỔNG CỘNG', tienNang: acc.tienNang + row.tienNang, tienHa: acc.tienHa + row.tienHa,
    psKhac: acc.psKhac + row.psKhac, tongPhaiThuTra: acc.tongPhaiThuTra + row.tongPhaiThuTra,
    daThuTra: acc.daThuTra + row.daThuTra, conLai: acc.conLai + row.conLai, ghiChu: null,
    soLuong: acc.soLuong + row.soLuong, phaiThu: acc.phaiThu + row.phaiThu, phaiTra: acc.phaiTra + row.phaiTra,
  }), { party: 'TỔNG CỘNG', tienNang: 0, tienHa: 0, psKhac: 0, tongPhaiThuTra: 0, daThuTra: 0, conLai: 0, ghiChu: null, soLuong: 0, phaiThu: 0, phaiTra: 0 });
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
