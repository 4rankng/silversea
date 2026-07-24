/**
 * useOnboardingChecklist — the role-checklist data hook (Phase 6).
 *
 * Loads the caller's task statuses from the server (Phase 4
 * `GET /api/onboarding/tasks`), subscribes to each incomplete task's
 * `completionEvent` via the Phase 1 event bus, and persists completions back to
 * the server. Exposes:
 *   - tasks: the caller's role tasks merged with server status
 *   - completedCount / total / pct for the progress bar
 *   - launchTour(taskId): start the task's curated tour (chatbot/checklist origin)
 *   - dismiss(): mark the panel dismissed (writes 'dismissed' to the server)
 *
 * The hook is office-role-only — DRIVER/FORWARDER get an empty task list and
 * the panel is gated in Layout.
 *
 * Completion is event-driven: when the product event fires (e.g. trip.created),
 * the matching incomplete task flips to 'completed' and is persisted. A task
 * completes only from its OWN event (subscriptions are scoped to
 * tasksForRole(role)).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  tasksForRole,
  type OnboardingTask,
} from '@tingting/shared';
import { useAuth } from './useAuth';
import { onboardingClient, type OnboardingTaskItem } from '../api/onboardingClient';
import { onboardingEvents } from '../lib/onboardingEvents';
import { useTourController } from '../context/TourControllerContext';

export interface ChecklistTask extends OnboardingTask {
  /** Current persisted status from the server (or 'pending' if no row yet). */
  taskStatus: 'pending' | 'completed' | 'dismissed';
}

export interface UseOnboardingChecklist {
  tasks: ChecklistTask[];
  total: number;
  completedCount: number;
  pct: number; // 0..100
  /** True until the first server load resolves. */
  loading: boolean;
  /** Launch the task's curated tour (no-op if the task has no tourId). */
  launchTour: (taskId: string) => void;
  /** Dismiss the panel — writes 'dismissed' for every still-pending task. */
  dismiss: () => void;
}

export function useOnboardingChecklist(): UseOnboardingChecklist {
  const { user } = useAuth();
  const { start } = useTourController();
  const role = user?.role;
  const [statuses, setStatuses] = useState<Record<string, 'pending' | 'completed' | 'dismissed'>>({});
  const [loading, setLoading] = useState(true);

  // The role's tasks (ordered). Memoized; empty for non-office roles.
  const roleTasks = useMemo<readonly OnboardingTask[]>(
    () => (role ? tasksForRole(role) : []),
    [role],
  );

  // Load server statuses on mount + whenever the user's role changes.
  useEffect(() => {
    if (!user || roleTasks.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    onboardingClient
      .getTasks()
      .then((rows: OnboardingTaskItem[]) => {
        if (cancelled) return;
        const map: Record<string, 'pending' | 'completed' | 'dismissed'> = {};
        for (const r of rows) map[r.taskId] = r.status;
        setStatuses(map);
      })
      .catch(() => {
        // Best-effort: if the load fails, proceed with all-pending so the
        // checklist still renders and can complete locally.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.userId, roleTasks]);

  // Merge role tasks with server status.
  const tasks = useMemo<ChecklistTask[]>(() => {
    const seen = new Set<string>();
    const merged = roleTasks.map<ChecklistTask>((t) => ({
      ...t,
      taskStatus: statuses[t.id] ?? 'pending',
    }));
    void seen;
    return merged;
  }, [roleTasks, statuses]);

  const completedCount = useMemo(
    () => tasks.filter((t) => t.taskStatus === 'completed').length,
    [tasks],
  );
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  // Subscribe to each incomplete event-gated task. When it fires, flip
  // the task to completed locally + persist. Re-subscribes when tasks/statuses
  // change. Per-role scoping prevents cross-role event crossfire.
  useEffect(() => {
    if (roleTasks.length === 0) return;
    const incomplete = tasks.filter(
      (t): t is ChecklistTask & { completion: { type: 'event'; event: import('@tingting/shared').ProductEventName } } =>
        t.taskStatus !== 'completed' && t.completion.type === 'event',
    );
    const unsubs: Array<() => void> = [];
    for (const t of incomplete) {
      const off = onboardingEvents.on(t.completion.event, () => {
        // Flip locally first (responsive), then persist.
        setStatuses((prev) => (prev[t.id] === 'completed' ? prev : { ...prev, [t.id]: 'completed' }));
        onboardingClient
          .upsertTask({ taskId: t.id, status: 'completed' })
          .catch(() => {
            // Non-blocking; local state is already updated.
          });
      });
      unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

  // Completing a curated guide is also meaningful onboarding progress. The
  // guide-specific payload ensures finishing (for example) the fuel guide
  // cannot complete a different task that happens to have a tour.
  useEffect(() => {
    const off = onboardingEvents.on('tour.completed', (payload) => {
      if (!payload || typeof payload !== 'object' || !('tourId' in payload)) return;
      const tourId = (payload as { tourId?: unknown }).tourId;
      if (typeof tourId !== 'string') return;
      for (const task of tasks) {
        if (task.completion.type !== 'tour' || task.tourId !== tourId || task.taskStatus === 'completed') continue;
        setStatuses((prev) =>
          prev[task.id] === 'completed' ? prev : { ...prev, [task.id]: 'completed' },
        );
        onboardingClient
          .upsertTask({ taskId: task.id, status: 'completed' })
          .catch(() => {
            // Keep the completed state in this session; a later event can retry.
          });
      }
    });
    return off;
  }, [tasks]);

  const launchTour = (taskId: string) => {
    const t = roleTasks.find((x) => x.id === taskId);
    if (!t?.tourId) return;
    start(t.tourId, undefined, 'checklist');
  };

  const dismiss = () => {
    // Mark every still-pending task as dismissed so the panel can stay hidden
    // (Phase 6 dismiss logic). Each is persisted fire-and-forget.
    setStatuses((prev) => {
      const next = { ...prev };
      for (const t of tasks) {
        if (next[t.id] !== 'completed') next[t.id] = 'dismissed';
      }
      return next;
    });
    for (const t of tasks) {
      if (t.taskStatus !== 'completed') {
        onboardingClient
          .upsertTask({ taskId: t.id, status: 'dismissed' })
          .catch(() => {});
      }
    }
  };

  return { tasks, total, completedCount, pct, loading, launchTour, dismiss };
}
