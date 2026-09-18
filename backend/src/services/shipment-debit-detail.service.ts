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
  containerNumber: string | null;
  containerTypeLabel: string | null;
  tripId: number | null;
  rateKey: string | null;
  freight: number | null;
  surcharge: number | null;
  total: number | null;
}

export interface DebitDetailChiHoRow {
  containerNumber: string | null;
  containerTypeLabel: string | null;
  tripId: number | null;
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

  // Lớp 2 renders ONE ROW PER CONTAINER (REWORK B, 20260918_18): the container
  // list is the row skeleton; trips/expenses/snapshots merge onto their
  // container where the data exists. A container without a trip yet still
  // renders — money null = Chưa xác định (O2C nulls rule), never an empty
  // table.
  const containers = await db.select({
    id: s.shipmentContainers.id,
    containerNumber: s.shipmentContainers.containerNumber,
    containerTypeId: s.shipmentContainers.containerTypeId,
    typeLabel: s.containerTypes.name,
  })
    .from(s.shipmentContainers)
    .leftJoin(s.containerTypes, eq(s.containerTypes.id, s.shipmentContainers.containerTypeId))
    .where(eq(s.shipmentContainers.shipmentId, shipmentId))
    .orderBy(s.shipmentContainers.id);

  const lotTrips = await db.select({
    id: s.trips.id,
    podRecoveredAt: s.trips.podRecoveredAt,
  })
    .from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .where(eq(s.shipmentFulfillments.shipmentId, shipmentId));
  const tripIds = lotTrips.map((trip) => trip.id);
  const podByTrip = new Map(lotTrips.map((trip) => [trip.id, trip.podRecoveredAt]));

  // Container → trip linkage via trip_containers.sourceShipmentContainerId.
  const tripLinks = tripIds.length === 0 ? [] : await db.select({
    tripId: s.tripContainers.tripId,
    shipmentContainerId: s.tripContainers.sourceShipmentContainerId,
    containerNumber: s.tripContainers.containerNumber,
  })
    .from(s.tripContainers)
    .where(and(
      inArray(s.tripContainers.tripId, tripIds),
      eq(s.tripContainers.sourceShipmentId, shipmentId),
    ));
  const tripByContainerId = new Map<number, number>();
  for (const link of tripLinks) {
    if (link.shipmentContainerId != null && !tripByContainerId.has(link.shipmentContainerId)) {
      tripByContainerId.set(link.shipmentContainerId, link.tripId);
    }
  }
  // Trips with no container linkage (ad-hoc legs): keep them addressable by
  // trip id so their data still reaches a row.
  const linkedTripIds = new Set(tripByContainerId.values());
  const orphanTrips = lotTrips.filter((trip) => !linkedTripIds.has(trip.id));

  const freightByTrip = new Map<number, { freight: string | null; surcharge: string | null; total: string | null; rateKey: string | null }>();
  if (tripIds.length > 0) {
    const snapshots = await db.select({
      tripId: s.freightRateSnapshots.tripId,
      rateKey: s.pricingTables.rateKey,
      freight: s.freightRateSnapshots.freightAmount,
      surcharge: s.freightRateSnapshots.surchargeAmount,
      total: s.freightRateSnapshots.totalAmount,
    })
      .from(s.freightRateSnapshots)
      .leftJoin(s.pricingTables, eq(s.pricingTables.id, s.freightRateSnapshots.pricingTableId))
      .where(eq(s.freightRateSnapshots.shipmentId, shipmentId));
    for (const snapshot of snapshots) {
      if (snapshot.tripId != null) freightByTrip.set(snapshot.tripId, snapshot);
    }
  }

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
  const expensesByTrip = new Map<number, typeof expenses>();
  for (const expense of expenses) {
    const bucket = expensesByTrip.get(expense.tripId) ?? [];
    bucket.push(expense);
    expensesByTrip.set(expense.tripId, bucket);
  }

  function buildRow(container: {
    id: number | null;
    containerNumber: string | null;
    typeLabel: string | null;
    tripId: number | null;
  }): { freightRow: DebitDetailFreightRow; chiHoRow: DebitDetailChiHoRow } {
    const tripId = container.tripId;
    const snapshot = tripId != null ? freightByTrip.get(tripId) : undefined;
    const tripExpenses = tripId != null ? (expensesByTrip.get(tripId) ?? []) : [];
    const otherFees = tripExpenses
      .filter((expense) => expense.expenseType === 'OTHER')
      .map((expense) => ({ id: expense.id, name: expense.feeName ?? 'Phí khác', amount: Number(expense.buyAmount) }));
    const coreRows = tripExpenses.filter((expense) => expense.expenseType !== 'OTHER');
    const podRecoveredAt = tripId != null ? podByTrip.get(tripId) ?? null : null;
    const freightRow: DebitDetailFreightRow = {
      containerNumber: container.containerNumber,
      containerTypeLabel: container.typeLabel,
      tripId,
      rateKey: snapshot?.rateKey ?? null,
      freight: snapshot?.freight != null ? Number(snapshot.freight) : null,
      surcharge: snapshot?.surcharge != null ? Number(snapshot.surcharge) : null,
      total: snapshot?.total != null ? Number(snapshot.total) : null,
    };
    const chiHoRow: DebitDetailChiHoRow = {
      containerNumber: container.containerNumber,
      containerTypeLabel: container.typeLabel,
      tripId,
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
      // agreed (null = chưa xác định for FE).
      carrierDetention: null,
      repairAdvance: null,
      opsDocsStatus: opsDocsStatusOf({ podRecoveredAt }),
    };
    return { freightRow, chiHoRow };
  }

  const freightRows: DebitDetailFreightRow[] = [];
  const chiHoRows: DebitDetailChiHoRow[] = [];
  for (const container of containers) {
    const tripId = tripByContainerId.get(container.id) ?? null;
    const built = buildRow({ id: container.id, containerNumber: container.containerNumber, typeLabel: container.typeLabel, tripId });
    freightRows.push(built.freightRow);
    chiHoRows.push(built.chiHoRow);
  }
  // Orphan trips (no container linkage): emit their rows trip-addressed so
  // existing data never disappears from the screen.
  for (const trip of orphanTrips) {
    // Orphan trips render only when they carry data — a bare trip with no
    // container and no cost rows is nothing the Lớp-2 table needs to show.
    const hasData = (expensesByTrip.get(trip.id)?.length ?? 0) > 0 || freightByTrip.has(trip.id);
    if (!hasData) continue;
    const built = buildRow({ id: null, containerNumber: null, typeLabel: null, tripId: trip.id });
    freightRows.push(built.freightRow);
    chiHoRows.push(built.chiHoRow);
  }

  const hasChiHoData = chiHoRows.some((row) => row.items.length > 0 || row.otherFees.length > 0);
  const chiHoTotal = chiHoRows.reduce((sum, row) => sum + (row.items.reduce((s2, item) => s2 + (item.amount ?? 0), 0)), 0);
  const thuKhachTotal = chiHoRows.reduce((sum, row) => sum + (row.items.reduce((s2, item) => s2 + (item.thuKhach ?? 0), 0)), 0);

  return {
    freightRows,
    chiHoRows,
    payables: { chiHoTotal: hasChiHoData ? chiHoTotal : null },
    thuKhachTotal: hasChiHoData ? thuKhachTotal : null,
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
