/**
 * Onboarding REST routes (Phase 4).
 *
 * Mount point: `/api/onboarding` behind `authMiddleware` +
 * `casbinAuthz('onboarding')` + `requireRoles(ADMIN, MANAGER, ACCOUNTANT)`
 * (mirrors the chatbot office-role gate — DRIVER/FORWARDER get no onboarding).
 * Mutations flow through the global `audit.ts` middleware (Vietnamese audit
 * messages) like every other write endpoint.
 *
 * Endpoints:
 *   GET  /api/onboarding/progress           — caller's progress rows
 *   PUT  /api/onboarding/progress/:tourId   — upsert (debounced client-side)
 *   GET  /api/onboarding/tasks              — caller's checklist task rows
 *   PUT  /api/onboarding/tasks/:taskId      — upsert (Phase 6)
 *
 * `userId` is ALWAYS taken from the JWT (req.user), never the body — a caller
 * can only read/write their own onboarding state.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { ApiError } from '../errors';
import {
  getProgressForUser,
  upsertProgress,
  getTasksForUser,
  upsertTask,
  recordEvents,
  type OnboardingAnalyticsInput,
} from '../services/onboarding.service';
import { ONBOARDING_EVENT_NAMES } from '@tingting/shared';

export const onboardingRouter = Router();

const progressUpsertSchema = z.object({
  tourVersion: z.number().int().positive(),
  currentStepId: z.string().max(120).nullable().optional(),
  status: z.enum(['in_progress', 'completed', 'skipped']),
});

const taskUpsertSchema = z.object({
  status: z.enum(['pending', 'completed', 'dismissed']),
  metadata: z.unknown().optional(),
});

// Batch of lifecycle analytics events (Phase 5). The server re-filters against
// the closed set so a tampered payload can't inject arbitrary event names.
const analyticsEventSchema = z.object({
  eventName: z.enum([...ONBOARDING_EVENT_NAMES] as [string, ...string[]]),
  tourId: z.string().max(120).optional(),
  tourVersion: z.number().int().positive().optional(),
  stepId: z.string().max(120).optional(),
  routeKey: z.string().max(60).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  triggerSource: z.enum(['chatbot', 'checklist', 'manual']).optional(),
  targetFound: z.boolean().optional(),
});
const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventSchema).max(200),
});

// ─── Progress ───────────────────────────────────────────────────────────────

onboardingRouter.get(
  '/progress',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const items = await getProgressForUser(user.userId);
    res.json({ items });
  }),
);

onboardingRouter.put(
  '/progress/:tourId',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const tourId = String(req.params.tourId ?? '');
    if (!tourId || tourId.length > 120) {
      throw new ApiError(400, 'tourId không hợp lệ');
    }
    const parsed = progressUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Dữ liệu tiến độ không hợp lệ', JSON.stringify(parsed.error.issues));
    }
    const row = await upsertProgress(user.userId, { tourId, ...parsed.data });
    res.json(row);
  }),
);

// ─── Tasks ──────────────────────────────────────────────────────────────────

onboardingRouter.get(
  '/tasks',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const items = await getTasksForUser(user.userId);
    res.json({ items });
  }),
);

onboardingRouter.put(
  '/tasks/:taskId',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const taskId = String(req.params.taskId ?? '');
    if (!taskId || taskId.length > 120) {
      throw new ApiError(400, 'taskId không hợp lệ');
    }
    const parsed = taskUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Dữ liệu task không hợp lệ', JSON.stringify(parsed.error.issues));
    }
    const row = await upsertTask(user.userId, { taskId, ...parsed.data });
    res.json(row);
  }),
);

// ─── Lifecycle analytics (Phase 5) ──────────────────────────────────────────

onboardingRouter.post(
  '/events',
  asyncHandler(async (req: Request, res: Response) => {
    const user = getUser(req);
    const parsed = analyticsBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'Dữ liệu analytics không hợp lệ', JSON.stringify(parsed.error.issues));
    }
    const inserted = await recordEvents(
      user.userId,
      user.role,
      parsed.data.events as OnboardingAnalyticsInput[],
    );
    res.json({ inserted });
  }),
);
