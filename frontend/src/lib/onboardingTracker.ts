/**
 * Batched onboarding-lifecycle analytics tracker (Phase 5).
 *
 * The TourControllerContext calls `track(...)` at every status transition; this
 * module batches events in memory and flushes them to `POST /api/onboarding/
 * events` periodically (5s), on tour end, and on `visibilitychange:hidden`.
 *
 * Contract:
 *   - NEVER throws into the tour UI (failures are swallowed + logged).
 *   - Queue is capped at 200 (drop oldest on overflow — analytics is
 *     best-effort, not a correctness-critical path).
 *   - Payloads carry only IDs/enums/durations — never amounts, customer names,
 *     or free text (PII-safe). The server filters on the closed
 *     `ONBOARDING_EVENT_NAMES` set regardless.
 */
import type {
  OnboardingEventName,
  TriggerSource,
} from '@tingting/shared';
import { api } from './api';

export interface TrackInput {
  eventName: OnboardingEventName;
  tourId?: string;
  tourVersion?: number;
  stepId?: string;
  routeKey?: string;
  durationMs?: number;
  triggerSource?: TriggerSource;
  targetFound?: boolean;
}

const MAX_QUEUE = 200;
const FLUSH_INTERVAL_MS = 5_000;

class OnboardingTracker {
  private queue: TrackInput[] = [];
  private timer: number | null = null;
  private flushing = false;
  private visibilityBound = false;

  /** Enqueue an event. Safe to call from render/handlers; never throws. */
  track(e: TrackInput): void {
    if (this.queue.length >= MAX_QUEUE) {
      // Drop oldest — bounded queue, best-effort analytics.
      this.queue.shift();
    }
    this.queue.push(e);
    this.ensureTimer();
  }

  /** Flush now (e.g. on tour end). Returns when the POST settles. */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue;
    this.queue = [];
    try {
      await api.post('/onboarding/events', { events: batch });
    } catch {
      // Keep the batch for the next flush (re-enqueue at the front, capped).
      this.queue = [...batch.slice(-MAX_QUEUE), ...this.queue].slice(0, MAX_QUEUE);
    } finally {
      this.flushing = false;
    }
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    if (typeof window === 'undefined') return;
    this.timer = window.setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }
}

/** Singleton tracker. Imported by TourControllerContext (Phase 5 instrumentation). */
export const onboardingTracker = new OnboardingTracker();
