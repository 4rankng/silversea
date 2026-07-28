import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import {
  getForwarderTrips,
  getForwarderTripCounts,
  getForwarderTripDetail,
  createTripContainer,
  createTripExpense,
  deleteTripExpense,
  listUnlinkedTripExpenses,
  addExpensePhoto,
  getExpensePhotos,
  getForwarderOwnedExpenseId,
  deleteExpensePhoto,
  listActiveSuppliersForForwarder,
  getTripExpenseAuditInfo,
  updateForwarderTripExpense,
  setTripExpenseCompletion,
} from '../services/forwarder.service';
import { exportSettlementXlsx, exportSettlementHtml, previewSettlementHtml, previewSettlementXlsx } from '../services/settlement-export.service';
import { formatLocalDate } from '../lib/format';
import { asyncHandler } from '../middleware/asyncHandler';
import { resolveForwarder } from '../middleware/forwarder';
import { throwValidation } from '../lib/validation';
import { db } from '../db';
import * as s from '../db/schema';
import { tripContainerSchema, tripExpenseSchema, tripExpensePatchSchema, tripExpenseCompletionSchema } from '@tingting/shared';
import { createAdvanceRequest, listAdvanceRequests, getAdvanceRequestCounts, createAdvanceSettlement, listAdvanceSettlements, getAdvanceSettlement, getOutstandingAdvanceBalance } from '../services/advance.service';
import { createAdvanceRequestSchema, createAdvanceSettlementSchema } from '@tingting/shared';
import { storageService } from '../services/storage.service';
import sharp from 'sharp';
import { sniffImageType } from '../lib/format';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { runIdempotent } from '../services/idempotency.service';

const expensePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// Unify with upload.ts / expense.ts (2048). Was 1600 — inconsistent downscale ceiling.
const MAX_IMAGE_DIMENSION = 2048;

const router = Router();

export const forwarderTripContainerSchema = tripContainerSchema.refine(
  (container) => Boolean(container.containerNumber?.trim()),
  {
    path: ['containerNumber'],
    message: 'Số container không được để trống',
  },
);

// Resolve forwarder profile once for all routes — handlers access req.forwarder
router.use(resolveForwarder);

router.get('/trips', asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  // N4: optional filters — search (container number OR customer name),
  // dateFrom/dateTo (filter on trip.departure_date). Mirrors the param-reading
  // pattern in routes/trips.ts summary handler (accepts camelCase and snake_case).
  const search = (req.query.search as string | undefined) || undefined;
  const dateFrom = (req.query.dateFrom || req.query.date_from) as string | undefined;
  const dateTo = (req.query.dateTo || req.query.date_to) as string | undefined;
  const [items, counts] = await Promise.all([
    getForwarderTrips(status, { search, dateFrom, dateTo }),
    getForwarderTripCounts(),
  ]);
  res.json({ items, counts });
}));

router.get('/trips/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const trip = await getForwarderTripDetail(parseInt(req.params.id as string, 10), forwarder.id);
  if (!trip) return res.status(404).json({ error: 'Không tìm thấy chuyến đi' });
  res.json(trip);
}));

router.post('/trips/:tripId/containers', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = forwarderTripContainerSchema.safeParse({ ...req.body, tripId });
  if (!parsed.success) throwValidation(parsed.error);
  const container = await createTripContainer({
    ...parsed.data,
    containerTypeId: parsed.data.containerTypeId ?? null,
    sealNumber: parsed.data.sealNumber ?? null,
    notes: parsed.data.notes ?? null,
    createdBy: forwarder.id,
  });
  res.status(201).json(container);
}));

router.get('/suppliers', asyncHandler(async (_req: Request, res: Response) => {
  const items = await listActiveSuppliersForForwarder();
  res.json({ items });
}));

router.post('/expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = tripExpenseSchema.safeParse({ ...req.body, forwarderId: forwarder.id });
  if (!parsed.success) throwValidation(parsed.error);
  const expense = await db.transaction((tx) => createTripExpense(tx, {
    tripId: parsed.data.tripId,
    forwarderId: forwarder.id,  // forwarder-created → PENDING
    createdBy: forwarder.id,
    expenseType: parsed.data.expenseType,
    buyAmount: String(parsed.data.buyAmount),
    sellAmount: String(parsed.data.sellAmount ?? 0),
    settlementMethod: parsed.data.settlementMethod,
    supplierId: parsed.data.supplierId ?? null,
    expenseDate: parsed.data.expenseDate ?? null,
    payeeName: parsed.data.payeeName?.trim() || null,
    invoiceNumber: parsed.data.invoiceNumber ?? null,
    invoiceDate: parsed.data.invoiceDate ?? null,
    declarationNumber: parsed.data.declarationNumber ?? null,
    containerNumber: parsed.data.containerNumber ?? null,
    tripContainerId: parsed.data.tripContainerId ?? null,
    note: parsed.data.note ?? null,
    noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [],
  }));
  res.status(201).json(expense);
}));

router.patch('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  const parsed = tripExpensePatchSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const item = await updateForwarderTripExpense(expenseId, forwarder.id, {
    expenseType: parsed.data.expenseType,
    buyAmount: parsed.data.buyAmount !== undefined ? String(parsed.data.buyAmount) : undefined,
    sellAmount: parsed.data.sellAmount !== undefined ? String(parsed.data.sellAmount) : undefined,
    settlementMethod: parsed.data.settlementMethod,
    ...(parsed.data.supplierId !== undefined ? { supplierId: parsed.data.supplierId ?? null } : {}),
    ...(parsed.data.expenseDate !== undefined ? { expenseDate: parsed.data.expenseDate ?? null } : {}),
    ...(parsed.data.payeeName !== undefined ? { payeeName: parsed.data.payeeName?.trim() || null } : {}),
    ...(parsed.data.invoiceNumber !== undefined ? { invoiceNumber: parsed.data.invoiceNumber ?? null } : {}),
    ...(parsed.data.invoiceDate !== undefined ? { invoiceDate: parsed.data.invoiceDate ?? null } : {}),
    ...(parsed.data.declarationNumber !== undefined ? { declarationNumber: parsed.data.declarationNumber ?? null } : {}),
    ...(parsed.data.containerNumber !== undefined ? { containerNumber: parsed.data.containerNumber ?? null } : {}),
    ...(parsed.data.tripContainerId !== undefined ? { tripContainerId: parsed.data.tripContainerId ?? null } : {}),
    ...(parsed.data.note !== undefined ? { note: parsed.data.note ?? null } : {}),
    ...(parsed.data.noInvoiceEvidenceTypes !== undefined ? { noInvoiceEvidenceTypes: parsed.data.noInvoiceEvidenceTypes ?? [] } : {}),
  });
  res.json(item);
}));

router.put('/trips/:tripId/expense-completion', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const tripId = parseInt(req.params.tripId as string, 10);
  const parsed = tripExpenseCompletionSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const scope = await setTripExpenseCompletion(
    tripId,
    parsed.data.tripContainerId,
    parsed.data.completed,
    forwarder.id,
  );
  res.json(scope);
}));

router.delete('/expenses/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);

  // Fetch expense info for audit log before delete (shared with trips route)
  const expense = await getTripExpenseAuditInfo(expenseId);

  const result = await deleteTripExpense(expenseId, forwarder.id);
  if (result === null) return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  if (result === 'FORBIDDEN') return res.status(403).json({ error: 'Không có quyền xóa chi phí này' });

  if (expense) {
    const buyAmt = Number(expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
    const tripPart = expense.tripCode ? ` cho chuyến ${expense.tripCode}` : '';
    const supplierPart = expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : '';
    res.locals.auditEntityKey = `phí ${expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
  }

  res.json({ success: true });
}));

// ── Unlinked Trip Expenses (for settlement form) ──

router.get('/unlinked-expenses', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const items = await listUnlinkedTripExpenses(forwarder.id);
  res.json({ items });
}));

// ── Advance Requests ──

router.get('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = req.query.status as string | undefined;
  const excludeLinkedToActiveSettlement = req.query.eligibleForSettlement === 'true';
  const [items, counts] = await Promise.all([
    listAdvanceRequests({ requesterId: forwarder.id, status, excludeLinkedToActiveSettlement }),
    getAdvanceRequestCounts(forwarder.id),
  ]);
  res.json({ items, counts });
}));

router.post('/advance-requests', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceRequestSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'forwarder.advance-requests.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...parsed.data },
    createdBy: forwarder.id,
    entityType: 'advance_request',
    create: (tx) => createAdvanceRequest(forwarder.id, parsed.data, tx),
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// ── Advance Balance (F1) ──

router.get('/advance-balance', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const outstanding = await getOutstandingAdvanceBalance(forwarder.id);
  res.json({ outstanding: String(outstanding) });
}));

// ── Advance Settlements ──

router.get('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const items = await listAdvanceSettlements({ forwarderId: forwarder.id });
  res.json({ items });
}));

router.get('/advance-settlements/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const settlement = await getAdvanceSettlement(Number(req.params.id));
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });
  res.json(settlement);
}));

router.get('/advance-settlements/:id/export', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const id = Number(req.params.id);
  const settlement = await getAdvanceSettlement(id);
  if (!settlement) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
  if (settlement.forwarderId !== forwarder.id) return res.status(403).json({ error: 'Không có quyền truy cập' });

  const format = (req.query.format as string) || 'xlsx';
  if (format === 'pdf' || format === 'html') {
    const html = await exportSettlementHtml(id);
    if (!html) return res.status(404).json({ error: 'Không tìm thấy phiếu thanh toán' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }

  const dateStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-${id}-${dateStr}.xlsx`);
  await exportSettlementXlsx(id, res);
}));

router.post('/advance-settlements/preview', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { advanceRequestIds, tripExpenseIds, refundAmount, note } = parsed.data;

  const format = (req.query.format as string) || 'html';
  const input = { forwarderId: forwarder.id, advanceRequestIds, tripExpenseIds, refundAmount, note: note ?? undefined };

  if (format === 'xlsx') {
    const dateStr = formatLocalDate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=phieu-thanh-toan-xem-truoc-${dateStr}.xlsx`);
    await previewSettlementXlsx(input, res);
    return;
  }

  const html = await previewSettlementHtml(input);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));

router.post('/advance-settlements', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const parsed = createAdvanceSettlementSchema.safeParse(req.body);
  if (!parsed.success) throwValidation(parsed.error);
  const { note, ...rest } = parsed.data;
  const input = { ...rest, note: note ?? undefined };
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: 'forwarder.advance-settlements.create',
    idempotencyKey,
    payload: { forwarderId: forwarder.id, ...input },
    createdBy: forwarder.id,
    entityType: 'advance_settlement',
    create: (tx) => createAdvanceSettlement(forwarder.id, input, tx),
  });
  res.status(replayed ? 200 : 201).json(idempotencyKey ? { ...result, replayed } : result);
}));

// ── Expense Photos ──

router.get('/expenses/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const expenseId = parseInt(req.params.id as string, 10);
  // N1: gate on expense ownership before listing — unowned → 404 (not 403),
  // so a forwarder cannot enumerate another forwarder's photo metadata.
  if (!(await getForwarderOwnedExpenseId(expenseId, forwarder.id))) {
    return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  }
  const photos = await getExpensePhotos(expenseId);
  res.json({ items: photos });
}));

router.post('/expenses/:id/photos', expensePhotoUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Không có file tải lên' });

  const expenseId = parseInt(req.params.id as string, 10);

  // N1: ownership precheck BEFORE any processing — unowned → 404 (not 403),
  // so a forwarder cannot attach photos to another forwarder's trip_expense.
  if (!(await getForwarderOwnedExpenseId(expenseId, forwarder.id))) {
    return res.status(404).json({ error: 'Không tìm thấy chi phí' });
  }

  // Validate image type
  const mime = sniffImageType(file.buffer);
  if (!mime) return res.status(400).json({ error: 'Định dạng file không được hỗ trợ' });

  // Process: strip EXIF, downscale. Wrapped in try/catch (parity with
  // expense.ts) so a corrupt/unsupported codec yields a clean 400, not a 500.
  let processedBuffer: Buffer;
  let ext: string;
  try {
    if (mime === 'image/png') {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await sharp(file.buffer).rotate().resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    }
  } catch (err) {
    console.warn('[forwarder] expense-photo processing failed:', err instanceof Error ? err.message : err);
    return res.status(400).json({ error: 'Xử lý ảnh thất bại' });
  }

  const storageKey = `expense-photos/${expenseId}/${Date.now()}${ext}`;
  await storageService.upload(processedBuffer, storageKey);
  const photo = await addExpensePhoto(expenseId, storageKey, forwarder.id);
  res.status(201).json(photo);
}));

router.delete('/expense-photos/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const photoId = parseInt(req.params.id as string, 10);
  const result = await deleteExpensePhoto(photoId, forwarder.id);
  // Unowned and not-found both surface as 404 (N1) — no FORBIDDEN/403 oracle.
  if (!result) return res.status(404).json({ error: 'Không tìm thấy ảnh' });
  // Try to remove from storage (best-effort)
  try { await storageService.delete(result.storageKey); } catch {}
  res.json({ success: true });
}));

// ── Expense type labels (for forwarder catalog) ──

router.get('/expense-types', asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select({
    code: s.forwarderExpenseTypes.code,
    name: s.forwarderExpenseTypes.name,
  }).from(s.forwarderExpenseTypes)
    .orderBy(s.forwarderExpenseTypes.name);
  res.json(rows);
}));

export default router;
