// SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — the lot's ORIGINAL document set state.
//
// Layer 2 of the KB's three independent document-status layers: the
// completeness of bộ hồ sơ chứng từ gốc (Còn thiếu · Đang bổ sung · Đã đủ),
// the bảng kê condition of Chứng từ/Kế toán. Deliberately independent of the
// physical custody facts (shipment-accounting-custody.service) and of the
// e-POD upload state — the KB's layers never infer each other.
//
// Laws:
//  - Append-only facts, latest wins (same shape as the custody facts).
//  - 'Đã đủ' (COMPLETE) is only writable when BOTH Người nhận and Ngày nhận
//    thực tế land — the server refuses the transition with the VN reason.
//  - A lot with NO fact reads as MISSING ('Còn thiếu'): the absence of a
//    record IS the debt.
//  - A locked lot (khóa kế toán) refuses writes, like every lot-data write.
//  - CUS actors see only their own lots on the debt screen
//    (cus-visibility.service — the group rule).
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  SHIPMENT_DOCUMENT_SET_STATUS_LABELS,
  ShipmentDocumentSetStatus,
  Role,
} from '@tingting/shared';
import type {
  ShipmentDocumentDebtItem,
  ShipmentDocumentSet,
  ShipmentDocumentSetUpdateInput,
} from '@tingting/shared';
import * as s from '../db/schema';
import { db, type Executor } from '../db';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { runInTx } from '../lib/tx';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock-reads.service';
import { bumpShipmentVersion } from './shipment-accounting-lock-shared.service';
import { billOrBookNumberFor } from './cus-workspace-mapping.service';
import { CUSTOMER_OPERATIONAL_NAME } from './cus-workspace-sql.service';
import { cusVisibilityCondition } from './cus-visibility.service';
import { isFulfillmentRequired } from './shipment-fulfillment.service';
import {
  buildShipmentDocumentDebtLayers,
  shipmentDocumentDebtHasOpenLayer,
  type DocumentDebtPhoiFact,
  type DocumentDebtPodFact,
} from './shipment-document-debt-layers';

/** The roles the KB names for the bảng kê side of the document set. */
export const DOCUMENT_SET_WRITER_ROLES: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.CUS];

export function canWriteDocumentSet(actor: AuthUser): boolean {
  return DOCUMENT_SET_WRITER_ROLES.includes(actor.role);
}

export interface ShipmentDocumentSetFactRow {
  id: number;
  shipmentId: number;
  shipmentVersion: number;
  status: string;
  missingDocuments: string[];
  receiverName: string | null;
  receivedOn: string | null;
  changedAt: Date;
  changedByName: string | null;
}

/** The fields the wire summary reads — batched list loaders carry just these. */
export type ShipmentDocumentSetSummaryRow = Pick<
  ShipmentDocumentSetFactRow,
  'status' | 'missingDocuments' | 'receiverName' | 'receivedOn' | 'changedAt' | 'changedByName'
>;

export async function getLatestShipmentDocumentSetFact(
  shipmentId: number,
  executor: Executor = db,
): Promise<ShipmentDocumentSetFactRow | null> {
  const [row] = await executor.select({
    id: s.shipmentDocumentSetFacts.id,
    shipmentId: s.shipmentDocumentSetFacts.shipmentId,
    shipmentVersion: s.shipmentDocumentSetFacts.shipmentVersion,
    status: s.shipmentDocumentSetFacts.status,
    missingDocuments: s.shipmentDocumentSetFacts.missingDocuments,
    receiverName: s.shipmentDocumentSetFacts.receiverName,
    receivedOn: s.shipmentDocumentSetFacts.receivedOn,
    changedAt: s.shipmentDocumentSetFacts.changedAt,
    changedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
  }).from(s.shipmentDocumentSetFacts)
    .leftJoin(s.users, eq(s.users.id, s.shipmentDocumentSetFacts.changedBy))
    .where(eq(s.shipmentDocumentSetFacts.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDocumentSetFacts.changedAt), desc(s.shipmentDocumentSetFacts.id))
    .limit(1);
  if (row == null) return null;
  return {
    ...row,
    missingDocuments: Array.isArray(row.missingDocuments) ? row.missingDocuments : [],
    receivedOn: row.receivedOn ?? null,
  };
}

/** The wire summary every surface renders — status defaults to MISSING ('Còn thiếu'). */
export function buildShipmentDocumentSetSummary(
  fact: ShipmentDocumentSetSummaryRow | null,
  actor: AuthUser | null,
  locked: boolean,
): ShipmentDocumentSet {
  const status = (fact?.status as ShipmentDocumentSetStatus | undefined) ?? ShipmentDocumentSetStatus.MISSING;
  return {
    status,
    label: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status] ?? status,
    missingDocuments: fact?.missingDocuments ?? [],
    receiverName: fact?.receiverName ?? null,
    receivedOn: fact?.receivedOn ?? null,
    changedAt: fact?.changedAt != null ? fact.changedAt.toISOString() : null,
    changedByName: fact?.changedByName ?? null,
    editable: !locked && actor != null && canWriteDocumentSet(actor),
  };
}

function normalizeMissingDocuments(input: ShipmentDocumentSetUpdateInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.missingDocuments ?? []) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export async function updateShipmentDocumentSet(args: {
  shipmentId: number;
  input: ShipmentDocumentSetUpdateInput;
  actor: AuthUser;
  transaction?: Tx;
}) {
  if (!canWriteDocumentSet(args.actor)) {
    throw new ApiError(403, 'Chỉ Quản trị, Quản lý hoặc Chứng từ được cập nhật bộ hồ sơ chứng từ gốc.');
  }
  // KB §3.5.4: chỉ chuyển "Đã đủ" khi ghi đủ Người nhận + Ngày nhận thực tế.
  if (args.input.status === ShipmentDocumentSetStatus.COMPLETE
    && (!args.input.receiverName || !args.input.receivedOn)) {
    throw new ApiError(400, 'Chuyển "Đã đủ" cần ghi đủ Người nhận và Ngày nhận thực tế.');
  }

  const execute = async (tx: Tx) => {
    const shipment = await assertShipmentAccountingUnlocked(tx, args.shipmentId);
    if (shipment.version !== args.input.expectedShipmentVersion) {
      throw new ApiError(409, 'Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật bộ hồ sơ.');
    }

    const [fact] = await tx.insert(s.shipmentDocumentSetFacts).values({
      shipmentId: shipment.id,
      shipmentVersion: shipment.version,
      status: args.input.status,
      missingDocuments: normalizeMissingDocuments(args.input),
      receiverName: args.input.receiverName?.trim() || null,
      receivedOn: args.input.receivedOn || null,
      changedBy: args.actor.userId,
    }).returning();

    const nextShipmentVersion = await bumpShipmentVersion(
      tx,
      shipment.id,
      shipment.version,
      args.actor.userId,
    );

    return {
      fact: { ...fact, missingDocuments: Array.isArray(fact.missingDocuments) ? fact.missingDocuments : [] },
      shipmentVersion: nextShipmentVersion,
    };
  };
  return runInTx(args.transaction, execute);
}

/**
 * The "Nợ chứng từ" screen: every visible lot whose LATEST set fact is not
 * 'Đã đủ' (no fact at all reads MISSING). CUS actors see only their own/team
 * lots through the one visibility law; staff roles see the whole book.
 */
export async function listShipmentDocumentDebt(actor: AuthUser): Promise<ShipmentDocumentDebtItem[]> {
  const conditions = [isNull(s.shipments.deletedAt)];
  if (actor.role === Role.CUS) {
    conditions.push(...await cusVisibilityCondition(db, actor));
  }

  // One row per visible lot, carrying its LATEST document-set fact (no fact
  // at all = null). DISTINCT ON + newest-first order picks the newest fact
  // per lot; the LEFT JOIN keeps the lots that never got one (the KB default
  // state 'Còn thiếu' exists without any recorded row).
  const rows = await db.selectDistinctOn([s.shipments.id], {
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    customerName: CUSTOMER_OPERATIONAL_NAME,
    factId: s.shipmentDocumentSetFacts.id,
    status: s.shipmentDocumentSetFacts.status,
    missingDocuments: s.shipmentDocumentSetFacts.missingDocuments,
    receiverName: s.shipmentDocumentSetFacts.receiverName,
    receivedOn: s.shipmentDocumentSetFacts.receivedOn,
    changedAt: s.shipmentDocumentSetFacts.changedAt,
    changedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
  })
    .from(s.shipments)
    .leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))
    .leftJoin(s.shipmentDocumentSetFacts, eq(s.shipmentDocumentSetFacts.shipmentId, s.shipments.id))
    .leftJoin(s.users, eq(s.users.id, s.shipmentDocumentSetFacts.changedBy))
    .where(and(...conditions))
    .orderBy(s.shipments.id, desc(s.shipmentDocumentSetFacts.changedAt), desc(s.shipmentDocumentSetFacts.id));

  if (rows.length === 0) return [];

  // SIL-1107 — Lớp 1 (e-POD) and Lớp 3 (nhận phơi) are read for the whole
  // visible book in batched queries; the layer law then decides which lots
  // still owe a document.
  const layerFacts = await loadDocumentDebtLayerFacts(rows.map((row) => row.shipmentId));

  const items: ShipmentDocumentDebtItem[] = [];
  for (const row of rows) {
    const documentSet = row.factId == null ? null : {
      status: row.status as ShipmentDocumentSetStatus,
      missingDocuments: Array.isArray(row.missingDocuments) ? row.missingDocuments : [],
    };
    const layers = buildShipmentDocumentDebtLayers({
      documentSet,
      pod: layerFacts.pod.get(row.shipmentId) ?? [],
      phoi: layerFacts.phoi.get(row.shipmentId) ?? [],
    });
    // A lot is in debt while ANY of its three layers is open — the layers
    // never infer each other, so a complete bộ hồ sơ gốc never hides an
    // open e-POD or phơi.
    if (!shipmentDocumentDebtHasOpenLayer(layers)) continue;

    const status = documentSet?.status ?? ShipmentDocumentSetStatus.MISSING;
    items.push({
      shipmentId: row.shipmentId,
      shipmentCode: row.shipmentCode ?? null,
      billOrBookNumber: billOrBookNumberFor(row.tradeDirection, row.blNumber, row.bookingRef),
      customerName: row.customerName ?? null,
      status,
      label: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status] ?? status,
      missingDocuments: documentSet?.missingDocuments ?? [],
      receiverName: row.receiverName ?? null,
      receivedOn: row.receivedOn ?? null,
      changedAt: row.changedAt != null ? row.changedAt.toISOString() : null,
      changedByName: row.changedByName ?? null,
      layers,
    });
  }

  return items.sort((a, b) => b.shipmentId - a.shipmentId);
}

/**
 * SIL-1107 — the e-POD (Lớp 1) and nhận phơi (Lớp 3) facts of every lot in
 * one batch. Four queries, no per-lot round trip: the debt screen lists the
 * whole visible book, so an N+1 here would be an N+1 over hundreds of lots.
 */
async function loadDocumentDebtLayerFacts(shipmentIds: number[]): Promise<{
  pod: Map<number, DocumentDebtPodFact[]>;
  phoi: Map<number, DocumentDebtPhoiFact[]>;
}> {
  const pod = new Map<number, DocumentDebtPodFact[]>();
  const phoi = new Map<number, DocumentDebtPhoiFact[]>();
  if (shipmentIds.length === 0) return { pod, phoi };

  const fulfillmentRows = await db.select({
    id: s.shipmentFulfillments.id,
    shipmentId: s.shipmentFulfillments.shipmentId,
    fulfillmentType: s.shipmentFulfillments.fulfillmentType,
    shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
    cargoMode: s.shipmentFulfillments.cargoMode,
    canceledAt: s.shipmentFulfillments.canceledAt,
    cancellationDisposition: s.shipmentFulfillments.cancellationDisposition,
    replacementFulfillmentId: s.shipmentFulfillments.replacementFulfillmentId,
    notRequiredApprovedBy: s.shipmentFulfillments.notRequiredApprovedBy,
    notRequiredApprovedAt: s.shipmentFulfillments.notRequiredApprovedAt,
    notRequiredReason: s.shipmentFulfillments.notRequiredReason,
  })
    .from(s.shipmentFulfillments)
    .where(inArray(s.shipmentFulfillments.shipmentId, shipmentIds));

  const fulfillmentById = new Map(fulfillmentRows.map((row) => [row.id, row]));
  const fulfillmentIds = fulfillmentRows.map((row) => row.id);

  // The current e-POD submission of each fulfillment (newest version first),
  // then the file types it carries — the presence of the FILE is what makes
  // the document present (KB Lớp 1: Chưa có / Đã lưu / Chưa đọc được).
  const submissionRows = fulfillmentIds.length === 0 ? [] : await db.selectDistinctOn(
    [s.tripPodSubmissions.fulfillmentId],
    {
      id: s.tripPodSubmissions.id,
      fulfillmentId: s.tripPodSubmissions.fulfillmentId,
    },
  )
    .from(s.tripPodSubmissions)
    .where(inArray(s.tripPodSubmissions.fulfillmentId, fulfillmentIds))
    .orderBy(
      s.tripPodSubmissions.fulfillmentId,
      desc(s.tripPodSubmissions.submissionVersion),
      desc(s.tripPodSubmissions.id),
    );

  const submissionIds = submissionRows.map((row) => row.id);
  const fileRows = submissionIds.length === 0 ? [] : await db.select({
    submissionId: s.tripPodFiles.submissionId,
    fileType: s.tripPodFiles.fileType,
  })
    .from(s.tripPodFiles)
    .where(inArray(s.tripPodFiles.submissionId, submissionIds));

  const fileTypesBySubmission = new Map<number, string[]>();
  for (const file of fileRows) {
    const types = fileTypesBySubmission.get(file.submissionId) ?? [];
    types.push(file.fileType);
    fileTypesBySubmission.set(file.submissionId, types);
  }
  const submissionByFulfillment = new Map(
    submissionRows.map((row) => [row.fulfillmentId, row.id]),
  );

  for (const row of fulfillmentRows) {
    const replacement = row.replacementFulfillmentId != null
      ? fulfillmentById.get(row.replacementFulfillmentId) ?? null
      : null;
    const required = isFulfillmentRequired(row, replacement);
    const submissionId = submissionByFulfillment.get(row.id);
    const facts = pod.get(row.shipmentId) ?? [];
    facts.push({
      required,
      cargoMode: row.cargoMode,
      presentFileTypes: submissionId != null ? fileTypesBySubmission.get(submissionId) ?? [] : [],
    });
    pod.set(row.shipmentId, facts);
  }

  // Lớp 3 — the lot's live trips (not deleted, not canceled) and whether their
  // paper phơi was taken. A trip belongs to the lot directly or through its
  // fulfillment — the same law the lot-status summary reads.
  const tripRows = await db.select({
    tripId: s.trips.id,
    tripCode: s.trips.tripCode,
    tripStatus: s.trips.status,
    deletedAt: s.trips.deletedAt,
    directShipmentId: s.trips.shipmentId,
    fulfillmentShipmentId: s.shipmentFulfillments.shipmentId,
  })
    .from(s.trips)
    .leftJoin(s.shipmentFulfillments, eq(s.trips.fulfillmentId, s.shipmentFulfillments.id))
    .where(or(
      inArray(s.trips.shipmentId, shipmentIds),
      inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
    ));

  const liveTrips = tripRows.filter((row) => row.deletedAt == null && row.tripStatus !== 'CANCELED');
  const phoiRows = liveTrips.length === 0 ? [] : await db.select({
    tripId: s.tripFinancialState.tripId,
    phoiTakenDate: s.tripFinancialState.phoiTakenDate,
  })
    .from(s.tripFinancialState)
    .where(inArray(s.tripFinancialState.tripId, liveTrips.map((row) => row.tripId)));

  const phoiTakenByTrip = new Map(phoiRows.map((row) => [row.tripId, row.phoiTakenDate]));
  for (const row of liveTrips) {
    const ownerShipmentIds = new Set<number>();
    if (row.directShipmentId != null) ownerShipmentIds.add(row.directShipmentId);
    if (row.fulfillmentShipmentId != null) ownerShipmentIds.add(row.fulfillmentShipmentId);
    for (const ownerShipmentId of ownerShipmentIds) {
      const facts = phoi.get(ownerShipmentId) ?? [];
      facts.push({
        tripId: row.tripId,
        tripCode: row.tripCode ?? null,
        phoiTakenDate: phoiTakenByTrip.get(row.tripId) ?? null,
      });
      phoi.set(ownerShipmentId, facts);
    }
  }

  return { pod, phoi };
}
