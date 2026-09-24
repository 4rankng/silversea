/**
 * Ops field-operations portal (docs/prd/OpsVanHanh.md), mounted at /api/ops
 * behind authMiddleware. Role gates per PRD §2: portal routes are OPS-only,
 * financial reconciliation is ADMIN/MANAGER/ACCOUNTANT, truck ops
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
import { parseId as sharedParseId } from './utils/parse-id';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from '../services/idempotency.service';
import { getRequestIdempotencyKey } from './utils/idempotency';
import { formatLocalDate, sniffImageType } from '../lib/format';
import { storageService } from '../services/storage.service';
import { createAdvanceRequest, listAdvanceRequestsPaginated } from '../services/advance-request.service';
import { listOpsOrders, setShipmentPin } from '../services/ops-orders.service';
import { getOpsWalletSummary, getOpsFundBook } from '../services/ops-wallet.service';
import {
  attachOpsExpensePhoto,
  createOpsExpense,
  deleteOpsExpense,
  deleteOpsExpensePhoto,
  listActiveOpsExpenseTypes,
  listOpsExpensePhotos,
  listOpsExpenses,
  updateOpsExpense,
} from '../services/ops-expenses.service';
import {
  createOpsSettlement,
  finalizeOpsSettlement,
  reopenOpsSettlementDraft,
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
const statusFilterSchema = z.enum(['DRAFT', 'RECORDED', 'VOIDED']).optional();

function parseId(value: string | string[] | undefined, label = 'ID'): number {
  return sharedParseId(value, label);
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

// Card 20260923_13 — read-only Sổ quỹ scoped to the caller's own tạm ứng/
// hoàn ứng cash events (ADR 2026-09-24-ops-fund-book-scoped-read). Identity
// comes only from the session; full treasury stays ACCOUNTANT/ADMIN.
router.get('/wallet/fund-book', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getOpsFundBook(getUser(req).userId));
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

router.get('/wallet/advance-requests', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const page = Math.max(Number.parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
  res.json(await listAdvanceRequestsPaginated({ requesterId: user.userId, status, page, limit }));
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
    // Direct-effect save: the requester's own create applies the advance
    // (status + ledger) in the same transaction — no approval handoff.
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
  costGroup: z.enum(['INVOICED_LIFT', 'INVOICED_DROP', 'INVOICED_OTHER', 'OPS_REGULAR', 'OPS_INCIDENTAL']).optional(),
  feeName: z.string().trim().min(1).max(200).optional(), invoiceNumber: z.string().trim().max(50).nullable().optional(),
  invoiceDate: z.string().nullable().optional(), recoveryNote: z.string().max(1000).nullable().optional(),
  // Card 20260921_5 — the Thực-thu side of the no-invoice pair. Invoice
  // rows keep the charge=amount invariant regardless of any override.
  customerChargeAmount: z.union([z.number(), z.string()]).nullable().optional(),
  shipmentId: z.number().int().positive(),
  // Audit c12 A2: name the field — the generic "Giá trị phải lớn hơn 0"
  // misled operators when the container selection dropped to 0.
  shipmentContainerId: z.number().int().positive('Dòng cont không hợp lệ — chọn lại cont trước khi lưu.').nullable().optional(),
  expenseTypeCode: z.string().min(1).max(50),
  amount: z.union([z.number(), z.string()]),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).nullable().optional(),
  photoStorageKeys: z.array(z.string().min(1).max(500)).max(20).optional(),
});

const expensePatchSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  expectedVersion: z.number().int().positive().optional(),
  costGroup: z.enum(['INVOICED_LIFT', 'INVOICED_DROP', 'INVOICED_OTHER', 'OPS_REGULAR', 'OPS_INCIDENTAL']).optional(),
  feeName: z.string().trim().min(1).max(200).optional(), invoiceNumber: z.string().trim().max(50).nullable().optional(),
  invoiceDate: z.string().nullable().optional(), recoveryNote: z.string().max(1000).nullable().optional(),
  customerChargeAmount: z.union([z.number(), z.string()]).nullable().optional(),
  shipmentContainerId: z.number().int().positive('Dòng cont không hợp lệ — chọn lại cont trước khi lưu.').nullable().optional(),
  expenseTypeCode: z.string().min(1).max(50).optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).nullable().optional(),
});


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
  // Q10 (card 20260922_78 batch 2): the soft void now captures a mandatory
  // free-text reason with the actor.
  const reason = z.object({ reason: z.string().trim().min(1, 'Lý do xóa là bắt buộc.').max(500) })
    .parse((req.body ?? {})).reason;
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_EXPENSE_DELETE,
    idempotencyKey: requireOpsIdempotencyKey(req),
    payload: { expenseId, userId: user.userId, reason },
    createdBy: user.userId,
    create: async (tx) => {
      await deleteOpsExpense(user.userId, expenseId, reason, tx);
      return { success: true };
    },
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

// Receipt review: the author or financial staff (ADMIN/MANAGER/ACCOUNTANT) may
// list an expense's photos — accounting must see the evidence before deciding.
router.get('/expenses/:id/photos', asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const canReviewFinancialEvidence = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(user.role as Role);
  if (!canReviewFinancialEvidence && user.role !== Role.OPS) throw new ApiError(403, 'Không có quyền truy cập.');
  res.json({ items: await listOpsExpensePhotos(user.userId, canReviewFinancialEvidence, parseId(req.params.id)) });
}));

// ── Đề nghị thanh toán ──────────────────────────────────────────────────────

router.get('/settlements', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const status = z.enum(['DRAFT', 'RECORDED', 'VOIDED']).optional().parse(req.query.status);
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

router.post('/settlements/:id/finalize', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const id = parseId(req.params.id);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_FINALIZE,
    idempotencyKey: requireOpsIdempotencyKey(req), payload: { id, userId: user.userId },
    createdBy: user.userId, responseStatusCode: 200,
    create: (tx) => finalizeOpsSettlement(user.userId, id, tx),
  });
  res.status(outcome.statusCode).json(outcome.result);
}));

router.post('/settlements/:id/reopen-draft', OPS_ONLY, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const id = parseId(req.params.id);
  const outcome = await runIdempotent({
    endpoint: IDEMPOTENCY_ENDPOINTS.OPS_SETTLEMENT_REOPEN_DRAFT,
    idempotencyKey: requireOpsIdempotencyKey(req), payload: { id, userId: user.userId },
    createdBy: user.userId, responseStatusCode: 200,
    create: (tx) => reopenOpsSettlementDraft(user.userId, id, tx),
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

/**
 * Export contract (OpsVanHanh §5.4 + PRD L129): Excel only — the A4 print
 * path is the frontend's In view. An explicit unsupported format must 400
 * instead of silently receiving the spreadsheet.
 */
function parseExportFormat(value: unknown): 'xlsx' | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'string' && (value === 'xlsx' || value === 'xls')) return 'xlsx';
  throw new ApiError(400, `Định dạng xuất không hỗ trợ: ${typeof value === 'string' ? `"${value}"` : 'tham số lặp'}. Chỉ hỗ trợ Excel (xlsx).`);
}

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
  parseExportFormat(req.query.format);
  const detail = await getOpsSettlementDetail(parseId(req.params.id));
  if (detail.settlement.opsUserId !== user.userId) {
    throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');
  }
  await sendOpsSettlementXlsx(res, detail.settlement.id, detail);
}));

router.get('/admin/settlements/:id/export', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  parseExportFormat(req.query.format);
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

// KP-149: approve/reject endpoints removed — OPS expenses and settlements
// are saved directly as APPROVED at creation time.

router.get('/admin/settlements', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  const status = z.enum(['DRAFT', 'RECORDED', 'VOIDED']).optional().parse(req.query.status);
  res.json({ items: await listOpsSettlements({ status }) });
}));

router.get('/admin/settlements/:id', OPS_APPROVERS, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getOpsSettlementDetail(parseId(req.params.id)));
}));

export default router;
