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
import { carrierKeysForLot, assertRoundIssuanceTotals, type CarrierDerivationEntry } from './debit-settlement-shared';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { assertNoPendingApprovalFees } from './shipment-pending-fees.service';
import { buildFrozenShipmentDebitLines } from './shipment-cost-lock-lines';
import { loadRevGroupMergeContext, revGroupMergeNote } from './rev-group-merge-note.service';
import { documentVatTotals } from './billing-document-shared.service';
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
      code: s.shipments.shipmentCode,
      customerId: s.shipments.customerId,
      ngay: s.shipments.expectedDeliveryDate,
    }).from(s.shipments)
      .where(and(inArray(s.shipments.id, shipmentIds), isNull(s.shipments.deletedAt)));
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
      throw new ApiError(400, `Lô ${noDate.map((l) => l.code ?? `#${l.id}`).join(', ')} chưa có ngày giao.`);
    }
    // SIL-883 (3.2) — Chọn Debit hard-blocks while any selected lot still
    // carries a fee awaiting Kế toán duyệt (the same count the boards render).
    await assertNoPendingApprovalFees(tx, shipmentIds, 'chọn Debit');
    const outOfRange = lots.filter((l) => l.ngay! < input.dateFrom || l.ngay! > input.dateTo);
    if (outOfRange.length > 0) {
      throw new ApiError(400, `Lô ${outOfRange.map((l) => l.code ?? `#${l.id}`).join(', ')} có ngày giao ngoài khoảng đã chọn.`);
    }
    // ── 2. nhà xe derivation: server-side truth from the lots' active trips ──
    const entriesByLot = await loadLotCarrierEntries(tx, shipmentIds);
    const keysByLot = new Map<number, string[]>();
    const noCarrier: string[] = [];
    const unionSet = new Set<string>();
    for (const lot of lots) {
      const keys = carrierKeysForLot(entriesByLot.get(lot.id) ?? []);
      keysByLot.set(lot.id, keys);
      if (keys.length === 0) noCarrier.push(lot.code ?? `#${lot.id}`);
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
    for (const lot of lots) {
      const row = rowsById.get(lot.id);
      if (!row) {
        throw new ApiError(404, `Lô ${lot.code ?? `#${lot.id}`} không tồn tại trong khoảng đã chọn.`);
      }
      const basis = input.direction === 'THU' ? row.thu.tongThu : row.tra.tong1;
      if (basis == null) {
        throw new ApiError(400, `Lô ${lot.code ?? `#${lot.id}`} chưa xác định được số tiền ${input.direction === 'THU' ? 'phải thu' : 'phải trả'} — chưa thể chốt.`);
      }
      amount += Number(basis);
    }
    // ── 6. duplicate-lần + lot-overlap: clean 400s before the guarded write ──
    const periodKey = `${input.year}-${String(input.month).padStart(2, '0')}`;
    const overlaps = await tx.select({
      code: s.shipments.shipmentCode,
      shipmentId: s.debitSettlementRoundLots.shipmentId,
      roundNo: s.debitSettlementRounds.roundNo,
      periodKey: s.debitSettlementRounds.periodKey,
    }).from(s.debitSettlementRoundLots)
      .innerJoin(s.debitSettlementRounds, eq(s.debitSettlementRounds.id, s.debitSettlementRoundLots.roundId))
      .innerJoin(s.shipments, eq(s.shipments.id, s.debitSettlementRoundLots.shipmentId))
      .where(inArray(s.debitSettlementRoundLots.shipmentId, shipmentIds));
    if (overlaps.length > 0) {
      const named = overlaps.map((o) => `Lô ${o.code ?? `#${o.shipmentId}`} (Lần ${o.roundNo} · ${o.periodKey})`).join(', ');
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
      shipmentIds.map((shipmentId) => ({ roundId: created.id, shipmentId })),
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
    throw new ApiError(409,
      `Đợt còn ${unlocked.length} lô chưa khóa chi phí: ${unlocked.map((lot) => lot.shipmentCode ?? `#${lot.id}`).join(', ')}`
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

  const items: DebitNoteRoundPreviewItem[] = [];
  const allLines: BillingDocumentLine[] = [];
  for (const lot of lots) {
    const lockRow = lockedById.get(lot.id)!;
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
      shipmentId: lot.id,
      billOrBooking: billOrBookNumberFor(lot.tradeDirection, lot.blNumber, lot.bookingRef),
      customerName: lot.rawCustomerName?.trim() || null,
      billingTruckNo: round.direction === 'TRA' ? null : previewPlateOf(lot),
      actualTruckNo: realPlateOf(lot),
      vehicleType: payableVehicleTypeOf(lot),
      mergeNote: revGroupMergeNote(mergeCtx.membershipByLot.get(lot.id), mergeCtx.principalRefByGroup),
      net: lotTotals.net,
      costLockedAt: lockRow.lockedAt?.toISOString() ?? null,
    });
  }
  // SIL-855 money law — the preview must equal the round record before it is
  // allowed to exist at all: a freeze that lost a lot's money 409s here so
  // the accountant sees the block INSTEAD of a half-money table (R3P-677-C
  // showed 0 ₫ and [Lưu] posted half of round 5).
  const totals = documentVatTotals(allLines);
  assertRoundIssuanceTotals(totals, round);
  return { round: roundHeader, items, totals };
}
