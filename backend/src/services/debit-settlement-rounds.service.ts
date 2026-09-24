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
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import { getAccountingDebitBoard, assertNoPendingRateAdjustment } from './accounting-debit-close.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { carrierKeysForLot, type CarrierDerivationEntry } from './debit-settlement-shared';
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
    // ── 4. pending rate adjustment → 409 (same guard as issuance routes) ──
    await assertNoPendingRateAdjustment(shipmentIds);
    // ── 5. amounts: the board ladder is the single money truth ──
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
  const nameRows = nameIds.size > 0 ? await db.select({ id: s.customers.id, name: s.customers.name })
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

function vatForAmount(amount: string, vatRate: number): number {
  return Math.round(Number(amount) * vatRate) / 100;
}
