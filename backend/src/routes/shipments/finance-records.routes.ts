import { Router } from 'express';
import { z } from 'zod';
import { Role, containerDepositSchema, shipmentInvoiceRecordSchema } from '@tingting/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { ApiError } from '../../errors';
import { throwValidation } from '../../lib/validation';
import { listShipmentFinanceRecords, saveContainerDepositRecord, saveShipmentInvoiceRecord, shipmentFinanceOptions } from '../../services/shipment-finance-records.service';
import { requireShipmentIdempotencyKey, runShipmentWrite, sendShipmentWrite } from './shipment-shared';

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  depositState: z.enum(['OPEN', 'REFUNDED']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'Ngày bắt đầu phải trước ngày kết thúc.');

function shipmentId(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ApiError(400, 'ID lô hàng không hợp lệ.');
  }
  return Number(value);
}

export const financeRecordsRoutes = Router();
financeRecordsRoutes.get('/finance-record-options', asyncHandler(async (req, res) => {
  res.json(await shipmentFinanceOptions(getUser(req), req.query.shipmentId ? shipmentId(req.query.shipmentId) : undefined));
}));
financeRecordsRoutes.get(['/finance-records', '/:id/finance-records'], asyncHandler(async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) throwValidation(query.error);
  res.json(await listShipmentFinanceRecords(getUser(req), {
    ...query.data, shipmentId: req.params.id ? shipmentId(req.params.id) : undefined,
  }));
}));
financeRecordsRoutes.post('/:id/invoice-records', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req, res) => {
  const id = shipmentId(req.params.id);
  const parsed = shipmentInvoiceRecordSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để tránh ghi hóa đơn trùng.');
  const { result } = await runShipmentWrite(req, 'shipments.invoice-records.save', { shipmentId: id, ...parsed.data }, async (tx) => ({
    body: await saveShipmentInvoiceRecord(tx, id, parsed.data, getUser(req)),
    status: parsed.data.id ? 200 : 201, auditEntityId: id,
  }));
  sendShipmentWrite(res, result);
}));
financeRecordsRoutes.post('/:id/container-deposits', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req, res) => {
  const id = shipmentId(req.params.id);
  const parsed = containerDepositSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để tránh ghi cược trùng.');
  const { result } = await runShipmentWrite(req, 'shipments.container-deposits.save', { shipmentId: id, ...parsed.data }, async (tx) => ({
    body: await saveContainerDepositRecord(tx, id, parsed.data, getUser(req)),
    status: parsed.data.id ? 200 : 201, auditEntityId: id,
  }));
  sendShipmentWrite(res, result);
}));
