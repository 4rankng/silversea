// Shipment Documents Service — document/declaration metadata for shipments.
//
// Extracted from shipment.service.ts (T3b): attach, declaration upsert,
// DO-expiry check, dispatch readiness (advisory), and document replacement
// with audit-preserving `replacedBy` chaining. Leaf module: imports only
// db/schema, shared helpers, and sibling leaf services — never
// shipment.service itself.

import { db } from '../db';
import * as s from '../db/schema';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { AuthUser } from '../middleware/auth';
import {
  assertDispatcherCanMutateShipmentIntake,
  normalizeShipmentDeclarationScope,
  normalizeShipmentDocumentType,
} from './shipment-intake.service';
import {
  assertClerkCanAccessShipment,
  isClerkScopedUser,
  loadClerkShipmentScope,
} from './clerk-shipment-scope.service';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import type { ShipmentDeclarationMutationInput } from './shipment-types';

export async function listShipmentDocuments(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentDocuments)
    .where(eq(s.shipmentDocuments.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDocuments.createdAt));
}

export async function listShipmentDeclarations(shipmentId: number, tx?: Tx) {
  const client = tx ?? db;
  return await client.select().from(s.shipmentDeclarations)
    .where(eq(s.shipmentDeclarations.shipmentId, shipmentId))
    .orderBy(desc(s.shipmentDeclarations.createdAt));
}

// Default declaration scope when a caller omits it (moved from
// shipment.service.ts with the declaration upsert).
export const DEFAULT_SHIPMENT_DECLARATION_SCOPE = 'SINGLE' as const;

// ─── Document attach ────────────────────────────────────────────────────────
//
// The file bytes themselves are uploaded separately via `/api/upload` (the same
// path trip photos use); this endpoint records the metadata row that references
// the resulting `storageKey`. Multipart upload is a Wave 2 portal concern.

export async function attachShipmentDocument(
  shipmentId: number,
  input: { type: typeof s.shipmentDocuments.type.enumValues[number]; storageKey: string; uploadedBy?: number | null },
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const documentType = normalizeShipmentDocumentType(input.type);
    if (!documentType) throw new ApiError(400, 'Loại chứng từ không hợp lệ');
    const [existing] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existing);
    }

    const [doc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: documentType,
      storageKey: input.storageKey,
      uploadedBy: input.uploadedBy ?? null,
    }).returning();
    return doc;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

export async function upsertShipmentDeclaration(
  shipmentId: number,
  input: ShipmentDeclarationMutationInput,
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const scope = normalizeShipmentDeclarationScope(input.scope) ?? DEFAULT_SHIPMENT_DECLARATION_SCOPE;
    const issuedAt = input.issuedAt ? new Date(input.issuedAt) : null;
    const [existingShipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!existingShipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    assertDispatcherCanMutateShipmentIntake(actor, existingShipment.status);
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, existingShipment);
    }

    if (input.id != null) {
      const [updated] = await tx.update(s.shipmentDeclarations).set({
        declarationNumber: input.declarationNumber ?? null,
        issuedAt,
        scope,
        note: input.note ?? null,
        updatedAt: new Date(),
      })
        .where(and(
          eq(s.shipmentDeclarations.id, input.id),
          eq(s.shipmentDeclarations.shipmentId, shipmentId),
        ))
        .returning();
      if (!updated) throw new ApiError(404, 'Không tìm thấy tờ khai cần cập nhật');
      return updated;
    }

    const [created] = await tx.insert(s.shipmentDeclarations).values({
      shipmentId,
      declarationNumber: input.declarationNumber ?? null,
      issuedAt,
      scope,
      note: input.note ?? null,
      createdBy: input.updatedBy ?? null,
    }).returning();
    return created;
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}

// ─── M3.2: expired document check + document replacement ────────────────────

/**
 * Check if a shipment has any expired documents (DO type with expiresAt in the
 * past). Returns the list of expired document rows. Empty = no expired docs.
 */
export async function checkExpiredDocuments(shipmentId: number, transaction?: Tx) {
  const client = transaction ?? db;
  const today = new Date().toISOString().slice(0, 10);
  const docs = await client.select()
    .from(s.shipmentDocuments)
    .where(and(
      eq(s.shipmentDocuments.shipmentId, shipmentId),
      eq(s.shipmentDocuments.type, 'DO'),
      sql`${s.shipmentDocuments.expiresAt} IS NOT NULL`,
      sql`${s.shipmentDocuments.expiresAt} < ${today}`,
      isNull(s.shipmentDocuments.replacedBy), // not superseded by a newer version
    ));
  return docs;
}

// ─── M10.2 slice 2: dispatch readiness (advisory) ───────────────────────────
//
// PRD M10-02-03 ("mandatory fields defined before dispatch") + Q17 (clerk
// editable surface, status `pending`). A hard mandatory gate would be a
// breaking behavioural change while the field set is still unconfirmed, so
// slice 2 ships the check as advisory: this helper returns the list of
// missing recommended fields so fulfillment-dispatch callers can show
// `preDispatchWarnings` without blocking dispatch. The UI (slice 3) shows a
// confirm dialog; a follow-up slice flips enforcing on
// once Q17 / M10.2 §1 sign-off lands (mirrors the M12.2 "advisory first"
// precedent).
//
// Recommended set today: BL number + ≥1 shipment container. BL is the legal
// shipping document; containers are what get snapshotted into the trip.

export interface DispatchReadiness {
  /** True when no recommended fields are missing. */
  ready: boolean;
  /** Vietnamese field labels not yet set (empty when `ready`). */
  missing: string[];
}

/**
 * Return the list of recommended pre-dispatch fields that are not yet set on
 * the shipment. Throws 404 on a missing/soft-deleted shipment so callers can
 * surface the canonical not-found error before dispatch attempts.
 */
export async function getDispatchReadiness(shipmentId: number, transaction?: Tx): Promise<DispatchReadiness> {
  const client = transaction ?? db;
  const [shipment] = await client.select({
    blNumber: s.shipments.blNumber,
  })
    .from(s.shipments)
    .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
    .limit(1);
  if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');

  const missing: string[] = [];
  if (!shipment.blNumber || shipment.blNumber.trim() === '') {
    missing.push('Số vận đơn (B/L)');
  }

  const [containerCountRow] = await client.select({ count: count() })
    .from(s.shipmentContainers)
    .where(eq(s.shipmentContainers.shipmentId, shipmentId));
  const containerCount = containerCountRow?.count ?? 0;
  if (containerCount === 0) {
    missing.push('Công-te-nơ (ít nhất một)');
  }

  return { ready: missing.length === 0, missing };
}

/**
 * M3.2: Replace a shipment document with a new version. The old document is
 * NOT deleted — its `replacedBy` is set to the new document's id, preserving
 * the full audit history. The new document inherits the old one's type and
 * can have a new expiry date.
 */
export async function replaceShipmentDocument(
  shipmentId: number,
  oldDocId: number,
  newDocData: {
    expectedVersion: number;
    storageKey: string;
    expiresAt?: string | null;
    uploadedBy?: number | null;
  },
  actor?: AuthUser,
  transaction?: Tx,
) {
  const execute = async (tx: Tx) => {
    const [shipment] = await tx.select()
      .from(s.shipments)
      .where(and(eq(s.shipments.id, shipmentId), isNull(s.shipments.deletedAt)))
      .for('update')
      .limit(1);
    if (!shipment) throw new ApiError(404, 'Không tìm thấy lô hàng');
    await assertShipmentAccountingUnlocked(tx, shipmentId);
    if (shipment.version !== newDocData.expectedVersion) {
      throw new ApiError(409, 'Lô hàng đã bị người khác cập nhật. Vui lòng tải lại.');
    }
    if (actor && isClerkScopedUser(actor)) {
      const scope = await loadClerkShipmentScope(actor.userId, tx);
      assertClerkCanAccessShipment(scope, shipment);
    }

    const [oldDoc] = await tx.select()
      .from(s.shipmentDocuments)
      .where(and(
        eq(s.shipmentDocuments.id, oldDocId),
        eq(s.shipmentDocuments.shipmentId, shipmentId),
      ))
      .for('update')
      .limit(1);
    if (!oldDoc) throw new ApiError(404, 'Không tìm thấy tài liệu cần thay thế');
    if (oldDoc.replacedBy != null) {
      throw new ApiError(409, 'Tài liệu đã được thay thế. Vui lòng tải lại.');
    }

    const [newDoc] = await tx.insert(s.shipmentDocuments).values({
      shipmentId,
      type: oldDoc.type,
      storageKey: newDocData.storageKey,
      expiresAt: newDocData.expiresAt ?? null,
      uploadedBy: newDocData.uploadedBy ?? null,
    }).returning();

    const [linked] = await tx.update(s.shipmentDocuments)
      .set({ replacedBy: newDoc.id })
      .where(and(
        eq(s.shipmentDocuments.id, oldDocId),
        eq(s.shipmentDocuments.shipmentId, shipmentId),
        isNull(s.shipmentDocuments.replacedBy),
      ))
      .returning({ id: s.shipmentDocuments.id });
    if (!linked) {
      throw new ApiError(409, 'Tài liệu đã được thay thế. Vui lòng tải lại.');
    }

    const nextVersion = shipment.version + 1;
    await tx.update(s.shipments)
      .set({ version: nextVersion, updatedAt: new Date(), updatedBy: actor?.userId ?? null })
      .where(eq(s.shipments.id, shipmentId));

    return { ...newDoc, shipmentVersion: nextVersion };
  };
  return transaction ? execute(transaction) : db.transaction(execute);
}
