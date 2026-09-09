// Freight-rate snapshot runtime (Phương án tính cước §2-D/§4).
//
// Paths align with the shared PRICING_ENGINE constants
// (shared/src/constants/api-paths.ts) so the pricing client needs no
// backend-specific mapping.
//
// The frozen snapshot is read-only for every role — including OPS/dispatch —
// by construction: no write route exists for it. The ONLY mutable surface is
// the debit-note override, gated to the financial trio (ADMIN / MANAGER /
// ACCOUNTANT) on top of the financial casbin gate, so an OPS write attempt
// fails with 403 before touching any row. The system freight always comes
// from the snapshot row server-side; a client-sent value is never trusted.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Role, freightRateOverrideSchema } from '@tingting/shared';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import { upsertDebitNoteOverride } from '../../services/freight-pricing-engine.service';
import {
  getFreightRateSnapshotById,
  resolveFreightRateWithManualFallback,
} from '../../services/freight-rate-snapshot-lifecycle.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { runIdempotent } from '../../services/idempotency.service';

const ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;
const FREIGHT_RATE_OVERRIDE_ENDPOINT = 'freight-rate-snapshots.override';

function parseSnapshotId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'ID ảnh chụp giá cước không hợp lệ');
  }
  return id;
}

// ─── Preview (shipments-authorized; the CUS create form consumes it) ────────
// Read-only resolution of the auto pricing engine: the AUTO formula breakdown
// or the MANUAL hint (missing 15T base price, lag before the first fuel
// period, unconfigured customer×route) WITHOUT persisting a snapshot.
export const freightRatePreviewRoutes = Router();

freightRatePreviewRoutes.get('/freight-preview', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({
    customerId: z.coerce.number().int().positive(),
    routeId: z.coerce.number().int().positive(),
    vehicleSizeClassCode: z.string().trim().min(1).max(20),
    transportDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày vận chuyển phải có dạng YYYY-MM-DD'),
  }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Tham số không hợp lệ' });
  }
  res.json(await resolveFreightRateWithManualFallback(parsed.data));
}));

// ─── Financial surface (ADMIN / MANAGER / ACCOUNTANT) ───────────────────────
const router = Router();

// GET /api/pricing/snapshots/:id — frozen snapshot + trace + override, for
// the debit-note builder surface.
router.get('/pricing/snapshots/:id', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const view = await getFreightRateSnapshotById(parseSnapshotId(req));
  if (!view) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh chụp giá cước' });
  }
  res.json(view);
}));

// GET /api/pricing/snapshots/:id/override — the override row itself.
// 404 = no override yet on a live snapshot (the UI treats 404 as null, not
// an error); the frozen system freight for the form comes from the snapshot
// detail route, so no wrapper body is needed here.
router.get('/pricing/snapshots/:id/override', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const view = await getFreightRateSnapshotById(parseSnapshotId(req));
  if (!view) {
    return res.status(404).json({ error: 'Không tìm thấy ảnh chụp giá cước' });
  }
  if (!view.override) {
    return res.status(404).json({ error: 'Chưa có điều chỉnh giá cước cho ảnh chụp này' });
  }
  res.json(view.override);
}));

// PUT /api/pricing/snapshots/:id/override — accountant enters the negotiated
// final debit freight (upsert). Reason is required whenever the final value
// differs from the frozen system total (enforced in the service).
router.put('/pricing/snapshots/:id/override', requireRoles(...ROLES), asyncHandler(async (req: Request, res: Response) => {
  const snapshotId = parseSnapshotId(req);
  const parsed = freightRateOverrideSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Dữ liệu không hợp lệ' });
  }
  const actor = getUser(req);
  const idempotencyKey = getRequestIdempotencyKey(req);
  const { result, replayed } = await runIdempotent({
    endpoint: FREIGHT_RATE_OVERRIDE_ENDPOINT,
    idempotencyKey,
    payload: { actorId: actor.userId, snapshotId, ...parsed.data },
    createdBy: actor.userId,
    entityType: 'freight_rate_snapshot',
    create: async (tx) => {
      const view = await getFreightRateSnapshotById(snapshotId, tx);
      if (!view) throw new ApiError(404, 'Không tìm thấy ảnh chụp giá cước');
      await upsertDebitNoteOverride({
        snapshotId,
        // Frozen system freight — the debit-note total (K = J + H).
        systemCalculatedFreight: view.totalAmount,
        finalDebitFreight: parsed.data.finalDebitFreight ?? undefined,
        overrideReason: parsed.data.overrideReason ?? undefined,
        overrideBy: actor.userId,
        executor: tx,
      });
      // Respond with the override row itself (the frontend client's
      // DebitNoteOverrideRow shape) — the full snapshot view stays on the
      // detail route.
      const refreshed = await getFreightRateSnapshotById(snapshotId, tx);
      return { override: refreshed?.override ?? null };
    },
  });
  res.json({ ...result.override, ...(idempotencyKey ? { replayed } : {}) });
}));

export default router;
