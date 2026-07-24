// TourControllerContext — the tour "engine": holds the active tour + current
// step, drives each step's directive via `sendAndWait` (the async directive
// entrypoint), persists progress to localStorage, and (Phase 3) waits for real
// business events to auto-advance interaction steps.
//
// State machine (Phase 3 — explicit TourStatus):
//   start (resets to step 0, or a resume step)
//     → showing (explain/navigate step; spotlight up; manual Next)
//     → waiting_for_action (interaction step; waiting for completionEvent)
//     → target_missing (recovery UX: retry / skip-step)
//   next/prev → advance (or complete on last step)
//   complete (last step or "Xong") / skip ("Bỏ qua")
// start() replaces any active tour (concurrent-tour guard) and records a
// `triggerSource` ('manual' | 'chatbot' | 'checklist') for Phase 5 analytics.
// The tourActive singleton flag (agentHighlight) is set on start and cleared on
// end, so the chat directive path suppresses its own spotlight while a tour
// owns it.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { TOUR_CATALOG, TOUR_IDS, Role, type Tour, type TourId, type ProductEventName } from '@tingting/shared';
import { useAgentDirectives } from './AgentDirectiveContext';
import { useAuth } from '../hooks/useAuth';
import { setTourActive } from '../lib/agentHighlight';
import { onboardingEvents } from '../lib/onboardingEvents';
import { onboardingTracker } from '../lib/onboardingTracker';
import {
  getInProgressStep,
  getUpdatedAt,
  markTourStep,
  markTourCompleted,
  clearTourProgress,
} from '../lib/tourProgress';
import { onboardingClient } from '../api/onboardingClient';

/** Who/what started the tour — recorded for Phase 5 lifecycle analytics. */
export type TourTriggerSource = 'manual' | 'chatbot' | 'checklist';

/**
 * Explicit tour lifecycle status (Phase 3). The pre-refactor context tracked
 * this implicitly via `(tour, currentStep, highlightMissed)`; surfacing it lets
 * the controller render distinct UX for interaction steps and missing targets.
 *
 * `idle` = no tour active (also the value when a resume prompt is pending but
 * no tour has started yet this session).
 */
export type TourStatus =
  | 'idle'
  | 'showing'
  | 'waiting_for_action'
  | 'target_missing'
  | 'completed'
  | 'skipped';

export interface TourControllerValue {
  tour: Tour | null;
  currentStep: number;
  /** True when the current step's spotlight target never mounted (graceful
   *  degradation note shown; the tour still advances). Retained for any caller
   *  that read the pre-Phase-3 boolean. */
  highlightMissed: boolean;
  /** Explicit lifecycle status (Phase 3). */
  status: TourStatus;
  /** Who started the active tour (Phase 5 analytics origin). */
  triggerSource: TourTriggerSource;
  /** A tour left in_progress before a refresh whose role still applies. */
  resumable: Tour | null;
  start: (tourId: string, resumeStep?: number, triggerSource?: TourTriggerSource) => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  complete: () => void;
  /** Manual escape for a waiting_for_action step (the user clicked "I did it"). */
  manualAdvance: () => void;
  /** Re-attempt spotlight resolution for the current step's target. */
  retryTarget: () => void;
  /** Phase 7: cancel the active tour (chatbot cancel_tour). */
  cancel: () => void;
  dismissResume: () => void;
}

const TourControllerContext = createContext<TourControllerValue | null>(null);

export function useTourController(): TourControllerValue {
  const ctx = useContext(TourControllerContext);
  if (!ctx) throw new Error('useTourController must be used within TourControllerProvider');
  return ctx;
}

export function TourControllerProvider({ children }: { children: ReactNode }) {
  const { sendAndWait } = useAgentDirectives();
  const { user } = useAuth();
  const [tour, setTour] = useState<Tour | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [highlightMissed, setHighlightMissed] = useState(false);
  const [status, setStatus] = useState<TourStatus>('idle');
  const [triggerSource, setTriggerSource] = useState<TourTriggerSource>('manual');
  const [resumable, setResumable] = useState<Tour | null>(null);
  /** Bumped to force the step-drive effect to re-resolve the target (retry). */
  const [retryNonce, setRetryNonce] = useState(0);
  /** Tracks the active waitFor subscription so a stale resolve can't advance. */
  const waitGeneration = useRef(0);

  const roleOk = useCallback(
    // No known user (still loading / logged out) → refuse rather than default-allow:
    // a curated tour must never start without a confirmed role.
    (t: Tour) => (user ? (t.roles as readonly Role[]).includes(user.role) : false),
    [user],
  );

  // Resume-on-refresh: on mount (once the user is known), surface a tour left
  // in_progress whose role still applies. The TourController shows "Tiếp tục?".
  useEffect(() => {
    if (!user) return;
    for (const id of TOUR_IDS) {
      const t = TOUR_CATALOG[id];
      if (getInProgressStep(id, t.version) !== null && (t.roles as readonly Role[]).includes(user.role)) {
        setResumable(t);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId]);

  const advance = useCallback(
    (dir: 1 | -1) => {
      setCurrentStep((step) => {
        if (!tour) return step;
        const nextStep = step + dir;
        if (nextStep < 0) return step;
        if (nextStep > tour.steps.length - 1) {
          // Past the last step → complete.
          markTourCompleted(tour.id, tour.version);
          onboardingClient
            .upsertProgress({
              tourId: tour.id,
              tourVersion: tour.version,
              currentStepId: String(step),
              status: 'completed',
            })
            .catch(() => {
              // Non-blocking: localStorage is the cache of record on failure.
            });
          // Phase 5 analytics: the tour reached its natural end.
          onboardingTracker.track({
            eventName: 'onboarding_tour_completed',
            tourId: tour.id,
            tourVersion: tour.version,
            stepId: String(step),
          });
          onboardingTracker.flush();
          onboardingEvents.emit('tour.completed', { tourId: tour.id });
          setTourActive(false);
          setStatus('completed');
          setTour(null);
          return step;
        }
        return nextStep;
      });
    },
    [tour],
  );

  // Drive the current step's directive whenever the step (or retry nonce)
  // changes. Awaits the target mounting so the spotlight lands; on a missing
  // target, transitions to target_missing (Phase 3 recovery UX). Then, if the
  // step is an interaction step, subscribes to its completionEvent.
  useEffect(() => {
    if (!tour) return;
    markTourStep(tour.id, tour.version, currentStep);
    const step = tour.steps[currentStep];
    let cancelled = false;
    // Invalidate any prior waitFor subscription so a slow resolve from the
    // previous step can't advance this one.
    const myGen = ++waitGeneration.current;

    let cancelEventWait: (() => void) | undefined;
    const drive = async () => {
      // Phase 5 analytics: a step was viewed (timed for duration-on-step).
      const viewedAt = Date.now();
      onboardingTracker.track({
        eventName: 'onboarding_step_viewed',
        tourId: tour.id,
        tourVersion: tour.version,
        stepId: String(currentStep),
      });

      // Subscribe first: an API action may resolve while route/highlight work is
      // still in flight. Teardown prevents a stale step from advancing later.
      const eventPromise = step?.completionEvent
        ? new Promise<unknown>((resolve) => {
          cancelEventWait = onboardingEvents.once(step.completionEvent as ProductEventName, resolve);
        })
        : undefined;

      // 1. Drive the directive (spotlight / navigate). Text-only steps skip this.
      if (step?.directive) {
        const outcome = await sendAndWait(step.directive);
        if (cancelled) return;
        if (outcome.reason === 'highlight-missed') {
          setHighlightMissed(true);
          setStatus('target_missing');
          onboardingTracker.track({
            eventName: 'onboarding_target_missing',
            tourId: tour.id,
            tourVersion: tour.version,
            stepId: String(currentStep),
            targetFound: false,
          });
          cancelEventWait?.();
          return; // Recovery panel shown; no auto-advance until user acts.
        }
        setHighlightMissed(false);
      } else {
        setHighlightMissed(false);
      }

      // 2. Interaction step: wait for the real business event.
      if (step?.completionEvent) {
        setStatus('waiting_for_action');
        const timeoutMs = step.completionTimeoutMs ?? 0; // 0 = wait forever
        // `completionEvent` is typed as a widened string (the Zod enum is cast
        // through a `[string, ...string[]]` head); the catalog test guarantees
        // it is a member of PRODUCT_EVENTS, so the cast to ProductEventName is safe.
        const payload = timeoutMs > 0
          ? await Promise.race([eventPromise!, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs))])
          : await eventPromise!;
        if (cancelled || myGen !== waitGeneration.current) return;
        if (payload !== null) {
          // Event fired → auto-advance to the next step + record it.
          onboardingTracker.track({
            eventName: 'onboarding_action_completed',
            tourId: tour.id,
            tourVersion: tour.version,
            stepId: String(currentStep),
            durationMs: Date.now() - viewedAt,
          });
          advance(1);
        }
        // payload === null means we timed out. Per Phase 3 policy we do NOT
        // force-advance; the user uses the manual-fallback button. Stay in
        // waiting_for_action.
        return;
      }

      // 3. Explain/navigate step: just showing.
      setStatus('showing');
    };

    void drive();
    return () => {
      cancelled = true;
      cancelEventWait?.();
    };
  }, [tour, currentStep, sendAndWait, retryNonce, advance]);

  // ── Phase 4: server write-through (debounced, non-blocking) ───────────────
  // Mirror each step change to the server so progress is cross-device and the
  // source of truth. Debounced 1.5s so rapid Next clicks don't spam writes.
  // Failures are swallowed + logged — the localStorage cache holds state and a
  // later step change retries; the tour NEVER blocks on a server write.
  useEffect(() => {
    if (!tour) return;
    const handle = window.setTimeout(() => {
      onboardingClient
        .upsertProgress({
          tourId: tour.id,
          tourVersion: tour.version,
          currentStepId: String(currentStep),
          status: 'in_progress',
        })
        .catch(() => {
          // Non-blocking: localStorage cache already holds the freshest step.
          // A subsequent step change re-attempts.
        });
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [tour, currentStep]);

  const start = useCallback(
    (tourId: string, resumeStep?: number, source: TourTriggerSource = 'manual') => {
      const t = TOUR_CATALOG[tourId as TourId];
      if (!t || !roleOk(t)) return;
      // Admin master switch: refuse to start a tour when the onboarding
      // tutorial is disabled app-wide. Defaults to enabled while undefined.
      if (user?.onboardingEnabled === false) return;
      // Replacing another active tour, or leaving a stale in_progress record
      // from a dismissed resume prompt: clear every OTHER tour's in_progress
      // record so the resume-on-refresh scan can't resurrect a tour we just
      // left. Only the tour we're starting may keep its progress.
      for (const id of TOUR_IDS) {
        if (id !== t.id && getInProgressStep(id, TOUR_CATALOG[id].version) !== null) clearTourProgress(id, TOUR_CATALOG[id].version);
      }
      setResumable(null);
      setHighlightMissed(false);
      setTriggerSource(source);
      setTour(t);
      setCurrentStep(Math.max(0, Math.min(resumeStep ?? 0, t.steps.length - 1)));
      setStatus('showing');
      setTourActive(true);
      // Phase 5 analytics: a tour started.
      onboardingTracker.track({
        eventName: 'onboarding_tour_started',
        tourId: t.id,
        tourVersion: t.version,
        stepId: '0',
        triggerSource: source,
      });

      // Phase 4 reconcile: best-effort fetch the server's progress for this
      // tour+version and prefer whichever side is fresher (by server
      // updatedAt). Non-blocking — if the fetch fails or is slow, the tour
      // proceeds from the local cache and the debounced write-through pushes
      // the local state up on the next step change.
      void onboardingClient
        .getProgress()
        .then((rows) => {
          const serverRow = rows.find(
            (r) => r.tourId === t.id && r.tourVersion === t.version,
          );
          if (!serverRow) return; // server has no row → local wins, push later.
          const serverUpdated = Date.parse(serverRow.updatedAt) || 0;
          const localUpdated = getUpdatedAt(t.id, t.version);
          if (serverUpdated > localUpdated && serverRow.status === 'in_progress') {
            const serverStep = serverRow.currentStepId ? Number(serverRow.currentStepId) : 0;
            if (Number.isFinite(serverStep)) {
              setCurrentStep(Math.max(0, Math.min(serverStep, t.steps.length - 1)));
            }
          }
        })
        .catch(() => {
          // Reconcile is best-effort; ignore network/permission failures.
        });
    },
    [roleOk],
  );

  const next = useCallback(() => advance(1), [advance]);

  const prev = useCallback(() => {
    if (!tour || currentStep === 0) return;
    setCurrentStep(currentStep - 1);
  }, [tour, currentStep]);

  const end = useCallback(
    (completed: boolean) => {
      if (!tour) return;
      if (completed) markTourCompleted(tour.id, tour.version);
      else clearTourProgress(tour.id, tour.version);
      // Phase 4: push the terminal status to the server (fire-and-forget).
      // Skipped is recorded as 'skipped' so analytics/abandonment can read it.
      onboardingClient
        .upsertProgress({
          tourId: tour.id,
          tourVersion: tour.version,
          currentStepId: String(currentStep),
          status: completed ? 'completed' : 'skipped',
        })
        .catch(() => {
          // Non-blocking: localStorage is the cache of record on failure.
        });
      setTourActive(false);
      if (completed) onboardingEvents.emit('tour.completed', { tourId: tour.id });
      setTour(null);
      setStatus(completed ? 'completed' : 'skipped');
      setHighlightMissed(false);
      // Phase 5 analytics: the tour ended either by completion or abandonment.
      onboardingTracker.track({
        eventName: completed ? 'onboarding_tour_completed' : 'onboarding_tour_abandoned',
        tourId: tour.id,
        tourVersion: tour.version,
        stepId: String(currentStep),
        triggerSource,
      });
      onboardingTracker.flush();
    },
    [tour, currentStep, triggerSource],
  );

  const skip = useCallback(() => end(false), [end]);
  const complete = useCallback(() => end(true), [end]);
  /** Manual escape from a waiting_for_action step — advances to the next step. */
  const manualAdvance = useCallback(() => advance(1), [advance]);
  /** Re-resolve the current step's spotlight target (re-bump the drive effect). */
  const retryTarget = useCallback(() => setRetryNonce((n) => n + 1), []);
  /** Phase 7: cancel the active tour (chatbot cancel_tour). Same as skip but
   *  semantically distinct for analytics. */
  const cancel = useCallback(() => end(false), [end]);
  const dismissResume = useCallback(() => setResumable(null), []);

  const value: TourControllerValue = {
    tour,
    currentStep,
    highlightMissed,
    status,
    triggerSource,
    resumable,
    start,
    next,
    prev,
    skip,
    complete,
    manualAdvance,
    retryTarget,
    cancel,
    dismissResume,
  };

  return (
    <TourControllerContext.Provider value={value}>{children}</TourControllerContext.Provider>
  );
}
