import { Router } from 'express';
import { autoApplyGovernanceAction } from '../../services/adjustment-governance.service';
import type { Request } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';

import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { ApiError } from '../../errors';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runIdempotent } from '../../services/idempotency.service';
import {
  approveFuelInvoice,
  createFuelInvoice,
  getFuelInvoice,
  listFuelInvoices,
  requestFuelInvoiceCorrection,
  updateFuelInvoice,
} from '../../services/fuel-invoice.service';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD');

const allocationSchema = z.object({
  tripId: z.coerce.number().int().positive(),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  tripExpenseId: z.coerce.number().int().positive().optional().nullable(),
  voucherReference: z.string().trim().min(1, 'Số phiếu hoặc nhật ký đổ nhiên liệu là bắt buộc').max(120),
  voucherDate: dateSchema,
  liters: z.coerce.number().positive('Số lít phải lớn hơn 0'),
  note: z.string().trim().max(1000).optional().nullable(),
});

const fuelInvoiceSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  invoiceNumber: z.string().trim().min(1, 'Số hóa đơn là bắt buộc').max(80),
  invoiceDate: dateSchema,
  totalLiters: z.coerce.number().positive('Tổng số lít phải lớn hơn 0'),
  unitPrice: z.coerce.number().positive('Đơn giá phải lớn hơn 0'),
  note: z.string().trim().max(2000).optional().nullable(),
  allocations: z.array(allocationSchema).max(200).default([]),
});

const fuelInvoiceMutationSchema = fuelInvoiceSchema.extend({
  expectedVersion: z.coerce.number().int().positive('Phiên bản hóa đơn nhiên liệu không hợp lệ'),
});

const fuelInvoiceDecisionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive('Phiên bản hóa đơn nhiên liệu không hợp lệ'),
  reason: z.string().trim().min(1, 'Lý do đề nghị duyệt là bắt buộc').max(1000),
});

const fuelInvoiceCorrectionSchema = z.discriminatedUnion('correctionType', [
  z.object({
    correctionType: z.literal('ADJUSTMENT'),
    expectedVersion: z.coerce.number().int().positive('Phiên bản hóa đơn nhiên liệu không hợp lệ'),
    reason: z.string().trim().min(1, 'Lý do điều chỉnh là bắt buộc').max(1000),
    correctedInvoice: fuelInvoiceSchema,
  }),
  z.object({
    correctionType: z.literal('REVERSAL'),
    expectedVersion: z.coerce.number().int().positive('Phiên bản hóa đơn nhiên liệu không hợp lệ'),
    reason: z.string().trim().min(1, 'Lý do hoàn tác là bắt buộc').max(1000),
  }),
]);

const listSchema = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'REVERSED']).optional(),
  paginated: z.literal('true').optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
});

function parseId(raw: string | string[]): number {
  const id = Array.isArray(raw) ? Number.NaN : Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new z.ZodError([{
      code: z.ZodIssueCode.custom,
      message: 'ID hóa đơn nhiên liệu không hợp lệ',
      path: ['id'],
    }]);
  }
  return id;
}

const FUEL_INVOICE_CREATE_ENDPOINT = 'fuel-invoices.create';
const FUEL_INVOICE_UPDATE_ENDPOINT = 'fuel-invoices.update';
const FUEL_INVOICE_APPROVE_ENDPOINT = 'fuel-invoices.approve';
const FUEL_INVOICE_CORRECTION_ENDPOINT = 'fuel-invoices.correction.create';

function requireIdempotencyKey(req: Request): string {
  const idempotencyKey = getRequestIdempotencyKey(req);
  if (!idempotencyKey) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác hóa đơn nhiên liệu.');
  }
  return idempotencyKey;
}

const router = Router();

router.get(
  '/finance/fuel-invoices',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const { paginated, limit, cursor, ...filters } = listSchema.parse(req.query);
    if (paginated === 'true') {
      res.json(await listFuelInvoices({ ...filters, limit, cursor }));
      return;
    }

    const items: Awaited<ReturnType<typeof listFuelInvoices>>['items'] = [];
    let nextCursor: string | undefined;
    do {
      const page = await listFuelInvoices({
        ...filters,
        limit: 100,
        cursor: nextCursor,
      });
      items.push(...page.items);
      nextCursor = page.nextCursor ?? undefined;
    } while (nextCursor);
    res.json(items);
  }),
);

router.get(
  '/finance/fuel-invoices/:id',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    res.json(await getFuelInvoice(parseId(req.params.id)));
  }),
);

router.post(
  '/finance/fuel-invoices',
  requireRoles(Role.ADMIN, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const payload = fuelInvoiceSchema.parse(req.body);
    const { result, replayed, statusCode } = await runIdempotent({
      endpoint: FUEL_INVOICE_CREATE_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: { actorId: actor.userId, ...payload },
      createdBy: actor.userId,
      entityType: 'fuel_invoice',
      responseStatusCode: 201,
      create: (tx) => createFuelInvoice(payload, actor.userId, tx),
    });
    const created = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = created.id;
    res.locals.auditEntityKey = `fuel-invoice-${created.id}`;
    res.status(statusCode).json(created);
  }),
);

router.put(
  '/finance/fuel-invoices/:id',
  requireRoles(Role.ADMIN, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const invoiceId = parseId(req.params.id);
    const payload = fuelInvoiceMutationSchema.parse(req.body);
    const { expectedVersion, ...body } = payload;
    const { result, replayed } = await runIdempotent({
      endpoint: FUEL_INVOICE_UPDATE_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: { actorId: actor.userId, expectedVersion, id: invoiceId, ...body },
      createdBy: actor.userId,
      entityType: 'fuel_invoice',
      create: (tx) => updateFuelInvoice(invoiceId, body, expectedVersion, tx),
      getEntityId: () => invoiceId,
    });
    const updated = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = updated.id;
    res.locals.auditEntityKey = `fuel-invoice-${updated.id}`;
    res.json(updated);
  }),
);

router.post(
  '/finance/fuel-invoices/:id/corrections',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const invoiceId = parseId(req.params.id);
    const payload = fuelInvoiceCorrectionSchema.parse(req.body);
    const { result, replayed, statusCode } = await runIdempotent({
      endpoint: FUEL_INVOICE_CORRECTION_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: {
        actorId: actor.userId,
        actorRole: actor.role,
        invoiceId,
        ...payload,
      },
      createdBy: actor.userId,
      entityType: 'governance_action',
      responseStatusCode: 201,
      create: (tx) => autoApplyGovernanceAction({
        make: (tx) => requestFuelInvoiceCorrection({
          invoiceId,
          expectedVersion: payload.expectedVersion,
          reason: payload.reason,
          correctionType: payload.correctionType,
          correctedInvoice: payload.correctionType === 'ADJUSTMENT'
            ? payload.correctedInvoice
            : undefined,
          makerId: actor.userId,
          makerRole: actor.role,
          transaction: tx,
        }),
        actorId: actor.userId,
        actorRole: actor.role,
        transaction: tx,
      }),
    });
    const action = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = action.id;
    res.locals.auditEntityKey = `fuel-invoice-correction-${action.id}`;
    res.status(statusCode).json(action);
  }),
);

router.post(
  '/finance/fuel-invoices/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const invoiceId = parseId(req.params.id);
    const payload = fuelInvoiceDecisionSchema.parse(req.body);
    const { result, replayed } = await runIdempotent({
      endpoint: FUEL_INVOICE_APPROVE_ENDPOINT,
      idempotencyKey: requireIdempotencyKey(req),
      payload: {
        actorId: actor.userId,
        actorRole: actor.role,
        expectedVersion: payload.expectedVersion,
        reason: payload.reason,
        id: invoiceId,
      },
      createdBy: actor.userId,
      entityType: 'fuel_invoice',
      create: (tx) => approveFuelInvoice(
        invoiceId,
        actor.userId,
        actor.role,
        payload.expectedVersion,
        payload.reason,
        tx,
      ),
      getEntityId: () => invoiceId,
    });
    const approved = replayed ? { ...result, replayed } : result;
    res.locals.auditEntityId = approved.id;
    res.locals.auditEntityKey = `fuel-invoice-${approved.id}`;
    res.status(replayed ? 200 : 201).json(approved);
  }),
);

export default router;
