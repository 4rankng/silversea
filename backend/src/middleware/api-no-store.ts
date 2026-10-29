// SIL-594 (id 694) — the API serves live operational state: a read-after-write
// refetch must never be answered with cached pre-save bytes by any cache in
// the path (browser fetch cache, service worker, or the staging nginx proxy).
// Every /api response therefore declares `Cache-Control: no-store`; the FE
// twin is `cache: 'no-store'` on the fetch itself (lib/api/client.ts).
import type { NextFunction, Request, Response } from 'express';

export function apiNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}
