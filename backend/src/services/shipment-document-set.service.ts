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
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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

  // Lots with NO fact at all are the debt's floor: the KB default state
  // 'Còn thiếu' exists without any recorded row.
  const factlessRows = await db.select({
    shipmentId: s.shipments.id,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    customerName: CUSTOMER_OPERATIONAL_NAME,
  })
    .from(s.shipments)
    .leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))
    .leftJoin(s.shipmentDocumentSetFacts, eq(s.shipmentDocumentSetFacts.shipmentId, s.shipments.id))
    .where(and(...conditions, sql`${s.shipmentDocumentSetFacts.id} is null`))
    .orderBy(desc(s.shipments.id));

  const factlessItems: ShipmentDocumentDebtItem[] = factlessRows.map((row) => ({
    shipmentId: row.shipmentId,
    shipmentCode: row.shipmentCode ?? null,
    billOrBookNumber: billOrBookNumberFor(row.tradeDirection, row.blNumber, row.bookingRef),
    customerName: row.customerName ?? null,
    status: ShipmentDocumentSetStatus.MISSING,
    label: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[ShipmentDocumentSetStatus.MISSING],
    missingDocuments: [],
    receiverName: null,
    receivedOn: null,
    changedAt: null,
    changedByName: null,
  }));

  // Latest fact per lot (DISTINCT ON + newest-first order), then drop the
  // lots whose newest state is already 'Đã đủ'.
  const factRows = await db.selectDistinctOn([s.shipmentDocumentSetFacts.shipmentId], {
    shipmentId: s.shipmentDocumentSetFacts.shipmentId,
    status: s.shipmentDocumentSetFacts.status,
    missingDocuments: s.shipmentDocumentSetFacts.missingDocuments,
    receiverName: s.shipmentDocumentSetFacts.receiverName,
    receivedOn: s.shipmentDocumentSetFacts.receivedOn,
    changedAt: s.shipmentDocumentSetFacts.changedAt,
    changedByName: sql<string | null>`coalesce(${s.users.fullName}, ${s.users.username})`,
    shipmentCode: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    tradeDirection: s.shipments.tradeDirection,
    customerName: CUSTOMER_OPERATIONAL_NAME,
  })
    .from(s.shipmentDocumentSetFacts)
    .innerJoin(s.shipments, and(
      eq(s.shipments.id, s.shipmentDocumentSetFacts.shipmentId),
      ...conditions,
    ))
    .leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))
    .leftJoin(s.users, eq(s.users.id, s.shipmentDocumentSetFacts.changedBy))
    .orderBy(s.shipmentDocumentSetFacts.shipmentId, desc(s.shipmentDocumentSetFacts.changedAt), desc(s.shipmentDocumentSetFacts.id));

  const factItems: ShipmentDocumentDebtItem[] = factRows
    .filter((row) => row.status !== ShipmentDocumentSetStatus.COMPLETE)
    .map((row) => {
      const status = (row.status as ShipmentDocumentSetStatus);
      return {
        shipmentId: row.shipmentId,
        shipmentCode: row.shipmentCode ?? null,
        billOrBookNumber: billOrBookNumberFor(row.tradeDirection, row.blNumber, row.bookingRef),
        customerName: row.customerName ?? null,
        status,
        label: SHIPMENT_DOCUMENT_SET_STATUS_LABELS[status] ?? status,
        missingDocuments: Array.isArray(row.missingDocuments) ? row.missingDocuments : [],
        receiverName: row.receiverName ?? null,
        receivedOn: row.receivedOn ?? null,
        changedAt: row.changedAt != null ? row.changedAt.toISOString() : null,
        changedByName: row.changedByName ?? null,
      };
    });

  return [...factItems, ...factlessItems].sort((a, b) => b.shipmentId - a.shipmentId);
}
