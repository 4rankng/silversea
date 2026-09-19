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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { runIdempotent } from './idempotency.service';
import { assertShipmentCostUnlocked, SHIPMENT_COST_LOCKED_MESSAGE } from './shipment-cost-lock.service';
import { getLotDeclaredChannel } from './shipment-documents.service';
import { activeTripConditions } from './active-trip-scope';
import { resolveLotZoneSurcharge } from './zone-surcharge.service';
import { computeLotPayablesBreakdown, type LotPayablesBreakdown } from './lot-payables.service';
import { ExpenseTypeCategory, type DebitDetailChiHoRow, type DebitDetailFreightRow, type ShipmentDebitDetail } from '@tingting/shared';

/** Chi hộ rows group O2C §7.1 evidence: READY = POD recovered on the trip. */
function opsDocsStatusOf(trip: { podRecoveredAt: Date | null }): 'READY' | 'PENDING' {
  return trip.podRecoveredAt != null ? 'READY' : 'PENDING';
}

export interface DebitDetailPayables {
  chiHoTotal: number | null;
  externalFreightCost: number | null;
  hqgsFee: number | null;
  phatSinhFee: number | null;
  unclassifiedFee: number | null;
  opsExpenseTotal: number | null;
  payableTotal: number | null;
}

export async function getShipmentDebitDetail(shipmentId: number): Promise<ShipmentDebitDetail> {
  const [shipment] = await db.select({
    id: s.shipments.id,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) {
    throw new ApiError(404, 'Lô hàng không tồn tại hoặc đã bị xóa.');
  }
  // Lot-level business keys for the wire (card _39): declaration numbers ride
  // comma-joined; an explicit read avoids raw-sql alias mapping surprises.
  const declarationRows = await db.select({ declarationNumber: s.shipmentDeclarations.declarationNumber })
    .from(s.shipmentDeclarations)
    .where(eq(s.shipmentDeclarations.shipmentId, shipmentId))
    .orderBy(s.shipmentDeclarations.id);
  const lotDeclarationNumber = declarationRows
    .map((row) => row.declarationNumber)
    .filter((value): value is string => value != null && value !== '')
    .join(', ') || null;
  // Card 20260919_5 producer contract: the declared channel rides top-level
  // (lot-level attribute — every container row renders the same value).
  const customsChannel = await getLotDeclaredChannel(shipmentId);

  // Frozen port labels (card 20260919_35): locked lots read their lift/drop
  // site labels from the snapshot; unlocked lots and old locks read null and
  // the client falls back to the live label.
  const [activeLabelLock] = await db.select({ snapshot: s.shipmentCostLocks.costSnapshot })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ))
    .limit(1);
  const frozenByContainer = new Map<number, { lift: string | null; drop: string | null }>();
  const portLabels = (activeLabelLock?.snapshot as { portLabels?: { byContainer?: Array<{ containerId: number; liftSiteLabel: string | null; dropSiteLabel: string | null }> } } | null)?.portLabels;
  for (const entry of portLabels?.byContainer ?? []) {
    frozenByContainer.set(entry.containerId, { lift: entry.liftSiteLabel ?? null, drop: entry.dropSiteLabel ?? null });
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
    psActual: s.shipmentContainers.psActualAmount,
    psActualNote: s.shipmentContainers.psActualNote,
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
    .where(and(
      eq(s.shipmentFulfillments.shipmentId, shipmentId),
      ...activeTripConditions(),
    ));
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
    invoiceNumber: s.tripExpenses.invoiceNumber,
  })
    .from(s.tripExpenses)
    .where(inArray(s.tripExpenses.tripId, tripIds));
  const expensesByTrip = new Map<number, typeof expenses>();
  for (const expense of expenses) {
    const bucket = expensesByTrip.get(expense.tripId) ?? [];
    bucket.push(expense);
    expensesByTrip.set(expense.tripId, bucket);
  }

  // Bảng 2.1's auto customs column: container-scoped ops rows classified
  // HQGS via the explicit category column (never name matching).
  const opsRows = await db.select({
    containerId: s.opsExpenseEntries.shipmentContainerId,
    category: s.forwarderExpenseTypes.category,
    amount: s.opsExpenseEntries.amount,
  })
    .from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(eq(s.opsExpenseEntries.shipmentId, shipmentId));
  const hqgsByContainer = new Map<number, number>();
  const containersWithOps = new Set<number>();
  for (const opsRow of opsRows) {
    if (opsRow.containerId == null) continue;
    containersWithOps.add(opsRow.containerId);
    if (opsRow.category === ExpenseTypeCategory.HQGS) {
      hqgsByContainer.set(opsRow.containerId, (hqgsByContainer.get(opsRow.containerId) ?? 0) + Number(opsRow.amount));
    }
  }

  function buildRow(container: {
    id: number | null;
    containerNumber: string | null;
    typeLabel: string | null;
    tripId: number | null;
    psActual?: string | null;
    psActualNote?: string | null;
  }): { freightRow: DebitDetailFreightRow; chiHoRow: DebitDetailChiHoRow } {
    const tripId = container.tripId;
    const snapshot = tripId != null ? freightByTrip.get(tripId) : undefined;
    const tripExpenses = tripId != null ? (expensesByTrip.get(tripId) ?? []) : [];
    const otherFees = tripExpenses
      .filter((expense) => expense.expenseType === 'OTHER')
      .map((expense) => ({
        id: expense.id,
        name: expense.feeName ?? 'Phí khác',
        amount: Number(expense.buyAmount),
        // Card _2 (2b): the SELL side rides beside the buy side — null when
        // not entered (default 0 = chưa nhập → '—', never a silent 0).
        thuKhach: expense.sellAmount == null || Number(expense.sellAmount) === 0
          ? null
          : Number(expense.sellAmount),
      }));
    const coreRows = tripExpenses.filter((expense) => expense.expenseType !== 'OTHER');
    const podRecoveredAt = tripId != null ? podByTrip.get(tripId) ?? null : null;
    const frozenLabels = container.id != null ? frozenByContainer.get(container.id) : undefined;
    const freightRow: DebitDetailFreightRow = {
      containerNumber: container.containerNumber,
      containerTypeLabel: container.typeLabel,
      psActual: container.psActual == null ? null : Number(container.psActual),
      psActualNote: container.psActualNote ?? null,
      tripId,
      rateKey: snapshot?.rateKey ?? null,
      freightCharge: snapshot?.freight != null ? Number(snapshot.freight) : null,
      fuelSurcharge: snapshot?.surcharge != null ? Number(snapshot.surcharge) : null,
      customsFee: container.id != null && containersWithOps.has(container.id)
        ? (hqgsByContainer.get(container.id) ?? 0)
        : null,
      contractFreightTotal: snapshot?.total != null ? Number(snapshot.total) : null,
      liftSiteLabel: frozenLabels?.lift ?? null,
      dropSiteLabel: frozenLabels?.drop ?? null,
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
        // Ruling 2026-09-19: invoiced rows recharge at cost — the wire emits
        // the SAME derived (buy) quantity the summary L1 rolls up, never the
        // raw typed sell (CUS figures live on Phí khác rows only).
        thuKhach: Number(expense.buyAmount),
        note: expense.note,
        // Bảng 2.2 (fidelity card): the invoice number renders italic under
        // the fee amount — "HD: 00123". Null = no invoice on the source row.
        invoiceNumber: expense.invoiceNumber,
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
    const built = buildRow({
      id: container.id,
      containerNumber: container.containerNumber,
      typeLabel: container.typeLabel,
      tripId,
      psActual: container.psActual,
      psActualNote: container.psActualNote,
    });
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

  // 2.3 payables (ruling 2026-09-19): locked lots read the FROZEN snapshot
  // composition (ruling hardening c) — a catalog rename must not rewrite a
  // locked lot's table. chiHoTotal stays live (existing QA-pinned
  // semantics). Old snapshots lack the new keys — null = Chưa xác định,
  // never a fabricated 0.
  const [activeLock] = await db.select({ snapshot: s.shipmentCostLocks.costSnapshot })
    .from(s.shipmentCostLocks)
    .where(and(
      eq(s.shipmentCostLocks.shipmentId, shipmentId),
      isNull(s.shipmentCostLocks.unlockedAt),
    ))
    .limit(1);
  const breakdown = await computeLotPayablesBreakdown(shipmentId);
  const payables: DebitDetailPayables = activeLock
    ? { chiHoTotal: hasChiHoData ? chiHoTotal : null, ...payablesFromSnapshot(activeLock.snapshot) }
    : { chiHoTotal: hasChiHoData ? chiHoTotal : null, ...breakdown };

  // Frozen lots (card _35 family): the snapshot captured the zone surcharge
  // at lock time — renames/config changes after the lock never rewrite it.
  const snapshotZone = (activeLabelLock?.snapshot as { zoneSurcharge?: { label: string; amount: number; source: 'OVERRIDE' | 'INCIDENTAL' | 'CONFIG' } | null } | null)?.zoneSurcharge;
  const zoneSurcharge = snapshotZone ?? await resolveLotZoneSurcharge(shipmentId);
  return {
    freightRows,
    chiHoRows,
    payables,
    thuKhachTotal: hasChiHoData ? thuKhachTotal : null,
    customsChannel,
    bookingRef: shipment.bookingRef ?? null,
    billNumber: shipment.blNumber ?? null,
    declarationNumber: lotDeclarationNumber,
    zoneSurcharge,
  };
}

/** Card _2 — the 2.3 zone-surcharge column's single source ladder. The
 *  dispatcher override (ops expense rows of the structural zone kind, entered
 *  through the audited ops intake) wins; then driver-reported incidental
 *  actuals (LIFT_DROP_ZONE rows on the lot's trips); then the configured
 *  amount when the lot's ports carry a zone-surcharge config row ("tự nhảy
 *  khi cài đặt"); otherwise null — the column shows '—', never a fabricated 0.
 *  Place names live in the config ROW (label), never in code. */
/** Frozen 2.3 reads for locked lots: missing snapshot keys read null —
 *  Chưa xác định, never a fabricated 0. */
function payablesFromSnapshot(snapshot: unknown): LotPayablesBreakdown {
  const data = (snapshot ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  };
  return {
    externalFreightCost: num(data['externalFreightCost']),
    hqgsFee: num(data['hqgsFee']),
    phatSinhFee: num(data['phatSinhFee']),
    unclassifiedFee: num(data['unclassifiedFee']),
    opsExpenseTotal: num(data['opsExpenseTotal']),
    payableTotal: num(data['payableTotal']),
  };
}

export interface DebitEditPayload {
  edits?: Array<{ expenseId: number; buyAmount?: number; sellAmount?: number; note?: string }>;
  addOtherFees?: Array<{ tripId: number; name: string; amount: number }>;
  removeExpenseIds?: number[];
  freightEdits?: Array<{ containerNumber: string; psActual?: number; note?: string }>;
}

/** Editable surface for PUT /debit-edits — strict on unknown keys. */
export function debitEditSchemaGuard(payload: Record<string, unknown>): DebitEditPayload {
  const allowed = ['edits', 'addOtherFees', 'removeExpenseIds', 'freightEdits'];
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
  const freightEdits = Array.isArray(payload.freightEdits) ? payload.freightEdits : [];
  for (const edit of freightEdits as Array<Record<string, unknown>>) {
    for (const key of Object.keys(edit)) {
      if (!['containerNumber', 'psActual', 'note'].includes(key)) {
        throw new ApiError(400, `Trường "${key}" trong freightEdits không hợp lệ.`);
      }
    }
    if (typeof edit.containerNumber !== 'string' || !edit.containerNumber.trim()) {
      throw new ApiError(400, 'freightEdits cần containerNumber.');
    }
  }
  return { edits, addOtherFees, removeExpenseIds, freightEdits } as DebitEditPayload;
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
        .where(and(
          eq(s.shipmentFulfillments.shipmentId, input.shipmentId),
          ...activeTripConditions(),
        ));
      const tripIds = new Set(lotTrips.map((trip) => trip.id));
      for (const edit of payload.edits ?? []) {
        const [expense] = await tx.select().from(s.tripExpenses)
          .where(eq(s.tripExpenses.id, edit.expenseId)).limit(1);
        if (!expense || !tripIds.has(expense.tripId)) {
          throw new ApiError(404, 'Không tìm thấy dòng chi hộ trên lô hàng này.');
        }
        // Ruling 2026-09-19: the customer figure is CUS-typed only on Phí
        // khác rows — invoiced/pass-through rows recharge from the expense-
        // type rule (cost pass-through today) and stay read-only here.
        if (edit.sellAmount !== undefined && expense.expenseType !== 'OTHER') {
          throw new ApiError(400, 'Chỉ dòng Phí khác (không hóa đơn) được nhập số phải thu khách. Dòng có hóa đơn tự tính lại theo quy tắc loại chi phí.');
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
      for (const freightEdit of payload.freightEdits ?? []) {
        const [container] = await tx.select({ id: s.shipmentContainers.id })
          .from(s.shipmentContainers)
          .where(and(
            eq(s.shipmentContainers.shipmentId, input.shipmentId),
            eq(s.shipmentContainers.containerNumber, freightEdit.containerNumber.trim()),
          )).limit(1);
        if (!container) {
          throw new ApiError(404, 'Không tìm thấy container trên lô hàng này.');
        }
        await tx.update(s.shipmentContainers).set({
          psActualAmount: freightEdit.psActual != null ? String(freightEdit.psActual) : null,
          psActualNote: freightEdit.note ?? null,
        }).where(eq(s.shipmentContainers.id, container.id));
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
