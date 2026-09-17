import { correctAccountingExpense } from '../services/expense-accounting-correction.service';
import multer from 'multer';
import { attachAccountingExpensePhoto } from '../services/expense-accounting-photo.service';
import { ApiError } from '../errors';
import { Router } from 'express';
import { z } from 'zod';
import { expenseAccountingCreateSchema, expenseAccountingUpdateSchema, expenseConfirmSchema, expenseDateSchema, expenseListQuerySchema, EXPENSE_SOURCE_KINDS } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { throwValidation } from '../lib/validation';
import { assignTruckAccountant, confirmAccountingExpenses, updateAccountingExpense } from '../services/expense-accounting-write.service';
import { createAccountingExpense } from '../services/expense-accounting-create.service';
import { getExpenseAccountingCatalog, getExpenseAccountingEntry, getExpenseAccountingReport, listExpenseAccountingEntries, listTruckAccountantAssignments } from '../services/expense-accounting-reads.service';
import { listExpenseAccountingWork } from '../services/expense-accounting-work.service';
import { exportExpenseAccountingReport } from '../services/expense-accounting-export.service';
import { requireShipmentIdempotencyKey, runShipmentWrite, sendShipmentWrite } from './shipments/shipment-shared';

import expenseAccountingCashRoutes from './expense-accounting-cash';

const router = Router();
router.use(expenseAccountingCashRoutes);
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throwValidation(result.error);
  return result.data;
}
const sourceSchema = z.enum(EXPENSE_SOURCE_KINDS);
const idSchema = z.coerce.number().int().positive();
const reportSchema = expenseListQuerySchema.extend({ direction: z.enum(['IN', 'OUT']), asOfDate: expenseDateSchema.optional() });
router.post('/entries/:kind/:id/photos/upload', multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Chọn ảnh chứng từ.');
  res.status(201).json(await attachAccountingExpensePhoto(getUser(req), parse(sourceSchema, req.params.kind), parse(idSchema, req.params.id), req.file));
}));
router.get('/entries', asyncHandler(async (req, res) => res.json(await listExpenseAccountingEntries(getUser(req), parse(expenseListQuerySchema, req.query)))));
router.get('/work', asyncHandler(async (req, res) => res.json(await listExpenseAccountingWork(getUser(req), parse(expenseListQuerySchema, req.query)))));
router.get('/catalog', asyncHandler(async (req, res) => res.json(await getExpenseAccountingCatalog(getUser(req)))));
router.get('/entries/:kind/:id', asyncHandler(async (req, res) => res.json(await getExpenseAccountingEntry(getUser(req), parse(sourceSchema, req.params.kind), parse(idSchema, req.params.id)))));
router.post('/entries', asyncHandler(async (req, res) => {
  const input = parse(expenseAccountingCreateSchema, req.body);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để tránh ghi trùng khoản chi.');
  const result = await runShipmentWrite(req, 'expense-accounting.create', input, async tx => {
    const row = await createAccountingExpense(tx, getUser(req), input);
    return { body: await getExpenseAccountingEntry(getUser(req), row.sourceKind, row.sourceId, tx), status: 201, auditEntityId: row.id };
  });
  sendShipmentWrite(res, result.result);
}));
router.post('/entries/:kind/:id/update', asyncHandler(async (req, res) => {
  const kind = parse(sourceSchema, req.params.kind); const id = parse(idSchema, req.params.id);
  const input = parse(expenseAccountingUpdateSchema, req.body);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để thử lại an toàn.');
  const result = await runShipmentWrite(req, 'expense-accounting.update', { kind, id, ...input }, async tx => {
    const row = await updateAccountingExpense(tx, getUser(req), kind, id, input);
    return { body: await getExpenseAccountingEntry(getUser(req), row.sourceKind, row.sourceId, tx), status: 200, auditEntityId: row.id };
  });
  sendShipmentWrite(res, result.result);
}));
router.post('/entries/:kind/:id/correct', asyncHandler(async (req, res) => {
  const kind = parse(sourceSchema, req.params.kind); const id = parse(idSchema, req.params.id);
  const input = parse(expenseAccountingUpdateSchema, req.body);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để không điều chỉnh trùng.');
  const result = await runShipmentWrite(req, 'expense-accounting.correct', { kind, id, ...input }, async tx => {
    const row = await correctAccountingExpense(tx, getUser(req), kind, id, input);
    return { body: await getExpenseAccountingEntry(getUser(req), row.sourceKind, row.sourceId, tx), status: 200, auditEntityId: row.id };
  });
  sendShipmentWrite(res, result.result);
}));
router.post('/confirm', asyncHandler(async (req, res) => {
  const input = parse(expenseConfirmSchema, req.body);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để đối chiếu không bị trùng.');
  const result = await runShipmentWrite(req, 'expense-accounting.confirm', input, async tx => {
    const rows = await confirmAccountingExpenses(tx, getUser(req), input.entries);
    return { body: { items: await Promise.all(rows.map(row => getExpenseAccountingEntry(getUser(req), row.sourceKind, row.sourceId, tx))) }, status: 200, auditEntityId: rows[0].id };
  });
  sendShipmentWrite(res, result.result);
}));
router.get('/assignments', asyncHandler(async (req, res) => res.json({ items: await listTruckAccountantAssignments(getUser(req)) })));
router.post('/assignments', asyncHandler(async (req, res) => {
  const input = parse(z.object({ truckId: idSchema, accountantId: idSchema.nullable(), expectedVersion: z.number().int().nonnegative() }).strict(), req.body);
  requireShipmentIdempotencyKey(req, 'Cần mã thao tác để cập nhật phân công.');
  const result = await runShipmentWrite(req, 'expense-accounting.assign', input, async tx => ({ body: await assignTruckAccountant(tx, getUser(req), input.truckId, input.accountantId, input.expectedVersion), status: 200, auditEntityId: input.truckId }));
  sendShipmentWrite(res, result.result);
}));
router.get('/reports', asyncHandler(async (req, res) => res.json(await getExpenseAccountingReport(getUser(req), parse(reportSchema, req.query)))));
router.get('/reports/export', asyncHandler(async (req, res) => {
  const buffer = await exportExpenseAccountingReport(getUser(req), parse(reportSchema, req.query));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="chi-phi.xlsx"'); res.send(buffer);
}));
export default router;
