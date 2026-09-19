// Shipment attachment leaf — documents, declarations, and containers.
//
// `/:id/documents` attach/replace (metadata only — bytes go via `/api/upload`),
// `/:id/declarations` (tờ khai) create/update, and the `/:id/containers`
// read/reconcile pair. All writes use the idempotent `runShipmentWrite`
// envelope with the intake mutation roles.

import { Router } from 'express';
import {
  Role,
  attachShipmentDocumentSchema,
  shipmentContainerBatchSchema,
} from '@tingting/shared';
import { z } from 'zod';
import type { Request, Response } from 'express';
import {
  getShipment,
  getShipmentDetail,
  attachShipmentDocument,
  upsertShipmentDeclaration,
  replaceShipmentDocument,
  batchUpsertShipmentContainers,
} from '../../services/shipment.service';
import {
  findDeclarationReferenceConflict,
  throwShipmentReferenceConflict,
} from '../../services/shipment-lifecycle-shared.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import {
  SHIPMENT_INTAKE_MUTATION_ROLES,
  parseId,
  runShipmentWrite,
  sendShipmentWrite,
} from './shipment-shared';

const shipmentDeclarationSchema = z.object({
  declarationNumber: z.string().trim().max(50).optional().nullable(),
  issuedAt: z.string().trim().min(1).optional().nullable(),
  scope: z.enum(['SINGLE', 'SHARED']).optional(),
  note: z.string().trim().optional().nullable(),
  // Card 20260919_5: undefined = keep current value, null = clear (partial
  // update). Anything outside RED/YELLOW/GREEN is rejected here at the API.
  channel: z.enum(['RED', 'YELLOW', 'GREEN']).optional().nullable(),
});

const replaceShipmentDocumentSchema = z.object({
  expectedVersion: z.number().int().nonnegative('expectedVersion là bắt buộc để kiểm soát đồng thời'),
  storageKey: z.string().trim().min(1, 'storageKey là bắt buộc').max(255),
  expiresAt: z.string().trim().min(1).optional().nullable(),
});

const documentsRoutes = Router();

// ─── POST /:id/documents — record an uploaded document's metadata ──────────
//
// The file bytes themselves are uploaded via `/api/upload`; this endpoint
// records the resulting `storageKey` against the shipment. A future Wave 2
// portal variant may accept multipart directly.
documentsRoutes.post(
  '/:id/documents',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = attachShipmentDocumentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_ATTACH,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(id, tx);
        const doc = await attachShipmentDocument(id, {
          type: parsed.data.type,
          storageKey: parsed.data.storageKey,
          uploadedBy: user.userId,
        }, user, tx);
        return {
          body: doc,
          status: 201,
          auditEntityId: id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

documentsRoutes.post(
  '/:id/documents/:documentId/replace',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const documentId = parseInt(req.params.documentId as string, 10);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: 'ID tài liệu không hợp lệ' });
      return;
    }
    const parsed = replaceShipmentDocumentSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DOCUMENT_REPLACE,
      { shipmentId, documentId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        const replaced = await replaceShipmentDocument(shipmentId, documentId, {
          expectedVersion: parsed.data.expectedVersion,
          storageKey: parsed.data.storageKey,
          expiresAt: parsed.data.expiresAt ?? null,
          uploadedBy: user.userId,
        }, user, tx);
        return {
          body: replaced,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

documentsRoutes.post(
  '/:id/declarations',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentDeclarationSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_CREATE,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        // Customer feedback 2026-09-07: block creating a declaration whose
        // `declarationNumber` already belongs to another active shipment.
        const incomingDeclaration = parsed.data.declarationNumber?.trim();
        if (incomingDeclaration) {
          const conflict = await findDeclarationReferenceConflict(
            tx,
            incomingDeclaration,
            shipmentId,
          );
          if (conflict) {
            throwShipmentReferenceConflict(conflict, 'declaration');
          }
        }
        const declaration = await upsertShipmentDeclaration(shipmentId, {
          declarationNumber: parsed.data.declarationNumber ?? null,
          issuedAt: parsed.data.issuedAt ?? null,
          scope: parsed.data.scope,
          note: parsed.data.note ?? null,
          channel: parsed.data.channel,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: declaration,
          status: 201,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

documentsRoutes.put(
  '/:id/declarations/:declarationId',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const declarationId = parseInt(req.params.declarationId as string, 10);
    if (!Number.isInteger(declarationId) || declarationId <= 0) {
      res.status(400).json({ error: 'ID tờ khai không hợp lệ' });
      return;
    }
    const parsed = shipmentDeclarationSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DECLARATION_UPDATE,
      { shipmentId, declarationId, data: parsed.data },
      async (tx) => {
        const shipment = await getShipment(shipmentId, tx);
        const incomingDeclaration = parsed.data.declarationNumber?.trim();
        if (incomingDeclaration) {
          const conflict = await findDeclarationReferenceConflict(
            tx,
            incomingDeclaration,
            shipmentId,
          );
          if (conflict) {
            throwShipmentReferenceConflict(conflict, 'declaration');
          }
        }
        const declaration = await upsertShipmentDeclaration(shipmentId, {
          id: declarationId,
          declarationNumber: parsed.data.declarationNumber ?? null,
          issuedAt: parsed.data.issuedAt ?? null,
          scope: parsed.data.scope,
          note: parsed.data.note ?? null,
          channel: parsed.data.channel,
          updatedBy: user.userId,
        }, user, tx);
        return {
          body: declaration,
          status: 200,
          auditEntityId: shipment.id,
          auditEntityKey: shipment.shipmentCode ?? "Lô hàng chưa có mã",
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── GET /:id/containers — list shipment containers ────────────────────────
documentsRoutes.get('/:id/containers', asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (id === null) return;
  // 404 if the shipment itself is missing, rather than returning an empty
  // list that would mask the missing parent.
  const detail = await getShipmentDetail(id, getUser(req));
  res.json({ items: detail.containers });
}));

// ─── PUT /:id/containers — full reconcile of shipment containers ───────────
documentsRoutes.put(
  '/:id/containers',
  requireRoles(...SHIPMENT_INTAKE_MUTATION_ROLES),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req, res);
    if (id === null) return;
    const parsed = shipmentContainerBatchSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const user = getUser(req);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CONTAINERS_RECONCILE,
      { shipmentId: id, data: parsed.data },
      async (tx) => {
        const reconciled = await batchUpsertShipmentContainers(
          id,
          user.userId,
          parsed.data.expectedVersion,
          parsed.data.containers,
          user,
          tx,
        );
        return {
          body: reconciled,
          status: 200,
          auditEntityId: id,
        };
      },
    );
    // Report both the reconciled ids (what the caller asked for) and the full
    // refreshed list (what the UI needs to re-render). Mirrors the trips
    // containers PUT response contract.
    sendShipmentWrite(res, result);
  }),
);

export { documentsRoutes };
