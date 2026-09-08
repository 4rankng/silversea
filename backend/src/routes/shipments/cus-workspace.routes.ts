// CUS workspace leaf — `/api/shipments/cus-workspace/*`.
//
// The clerk-side shipment workspace: overview/detail reads, per-container line
// updates, finance confirmations, charge-proposal billing review, document
// custody, accounting lock, and the reopen request/decision flow. All writes
// go through the idempotent `runShipmentWrite` envelope.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import type { Request, Response } from 'express';
import {
  shipmentChargeProposalReviewSchema,
  shipmentCusWorkspaceQuerySchema,
  shipmentCusContainerQuerySchema,
  shipmentCusContainerLineUpdateSchema,
  shipmentCusFinanceConfirmationCreateSchema,
  shipmentCusDocumentCustodyUpdateSchema,
  shipmentCusLockSchema,
  shipmentCusReopenRequestSchema,
  shipmentCusReopenDecisionSchema,
} from '@tingting/shared';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentContainers,
  listCusShipmentWorkspace,
  updateCusShipmentContainerLine,
} from '../../services/cus-shipment-workspace.service';
import {
  activateShipmentAccountingLock,
  confirmShipmentFinance,
  decideShipmentReopen,
  reviewShipmentChargeProposal,
  requestShipmentReopen,
  updateShipmentDocumentCustody,
} from '../../services/shipment-accounting-lock.service';
import {
  requestShipmentDelete,
  decideShipmentDeleteRequest,
  requestContainerEdit,
  decideContainerEditRequest,
} from '../../services/shipment-governance.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import { parseId, runShipmentWrite, sendShipmentWrite } from './shipment-shared';

const cusWorkspaceRoutes = Router();

cusWorkspaceRoutes.get(
  '/cus-workspace',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = shipmentCusWorkspaceQuerySchema.safeParse(req.query);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await listCusShipmentWorkspace(parsed.data, getUser(req)));
  }),
);

cusWorkspaceRoutes.get(
  '/cus-workspace/containers',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    // Detail-only strict contract: informationStatus is accepted here and
    // rejected by the overview schema, locking the two endpoints' surfaces.
    const parsed = shipmentCusContainerQuerySchema.safeParse(req.query);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await listCusShipmentContainers(parsed.data, getUser(req)));
  }),
);

cusWorkspaceRoutes.get(
  '/cus-workspace/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    res.json(await getCusShipmentWorkspaceDetail(shipmentId, getUser(req)));
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers/:containerId',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const containerId = Number.parseInt(req.params.containerId as string, 10);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(400, 'ID container không hợp lệ');
    }
    const parsed = shipmentCusContainerLineUpdateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_CONTAINER_LINE_UPDATE,
      { shipmentId, containerId, data: parsed.data },
      async (tx) => {
        const outcome = await updateCusShipmentContainerLine({
          shipmentId,
          containerId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/finance-confirmations',
  requireRoles(Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentCusFinanceConfirmationCreateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_FINANCE_CONFIRM,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const outcome = await confirmShipmentFinance({
          shipmentId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: outcome.replayed ? 200 : 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/proposal-billing-links',
  requireRoles(Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentChargeProposalReviewSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_PROPOSAL_BILLING_REVIEW,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const outcome = await reviewShipmentChargeProposal({
          shipmentId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: outcome.replayed ? 200 : 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/document-custody',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentCusDocumentCustodyUpdateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_DOCUMENT_CUSTODY_UPDATE,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const outcome = await updateShipmentDocumentCustody({
          shipmentId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/lock',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentCusLockSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_LOCK,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const outcome = await activateShipmentAccountingLock({
          shipmentId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: outcome.replayed ? 200 : 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/reopen-requests',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const parsed = shipmentCusReopenRequestSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_REOPEN_REQUEST,
      { shipmentId, data: parsed.data },
      async (tx) => {
        const outcome = await requestShipmentReopen({
          shipmentId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: outcome.replayed ? 200 : 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/reopen-requests/:actionId/decision',
  requireRoles(Role.ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const actionId = Number.parseInt(req.params.actionId as string, 10);
    if (!Number.isInteger(actionId) || actionId <= 0) {
      throw new ApiError(400, 'ID đề nghị điều chỉnh không hợp lệ');
    }
    const parsed = shipmentCusReopenDecisionSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_REOPEN_DECISION,
      { shipmentId, actionId, data: parsed.data },
      async (tx) => {
        const outcome = await decideShipmentReopen({
          shipmentId,
          actionId,
          input: parsed.data,
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── DELETE REQUEST — CUS requests shipment deletion ────────────────────────
cusWorkspaceRoutes.post(
  '/cus-workspace/:id/delete-request',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const { version, reason } = req.body ?? {};
    if (!Number.isInteger(version) || version < 0) {
      throw new ApiError(400, 'version là bắt buộc');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError(400, 'Lý do là bắt buộc');
    }
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST,
      { shipmentId, version, reason: reason.trim() },
      async (tx) => {
        const outcome = await requestShipmentDelete({
          shipmentId,
          version,
          reason: reason.trim(),
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: outcome.pendingApproval ? 201 : 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── DELETE REQUEST DECISION — Admin approves/rejects deletion ──────────────
cusWorkspaceRoutes.post(
  '/cus-workspace/:id/delete-requests/:actionId/decision',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const actionId = Number.parseInt(req.params.actionId as string, 10);
    if (!Number.isInteger(actionId) || actionId <= 0) {
      throw new ApiError(400, 'ID yêu cầu không hợp lệ');
    }
    const { decision, expectedVersion, reason } = req.body ?? {};
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw new ApiError(400, 'decision phải là APPROVE hoặc REJECT');
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new ApiError(400, 'expectedVersion là bắt buộc');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError(400, 'Lý do là bắt buộc');
    }
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_DELETE_REQUEST_DECISION,
      { shipmentId, actionId, decision, expectedVersion, reason: reason.trim() },
      async (tx) => {
        const outcome = await decideShipmentDeleteRequest({
          shipmentId,
          actionId,
          decision,
          expectedVersion,
          reason: reason.trim(),
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── CONTAINER EDIT REQUEST — CUS requests container field edit past cutoff ─
cusWorkspaceRoutes.post(
  '/cus-workspace/:id/container-edit-request',
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const { containerId, fields, reason } = req.body ?? {};
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(400, 'containerId là bắt buộc');
    }
    if (!fields || typeof fields !== 'object') {
      throw new ApiError(400, 'fields là bắt buộc');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError(400, 'Lý do là bắt buộc');
    }
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST,
      { shipmentId, containerId, fields, reason: reason.trim() },
      async (tx) => {
        const outcome = await requestContainerEdit({
          shipmentId,
          containerId,
          fields,
          reason: reason.trim(),
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 201,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

// ─── CONTAINER EDIT REQUEST DECISION — Admin approves/rejects edit ──────────
cusWorkspaceRoutes.post(
  '/cus-workspace/:id/container-edit-requests/:actionId/decision',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    const actionId = Number.parseInt(req.params.actionId as string, 10);
    if (!Number.isInteger(actionId) || actionId <= 0) {
      throw new ApiError(400, 'ID yêu cầu không hợp lệ');
    }
    const { decision, expectedVersion, reason } = req.body ?? {};
    if (decision !== 'APPROVE' && decision !== 'REJECT') {
      throw new ApiError(400, 'decision phải là APPROVE hoặc REJECT');
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new ApiError(400, 'expectedVersion là bắt buộc');
    }
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw new ApiError(400, 'Lý do là bắt buộc');
    }
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.CONTAINER_EDIT_REQUEST_DECISION,
      { shipmentId, actionId, decision, expectedVersion, reason: reason.trim() },
      async (tx) => {
        const outcome = await decideContainerEditRequest({
          shipmentId,
          actionId,
          decision,
          expectedVersion,
          reason: reason.trim(),
          actor: getUser(req),
          transaction: tx,
        });
        return {
          body: outcome,
          status: 200,
          auditEntityId: shipmentId,
          auditEntityKey: `shipment-${shipmentId}`,
        };
      },
    );
    sendShipmentWrite(res, result);
  }),
);

export { cusWorkspaceRoutes };
