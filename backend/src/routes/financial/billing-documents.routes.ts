import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  Role,
  billingDocumentAdjustmentRequestSchema,
  billingDocumentIssueRequestSchema,
  generateBillingDocumentSchema,
  saveBillingDocumentSchema,
  sendDebitNoteForConfirmationSchema,
  accountingTransportRegisterQuerySchema,
} from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as billingService from '../../services/billingDocument.service';
import {
  requestBillingDocumentAdjustment,
  requestBillingDocumentIssue,
} from '../../services/billing-document-governance.service';
import { getDebitNoteForRender, exportDebitNoteHtml } from '../../services/debit-note-pdf.service';
import { attachmentDisposition } from '../../services/statement.service';
import { invalidateReportCaches } from '../../lib/redis';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../../services/idempotency.service';
import { sendDebitNoteForCustomerConfirmation } from '../../services/debit-note-lifecycle.service';
import { listAccountingTransportRows } from '../../services/accounting-transport-register.service';

// Debit-note (AR) + payment-statement (AP) builder routes.
// Mounted under the financial router → already gated by casbinAuthz('financial').
// requireRoles adds explicit ACCOUNTANT/MANAGER/ADMIN defense-in-depth on every op
// (DRIVER / FORWARDER never get financial write in policy.csv).
const router = Router();
const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;
const BILLING_DOCUMENT_ISSUE_REQUEST_ENDPOINT = 'billing-documents.issue.request';
const BILLING_DOCUMENT_SEND_CONFIRMATION_ENDPOINT = 'billing-documents.send-confirmation';

// POST /api/finance/billing-documents/generate — preview draft lines (pre-save)
router.post('/finance/billing-documents/generate', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const data = generateBillingDocumentSchema.parse(req.body);
  res.json(await billingService.generateDraft(data));
}));

// POST /api/finance/billing-documents — save a snapshot document
router.post('/finance/billing-documents', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const data = saveBillingDocumentSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_CREATE,
    idempotencyKey,
    payload: { actorId: actor.userId, ...data },
    createdBy: actor.userId,
    entityType: 'billing_document',
    create: (tx) => billingService.saveDocument(data, actor.userId, tx),
  });
  if (!replayed) {
    await invalidateReportCaches();
  }
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// GET /api/finance/billing-documents?entityType&entityId&type — list saved documents
router.get('/finance/billing-documents', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const entityType = String(req.query.entityType ?? '');
  const entityId = Number(req.query.entityId);
  if ((entityType !== 'CUSTOMER' && entityType !== 'VENDOR') || !Number.isFinite(entityId) || entityId <= 0) {
    return res.status(400).json({ error: 'Thiếu hoặc sai entityType / entityId' });
  }
  const rawType = req.query.type;
  const type = rawType === 'DEBIT_NOTE' || rawType === 'PAYMENT_STATEMENT' ? rawType : undefined;
  res.json(await billingService.listDocuments(entityType, entityId, type));
}));

// GET /api/finance/billing-documents/transport-register — bounded, read-only
// accounting projection over locked trips and ACTIVE financial postings.
router.get('/finance/billing-documents/transport-register', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const query = accountingTransportRegisterQuerySchema.parse(req.query);
  res.json(await listAccountingTransportRows(query));
}));

// GET /api/finance/billing-documents/:id — one document with lines
router.get('/finance/billing-documents/:id', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  res.json(await billingService.getDocument(Number(req.params.id)));
}));

// PUT /api/finance/billing-documents/:id — edit in place (always-editable)
router.put('/finance/billing-documents/:id', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const data = saveBillingDocumentSchema.parse(req.body);
  const actor = getUser(req);
  const documentId = Number(req.params.id);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_UPDATE,
    idempotencyKey,
    payload: { actorId: actor.userId, documentId, ...data },
    createdBy: actor.userId,
    entityType: 'billing_document',
    create: (tx) => billingService.updateDocument(documentId, data, tx),
    getEntityId: () => documentId,
  });
  if (!replayed) {
    await invalidateReportCaches();
  }
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/finance/billing-documents/:id/adjustments', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const input = billingDocumentAdjustmentRequestSchema.parse(req.body);
  const documentId = Number(req.params.id);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_ADJUSTMENT_REQUEST,
    idempotencyKey,
    payload: { actorId: actor.userId, actorRole: actor.role, documentId, ...input },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: () => requestBillingDocumentAdjustment({
      documentId,
      reason: input.reason,
      makerId: actor.userId,
      makerRole: actor.role,
    }),
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/finance/billing-documents/:id/issue', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const input = billingDocumentIssueRequestSchema.parse(req.body);
  const documentId = Number(req.params.id);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: BILLING_DOCUMENT_ISSUE_REQUEST_ENDPOINT,
    idempotencyKey,
    payload: { actorId: actor.userId, actorRole: actor.role, documentId, ...input },
    createdBy: actor.userId,
    entityType: 'governance_action',
    create: () => requestBillingDocumentIssue({
      documentId,
      expectedVersion: input.expectedVersion,
      reason: input.reason,
      makerId: actor.userId,
      makerRole: actor.role,
    }),
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

router.post('/finance/billing-documents/:id/send-for-confirmation', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const input = sendDebitNoteForConfirmationSchema.parse(req.body);
  const documentId = Number(req.params.id);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: BILLING_DOCUMENT_SEND_CONFIRMATION_ENDPOINT,
    idempotencyKey,
    payload: { actorId: actor.userId, documentId, ...input },
    createdBy: actor.userId,
    entityType: 'billing_document',
    create: async (tx) => {
      await sendDebitNoteForCustomerConfirmation({
        documentId,
        expectedVersion: input.expectedVersion,
        actorUserId: actor.userId,
        transaction: tx,
      });
      return billingService.getDocument(documentId, tx);
    },
    getEntityId: () => documentId,
  });
  res.json({ ...result, replayed });
}));

// DELETE /api/finance/billing-documents/:id — soft delete
router.delete('/finance/billing-documents/:id', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const actor = getUser(req);
  const documentId = Number(req.params.id);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.BILLING_DOCUMENT_DELETE,
    idempotencyKey,
    payload: { actorId: actor.userId, documentId },
    createdBy: actor.userId,
    entityType: 'billing_document',
    create: async (tx) => {
      await billingService.deleteDocument(documentId, tx);
      return { ok: true };
    },
    getEntityId: () => documentId,
  });
  if (!replayed) {
    await invalidateReportCaches();
  }
  res.json(idempotencyKey ? { ...result, replayed } : result);
}));

// GET /api/finance/billing-documents/:id/export?format=xlsx|pdf&templateId=
// Default (no `format`) and `format=xlsx` return the Excel buffer.
// `format=pdf` returns browser-printable HTML (mirror of the on-screen
// template preview) for the browser's print-to-PDF. For DEBIT_NOTE,
// renders from the resolved template snapshot. Issued documents always use
// their frozen snapshot; ?templateId= is a draft-preview option only.
// Falls back to the legacy renderer when no template applies.
router.get('/finance/billing-documents/:id/export', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const format = String(req.query.format ?? 'xlsx').toLowerCase();
  const id = Number(req.params.id);
  const overrideRaw = req.query.templateId;
  const templateIdOverride = overrideRaw ? Number(overrideRaw) : null;

  if (format === 'pdf' || format === 'html') {
    // Wave 3 M5.8 — browser-printable HTML that mirrors the screen.
    const { doc, snapshot } = await getDebitNoteForRender(id, { templateIdOverride });
    const dateStr = new Date().toLocaleDateString('vi-VN');
    // Build the legacy DebitNotePdfData shape from the hydrated doc, then
    // delegate to the template-aware renderer.
    const data = {
      documentId: doc.id,
      entityName: doc.entityName ?? 'Khách hàng chưa xác định',
      rangeFrom: doc.rangeFrom,
      rangeTo: doc.rangeTo,
      originalDueDate: doc.originalDueDate,
      processingDueDate: doc.processingDueDate,
      totalInclVat: String(doc.totalInclVat),
      totalNet: String(doc.totalNet ?? doc.totalInclVat),
      totalTax: String(doc.totalTax ?? 0),
      totalGross: String(doc.totalGross ?? doc.totalInclVat),
      vatTreatmentVersion: doc.vatTreatmentVersion ?? 'VAT-V1',
      status: null,
      lines: doc.lines
        .filter(l => !l.excluded)
        .map(l => ({
          lineType: l.lineType,
          typeLabel: l.typeLabel,
          description: l.description,
          baseAmount: String(l.amountOverride ?? l.baseAmount),
          netAmount: String(l.netAmount ?? l.baseAmount),
          taxAmount: String(l.taxAmount ?? 0),
          grossAmount: String(l.grossAmount ?? l.baseAmount),
          routeName: l.routeName ?? null,
        })),
    };
    const html = exportDebitNoteHtml(data, snapshot, dateStr);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  // Default: Excel (xlsx) — Wave-2 templated renderer.
  const doc = await billingService.getDocument(id);
  const snap = await billingService.resolveDebitNoteTemplateForDoc(doc, { templateIdOverride });
  const buffer = snap
    ? await billingService.renderTemplatedXlsx(doc, snap)
    : await billingService.buildLegacyXlsx(doc);
  const kind = doc.type === 'DEBIT_NOTE' ? 'giay-bao-no' : 'bang-ke';
  const name = doc.entityName ?? String(doc.entityId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', attachmentDisposition(`${kind}-${name}.xlsx`));
  res.send(buffer);
}));

export default router;
