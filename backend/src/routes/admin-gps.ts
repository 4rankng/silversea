/**
 * Admin GPS endpoints — seed + repair the real-route database.
 *
 * With Google Directions retired, a trip's map is blank until its real GPS trail
 * is captured. The completion hook captures new trips automatically; these
 * endpoints handle the backlog (backfill) and one-off repairs (recapture).
 * RBAC: gps-admin action (ADMIN + MANAGER only) — applied at mount time.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { and, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { asyncHandler } from '../middleware/asyncHandler';
import { captureTripGpsTrack, deriveRoutesForStoredTrip, type CaptureResult } from '../services/gps/capture.service';

const router = Router();

async function captureAndDeriveTripGps(tripId: number): Promise<CaptureResult> {
  const capture = await captureTripGpsTrack(tripId); // never throws
  if (capture.status !== 'ok') return capture;

  try {
    const derivation = await deriveRoutesForStoredTrip(tripId);
    return {
      ...capture,
      legsDerived: derivation.legsDerived,
      legsTotal: derivation.legsTotal,
      status: derivation.legsDerived > 0 ? 'ok' : 'partial',
    };
  } catch (err: unknown) {
    console.warn('[gps] derive after capture failed', {
      tripId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ...capture,
      status: 'partial',
      errorKind: 'derive_failed',
    };
  }
}

/**
 * POST /api/admin/gps/backfill
 * Derive real GPS routes for historical COMPLETED/LOCKED trips. Iterates
 * SEQUENTIALLY (one provider window per trip — don't hammer Bách Khoa), each
 * trip isolated so one failure can't abort the run.
 *
 * Body: { dateFrom?, dateTo?, tripIds?: number[] }
 *   - tripIds given  → only those trips (any status except CANCELED is attempted)
 *   - else           → all COMPLETED/LOCKED trips with departureDate in [dateFrom, dateTo]
 */
router.post('/backfill', asyncHandler(async (req: Request, res: Response) => {
  const { dateFrom, dateTo, tripIds } = (req.body ?? {}) as {
    dateFrom?: string;
    dateTo?: string;
    tripIds?: number[];
  };

  // Validate tripIds (office-only endpoint, but reject malformed input early).
  const ids = Array.isArray(tripIds)
    ? tripIds.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 200)
    : [];

  const conds = [inArray(schema.trips.status, ['COMPLETED', 'LOCKED'])];
  if (ids.length) {
    conds.push(inArray(schema.trips.id, ids));
  } else if (dateFrom && dateTo) {
    // departureDate is a PgDateString (YYYY-MM-DD) — string compare is chronological for ISO dates.
    conds.push(gte(schema.trips.departureDate, dateFrom));
    conds.push(lte(schema.trips.departureDate, dateTo));
  }

  // Cap the sequential provider run so a huge date range can't hold a worker open
  // for tens of minutes. Fetch one extra row to detect truncation without a second query.
  const BACKFILL_CAP = 500;
  const selected = await db.select({ id: schema.trips.id })
    .from(schema.trips)
    .where(and(...conds))
    .orderBy(schema.trips.id)
    .limit(BACKFILL_CAP + 1);
  const truncated = selected.length > BACKFILL_CAP;
  const page = truncated ? selected.slice(0, BACKFILL_CAP) : selected;

  let ok = 0, partial = 0, failed = 0, empty = 0;
  const failures: Array<{ tripId: number; errorKind?: string }> = [];
  for (const t of page) {
    const r: CaptureResult = await captureAndDeriveTripGps(t.id);
    if (r.status === 'ok') ok++;
    else if (r.status === 'partial') partial++;
    else if (r.status === 'empty') empty++;
    else { failed++; failures.push({ tripId: t.id, errorKind: r.errorKind }); }
  }

  res.json({
    total: page.length,
    ok,
    partial,
    empty,
    failed,
    failures,
    truncated,
  });
}));

/**
 * POST /api/admin/gps/recapture/:tripId
 * Force re-capture + re-derive for one trip — overwrites its trip_gps_tracks row
 * and refreshes route_polylines for its pairs. Escape hatch for a trip whose
 * initial capture failed or whose displayed route looks wrong.
 */
router.post('/recapture/:tripId', asyncHandler(async (req: Request, res: Response) => {
  const tripId = parseInt(req.params.tripId as string, 10);
  if (!Number.isFinite(tripId)) {
    res.status(400).json({ error: 'tripId không hợp lệ' });
    return;
  }
  const result = await captureAndDeriveTripGps(tripId);
  res.json(result);
}));

export default router;
