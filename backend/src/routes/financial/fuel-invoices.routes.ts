import { Router } from 'express';
import { z } from 'zod';
import { Role } from '@tingting/shared';

import { getUser } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import {
  approveFuelInvoice,
  createFuelInvoice,
  getFuelInvoice,
  listFuelInvoices,
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

const listSchema = z.object({
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
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

const router = Router();

router.get(
  '/finance/fuel-invoices',
  requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    res.json(await listFuelInvoices(listSchema.parse(req.query)));
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
    const created = await createFuelInvoice(
      fuelInvoiceSchema.parse(req.body),
      getUser(req).userId,
    );
    res.locals.auditEntityId = created.id;
    res.locals.auditEntityKey = `fuel-invoice-${created.id}`;
    res.status(201).json(created);
  }),
);

router.put(
  '/finance/fuel-invoices/:id',
  requireRoles(Role.ADMIN, Role.ACCOUNTANT),
  asyncHandler(async (req, res) => {
    const updated = await updateFuelInvoice(
      parseId(req.params.id),
      fuelInvoiceSchema.parse(req.body),
    );
    res.locals.auditEntityId = updated.id;
    res.locals.auditEntityKey = `fuel-invoice-${updated.id}`;
    res.json(updated);
  }),
);

router.post(
  '/finance/fuel-invoices/:id/approve',
  requireRoles(Role.ADMIN, Role.MANAGER),
  asyncHandler(async (req, res) => {
    const actor = getUser(req);
    const approved = await approveFuelInvoice(
      parseId(req.params.id),
      actor.userId,
      actor.role,
    );
    res.locals.auditEntityId = approved.id;
    res.locals.auditEntityKey = `fuel-invoice-${approved.id}`;
    res.json(approved);
  }),
);

export default router;
