/**
 * Onboarding persistence service (Phase 4).
 *
 * Server-side source of truth for tour progress + checklist tasks. The frontend
 * `tourProgress.ts` localStorage layer is a read-through cache; these functions
 * are what makes progress cross-device, admin-visible, and analytics-ready.
 *
 * Security: every function takes `userId` from the JWT (never from the request
 * body) so a caller can only read/write their own rows. Office-role gating is
 * enforced at the route layer (casbin + requireRoles); this service trusts the
 * caller's userId.
 *
 * Concurrency: upserts use `onConflictDoUpdate` targeting the unique indexes,
 * so debounced client writes are safe — last-write-wins per (user, tour, version).
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { ONBOARDING_EVENT_NAMES, type OnboardingEventName, type TriggerSource, type Role } from '@tingting/shared';

export interface OnboardingProgressRow {
  id: number;
  tourId: string;
  tourVersion: number;
  currentStepId: string | null;
  status: 'in_progress' | 'completed' | 'skipped';
  startedAt: string | null;
  completedAt: string | null;
  skippedAt: string | null;
  updatedAt: string;
}

export interface OnboardingTaskRow {
  taskId: string;
  status: 'pending' | 'completed' | 'dismissed';
  completedAt: string | null;
  metadata: unknown;
  updatedAt: string;
}

// ─── Progress ───────────────────────────────────────────────────────────────

/** All progress rows for a user (every tour/version they've touched). */
export async function getProgressForUser(userId: number): Promise<OnboardingProgressRow[]> {
  const rows = await db
    .select()
    .from(s.userOnboardingProgress)
    .where(eq(s.userOnboardingProgress.userId, userId));
  return rows.map(toProgressRow);
}

/** Upsert a progress row. Last-write-wins per (user, tour, version). */
export async function upsertProgress(
  userId: number,
  input: {
    tourId: string;
    tourVersion: number;
    currentStepId?: string | null;
    status: 'in_progress' | 'completed' | 'skipped';
  },
): Promise<OnboardingProgressRow> {
  const now = new Date();
  // On INSERT, stamp every timestamp appropriately (startedAt = first touch).
  // On CONFLICT (update), only the matching status timestamp + updatedAt are
  // rewritten (see onConflictDoUpdate.set below), so startedAt/completedAt/
  // skippedAt from prior transitions are preserved.
  const [row] = await db
    .insert(s.userOnboardingProgress)
    .values({
      userId,
      tourId: input.tourId,
      tourVersion: input.tourVersion,
      currentStepId: input.currentStepId ?? null,
      status: input.status,
      startedAt: now,
      completedAt: input.status === 'completed' ? now : null,
      skippedAt: input.status === 'skipped' ? now : null,
    })
    .onConflictDoUpdate({
      target: [
        s.userOnboardingProgress.userId,
        s.userOnboardingProgress.tourId,
        s.userOnboardingProgress.tourVersion,
      ],
      set: {
        currentStepId: input.currentStepId ?? null,
        status: input.status,
        // Only stamp the timestamp that matches the new status; leave the
        // others as-is so a completed-then-resumed tour keeps its completedAt.
        completedAt: input.status === 'completed' ? now : undefined,
        skippedAt: input.status === 'skipped' ? now : undefined,
        updatedAt: now,
      },
    })
    .returning();
  return toProgressRow(row);
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/** All task rows for a user. */
export async function getTasksForUser(userId: number): Promise<OnboardingTaskRow[]> {
  const rows = await db
    .select()
    .from(s.userOnboardingTasks)
    .where(eq(s.userOnboardingTasks.userId, userId));
  return rows.map(toTaskRow);
}

/** Upsert a task row (one per user+task). Used by Phase 6 checklists. */
export async function upsertTask(
  userId: number,
  input: {
    taskId: string;
    status: 'pending' | 'completed' | 'dismissed';
    metadata?: unknown;
  },
): Promise<OnboardingTaskRow> {
  const now = new Date();
  const [row] = await db
    .insert(s.userOnboardingTasks)
    .values({
      userId,
      taskId: input.taskId,
      status: input.status,
      completedAt: input.status === 'completed' ? now : null,
      metadata: input.metadata ?? null,
    })
    .onConflictDoUpdate({
      target: [s.userOnboardingTasks.userId, s.userOnboardingTasks.taskId],
      set: {
        status: input.status,
        completedAt: input.status === 'completed' ? now : null,
        metadata: input.metadata ?? null,
        updatedAt: now,
      },
    })
    .returning();
  return toTaskRow(row);
}

// ─── mappers ────────────────────────────────────────────────────────────────

function toProgressRow(r: typeof s.userOnboardingProgress.$inferSelect): OnboardingProgressRow {
  return {
    id: r.id,
    tourId: r.tourId,
    tourVersion: r.tourVersion,
    currentStepId: r.currentStepId,
    status: r.status,
    startedAt: r.startedAt ? r.startedAt.toISOString() : null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    skippedAt: r.skippedAt ? r.skippedAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toTaskRow(r: typeof s.userOnboardingTasks.$inferSelect): OnboardingTaskRow {
  return {
    taskId: r.taskId,
    status: r.status,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    metadata: r.metadata,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Lifecycle analytics (Phase 5) ───────────────────────────────────────────

export interface OnboardingAnalyticsInput {
  eventName: OnboardingEventName;
  tourId?: string;
  tourVersion?: number;
  stepId?: string;
  routeKey?: string;
  durationMs?: number;
  triggerSource?: TriggerSource;
  targetFound?: boolean;
}

const KNOWN_EVENT_NAMES = new Set<string>(ONBOARDING_EVENT_NAMES);

/**
 * Bulk-insert onboarding lifecycle events (Phase 5). The server filters out any
 * event whose `eventName` is outside the closed `ONBOARDING_EVENT_NAMES` set
 * (defense-in-depth — the client only emits from that set anyway). Returns the
 * number of rows actually inserted.
 */
export async function recordEvents(
  userId: number,
  role: Role,
  events: OnboardingAnalyticsInput[],
): Promise<number> {
  // Filter + map in one pass; drop anything outside the closed set.
  const rows = events
    .filter((e) => KNOWN_EVENT_NAMES.has(e.eventName))
    .map((e) => ({
      userId,
      role: String(role),
      eventName: e.eventName,
      tourId: e.tourId ?? null,
      tourVersion: e.tourVersion ?? null,
      stepId: e.stepId ?? null,
      routeKey: e.routeKey ?? null,
      durationMs: e.durationMs ?? null,
      triggerSource: e.triggerSource ?? null,
      targetFound: e.targetFound ?? null,
    }));
  if (rows.length === 0) return 0;
  await db.insert(s.onboardingEvents).values(rows);
  return rows.length;
}

// Silence unused-import lint when `and` is not yet used (kept for future
// filtered queries in Phase 6).
void and;
