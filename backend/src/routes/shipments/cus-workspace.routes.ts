// CUS workspace leaf — `/api/shipments/cus-workspace/*`.
//
// The clerk-side shipment workspace: overview/detail reads, per-container line
// updates, finance confirmations, charge-proposal billing review, document
// custody, accounting lock, and the direct reopen request. All writes
// go through the idempotent `runShipmentWrite` envelope.

import { Router } from 'express';
import { Role } from '@tingting/shared';
import type { Request, Response } from 'express';
import {
  shipmentChargeProposalReviewSchema,
  shipmentCusWorkspaceQuerySchema,
  shipmentCusContainerQuerySchema,
  shipmentCusContainerLineUpdateSchema,
  shipmentCusContainerAddSchema,
  shipmentCusContainerRemoveSchema,
  shipmentCusContainerAppointmentCopySchema,
  shipmentCusContainerDeclarationCopySchema,
  shipmentCusFinanceConfirmationCreateSchema,
  shipmentCusDocumentCustodyUpdateSchema,
  shipmentDocumentSetUpdateSchema,
  shipmentCusLockSchema,
  shipmentCusReopenRequestSchema,
} from '@tingting/shared';
import {
  getCusShipmentWorkspaceDetail,
  listCusShipmentContainers,
  listCusShipmentWorkspace,
  updateCusShipmentContainerLine,
  addCusShipmentContainer,
  removeCusShipmentContainer,
  copyCusShipmentContainerAppointment,
  copyCusShipmentContainerDeclaration,
} from '../../services/cus-shipment-workspace.service';
import {
  activateShipmentAccountingLock,
  confirmShipmentFinance,
  reviewShipmentChargeProposal,
  requestShipmentReopen,
  updateShipmentDocumentCustody,
} from '../../services/shipment-accounting-lock.service';
import { listShipmentDocumentDebt, updateShipmentDocumentSet } from '../../services/shipment-document-set.service';
import {
  requestShipmentDelete,
} from '../../services/shipment-governance.service';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { assertCusLotVisible } from '../../services/cus-visibility.service';
import { asyncHandler } from '../../middleware/asyncHandler';
import { throwValidation } from '../../lib/validation';
import { ApiError } from '../../errors';
import { IDEMPOTENCY_ENDPOINTS } from '../../services/idempotency.service';
import { parseId, runShipmentWrite, sendShipmentWrite } from './shipment-shared';
import { SHIPMENT_AUDIT_SCOPES, withShipmentAuditDiff } from '../../services/shipment-audit-diff.service';
import { declareMaterialWrite } from '../../middleware/material-write';

const cusWorkspaceRoutes = Router()

cusWorkspaceRoutes.get(
  '/cus-workspace',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER, Role.OPS),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = shipmentCusWorkspaceQuerySchema.safeParse(req.query);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await listCusShipmentWorkspace(parsed.data, getUser(req)));
  }),
);

cusWorkspaceRoutes.get(
  '/cus-workspace/containers',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER, Role.OPS),
  asyncHandler(async (req: Request, res: Response) => {
    // Detail-only strict contract: informationStatus is accepted here and
    // rejected by the overview schema, locking the two endpoints' surfaces.
    const parsed = shipmentCusContainerQuerySchema.safeParse(req.query);
    if (!parsed.success) throwValidation(parsed.error);
    res.json(await listCusShipmentContainers(parsed.data, getUser(req)));
  }),
);

// SIL-1073 (KB Ch3 §3.5.4) — the "Nợ chứng từ" screen: lots whose original
// document set is not 'Đã đủ'. Registered BEFORE '/cus-workspace/:id' so the
// static segment wins; CUS scope rides cusVisibilityCondition inside the
// service (the one visibility law — never a hand-written WHERE).
cusWorkspaceRoutes.get(
  '/cus-workspace/document-debt',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listShipmentDocumentDebt(getUser(req)));
  }),
);

cusWorkspaceRoutes.get(
  '/cus-workspace/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS, Role.DISPATCHER, Role.OPS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    res.json(await getCusShipmentWorkspaceDetail(shipmentId, getUser(req)));
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers/:containerId', declareMaterialWrite('shipments.cus.container-line.update', { method: 'POST', path: '/api/shipments/cus-workspace/:id/containers/:containerId' }), 
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
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
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.containerSet },
        async () => {
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers', declareMaterialWrite('shipments.cus.container.add', { method: 'POST', path: '/api/shipments/cus-workspace/:id/containers' }), 
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentCusContainerAddSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_CONTAINER_ADD,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.containerSet },
        async () => {
          const outcome = await addCusShipmentContainer({
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers/:containerId/copy-appointment', declareMaterialWrite('shipments.cus.container-line.copy-appointment', { method: 'POST', path: '/api/shipments/cus-workspace/:id/containers/:containerId/copy-appointment' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const containerId = Number.parseInt(req.params.containerId as string, 10);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(400, 'ID container không hợp lệ');
    }
    const parsed = shipmentCusContainerAppointmentCopySchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_CONTAINER_APPOINTMENT_COPY,
      { shipmentId, containerId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.containerSet },
        async () => {
          const outcome = await copyCusShipmentContainerAppointment({
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers/:containerId/copy-declaration', declareMaterialWrite('shipments.cus.container-line.copy-declaration', { method: 'POST', path: '/api/shipments/cus-workspace/:id/containers/:containerId/copy-declaration' }),
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const containerId = Number.parseInt(req.params.containerId as string, 10);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(400, 'ID container không hợp lệ');
    }
    const parsed = shipmentCusContainerDeclarationCopySchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_CONTAINER_DECLARATION_COPY,
      { shipmentId, containerId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.containerSet },
        async () => {
          const outcome = await copyCusShipmentContainerDeclaration({
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/containers/:containerId/remove', declareMaterialWrite('shipments.cus.container.remove', { method: 'POST', path: '/api/shipments/cus-workspace/:id/containers/:containerId/remove' }), 
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS, Role.DISPATCHER),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const containerId = Number.parseInt(req.params.containerId as string, 10);
    if (!Number.isInteger(containerId) || containerId <= 0) {
      throw new ApiError(400, 'ID container không hợp lệ');
    }
    const parsed = shipmentCusContainerRemoveSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_CONTAINER_REMOVE,
      { shipmentId, containerId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.containerSet },
        async () => {
          const outcome = await removeCusShipmentContainer({
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/finance-confirmations', declareMaterialWrite('shipments.cus.finance-confirm', { method: 'POST', path: '/api/shipments/cus-workspace/:id/finance-confirmations' }), 
  requireRoles(Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentCusFinanceConfirmationCreateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_FINANCE_CONFIRM,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.shipmentFields },
        async () => {
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/proposal-billing-links', declareMaterialWrite('shipments.cus.proposal-billing.review', { method: 'POST', path: '/api/shipments/cus-workspace/:id/proposal-billing-links' }), 
  requireRoles(Role.ACCOUNTANT),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentChargeProposalReviewSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_PROPOSAL_BILLING_REVIEW,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.shipmentFields },
        async () => {
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/document-custody', declareMaterialWrite('shipments.cus.document-custody.update', { method: 'POST', path: '/api/shipments/cus-workspace/:id/document-custody' }), 
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentCusDocumentCustodyUpdateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_DOCUMENT_CUSTODY_UPDATE,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.custody },
        async () => {
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

// SIL-1073 (KB Ch3 §3.5.4, Lớp 2) — the original-document-set write. Writers
// are the KB's bảng kê maintainers (ADMIN/MANAGER/CUS — the same trio the lot
// edit admits); the 'Đã đủ' receiver+date law lives in the service.
cusWorkspaceRoutes.post(
  '/cus-workspace/:id/document-set', declareMaterialWrite('shipments.cus.document-set.update', { method: 'POST', path: '/api/shipments/cus-workspace/:id/document-set' }), 
  requireRoles(Role.ADMIN, Role.MANAGER, Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentDocumentSetUpdateSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_DOCUMENT_SET_UPDATE,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.documentSet },
        async () => {
          const outcome = await updateShipmentDocumentSet({
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/lock', declareMaterialWrite('shipments.cus.lock', { method: 'POST', path: '/api/shipments/cus-workspace/:id/lock' }), 
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentCusLockSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_LOCK,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.accountingLock },
        async () => {
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.post(
  '/cus-workspace/:id/reopen-requests', declareMaterialWrite('shipments.cus.reopen-request', { method: 'POST', path: '/api/shipments/cus-workspace/:id/reopen-requests' }), 
  requireRoles(Role.CUS),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
    const parsed = shipmentCusReopenRequestSchema.safeParse(req.body);
    if (!parsed.success) throwValidation(parsed.error);
    const { result } = await runShipmentWrite(
      req,
      IDEMPOTENCY_ENDPOINTS.SHIPMENT_CUS_REOPEN_REQUEST,
      { shipmentId, data: parsed.data },
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.accountingLock },
        async () => {
          const outcome = await requestShipmentReopen({
            shipmentId,
            input: parsed.data,
            actor: getUser(req),
            transaction: tx,
          });
          return {
            body: outcome,
            status:  200,
            auditEntityId: shipmentId,
            auditEntityKey: `shipment-${shipmentId}`,
          };
        },
      ),
    );
    sendShipmentWrite(res, result);
  }),
);

cusWorkspaceRoutes.delete(
  '/cus-workspace/:id', declareMaterialWrite('shipments.delete-request', { method: 'DELETE', path: '/api/shipments/cus-workspace/:id' }), 
  requireRoles(Role.CUS, Role.ADMIN),
  asyncHandler(async (req: Request, res: Response) => {
    const shipmentId = parseId(req, res);
    if (shipmentId === null) return;
    // Nhóm CUS: mọi handler theo lô (đọc + ghi container/custody/lock/xóa)
    // đều qua một luật — lô ngoài phạm vi = 404 như lô không tồn tại.
    await assertCusLotVisible(shipmentId, getUser(req));
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
      async (tx) => withShipmentAuditDiff(
        res.locals,
        { executor: tx, shipmentId, scope: SHIPMENT_AUDIT_SCOPES.shipmentFields },
        async () => {
          const outcome = await requestShipmentDelete({
            shipmentId,
            version,
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
      ),
    );
    sendShipmentWrite(res, result);
  }),
);
export { cusWorkspaceRoutes };
