import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LocationSample,
  type GeolocationError,
  CONTINUOUS_LOCATION_FRESH_MAX_AGE_MS,
  DEFAULT_REQUIRED_ACCURACY_METERS,
  DEFAULT_SUBMIT_TIMEOUT_MS,
  GEOLOCATION_PERMISSION_DENIED,
  createInaccurateGeolocationError,
  isFatalGeolocationError,
  isSampleSubmitReady,
  watchContinuousLocation,
} from '../lib/gps/geolocation';

/**
 * useGeolocation — warm-fix mobile GPS capture hook.
 *
 * Keeps a watchPosition fix warm while `enabled` (i.e. while a photo screen is
 * open) so the submit path is instant. Strategy (ported from payroll):
 *   - accuracy-pause: stop the watch once accuracy ≤ requiredAccuracyMeters;
 *     retain the sample for the freshness window (15s), then re-arm if still
 *     enabled.
 *   - visibility-pause: stop on document.hidden, clear the sample, require a
 *     fresh fix on resume (the user may have moved while backgrounded).
 *   - freshness-expiry: a timer flips isSubmitReady back to false the instant
 *     the retained sample's trust window lapses.
 *   - errors: permission-denied / unsupported are FATAL (stop + surface);
 *     transient errors are ignored (the watch keeps running).
 *
 * Submit path: prefer `sample` when `isSubmitReady`; otherwise call
 * `awaitAccurateSample()` to block for the next fresh, accurate fix.
 *
 * NOTE: not wired into any component yet — foundation module. The public surface
 * is ready for the M8.5/M9.5/M12.3 photo flows.
 */
export interface UseGeolocationOptions {
  enabled?: boolean;
  requiredAccuracyMeters?: number;
}
export interface UseGeolocationResult {
  sample: LocationSample | null;
  isWatching: boolean;
  /** A retained fix exists, is fresh, and meets the accuracy threshold. */
  isSubmitReady: boolean;
  fatalError: GeolocationError | null;
  /** Stop + restart the watch (e.g. after the user grants permission). */
  retry: () => void;
  /** Block until the next fresh accurate sample; rejects on timeout / fatal. */
  awaitAccurateSample: (timeoutMs?: number) => Promise<LocationSample>;
}

/** Silent cancellation when the watch is paused/restarted mid-await. */
class AbortedSubmitError extends Error {
  constructor() { super('Aborted'); this.name = 'AbortedSubmitError'; }
}

export function useGeolocation(options: UseGeolocationOptions = {}): UseGeolocationResult {
  const { enabled = true, requiredAccuracyMeters = DEFAULT_REQUIRED_ACCURACY_METERS } = options;

  const [sample, setSample] = useState<LocationSample | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [fatalError, setFatalError] = useState<GeolocationError | null>(null);

  // Epoch bumped by retry() to force a fresh watch lifecycle.
  const [epoch, setEpoch] = useState(0);
  // Re-render trigger for freshness-expiry (flips isSubmitReady at window end).
  const [, setFreshnessEpoch] = useState(0);

  const sampleRef = useRef<LocationSample | null>(null);
  const isWatchingRef = useRef(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const awaitersRef = useRef<Array<{ resolve: (s: LocationSample) => void; reject: (e: unknown) => void }>>([]);

  const stopWatch = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    isWatchingRef.current = false;
    setIsWatching(false);
  }, []);

  const rejectAwaiters = useCallback((err: unknown) => {
    const awaiters = awaitersRef.current;
    awaitersRef.current = [];
    for (const a of awaiters) a.reject(err);
  }, []);

  const startWatch = useCallback(() => {
    stopWatch();
    isWatchingRef.current = true;
    setIsWatching(true);
    unsubscribeRef.current = watchContinuousLocation({
      onSample: (next) => {
        sampleRef.current = next;
        setSample(next);
        // accuracy-pause: stop once good enough; retain the sample for 15s.
        if (next.accuracy <= requiredAccuracyMeters) {
          isWatchingRef.current = false;
          setIsWatching(false);
          if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null; }
        }
        // Resolve any cold-tap awaiters waiting for an accurate fix.
        if (next.accuracy <= requiredAccuracyMeters) {
          const awaiters = awaitersRef.current;
          awaitersRef.current = [];
          for (const a of awaiters) a.resolve(next);
        }
      },
      onError: (err) => {
        if (isFatalGeolocationError(err) || err.code === GEOLOCATION_PERMISSION_DENIED) {
          isWatchingRef.current = false;
          setIsWatching(false);
          setFatalError(err);
          if (unsubscribeRef.current) { unsubscribeRef.current(); unsubscribeRef.current = null; }
          rejectAwaiters(err);
        }
        // Transient errors (unavailable/timeout) are ignored: the watch keeps
        // running and the next fix updates state.
      },
    });
  }, [requiredAccuracyMeters, stopWatch, rejectAwaiters]);

  // Watch lifecycle: start when enabled + visible; stop + clear otherwise.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // iOS suspends the PWA anyway; stop promptly and require a fresh fix on
        // resume (the user may have moved while backgrounded).
        stopWatch();
        sampleRef.current = null;
        setSample(null);
        setFatalError(null);
        rejectAwaiters(new AbortedSubmitError());
      } else if (enabled) {
        setFatalError(null);
        startWatch();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, startWatch, stopWatch, rejectAwaiters]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined' || document.visibilityState === 'hidden') {
      stopWatch();
      sampleRef.current = null;
      setSample(null);
      setFatalError(null);
      rejectAwaiters(new AbortedSubmitError());
      return;
    }
    setFatalError(null);
    startWatch();
    return () => { stopWatch(); };
    // epoch is the retry knob — include it so retry() restarts cleanly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, epoch]);

  // Freshness-expiry: flip isSubmitReady the instant the retained sample's
  // 15s trust window lapses (and re-arm the watch so a new fix is acquired).
  useEffect(() => {
    if (!sample) return;
    const remainingMs = sample.timestamp + CONTINUOUS_LOCATION_FRESH_MAX_AGE_MS - Date.now();
    if (remainingMs <= 0) {
      // Already stale — re-arm if enabled so a fresh fix replaces it.
      if (enabled && !isWatchingRef.current && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        startWatch();
      }
      return;
    }
    const timer = setTimeout(() => {
      setFreshnessEpoch((e) => e + 1);
      // Re-arm the watch for the next fix when the window lapses.
      if (enabled && !isWatchingRef.current && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        startWatch();
      }
    }, remainingMs);
    return () => clearTimeout(timer);
  }, [sample, enabled, startWatch]);

  const retry = useCallback(() => {
    setFatalError(null);
    stopWatch();
    setEpoch((e) => e + 1);
  }, [stopWatch]);

  const awaitAccurateSample = useCallback(
    (timeoutMs: number = DEFAULT_SUBMIT_TIMEOUT_MS) =>
      new Promise<LocationSample>((resolve, reject) => {
        // Warm path: a fresh, accurate sample already exists.
        if (isSampleSubmitReady(sampleRef.current, requiredAccuracyMeters)) {
          resolve(sampleRef.current!);
          return;
        }
        // Ensure the watch is running for the cold path.
        if (!isWatchingRef.current && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
          startWatch();
        }
        const timer = setTimeout(() => {
          awaitersRef.current = awaitersRef.current.filter((a) => a.resolve !== resolve);
          reject(createInaccurateGeolocationError(sampleRef.current?.accuracy, requiredAccuracyMeters));
        }, timeoutMs);
        const wrappedResolve = (s: LocationSample) => { clearTimeout(timer); resolve(s); };
        const wrappedReject = (e: unknown) => { clearTimeout(timer); reject(e); };
        awaitersRef.current.push({ resolve: wrappedResolve, reject: wrappedReject });
      }),
    [requiredAccuracyMeters, startWatch],
  );

  return {
    sample,
    isWatching,
    isSubmitReady: isSampleSubmitReady(sample, requiredAccuracyMeters),
    fatalError,
    retry,
    awaitAccurateSample,
  };
}
