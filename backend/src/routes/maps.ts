import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import * as mapsService from '../services/maps.service';

const router = Router();

// ── Place autocomplete (OpenStreetMap / Nominatim) ─────────────────────────

router.get('/autocomplete', asyncHandler(async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  // TEMPORARY diagnostic: ?debug=1 reports each source's raw http status + body
  // so we can see why a query comes back empty. Remove once search is confirmed.
  if (req.query.debug === '1') {
    const diag = await mapsService.debugResolve(q);
    res.json({ suggestions: [], _diag: diag });
    return;
  }
  if (q.length < 2) {
    res.json({ suggestions: [] });
    return;
  }
  const suggestions = await mapsService.getPlaceAutocomplete(q);
  res.json({ suggestions });
}));

export default router;
