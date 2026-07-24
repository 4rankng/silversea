/**
 * Typed API client for the onboarding endpoints (Phase 4).
 *
 * Wraps `GET/PUT /api/onboarding/progress` and `/api/onboarding/tasks`.
 * `userId` is taken from the JWT server-side, so these methods never send a
 * user identity — the caller implicitly addresses their own rows. Used by:
 *   - `useOnboardingProgress` / `useOnboardingTasks` (read hooks)
 *   - the write-through path in `TourControllerContext` (debounced upserts)
 *   - Phase 6's checklist hook
 *
 * Server is the source of truth; `tourProgress.ts` localStorage is a cache.
 */
import { api } from '../lib/api';

export interface OnboardingProgressItem {
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

export interface OnboardingTaskItem {
  taskId: string;
  status: 'pending' | 'completed' | 'dismissed';
  completedAt: string | null;
  metadata: unknown;
  updatedAt: string;
}

export type OnboardingStatus = OnboardingProgressItem['status'];
export type OnboardingTaskStatus = OnboardingTaskItem['status'];

export const onboardingClient = {
  getProgress: async (): Promise<OnboardingProgressItem[]> => {
    const res = await api.get<{ items: OnboardingProgressItem[] }>('/onboarding/progress');
    return res.items;
  },

  upsertProgress: async (input: {
    tourId: string;
    tourVersion: number;
    currentStepId?: string | null;
    status: OnboardingStatus;
  }): Promise<OnboardingProgressItem> => {
    return api.put<OnboardingProgressItem>(`/onboarding/progress/${input.tourId}`, {
      tourVersion: input.tourVersion,
      currentStepId: input.currentStepId ?? null,
      status: input.status,
    });
  },

  getTasks: async (): Promise<OnboardingTaskItem[]> => {
    const res = await api.get<{ items: OnboardingTaskItem[] }>('/onboarding/tasks');
    return res.items;
  },

  upsertTask: async (input: {
    taskId: string;
    status: OnboardingTaskStatus;
    metadata?: unknown;
  }): Promise<OnboardingTaskItem> => {
    return api.put<OnboardingTaskItem>(`/onboarding/tasks/${input.taskId}`, {
      status: input.status,
      metadata: input.metadata,
    });
  },
};
