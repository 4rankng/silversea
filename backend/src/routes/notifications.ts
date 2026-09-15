import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { ApiError } from '../errors';
import { parsePagination } from './utils/pagination';
import * as notifService from '../services/notification.service';
import * as pushService from '../services/push.service';
import { config } from '../config';
import type { Request, Response } from 'express';

const router = Router();

router.get('/unread-count', asyncHandler(async (req: Request, res: Response) => {
  const count = await notifService.getUnreadCount(getUser(req).userId);
  res.json({ count });
}));

router.post('/read-all', asyncHandler(async (req: Request, res: Response) => {
  await notifService.markAllAsRead(getUser(req).userId);
  res.json({ ok: true });
}));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req, { limit: 20 });
  res.json(await notifService.getNotifications(getUser(req).userId, page, limit));
}));

router.post('/:id/read', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'ID thông báo không hợp lệ');
  const updated = await notifService.markAsRead(id, getUser(req).userId);
  if (!updated) throw new ApiError(404, 'Không tìm thấy thông báo.');
  res.json(updated);
}));

// ─── Web Push (subscribe / unsubscribe / VAPID public key) ──────────────────
// All three sit under the already-mounted `notifications` Casbin resource
// (read = GET vapid-key, write = POST subscribe/unsubscribe). Every role has
// read+write on notifications, so DRIVER/FORWARDER/office can all opt in.

router.get('/vapid-key', (_req: Request, res: Response) => {
  res.json({ publicKey: config.vapidPublicKey });
});

const subscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  deviceType: z.enum(['ios', 'android', 'web']).optional(),
});

router.post('/subscribe', asyncHandler(async (req: Request, res: Response) => {
  const parsed = subscribeSchema.parse(req.body);
  await pushService.subscribe(getUser(req).userId, parsed);
  res.json({ ok: true });
}));

router.post('/unsubscribe', asyncHandler(async (req: Request, res: Response) => {
  const endpoint = z.string().min(1).parse(req.body?.endpoint);
  await pushService.unsubscribe(getUser(req).userId, endpoint);
  res.json({ ok: true });
}));

export default router;
