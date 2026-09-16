/**
 * Forwarder trip reads. Handler bodies moved verbatim from
 * routes/forwarder.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { ApiError } from '../../errors';
import {
  getForwarderTrips, getForwarderTripCounts, getForwarderTripDetail,
} from '../../services/forwarder.service';

const router = Router();

router.get('/trips', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const status = req.query.status as string | undefined;
  // N4: optional filters — search (container number OR customer name),
  // dateFrom/dateTo (filter on trip.departure_date). Mirrors the param-reading
  // pattern in routes/trips.ts summary handler (accepts camelCase and snake_case).
  const search = (req.query.search as string | undefined) || undefined;
  const dateFrom = (req.query.dateFrom || req.query.date_from) as string | undefined;
  const dateTo = (req.query.dateTo || req.query.date_to) as string | undefined;
  const [items, counts] = await Promise.all([
    getForwarderTrips(forwarder.id, status, { search, dateFrom, dateTo }),
    getForwarderTripCounts(forwarder.id),
  ]);
  res.json({ items, counts });
}));

router.get('/trips/:id', asyncHandler(async (req: Request, res: Response) => {
  const forwarder = req.forwarder!;
  const trip = await getForwarderTripDetail(parseInt(req.params.id as string, 10), forwarder.id);
  if (!trip) throw new ApiError(404, 'Không tìm thấy chuyến đi');
  res.json(trip);
}));


export default router;
