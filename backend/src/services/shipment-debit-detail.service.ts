// Chi phí - Quyết toán (Debit CUS) Lớp 2 — per-lot detail + editable rows.
//
// Companion read/edit service for the debit wave (BE1 lane, FE _18 contract):
//   GET  /api/shipments/:id/debit-detail — freightRows, chiHoRows (per-trip
//        cost bundles with an otherFees[] bucket and the O2C evidence status),
//        payables, thuKhachTotal. Money nullable — null = "chưa xác định",
//        never a silent 0.
//   PUT  /api/shipments/:id/debit-edits — the only editable cells: PS thực tế
//        (buy), thu khách (sell) and the note on chi-hộ rows, plus Phí khác
//        (OTHER) add/remove. Everything else stays read-only; the lot being
//        debit-locked rejects edits with the _19 lock message.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { runIdempotent } from './idempotency.service';
import { assertShipmentCostUnlocked, SHIPMENT_COST_LOCKED_MESSAGE } from './shipment-cost-lock.service';

/** Chi hộ rows group O2C §7.1 evidence: READY = POD recovered on the trip. */
function opsDocsStatusOf(trip: { podRecoveredAt: Date | null }): 'READY' | 'PENDING' {
  return trip.podRecoveredAt != null ? 'READY' : 'PENDING';
}

export interface DebitDetailFreightRow {
  tripId: number | null;
  rateKey: string | null;
  freight: number | null;
  surcharge: number | null;
  total: number | null;
}

export interface DebitDetailChiHoRow {
  tripId: number;
  containerNumber: string | null;
  items: Array<{ id: number; expenseType: string; feeName: string | null; amount: number | null; thuKhach: number | null; note: string | null }>;
  otherFees: Array<{ id: number; name: string; amount: number | null }>;
  carrierDetention: number | null;
  repairAdvance: number | null;
  opsDocsStatus: 'READY' | 'PENDING';
}

export interface ShipmentDebitDetail {
  freightRows: DebitDetailFreightRow[];
  chiHoRows: DebitDetailChiHoRow[];
  payables: { chiHoTotal: number | null };
  thuKhachTotal: number | null;
}

export async function getShipmentDebitDetail(shipmentId: number): Promise<ShipmentDebitDetail> {
  const [shipment] = await db.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
  }

  const lotTrips = await db.select({
    id: s.trips.id,
    podRecoveredAt: s.trips.podRecoveredAt,
    containerNumber: s.tripContainers.containerNumber,
  })
    .from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .leftJoin(s.tripContainers, eq(s.tripContainers.tripId, s.trips.id))
    .where(eq(s.shipmentFulfillments.shipmentId, shipmentId));
  const tripIds = lotTrips.map((trip) => trip.id);

  const freightRows = tripIds.length === 0 ? [] : (await db.select({
    tripId: s.freightRateSnapshots.tripId,
    rateKey: s.pricingTables.rateKey,
    freight: s.freightRateSnapshots.freightAmount,
    surcharge: s.freightRateSnapshots.surchargeAmount,
    total: s.freightRateSnapshots.totalAmount,
  })
    .from(s.freightRateSnapshots)
    .leftJoin(s.pricingTables, eq(s.pricingTables.id, s.freightRateSnapshots.pricingTableId))
    .where(and(
      eq(s.freightRateSnapshots.shipmentId, shipmentId),
      tripIds.length > 0 ? inArray(s.freightRateSnapshots.tripId, tripIds) : undefined,
    ))
    .orderBy(s.freightRateSnapshots.id));

  const expenses = tripIds.length === 0 ? [] : await db.select({
    id: s.tripExpenses.id,
    tripId: s.tripExpenses.tripId,
    expenseType: s.tripExpenses.expenseType,
    feeName: s.tripExpenses.feeName,
    buyAmount: s.tripExpenses.buyAmount,
    sellAmount: s.tripExpenses.sellAmount,
    note: s.tripExpenses.recoveryNote,
  })
    .from(s.tripExpenses)
    .where(inArray(s.tripExpenses.tripId, tripIds));

  const podByTrip = new Map(lotTrips.map((trip) => [trip.id, trip]));
  const chiHoRows: DebitDetailChiHoRow[] = [];
  for (const trip of lotTrips) {
    const tripExpenses = expenses.filter((expense) => expense.tripId === trip.id);
    if (tripExpenses.length === 0) continue;
    const otherFees = tripExpenses
      .filter((expense) => expense.expenseType === 'OTHER')
      .map((expense) => ({ id: expense.id, name: expense.feeName ?? 'Phí khác', amount: Number(expense.buyAmount) }));
    const coreRows = tripExpenses.filter((expense) => expense.expenseType !== 'OTHER');
    if (coreRows.length === 0 && otherFees.length === 0) continue;
    chiHoRows.push({
      tripId: trip.id,
      containerNumber: trip.containerNumber ?? null,
      items: coreRows.map((expense) => ({
        id: expense.id,
        expenseType: expense.expenseType,
        feeName: expense.feeName,
        amount: Number(expense.buyAmount),
        thuKhach: expense.sellAmount == null ? null : Number(expense.sellAmount),
        note: expense.note,
      })),
      otherFees,
      // No dedicated detention/repair expense types exist yet — the OTHER
      // bucket carries user-added fees and these stay null until a type is
      // agreed (documented for FE; null = chưa xác định).
      carrierDetention: null,
      repairAdvance: null,
      opsDocsStatus: opsDocsStatusOf({
        podRecoveredAt: podByTrip.get(trip.id)?.podRecoveredAt ?? null,
      }),
    });
  }

  const chiHoTotal = chiHoRows.reduce((sum, row) => sum + (row.items.reduce((s2, item) => s2 + (item.amount ?? 0), 0)), 0);
  const thuKhachTotal = chiHoRows.reduce((sum, row) => sum + (row.items.reduce((s2, item) => s2 + (item.thuKhach ?? 0), 0)), 0);

  return {
    freightRows: freightRows.map((row) => ({
      tripId: row.tripId ?? null,
      rateKey: row.rateKey ?? null,
      freight: row.freight == null ? null : Number(row.freight),
      surcharge: row.surcharge == null ? null : Number(row.surcharge),
      total: row.total == null ? null : Number(row.total),
    })),
    chiHoRows,
    payables: { chiHoTotal: chiHoRows.length === 0 ? null : chiHoTotal },
    thuKhachTotal: chiHoRows.length === 0 ? null : thuKhachTotal,
  };
}

export interface DebitEditPayload {
  edits?: Array<{ expenseId: number; buyAmount?: number; sellAmount?: number; note?: string }>;
  addOtherFees?: Array<{ tripId: number; name: string; amount: number }>;
  removeExpenseIds?: number[];
}

/** Editable surface for PUT /debit-edits — strict on unknown keys. */
export function debitEditSchemaGuard(payload: Record<string, unknown>): DebitEditPayload {
  const allowed = ['edits', 'addOtherFees', 'removeExpenseIds'];
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) {
      throw new ApiError(400, `Trường "${key}" không được sửa — chỉ chấp nhận: ${allowed.join(', ')}.`);
    }
  }
  const edits = Array.isArray(payload.edits) ? payload.edits : [];
  for (const edit of edits as Array<Record<string, unknown>>) {
    for (const key of Object.keys(edit)) {
      if (!['expenseId', 'buyAmount', 'sellAmount', 'note'].includes(key)) {
        throw new ApiError(400, `Trường "${key}" trong edits không hợp lệ.`);
      }
    }
    if (typeof edit.expenseId !== 'number') {
      throw new ApiError(400, 'edits.expenseId là bắt buộc.');
    }
  }
  const addOtherFees = Array.isArray(payload.addOtherFees) ? payload.addOtherFees : [];
  for (const fee of addOtherFees as Array<Record<string, unknown>>) {
    for (const key of Object.keys(fee)) {
      if (!['tripId', 'name', 'amount'].includes(key)) {
        throw new ApiError(400, `Trường "${key}" trong addOtherFees không hợp lệ.`);
      }
    }
    if (typeof fee.tripId !== 'number' || typeof fee.name !== 'string' || !fee.name.trim()) {
      throw new ApiError(400, 'addOtherFees cần tripId và tên phí có nội dung.');
    }
  }
  const removeExpenseIds = Array.isArray(payload.removeExpenseIds) ? payload.removeExpenseIds : [];
  for (const id of removeExpenseIds) {
    if (typeof id !== 'number') throw new ApiError(400, 'removeExpenseIds phải là mảng số.');
  }
  return { edits, addOtherFees, removeExpenseIds } as DebitEditPayload;
}

export async function saveDebitEdits(input: {
  shipmentId: number;
  actorId: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}): Promise<{ id: number }> {
  const payload = debitEditSchemaGuard(input.payload);
  await assertShipmentCostUnlocked(db as never, input.shipmentId);

  const { result } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.SHIPMENT_DEBIT_EDITS,
    idempotencyKey: input.idempotencyKey,
    payload: { shipmentId: input.shipmentId, payload },
    createdBy: input.actorId,
    entityType: 'shipment',
    load: async () => ({ id: input.shipmentId }),
    create: async (tx) => {
      const lotTrips = await tx.select({ id: s.trips.id })
        .from(s.trips)
        .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
        .where(eq(s.shipmentFulfillments.shipmentId, input.shipmentId));
      const tripIds = new Set(lotTrips.map((trip) => trip.id));
      for (const edit of payload.edits ?? []) {
        const [expense] = await tx.select().from(s.tripExpenses)
          .where(eq(s.tripExpenses.id, edit.expenseId)).limit(1);
        if (!expense || !tripIds.has(expense.tripId)) {
          throw new ApiError(404, 'Không tìm thấy dòng chi hộ trên lô hàng này.');
        }
        await tx.update(s.tripExpenses).set({
          buyAmount: edit.buyAmount != null ? String(edit.buyAmount) : undefined,
          sellAmount: edit.sellAmount != undefined ? String(edit.sellAmount) : undefined,
          recoveryNote: edit.note,
        }).where(eq(s.tripExpenses.id, edit.expenseId));
      }
      for (const fee of payload.addOtherFees ?? []) {
        if (!tripIds.has(fee.tripId)) {
          throw new ApiError(404, 'Không tìm thấy chuyến trên lô hàng này.');
        }
        await tx.insert(s.tripExpenses).values({
          tripId: fee.tripId,
          expenseType: 'OTHER',
          feeName: fee.name.trim(),
          buyAmount: String(fee.amount),
          sellAmount: '0',
        });
      }
      for (const expenseId of payload.removeExpenseIds ?? []) {
        const [expense] = await tx.select().from(s.tripExpenses)
          .where(eq(s.tripExpenses.id, expenseId)).limit(1);
        if (!expense || !tripIds.has(expense.tripId)) {
          throw new ApiError(404, 'Không tìm thấy dòng chi hộ trên lô hàng này.');
        }
        await tx.delete(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId));
      }
      return { id: input.shipmentId };
    },
  });
  return result;
}

void SHIPMENT_COST_LOCKED_MESSAGE;
