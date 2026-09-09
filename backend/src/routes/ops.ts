/**
 * Ops field-operations portal (docs/prd/OpsVanHanh.md), mounted at /api/ops
 * behind authMiddleware. Role gates per PRD §2: portal routes are OPS-only,
 * expense/settlement approvals are ADMIN/MANAGER/ACCOUNTANT, truck ops
 * assignment is ADMIN-only.
 */
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Role, createAdvanceRequestSchema } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireRoles } from '../middleware/casbin';
import { getUser } from '../middleware/auth';
import { ApiError } from '../errors';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { formatLocalDate, sniffImageType } from '../lib/format';
import { storageService } from '../services/storage.service';
import { createAdvanceRequest } from '../services/advance-request.service';
import { listOpsOrders, setShipmentPin } from '../services/ops-orders.service';
import { getOpsWalletSummary } from '../services/ops-wallet.service';
import {
  attachOpsExpensePhoto,
  createOpsExpense,
  decideOpsExpense,
  deleteOpsExpense,
  deleteOpsExpensePhoto,
  listActiveOpsExpenseTypes,
  listOpsExpensePhotos,
  listOpsExpenses,
  resendOpsExpense,
  updateOpsExpense,
} from '../services/ops-expenses.service';
import {
  createOpsSettlement,
  decideOpsSettlement,
  getOpsSettlementDetail,
  listOpsSettlements,
} from '../services/ops-settlements.service';
import { exportOpsSettlementXlsx } from '../services/ops-settlement-export.service';
import { getOpsFleet, listActiveTruckOpsAssignments, setTruckOpsAssignment } from '../services/ops-fleet.service';

const OPS_ONLY = requireRoles(Role.OPS);
const OPS_APPROVERS = requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT);
const ADMIN_ONLY = requireRoles(Role.ADMIN);

const router = Router();

const dateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date phải có dạng YYYY-MM-DD');
const statusFilterSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional();

function parseId(value: string | string[] | undefined, label = 'ID'): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `${label} không hợp lệ.`);
  return id;
}

function requireOpsIdempotencyKey(req: Request): string {
  const key = getRequestIdempotencyKey(req);
  if (!key) {
    throw new ApiError(400, 'Idempotency-Key là bắt buộc cho thao tác ghi này.');
  }
  return key;
}

// ── Màn hình 1: Kế hoạch làm hàng (/ops/orders) ─────────────────────────────

router.get('/orders', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const date = dateQuerySchema.parse(req.query.date ?? formatLocalDate());
  const search = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json({ date, items: await listOpsOrders(user.userId, date, search) });
}));

// Pins use PUT set-semantics (not POST-toggle) so a replayed request converges
// on the requested state instead of flipping it again.
router.put('/orders/shipment-pins/:shipmentId', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const shipmentId = parseId(req.params.shipmentId, 'Mã lô');
  const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
  res.json(await setShipmentPin(user.userId, shipmentId, pinned));
}));

// ── Màn hình 3: Ví (/ops/wallet) ────────────────────────────────────────────

router.get('/wallet/summary', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getOpsWalletSummary(getUser(req).userId));
}));

router.get('/wallet/expenses', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const status = statusFilterSchema.parse(req.query.status);
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 200);
  const offset = Math.max(Number.parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
  res.json({
    items: await listOpsExpenses({ paidById: user.userId, status, limit, offset }),
  });
}));

router.post('/wallet/advance-requests', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = createAdvanceRequestSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_ADVANCE_REQUEST_CREATE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { ...parsed, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createAdvanceRequest(user.userId, parsed, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

// ── Khoản chi của Ops ───────────────────────────────────────────────────────

// Active expense-type catalog for the declaration form (no config:read grant
// needed for OPS).
router.get('/expense-types', OPS_ONLY, asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await listActiveOpsExpenseTypes() });
}));

const expenseCreateSchema = z.object({
  shipmentId: z.number().int().positive(),
  shipmentContainerId: z.number().int().positive().nullable().optional(),
  expenseTypeCode: z.string().min(1).max(50),
  amount: z.union([z.number(), z.string()]),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).nullable().optional(),
  photoStorageKeys: z.array(z.string().min(1).max(500)).max(20).optional(),
});

const expensePatchSchema = z.object({
  shipmentContainerId: z.number().int().positive().nullable().optional(),
  expenseTypeCode: z.string().min(1).max(50).optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).nullable().optional(),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

router.post('/expenses', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = expenseCreateSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_CREATE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { ...parsed, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createOpsExpense(user.userId, parsed, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.patch('/expenses/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const expenseId = parseId(req.params.id);
  const parsed = expensePatchSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_UPDATE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, patch: parsed, userId: user.userId },
    createdBy: user.userId,
    create: (tx) => updateOpsExpense(user.userId, expenseId, parsed, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.delete('/expenses/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const expenseId = parseId(req.params.id);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_DELETE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, userId: user.userId },
    createdBy: user.userId,
    create: async (tx) => {
      await deleteOpsExpense(user.userId, expenseId, tx);
      return { success: true };
    },
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.post('/expenses/:id/resend', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const expenseId = parseId(req.params.id);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_RESEND,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, userId: user.userId },
    createdBy: user.userId,
    create: (tx) => resendOpsExpense(user.userId, expenseId, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

const expensePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Receipt upload decoupled from the expense row (the entry may not exist yet —
 * "lưu trước, bổ sung ảnh sau"). Storage key = content hash, so a retried
 * upload of the same photo converges on one object without idempotency state.
 */
router.post('/expense-photos/upload', OPS_ONLY, expensePhotoUpload.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const file = req.file;
  if (!file) throw new ApiError(400, 'Không có file tải lên.');
  const mime = sniffImageType(file.buffer);
  if (!mime) throw new ApiError(400, 'Định dạng file không được hỗ trợ.');

  let processedBuffer: Buffer;
  let ext: string;
  try {
    if (mime === 'image/png') {
      processedBuffer = await sharp(file.buffer).rotate()
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      ext = '.png';
    } else {
      processedBuffer = await sharp(file.buffer).rotate()
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      ext = '.jpg';
    }
  } catch (err) {
    console.warn('[ops] expense-photo processing failed:', err instanceof Error ? err.message : err);
    throw new ApiError(400, 'Xử lý ảnh thất bại.');
  }

  const hash = createHash('sha256').update(processedBuffer).digest('hex').slice(0, 32);
  const storageKey = `ops-expense-photos/${user.userId}/${hash}${ext}`;
  await storageService.upload(processedBuffer, storageKey);
  res.status(201).json({ storageKey, url: `/api/photos/${encodeURIComponent(storageKey)}` });
}));

router.post('/expenses/:id/photos', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const { storageKey } = z.object({ storageKey: z.string().min(1).max(500) }).parse(req.body);
  const photo = await attachOpsExpensePhoto(user.userId, parseId(req.params.id), storageKey);
  res.status(201).json(photo);
}));

router.delete('/expense-photos/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  await deleteOpsExpensePhoto(getUser(req).userId, parseId(req.params.id));
  res.json({ success: true });
}));

// Receipt review: the author or an approver (ADMIN/MANAGER/ACCOUNTANT) may
// list an expense's photos — accounting must see the evidence before deciding.
router.get('/expenses/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const isApprover = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(user.role as Role);
  if (!isApprover && user.role !== Role.OPS) throw new ApiError(403, 'Không có quyền truy cập.');
  res.json({ items: await listOpsExpensePhotos(user.userId, isApprover, parseId(req.params.id)) });
}));

// ── Đề nghị thanh toán ──────────────────────────────────────────────────────

router.get('/settlements', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status);
  res.json({ items: await listOpsSettlements({ opsUserId: user.userId, status }) });
}));

router.post('/settlements', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_CREATE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { note: note ?? null, userId: user.userId },
    createdBy: user.userId,
    responseStatusCode: 201,
    create: (tx) => createOpsSettlement(user.userId, note, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.get('/settlements/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const detail = await getOpsSettlementDetail(parseId(req.params.id));
  if (detail.settlement.opsUserId !== user.userId) {
    throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');
  }
  res.json(detail);
}));

async function sendOpsSettlementXlsx(
  res: Response,
  settlementId: number,
  preloaded?: Awaited<ReturnType<typeof getOpsSettlementDetail>>,
) {
  const { buffer, filename } = await exportOpsSettlementXlsx(settlementId, preloaded);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(buffer);
}

router.get('/settlements/:id/export', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const detail = await getOpsSettlementDetail(parseId(req.params.id));
  if (detail.settlement.opsUserId !== user.userId) {
    throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');
  }
  await sendOpsSettlementXlsx(res, detail.settlement.id, detail);
}));

router.get('/admin/settlements/:id/export', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  await sendOpsSettlementXlsx(res, parseId(req.params.id));
}));

// ── Màn hình 2: Theo dõi phương tiện (/ops/fleet-tracking) ──────────────────

router.get('/fleet', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getOpsFleet(getUser(req).userId) });
}));

// ── Admin: gán Ops phụ trách xe ────────────────────────────────────────────

router.get('/trucks/ops-assignments', ADMIN_ONLY, asyncHandler(async (_req: Request, res: Response) => {
  res.json({ items: await listActiveTruckOpsAssignments() });
}));

router.put('/trucks/:truckId/ops-assignment', ADMIN_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const truckId = parseId(req.params.truckId, 'Mã xe');
  const { opsUserId } = z.object({ opsUserId: z.number().int().positive().nullable() })
    .parse(req.body);
  res.json(await setTruckOpsAssignment(truckId, opsUserId));
}));

// ── Kế toán / quản lý: duyệt khoản chi + phiếu thanh toán ───────────────────

router.get('/admin/expenses', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const status = statusFilterSchema.parse(req.query.status);
  const opsUserId = req.query.opsUserId != null && req.query.opsUserId !== ''
    ? parseId(String(req.query.opsUserId), 'Mã Ops')
    : undefined;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '100'), 10) || 100, 1), 200);
  const items = await listOpsExpenses({ status, paidById: opsUserId, limit });
  // Micro-ledger view (PRD §5.3): same-lot expenses cluster under ONE mã lô on
  // the accountant screen regardless of who paid — never split by payer. Lots
  // keep their first-appearance (newest) rank; within a lot the recent-first
  // order from the query survives the stable sort. Code-less rows act as
  // singleton clusters in the same first-appearance order.
  const lotRank = new Map<string, number>();
  for (const item of items) {
    const key = item.shipmentCode ?? `~row-${item.id}`;
    if (!lotRank.has(key)) lotRank.set(key, lotRank.size);
  }
  items.sort((a, b) =>
    (lotRank.get(a.shipmentCode ?? `~row-${a.id}`) ?? 0)
    - (lotRank.get(b.shipmentCode ?? `~row-${b.id}`) ?? 0));
  res.json({ items });
}));

const approveBodySchema = z.object({
  inPersonCheck: z.boolean().optional(),
  note: z.string().min(1).max(500).optional(),
});

router.post('/admin/expenses/:id/approve', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const expenseId = parseId(req.params.id);
  const approved = approveBodySchema.parse(req.body ?? {});
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_APPROVE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, decision: 'APPROVED', ...approved },
    createdBy: user.userId,
    create: (tx) => decideOpsExpense(user.userId, expenseId, 'APPROVED', undefined, tx, approved),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.post('/admin/expenses/:id/reject', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const expenseId = parseId(req.params.id);
  const { reason } = reasonSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_REJECT,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, decision: 'REJECTED', reason },
    createdBy: user.userId,
    create: (tx) => decideOpsExpense(user.userId, expenseId, 'REJECTED', reason, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.get('/admin/settlements', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status);
  res.json({ items: await listOpsSettlements({ status }) });
}));

router.get('/admin/settlements/:id', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getOpsSettlementDetail(parseId(req.params.id)));
}));

router.post('/admin/settlements/:id/approve', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const settlementId = parseId(req.params.id);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_APPROVE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { settlementId, decision: 'APPROVED' },
    createdBy: user.userId,
    create: (tx) => decideOpsSettlement(user.userId, settlementId, 'APPROVED', undefined, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.post('/admin/settlements/:id/reject', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const settlementId = parseId(req.params.id);
  const { reason } = reasonSchema.parse(req.body);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_REJECT,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { settlementId, decision: 'REJECTED', reason },
    createdBy: user.userId,
    create: (tx) => decideOpsSettlement(user.userId, settlementId, 'REJECTED', reason, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

export default router;
