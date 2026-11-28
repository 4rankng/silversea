// Card 20260923_12 — Chọn Debit: settlement rounds (đợt chốt debit).
// Kế toán ticks rows on the chot-debit board and opens Chọn Debit: one act
// persists one đợt per (customer, lần, tháng, chiều thu/trả) with the
// server-derived amount (THU = Σ Tổng thu, TRA = Σ Tổng 1 — Phí RU excluded,
// the board's P1 arithmetic), VAT 0/5/8/10 chosen at chốt time, and ghi chú.
// The TỔNG HỢP CÔNG NỢ KHÁCH HÀNG table reads these rows back.
//
// Guards (each red-first tested): lots exist; single customer; non-null EDD
// inside the popup range; VAT ∈ {0,5,8,10}; TRA requires ONE nhà xe across
// the selection (THU may span carriers → carrier_key MIXED); duplicate lần
// per (customer, month, direction) → 400; a lot already inside another round
// → 400 (lot-overlap guard); pending rate adjustment → 409 (the same guard
// the debit-issuance routes run).
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { effectiveBillingPlate, vatForAmount, type BillingDocumentLine } from '@tingting/shared';
import * as s from '../db/schema';
import { db } from '../db';
import { operationalName } from '../db/master-data-name';
import { ApiError } from '../errors';
import { getAccountingDebitBoard } from './accounting-debit-close.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { carrierKeysForLot, assertRoundIssuanceTotals, buildDebitRoundVarianceReport, type CarrierDerivationEntry, type DebitRoundVarianceLineInput, type DebitRoundVarianceReport } from './debit-settlement-shared';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { assertNoPendingApprovalFees } from './shipment-pending-fees.service';
import { buildFrozenShipmentDebitLines } from './shipment-cost-lock-lines';
import { loadRevGroupMergeContext, revGroupMergeNote } from './rev-group-merge-note.service';
import { documentVatTotals } from './billing-document-shared.service';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';

export interface CreatedDebitSettlementRound {
  id: number;
  customerId: number;
  direction: 'THU' | 'TRA';
  carrierKey: string;
  periodKey: string;
  roundNo: number;
  dateFrom: string;
  dateTo: string;
  amount: string;
  vatRate: number;
  ghiChu: string | null;
  lotCount: number;
}

export interface DebitSettlementRoundListRow extends CreatedDebitSettlementRound {
  customerName: string | null;
  carrierLabel: string | null;
  vatAmount: number;
  totalAmount: number;
  createdAt: string;
}

const VAT_RATES: readonly number[] = [0, 5, 8, 10];

/** Active-trip carrier entries per lot (same trip scope the board uses). */
async function loadLotCarrierEntries(
  executor: { select: typeof db.select },
  lotIds: number[],
): Promise<Map<number, CarrierDerivationEntry[]>> {
  const rows = await executor.select({
    shipmentId: s.trips.shipmentId,
    plate: s.trucks.licensePlate,
    carrierId: s.trucks.carrierId,
    externalEntityId: s.tripCarrierInfo.externalEntityId,
    externalEntityType: s.tripCarrierInfo.externalEntityType,
    externalPlate: s.tripCarrierInfo.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.shipmentId, lotIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ));
  const byLot = new Map<number, CarrierDerivationEntry[]>();
  for (const row of rows) {
    if (row.shipmentId == null) continue;
    const list = byLot.get(row.shipmentId) ?? [];
    list.push({ plate: row.carrierId == null ? row.plate : null, carrierId: row.carrierId, externalId: row.externalEntityType === 'CUSTOMER' && row.externalEntityId != null ? row.externalEntityId : null, externalPlate: row.externalPlate });
    byLot.set(row.shipmentId, list);
  }
  return byLot;
}

export async function createDebitSettlementRound(input: {
  shipmentIds: number[];
  dateFrom: string;
  dateTo: string;
  roundNo: number;
  month: number;
  year: number;
  direction: 'THU' | 'TRA';
  vatRate: number;
  ghiChu?: string;
  userId: number;
}, transaction?: Tx): Promise<CreatedDebitSettlementRound> {
  const execute = async (tx: Tx): Promise<CreatedDebitSettlementRound> => {
    const shipmentIds = [...new Set(input.shipmentIds)].sort((a, b) => a - b);
    // ── 1. lots exist, same customer, dated inside the popup range ──
    const lots = await tx.select({
      id: s.shipments.id,
      tradeDirection: s.shipments.tradeDirection,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
      customerId: s.shipments.customerId,
      ngay: s.shipments.expectedDeliveryDate,
    }).from(s.shipments)
      .where(and(inArray(s.shipments.id, shipmentIds), isNull(s.shipments.deletedAt)));
    const lotLabel = (lot: { tradeDirection: 'IMPORT' | 'EXPORT' | null; blNumber: string | null; bookingRef: string | null }) =>
      billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? 'chưa có số Bill/Booking';
    const foundIds = new Set(lots.map((l) => l.id));
    const missing = shipmentIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ApiError(404, `Lô hàng ${missing.join(', ')} không tồn tại hoặc đã bị xóa.`);
    }
    const customerIds = [...new Set(lots.map((l) => l.customerId))];
    if (customerIds.length !== 1) {
      throw new ApiError(400, 'Các lô đã chọn phải thuộc cùng một khách hàng.');
    }
    const customerId = customerIds[0]!;
    const noDate = lots.filter((l) => l.ngay == null);
    if (noDate.length > 0) {
      throw new ApiError(400, `Lô ${noDate.map((l) => lotLabel(l)).join(', ')} chưa có ngày giao.`);
    }
    // SIL-883 (3.2) — Chọn Debit hard-blocks while any selected lot still
    // carries a fee awaiting Kế toán duyệt (the same count the boards render).
    await assertNoPendingApprovalFees(tx, shipmentIds, 'chọn Debit');
    const outOfRange = lots.filter((l) => l.ngay! < input.dateFrom || l.ngay! > input.dateTo);
    if (outOfRange.length > 0) {
      throw new ApiError(400, `Lô ${outOfRange.map((l) => lotLabel(l)).join(', ')} có ngày giao ngoài khoảng đã chọn.`);
    }
    // ── 2. nhà xe derivation: server-side truth from the lots' active trips ──
    const entriesByLot = await loadLotCarrierEntries(tx, shipmentIds);
    const keysByLot = new Map<number, string[]>();
    const noCarrier: string[] = [];
    const unionSet = new Set<string>();
    for (const lot of lots) {
      const keys = carrierKeysForLot(entriesByLot.get(lot.id) ?? []);
      keysByLot.set(lot.id, keys);
      if (keys.length === 0) noCarrier.push(lotLabel(lot));
      for (const key of keys) unionSet.add(key);
    }
    // Chốt PHẢI THU settles with the CUSTOMER — the nhà xe side is not the
    // counterparty, so a lot without any identifiable nhà xe is fine here
    // (carrier_key MIXED). Chốt PHẢI TRẢ settles with the nhà xe, which must
    // exist and be ONE across the selection.
    const union = [...unionSet];
    if (input.direction === 'TRA') {
      if (noCarrier.length > 0) {
        throw new ApiError(400, `Lô ${noCarrier.join(', ')} chưa có phân xe (chưa xác định được nhà xe).`);
      }
      if (union.length !== 1) {
        throw new ApiError(400, 'Chốt phải trả yêu cầu các lô cùng một nhà xe (hiện có nhiều nhà xe trong lựa chọn).');
      }
    }
    const carrierKey = input.direction === 'THU' ? (union.length === 1 ? union[0]! : 'MIXED') : union[0]!;
    // ── 3. VAT set guard ──
    if (!VAT_RATES.includes(input.vatRate)) {
      throw new ApiError(400, 'Thuế suất VAT phải là 0/5/8/10%.');
    }
    // ── 4. amounts: the board ladder is the single money truth ──
    // (V22's pending-rate-adjustment 409 was retired 24/11, mục 12 — the
    // historical PENDING rows no longer block Chọn Debit.)
    const board = await getAccountingDebitBoard({ dateFrom: input.dateFrom, dateTo: input.dateTo });
    const rowsById = new Map(board.items.map((row) => [row.shipmentId, row]));
    let amount = 0;
    // FIN-01 — the per-lot contribution each lot paid into the sum, frozen at
    // chốt time so the variance read can localize a drift per LINE long after
    // the board moved on (the 639.200 ₫ QA case had only the two aggregates).
    const basisByLot = new Map<number, number>();
    for (const lot of lots) {
      const row = rowsById.get(lot.id);
      if (!row) {
        throw new ApiError(404, `Lô ${lotLabel(lot)} không tồn tại trong khoảng đã chọn.`);
      }
      const basis = input.direction === 'THU' ? row.thu.tongThu : row.tra.tong1;
      if (basis == null) {
        throw new ApiError(400, `Lô ${lotLabel(lot)} chưa xác định được số tiền ${input.direction === 'THU' ? 'phải thu' : 'phải trả'} — chưa thể chốt.`);
      }
      basisByLot.set(lot.id, Number(basis));
      amount += Number(basis);
    }
    // ── 6. duplicate-lần + lot-overlap: clean 400s before the guarded write ──
    const periodKey = `${input.year}-${String(input.month).padStart(2, '0')}`;
    const overlaps = await tx.select({
      tradeDirection: s.shipments.tradeDirection,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
      shipmentId: s.debitSettlementRoundLots.shipmentId,
      roundNo: s.debitSettlementRounds.roundNo,
      periodKey: s.debitSettlementRounds.periodKey,
    }).from(s.debitSettlementRoundLots)
      .innerJoin(s.debitSettlementRounds, eq(s.debitSettlementRounds.id, s.debitSettlementRoundLots.roundId))
      .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
      .where(inArray(s.debitSettlementRoundLots.shipmentId, shipmentIds));
    if (overlaps.length > 0) {
      const named = overlaps.map((o) => `Lô ${lotLabel(o)} (Lần ${o.roundNo} · ${o.periodKey})`).join(', ');
      throw new ApiError(400, `Lô đã thuộc một đợt chốt: ${named}.`);
    }
    const duplicate = await tx.select({ id: s.debitSettlementRounds.id })
      .from(s.debitSettlementRounds)
      .where(and(
        eq(s.debitSettlementRounds.customerId, customerId),
        eq(s.debitSettlementRounds.periodKey, periodKey),
        eq(s.debitSettlementRounds.direction, input.direction),
        eq(s.debitSettlementRounds.roundNo, input.roundNo),
      ));
    if (duplicate.length > 0) {
      throw new ApiError(400, `Lần ${input.roundNo} đã chốt cho khách hàng này trong tháng ${input.month}/${input.year} (chiều ${input.direction === 'THU' ? 'phải thu' : 'phải trả'}).`);
    }
    // ── 7. guarded write: advisory lock + insert round + lots, ONE transaction ──
    await lockApplicationOwnedUniquenessSet(tx, [{ scope: 'debit-settlement-round', parts: [customerId, periodKey] }]);
    const [created] = await tx.insert(s.debitSettlementRounds).values({
      customerId,
      direction: input.direction,
      carrierKey,
      periodKey,
      roundNo: input.roundNo,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      amount: String(amount),
      vatRate: input.vatRate,
      ghiChu: input.ghiChu?.trim() || null,
      createdBy: input.userId,
    }).returning();
    await tx.insert(s.debitSettlementRoundLots).values(
      shipmentIds.map((shipmentId) => ({
        roundId: created.id,
        shipmentId,
        // FIN-01 — the per-lot chốt basis (nullable column; always present for
        // rounds created from here on — the guard above refused null bases).
        amount: String(basisByLot.get(shipmentId)),
      })),
    );
    return {
      id: created.id,
      customerId,
      direction: created.direction as 'THU' | 'TRA',
      carrierKey: created.carrierKey,
      periodKey: created.periodKey,
      roundNo: created.roundNo,
      dateFrom: created.dateFrom,
      dateTo: created.dateTo,
      amount: created.amount,
      vatRate: created.vatRate,
      ghiChu: created.ghiChu,
      lotCount: shipmentIds.length,
    };
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

/** All settlement rounds, newest period first — the TỔNG HỢP CÔNG NỢ table. */
export async function listDebitSettlementRounds(): Promise<{ items: DebitSettlementRoundListRow[] }> {
  const rounds = await db.select().from(s.debitSettlementRounds)
    .orderBy(desc(s.debitSettlementRounds.periodKey), s.debitSettlementRounds.roundNo);
  const nameIds = new Set<number>(rounds.map((r) => r.customerId));
  for (const round of rounds) {
    if (round.carrierKey.startsWith('CUST:')) nameIds.add(Number(round.carrierKey.slice(5)));
  }
  const nameRows = nameIds.size > 0 ? await db.select({
    id: s.customers.id,
    // Card 201026095604a: the rounds table names ride the master-data short
    // name — same projection law as the chốt-debit board it sits under.
    name: operationalName(s.customers.shortName, s.customers.name),
  })
    .from(s.customers).where(inArray(s.customers.id, [...nameIds])) : [];
  const names = new Map(nameRows.map((r) => [r.id, r.name]));
  const countRows = await db.select({
    roundId: s.debitSettlementRoundLots.roundId,
    lots: sql<number>`count(*)::int`,
  }).from(s.debitSettlementRoundLots).groupBy(s.debitSettlementRoundLots.roundId);
  const counts = new Map(countRows.map((r) => [r.roundId, r.lots]));
  return { items: rounds.map((round) => ({
    id: round.id,
    customerId: round.customerId,
    customerName: names.get(round.customerId) ?? null,
    direction: round.direction as 'THU' | 'TRA',
    carrierKey: round.carrierKey,
    carrierLabel: carrierKeyLabel(round.carrierKey, names),
    periodKey: round.periodKey,
    roundNo: round.roundNo,
    dateFrom: round.dateFrom,
    dateTo: round.dateTo,
    amount: round.amount,
    vatRate: round.vatRate,
    vatAmount: vatForAmount(round.amount, round.vatRate),
    totalAmount: Number(round.amount) + vatForAmount(round.amount, round.vatRate),
    ghiChu: round.ghiChu,
    lotCount: counts.get(round.id) ?? 0,
    createdAt: round.createdAt.toISOString(),
  })) };
}

/** Read-side label for the informational carrier key (TỔNG HỢP table). */
function carrierKeyLabel(carrierKey: string, names: Map<number, string>): string | null {
  if (carrierKey === 'OWN') return 'Xe công ty';
  if (carrierKey === 'MIXED') return 'Nhiều nhà xe';
  if (carrierKey.startsWith('CUST:')) return names.get(Number(carrierKey.slice(5))) ?? null;
  if (carrierKey.startsWith('PLATE:')) return carrierKey.slice(6) || null;
  return null;
}

// vatForAmount lives in @tingting/shared (single implementation — the FE
// period summary composes the same math); behavior byte-identical to the
// former local copy: round(base × rate)/100, base is pre-VAT.

// ─── Ticket 18/11 Task 2.4 (SIL-855) — Debit Note ↔ đợt chốt ───────────────

export interface DebitNoteRoundPreviewItem {
  shipmentId: number;
  /** SIL-868 (hotfix CR-009.1) — the modal's identity is the SỐ BILL/BOOKING
   *  (direction-aware, the same helper the boards print): the internal
   *  SHP-* code never reaches the preview. */
  billOrBooking: string | null;
  customerName: string | null;
  /** BKS BÁO KHÁCH — the customer-facing plate. THU rounds only: a TRA
   *  (phải trả nhà xe) statement carries null here so the customer plate can
   *  NEVER reach the nhà xe ledger (K3.86/K6.32). */
  billingTruckNo: string | null;
  /** SIL-1092 (K6.32) — BKS THỰC of the lot's active trips (own-fleet truck
   *  plate / external carrier plate, the board's own projection), falling
   *  back to the lot's ĐV-assigned actualTruckNo. The nhà xe reconciles on
   *  this plate, never on the billing one. */
  actualTruckNo: string | null;
  /** SIL-1092 (K6.32) — loại xe TÍNH CƯỚC TRẢ: the lot's cost vehicle class
   *  (the same class the AP billing mirror stamps, billing-export/ AP draft
   *  law), null when the lot carries none — never a fabricated label. */
  vehicleType: string | null;
  /** SIL-1094 (KB §3.6.5 K3.87) — the row's merge note ("Ghép xe cùng Bill
   *  [Số Bill Lô 1]" for a rev-group member lot), else null. */
  mergeNote: string | null;
  net: number;
  costLockedAt: string | null;
}

export interface DebitNoteRoundPreview {
  round: {
    id: number;
    roundNo: number;
    periodKey: string;
    direction: 'THU' | 'TRA';
    vatRate: number;
    customerName: string | null;
  };
  items: DebitNoteRoundPreviewItem[];
  totals: { net: number; tax: number; gross: number };
}

/** Bảng xem trước Xuất Debit Note for ONE đợt (Lần · Tháng · Năm) — the rows
 *  and the four closing totals are computed from the SAME frozen-lock basis
 *  the [Lưu] issuance uses (buildFrozenShipmentDebitLines + documentVatTotals,
 *  both under the đợt's recorded vatRate), so what the accountant previews is
 *  byte-equal to what lands in Công nợ. Plate law is DIRECTION-AWARE
 *  (K3.86 + K6.32, SIL-1092): a THU (phải thu khách) đợt previews BKS BÁO
 *  KHÁCH (effectiveBillingPlate, trip-plate fallback); a TRA (phải trả nhà
 *  xe) đợt is the NHÀ XE statement — its items carry BKS THỰC + loại xe tính
 *  cước trả (cost class) and the billing-plate field goes out null, so the
 *  customer plate can never reach the nhà xe ledger. Unlocked lots refuse
 *  with the codes named (khóa trước, xuất sau). */
export async function getDebitNoteRoundPreview(roundId: number): Promise<DebitNoteRoundPreview> {
  const [round] = await db.select().from(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, roundId)).limit(1);
  if (!round) throw new ApiError(404, 'Không tìm thấy đợt chốt (Lần/Tháng/Năm).');
  const lotRows = await db.select({ shipmentId: s.debitSettlementRoundLots.shipmentId })
    .from(s.debitSettlementRoundLots).where(eq(s.debitSettlementRoundLots.roundId, roundId));
  const shipmentIds = lotRows.map((row) => row.shipmentId).sort((a, b) => a - b);
  const [nameRow] = await db.select({ name: operationalName(s.customers.shortName, s.customers.name) })
    .from(s.customers).where(eq(s.customers.id, round.customerId)).limit(1);
  const roundHeader: DebitNoteRoundPreview['round'] = {
    id: round.id,
    roundNo: round.roundNo,
    periodKey: round.periodKey,
    direction: round.direction as 'THU' | 'TRA',
    vatRate: round.vatRate,
    customerName: nameRow?.name ?? null,
  };
  if (shipmentIds.length === 0) return { round: roundHeader, items: [], totals: { net: 0, tax: 0, gross: 0 } };

  // SIL-1092 (K6.32) — the TRA pricing class (cost axis), aliased beside the
  // rev join so cả hai trục loại xe ride one query (the billing-export alias
  // convention).
  const costVehicleClass = alias(s.vehicleSizeClasses, 'debit_round_cost_vehicle_class');
  const lots = await db.select({
    id: s.shipments.id,
    customerId: s.shipments.customerId,
    rawCustomerName: s.shipments.rawCustomerName,
    shipmentCode: s.shipments.shipmentCode,
    tradeDirection: s.shipments.tradeDirection,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    billingTruckNo: s.shipments.billingTruckNo,
    actualTruckNo: s.shipments.actualTruckNo,
    cargoMode: s.shipments.cargoMode,
    revVehicleClassName: s.vehicleSizeClasses.name,
    revVehicleClassCode: s.vehicleSizeClasses.code,
    costVehicleClassName: costVehicleClass.name,
    costVehicleClassCode: costVehicleClass.code,
  }).from(s.shipments)
    .leftJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.shipments.revVehicleClassId))
    .leftJoin(costVehicleClass, eq(costVehicleClass.id, s.shipments.costVehicleClassId))
    .where(inArray(s.shipments.id, shipmentIds));
  if (lots.length !== shipmentIds.length) throw new ApiError(404, 'Có lô hàng trong đợt không tồn tại hoặc đã bị xóa.');

  const lockRows = await db.select({
    shipmentId: s.shipmentCostLocks.shipmentId,
    lockedAt: s.shipmentCostLocks.lockedAt,
    snapshot: s.shipmentCostLocks.costSnapshot,
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, shipmentIds),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  const lockedById = new Map(lockRows.map((row) => [row.shipmentId, row]));
  const unlocked = lots.filter((lot) => !lockedById.has(lot.id));
  if (unlocked.length > 0) {
    const names = unlocked.map((lot) => billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? 'chưa có số Bill/Booking').join(', ');
    throw new ApiError(409,
      `Đợt còn ${unlocked.length} lô chưa khóa chi phí: ${names}`
      + ' — hãy khóa chi phí các lô (Khóa lô / Khóa & xem trước) rồi xem lại bảng xem trước.');
  }

  // SIL-855 QA — BKS BÁO KHÁCH must name the plate the customer was actually
  // told. effectiveBillingPlate covers the CUS "xe ảo" text (and LCL's lot-row
  // BKS thực); when the lot row itself is blank, the ĐV-assigned trip plates —
  // the same non-canceled-trip projection the board's Phân xe / BKS thực
  // columns read — are the honest fallback, never a fabricated '—'. Issued
  // lines keep their own plate law (renderData stays effectiveBillingPlate);
  // this column is the preview's display truth. SIL-1092 (K6.32): a TRA
  // (phải trả nhà xe) statement carries NO billing plate at all — the wire
  // field goes out null so the customer-facing plate can never reach the
  // nhà xe ledger.
  // SIL-1094 (KB §3.6.5 K3.87) — the merge-note law ("Ghép xe cùng Bill
  // [Số Bill Lô 1]" per rev-group member row), the SAME context the [Lưu]
  // issuance stamps — preview ≡ issued by construction.
  const mergeCtx = await loadRevGroupMergeContext(db, shipmentIds);
  const tripPlateRows = await db.select({
    shipmentId: s.trips.shipmentId,
    ownPlate: s.trucks.licensePlate,
    truckCarrierId: s.trucks.carrierId,
    externalPlate: s.tripCarrierInfo.externalPlateNumber,
  }).from(s.trips)
    .leftJoin(s.trucks, eq(s.trucks.id, s.trips.truckId))
    .leftJoin(s.tripCarrierInfo, eq(s.tripCarrierInfo.tripId, s.trips.id))
    .where(and(
      inArray(s.trips.shipmentId, shipmentIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
    ))
    .orderBy(s.trips.id);
  const previewPlateOf = (lot: { id: number; billingTruckNo: string | null; actualTruckNo: string | null; cargoMode: string | null }): string | null => {
    const direct = effectiveBillingPlate(lot);
    if (direct) return direct;
    const plates: string[] = [];
    for (const row of tripPlateRows) {
      if (row.shipmentId !== lot.id) continue;
      // Mirror the board: an own-fleet truck prints its plate; a
      // subcontracted truck labels by carrier and shows the external plate.
      const plate = (row.truckCarrierId == null ? row.ownPlate : null) ?? row.externalPlate;
      const trimmed = plate?.trim();
      if (trimmed && !plates.includes(trimmed)) plates.push(trimmed);
    }
    return plates.length > 0 ? plates.join(', ') : null;
  };
  // SIL-1092 (K6.32) — BKS THỰC: the same non-canceled-trip projection the
  // board's BKS-thực column reads (own-fleet truck plate / external carrier
  // plate), falling back to the lot's ĐV-assigned actualTruckNo ('Gán xe
  // nhóm'). Never the billing plate.
  const realPlateOf = (lot: { id: number; actualTruckNo: string | null }): string | null => {
    const plates: string[] = [];
    for (const row of tripPlateRows) {
      if (row.shipmentId !== lot.id) continue;
      const plate = (row.truckCarrierId == null ? row.ownPlate : null) ?? row.externalPlate;
      const trimmed = plate?.trim();
      if (trimmed && !plates.includes(trimmed)) plates.push(trimmed);
    }
    if (plates.length > 0) return plates.join(', ');
    const fallback = lot.actualTruckNo?.trim();
    return fallback || null;
  };
  // SIL-1092 (K6.32) — loại xe TÍNH CƯỚC TRẢ: the cost vehicle class, the
  // same field the AP billing mirror stamps (billing-export-shared /
  // billing-document-draft law). null = the lot carries no cost class —
  // rendered '—', never inferred from the rev class or the plate.
  const payableVehicleTypeOf = (lot: { costVehicleClassName: string | null; costVehicleClassCode: string | null }): string | null =>
    lot.costVehicleClassName?.trim() || lot.costVehicleClassCode?.trim() || null;

  // SIL-1092 live-verify (27/11, staging round 11): a TRA đợt's money is the
  // board's Tổng-1 ladder — the SAME read [Chọn Debit] summed into
  // round.amount (merged derived channels + overrides). The frozen lock
  // snapshot freezes the RECEIVABLE side only, so summing the receivable
  // lines against a payable round mismatched by construction (real staging
  // data 409ed: snapshot 0 ₫ vs chốt 110.000 ₫). THU keeps the frozen
  // receivable law — its preview ≡ the [Lưu] issuance lines byte-for-byte.
  const isTra = round.direction === 'TRA';
  const traLadderByLot = new Map<number, number | null>();
  if (isTra) {
    const board = await getAccountingDebitBoard({ dateFrom: round.dateFrom, dateTo: round.dateTo });
    const roundLotSet = new Set(shipmentIds);
    for (const boardRow of board.items) {
      if (roundLotSet.has(boardRow.shipmentId)) {
        traLadderByLot.set(boardRow.shipmentId, boardRow.tra.tong1 == null ? null : Number(boardRow.tra.tong1));
      }
    }
  }

  const items: DebitNoteRoundPreviewItem[] = [];
  const allLines: BillingDocumentLine[] = [];
  for (const lot of lots) {
    const lockRow = lockedById.get(lot.id)!;
    const rowFacts = {
      shipmentId: lot.id,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      customerName: lot.rawCustomerName?.trim() || null,
      actualTruckNo: realPlateOf(lot),
      vehicleType: payableVehicleTypeOf(lot),
      mergeNote: revGroupMergeNote(mergeCtx.membershipByLot.get(lot.id), mergeCtx.principalRefByGroup),
      costLockedAt: lockRow.lockedAt?.toISOString() ?? null,
    };
    if (isTra) {
      items.push({
        ...rowFacts,
        // The payable statement's money cell is the board ladder's Tổng 1
        // (cước trả ĐV + lạch huyền ĐV + phát sinh ĐV, override-aware). An
        // unknown cell counts 0 here — the totals assertion still names the
        // mismatch against the chốt, never a fabricated line.
        billingTruckNo: null,
        net: traLadderByLot.get(lot.id) ?? 0,
      });
      continue;
    }
    const lines = buildFrozenShipmentDebitLines(
      (lockRow.snapshot ?? {}) as Record<string, unknown>,
      lot.shipmentCode ?? String(lot.id),
      {
        billingTruckNo: effectiveBillingPlate(lot),
        vehicleType: lot.revVehicleClassName ?? lot.revVehicleClassCode,
        // SIL-1094 — the merged member row cites the merge (GHI CHÚ column).
        note: revGroupMergeNote(mergeCtx.membershipByLot.get(lot.id), mergeCtx.principalRefByGroup),
        // SIL-855 — the đợt's VAT rides the SAME frozen lines the [Lưu]
        // issuance stamps (both under round.vatRate), so the four preview
        // totals are byte-equal to what lands in Công nợ.
        vatRatePercent: round.vatRate,
      },
    );
    const lotTotals = documentVatTotals(lines);
    allLines.push(...lines);
    items.push({
      ...rowFacts,
      billingTruckNo: previewPlateOf(lot),
      net: lotTotals.net,
    });
  }
  // SIL-855 money law — the preview must equal the round record before it is
  // allowed to exist at all: a freeze that lost a lot's money 409s here so
  // the accountant sees the block INSTEAD of a half-money table (R3P-677-C
  // showed 0 ₫ and [Lưu] posted half of round 5). TRA compares the same
  // board ladder the chốt summed.
  const totals = isTra
    ? (() => {
        const net = items.reduce((sum, item) => sum + item.net, 0);
        const tax = vatForAmount(net, round.vatRate);
        return { net, tax, gross: net + tax };
      })()
    : documentVatTotals(allLines);
  assertRoundIssuanceTotals(totals, round, isTra
    ? 'Chiều TRA đối chiếu bảng điều động (Tổng 1) với đợt chốt — bảng đã đổi tiền sau khi chốt thì xem lại đợt trước khi xuất bản kê.'
    : undefined);
  return { round: roundHeader, items, totals };
}

// ─── FIN-01 (QA 28/11, đợt Lần 12 · 2026-11): line-level variance + controlled ─
// ─── reconciliation with an audit trail ────────────────────────────────────────
// The mismatch guard (assertRoundIssuanceTotals) 409s the preview with the two
// aggregates only — the accountant cannot see WHICH lot drifted, and has no
// controlled path back to an exportable state short of unlock/re-lock dances
// that never touch the recorded total. This block adds:
//   GET  …/settlement-rounds/:id/variance  — the per-lot variance table (the
//       export basis each line would print vs the money the đợt recorded for
//       it at chốt time) + the round's reconciliation audit trail;
//   POST …/settlement-rounds/:id/reconcile — realigns the recorded total to
//       Σ the underlying charges, ONLY with a mandatory reason + actor, one
//       audit_logs row (before → after, old→new, who/when/why) inside the
//       same transaction as the write. The hard block stays: a variance đợt
//       still cannot preview-pass or export until reconciled.

export interface DebitRoundVarianceAuditEvent {
  at: string;
  actorName: string | null;
  reason: string;
  beforeAmount: number;
  afterAmount: number;
  varianceNet: number;
}

/** The per-lot variance table for ONE đợt + its reconciliation trail. The
 *  export basis mirrors the preview EXACTLY (THU: the frozen lock snapshot
 *  per lot; TRA: the board's Tổng 1 ladder) so a line that shows no diff is a
 *  line the export will print unchanged. A line missing its basis carries
 *  `null` money + `basisError` verbatim — never a fabricated 0₫. The
 *  closed-per-lot money is the chốt-time column (amount) when the round
 *  recorded it; legacy rounds predate the column → the live board ladder
 *  fallback, labeled BOARD_FALLBACK on the report. */
export async function getDebitSettlementRoundVariance(roundId: number): Promise<DebitRoundVarianceReport & { history: DebitRoundVarianceAuditEvent[] }> {
  const [round] = await db.select().from(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, roundId)).limit(1);
  if (!round) throw new ApiError(404, 'Không tìm thấy đợt chốt (Lần/Tháng/Năm).');
  const isTra = round.direction === 'TRA';

  // The đợt's lots WITH their recorded per-lot chốt basis (the FIN-01 column).
  const lotRows = await db.select({
    shipmentId: s.debitSettlementRoundLots.shipmentId,
    chotAmount: s.debitSettlementRoundLots.amount,
    shipmentCode: s.shipments.shipmentCode,
    tradeDirection: s.shipments.tradeDirection,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
  }).from(s.debitSettlementRoundLots)
    .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
    .where(eq(s.debitSettlementRoundLots.roundId, roundId))
    .orderBy(s.debitSettlementRoundLots.shipmentId);

  const lockRows = await db.select({
    shipmentId: s.shipmentCostLocks.shipmentId,
    snapshot: s.shipmentCostLocks.costSnapshot,
  }).from(s.shipmentCostLocks)
    .where(and(
      inArray(s.shipmentCostLocks.shipmentId, lotRows.length ? lotRows.map((row) => row.shipmentId) : [-1]),
      isNull(s.shipmentCostLocks.unlockedAt),
    ));
  const lockedById = new Map(lockRows.map((row) => [row.shipmentId, row]));

  // The live board ladder — the TRA export basis, and the closed-per-lot
  // fallback for legacy rounds whose chốt predates the per-lot column.
  const board = lotRows.length > 0
    ? await getAccountingDebitBoard({ dateFrom: round.dateFrom, dateTo: round.dateTo })
    : { items: [] };
  const boardByLot = new Map(board.items.map((row) => [row.shipmentId, row]));
  const boardCellOf = (shipmentId: number): string | null => {
    const row = boardByLot.get(shipmentId);
    if (!row) return null;
    return isTra ? row.tra.tong1 : row.thu.tongThu;
  };

  const lines: DebitRoundVarianceLineInput[] = lotRows.map((lot) => {
    let exportNet: number | null = null;
    let basisError: string | null = null;
    if (isTra) {
      const cell = boardCellOf(lot.shipmentId);
      exportNet = cell == null ? null : Number(cell);
      if (exportNet == null) basisError = 'Bảng điều động chưa có Tổng 1 cho lô này — chưa thể tính dòng bản kê.';
    } else {
      const lockRow = lockedById.get(lot.shipmentId);
      if (!lockRow) {
        basisError = 'Lô chưa khóa chi phí — chưa có nền số liệu khóa để đối chiếu.';
      } else {
        // The SAME frozen-basis math the preview runs per lot. A broken
        // freeze (the usual root cause of the aggregate mismatch) surfaces
        // HERE as the line's own error instead of hiding the whole table.
        try {
          const frozenLines = buildFrozenShipmentDebitLines(
            (lockRow.snapshot ?? {}) as Record<string, unknown>,
            lot.shipmentCode ?? String(lot.shipmentId),
            { vatRatePercent: round.vatRate },
          );
          exportNet = documentVatTotals(frozenLines).net;
        } catch (error) {
          basisError = error instanceof ApiError ? error.message : 'Bản khóa lô không đọc được số tiền.';
        }
      }
    }
    const stored = lot.chotAmount == null ? null : Number(lot.chotAmount);
    const fallback = boardCellOf(lot.shipmentId);
    const closedNet = stored ?? (fallback == null ? null : Number(fallback));
    return {
      shipmentId: lot.shipmentId,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      exportNet,
      closedNet,
      basisError,
    };
  });

  const report = buildDebitRoundVarianceReport({
    round: {
      id: round.id,
      roundNo: round.roundNo,
      periodKey: round.periodKey,
      direction: round.direction as 'THU' | 'TRA',
      vatRate: round.vatRate,
      amount: round.amount,
    },
    lines,
    closedBasis: lotRows.every((lot) => lot.chotAmount != null) ? 'CHOT_RECORDED' : 'BOARD_FALLBACK',
  });

  // The reconciliation trail: the round's own audit rows, newest first — the
  // dialog renders them so a corrected total shows who/why/old→new beside it.
  const auditRows = await db.select({
    timestamp: s.auditLogs.timestamp,
    actorName: s.auditLogs.actorName,
    payload: s.auditLogs.payload,
  }).from(s.auditLogs)
    .where(and(
      eq(s.auditLogs.entityType, 'debit_settlement_round'),
      eq(s.auditLogs.entityId, roundId),
      eq(s.auditLogs.message, 'DEBIT_SETTLEMENT_ROUND_RECONCILED'),
    ))
    .orderBy(desc(s.auditLogs.timestamp))
    .limit(10);
  const history: DebitRoundVarianceAuditEvent[] = auditRows.flatMap((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const before = payload.before as { amount?: unknown } | undefined;
    const after = payload.after as { amount?: unknown } | undefined;
    const beforeAmount = Number(before?.amount);
    const afterAmount = Number(after?.amount);
    const varianceNet = Number(payload.varianceNet);
    if (!Number.isFinite(beforeAmount) || !Number.isFinite(afterAmount)) return [];
    return [{
      at: row.timestamp.toISOString(),
      actorName: row.actorName ?? null,
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      beforeAmount,
      afterAmount,
      varianceNet: Number.isFinite(varianceNet) ? varianceNet : afterAmount - beforeAmount,
    }];
  });

  return { ...report, history };
}

export interface ReconciledDebitSettlementRound {
  roundId: number;
  roundNo: number;
  periodKey: string;
  direction: 'THU' | 'TRA';
  lotCount: number;
  before: { amount: number; vat: number; gross: number };
  after: { amount: number; vat: number; gross: number };
  varianceNet: number;
  reconciledBy: number;
  reconciledByName: string | null;
  reconciledAt: string;
  reason: string;
}

/** Controlled reconciliation: realign the đợt's recorded closed total to Σ the
 *  underlying charges (the SAME basis the preview and the [Lưu] issuance
 *  print), ONLY with a mandatory reason + actor. The write and its audit row
 *  (before → after, who/when/why) share ONE transaction. Guards: the đợt
 *  exists; every lot carries its export basis (THU: all locked, freezes
 *  readable — the builder's own 409 surfaces; TRA: every ladder cell summed);
 *  nothing of the đợt has issued into a Debit Note (a corrected record behind
 *  an issued document would desync Công nợ); there IS a variance to reconcile
 *  (the zero-diff control refuses — no silent write, no audit noise); and the
 *  post-write record must PASS the money law (assertRoundIssuanceTotals) or
 *  the act is refused — a reconciliation that still could not export would
 *  just move the mismatch. */
export async function reconcileDebitSettlementRound(input: {
  roundId: number;
  reason: string;
  actor: AuthUser;
}, transaction?: Tx): Promise<ReconciledDebitSettlementRound> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) throw new ApiError(400, 'Vui lòng nhập lý do đối chiếu.');
  if (reason.length > 2000) throw new ApiError(400, 'Lý do đối chiếu không được vượt quá 2000 ký tự.');
  const execute = async (tx: Tx): Promise<ReconciledDebitSettlementRound> => {
    const [round] = await tx.select().from(s.debitSettlementRounds).where(eq(s.debitSettlementRounds.id, input.roundId)).limit(1);
    if (!round) throw new ApiError(404, 'Không tìm thấy đợt chốt (Lần/Tháng/Năm).');
    const isTra = round.direction === 'TRA';

    const lotRows = await tx.select({
      shipmentId: s.debitSettlementRoundLots.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      tradeDirection: s.shipments.tradeDirection,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
    }).from(s.debitSettlementRoundLots)
      .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
      .where(eq(s.debitSettlementRoundLots.roundId, input.roundId))
      .orderBy(s.debitSettlementRoundLots.shipmentId);
    const shipmentIds = lotRows.map((row) => row.shipmentId);
    if (shipmentIds.length === 0) throw new ApiError(409, 'Đợt chốt không còn lô nào để đối chiếu.');

    // An issued document behind the đợt pins its record: realigning the
    // recorded total AFTER Công nợ received the old numbers would desync the
    // ledger. (The governed CANCEL releases the claims; then this path opens.)
    const claims = await tx.select({ documentId: s.debitNoteLots.documentId })
      .from(s.debitNoteLots)
      .where(and(
        inArray(s.debitNoteLots.shipmentId, shipmentIds),
        isNull(s.debitNoteLots.releasedAt),
      ))
      .limit(1);
    if (claims.length > 0) {
      throw new ApiError(409, `Đợt đã phát hành Debit Note #${claims[0]!.documentId} — tổng đợt chỉ đối chiếu được trước khi phát hành; hủy chứng từ (có kiểm soát) rồi đối chiếu lại.`);
    }

    // The export basis, computed EXACTLY like getDebitNoteRoundPreview (the
    // lines [Lưu] issues). A broken freeze or a missing ladder cell throws
    // the same business 409s the preview would — surfaced, never swallowed.
    const beforeRoundAmount = Number(round.amount);
    let target: number;
    let targetTax: number;
    if (isTra) {
      const board = await getAccountingDebitBoard({ dateFrom: round.dateFrom, dateTo: round.dateTo });
      const boardByLot = new Map(board.items.map((row) => [row.shipmentId, row]));
      target = 0;
      for (const lot of lotRows) {
        const cell = boardByLot.get(lot.shipmentId)?.tra.tong1;
        if (cell == null) {
          throw new ApiError(409, `Lô ${billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? `#${lot.shipmentId}`} chưa xác định được số tiền phải trả trên bảng điều động — chưa thể đối chiếu.`);
        }
        target += Number(cell);
      }
      targetTax = vatForAmount(target, round.vatRate);
    } else {
      const lockRows = await tx.select({
        shipmentId: s.shipmentCostLocks.shipmentId,
        snapshot: s.shipmentCostLocks.costSnapshot,
      }).from(s.shipmentCostLocks)
        .where(and(
          inArray(s.shipmentCostLocks.shipmentId, shipmentIds),
          isNull(s.shipmentCostLocks.unlockedAt),
        ));
      const lockedById = new Map(lockRows.map((row) => [row.shipmentId, row]));
      const unlocked = lotRows.filter((lot) => !lockedById.has(lot.shipmentId));
      if (unlocked.length > 0) {
        const names = unlocked.map((lot) => billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef) ?? 'chưa có số Bill/Booking').join(', ');
        throw new ApiError(409,
          `Đợt còn ${unlocked.length} lô chưa khóa chi phí: ${names}`
          + ' — hãy khóa chi phí các lô (Khóa lô / Khóa & xem trước) rồi đối chiếu.');
      }
      const allLines: BillingDocumentLine[] = [];
      for (const lot of lotRows) {
        const lockRow = lockedById.get(lot.shipmentId)!;
        allLines.push(...buildFrozenShipmentDebitLines(
          (lockRow.snapshot ?? {}) as Record<string, unknown>,
          lot.shipmentCode ?? String(lot.shipmentId),
          { vatRatePercent: round.vatRate },
        ));
      }
      const simulated = documentVatTotals(allLines);
      target = simulated.net;
      targetTax = simulated.tax;
    }

    const varianceNet = target - beforeRoundAmount;
    if (varianceNet === 0) {
      // The control: nothing drifts, nothing to correct — refuse instead of
      // writing the same number back with an audit row (no silent writes).
      throw new ApiError(409, `Đợt Lần ${round.roundNo} · ${round.periodKey} đã khớp tổng (${target} ₫) — không có chênh lệch để đối chiếu.`);
    }

    // Pre-flight: the post-write record must pass the SAME money law the
    // preview and the issuance run, or the reconciliation would leave the đợt
    // just as blocked (VAT-spread pathologies refuse here, not after a write).
    assertRoundIssuanceTotals(
      { net: target, tax: targetTax, gross: target + targetTax },
      { id: round.id, roundNo: round.roundNo, periodKey: round.periodKey, amount: String(target), vatRate: round.vatRate },
    );

    const beforeVat = vatForAmount(beforeRoundAmount, round.vatRate);
    const afterVat = vatForAmount(target, round.vatRate);
    const reconciledAt = new Date();
    const actorName = input.actor.fullName ?? input.actor.username ?? null;
    await tx.update(s.debitSettlementRounds)
      .set({ amount: String(target), updatedAt: reconciledAt })
      .where(eq(s.debitSettlementRounds.id, input.roundId));
    await tx.insert(s.auditLogs).values({
      userId: input.actor.userId,
      actorName,
      message: 'DEBIT_SETTLEMENT_ROUND_RECONCILED',
      entityType: 'debit_settlement_round',
      entityId: input.roundId,
      // The trail law: who (actor + role), why (reason verbatim), when (the
      // row's timestamp) and old→new — beside the aggregates, in ONE row.
      payload: {
        before: { amount: beforeRoundAmount, vat: beforeVat, gross: beforeRoundAmount + beforeVat },
        after: { amount: target, vat: afterVat, gross: target + afterVat },
        varianceNet,
        reason,
        role: input.actor.role,
        roundNo: round.roundNo,
        periodKey: round.periodKey,
        direction: round.direction,
        lotCount: shipmentIds.length,
        basis: 'UNDERLYING_CHARGES',
      },
    });
    return {
      roundId: input.roundId,
      roundNo: round.roundNo,
      periodKey: round.periodKey,
      direction: round.direction as 'THU' | 'TRA',
      lotCount: shipmentIds.length,
      before: { amount: beforeRoundAmount, vat: beforeVat, gross: beforeRoundAmount + beforeVat },
      after: { amount: target, vat: afterVat, gross: target + afterVat },
      varianceNet,
      reconciledBy: input.actor.userId,
      reconciledByName: actorName,
      reconciledAt: reconciledAt.toISOString(),
      reason,
    };
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}
