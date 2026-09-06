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
import { formatLocalDate, sniffImageType } from '../lib/format';
import { storageService } from '../services/storage.service';
import { createAdvanceRequest } from '../services/advance-request.service';
import { listOpsOrders, toggleShipmentPin } from '../services/ops-orders.service';
import { getOpsWalletSummary } from '../services/ops-wallet.service';
import {
  attachOpsExpensePhoto,
  createOpsExpense,
  decideOpsExpense,
  deleteOpsExpense,
  deleteOpsExpensePhoto,
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
import { getOpsFleet, setTruckOpsAssignment } from '../services/ops-fleet.service';

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

// ── Màn hình 1: Kế hoạch làm hàng (/ops/orders) ─────────────────────────────

router.get('/orders', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const date = dateQuerySchema.parse(req.query.date ?? formatLocalDate());
  const search = typeof req.query.q === 'string' ? req.query.q : undefined;
  res.json({ date, items: await listOpsOrders(user.userId, date, search) });
}));

router.post('/orders/shipment-pins/:shipmentId/toggle', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const shipmentId = parseId(req.params.shipmentId, 'Mã lô');
  res.json(await toggleShipmentPin(user.userId, shipmentId));
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
  res.status(201).json(await createAdvanceRequest(user.userId, parsed));
}));

// ── Khoản chi của Ops ───────────────────────────────────────────────────────

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
  res.status(201).json(await createOpsExpense(user.userId, parsed));
}));

router.patch('/expenses/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const parsed = expensePatchSchema.parse(req.body);
  res.json(await updateOpsExpense(user.userId, parseId(req.params.id), parsed));
}));

router.delete('/expenses/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  await deleteOpsExpense(getUser(req).userId, parseId(req.params.id));
  res.json({ success: true });
}));

router.post('/expenses/:id/resend', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  res.json(await resendOpsExpense(getUser(req).userId, parseId(req.params.id)));
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

// ── Đề nghị thanh toán ──────────────────────────────────────────────────────

router.get('/settlements', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status);
  res.json({ items: await listOpsSettlements({ opsUserId: user.userId, status }) });
}));

router.post('/settlements', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const { note } = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
  res.status(201).json(await createOpsSettlement(user.userId, note));
}));

router.get('/settlements/:id', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const detail = await getOpsSettlementDetail(parseId(req.params.id));
  if (detail.settlement.opsUserId !== user.userId) {
    throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');
  }
  res.json(detail);
}));

// ── Màn hình 2: Theo dõi phương tiện (/ops/fleet-tracking) ──────────────────

router.get('/fleet', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getOpsFleet(getUser(req).userId) });
}));

// ── Admin: gán Ops phụ trách xe ────────────────────────────────────────────

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
  res.json({ items: await listOpsExpenses({ status, paidById: opsUserId, limit }) });
}));

router.post('/admin/expenses/:id/approve', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  res.json(await decideOpsExpense(getUser(req).userId, parseId(req.params.id), 'APPROVED'));
}));

router.post('/admin/expenses/:id/reject', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await decideOpsExpense(getUser(req).userId, parseId(req.params.id), 'REJECTED', reason));
}));

router.get('/admin/settlements', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status);
  res.json({ items: await listOpsSettlements({ status }) });
}));

router.get('/admin/settlements/:id', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getOpsSettlementDetail(parseId(req.params.id)));
}));

router.post('/admin/settlements/:id/approve', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  res.json(await decideOpsSettlement(getUser(req).userId, parseId(req.params.id), 'APPROVED'));
}));

router.post('/admin/settlements/:id/reject', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const { reason } = reasonSchema.parse(req.body);
  res.json(await decideOpsSettlement(getUser(req).userId, parseId(req.params.id), 'REJECTED', reason));
}));

export default router;
