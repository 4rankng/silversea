/**
 * Mobile GPS capture — pure utilities.
 *
 * Ports the proven capture layer from the payroll reference (a different stack:
 * Go/Gin/MySQL) as stack-agnostic TypeScript. Two-tier strategy:
 *   1. A warm watchPosition fix is kept while the app/photo screen is open, so
 *      the submit tap is instant (no 3–10s cold-fix spinner).
 *   2. The watch self-pauses once accuracy meets the threshold (battery), and
 *      pauses on tab-hidden (iOS suspends the PWA anyway; require a fresh fix
 *      on resume before the sample is trusted again).
 *
 * All user-facing strings are Vietnamese (module rule M0X-HT-01).
 */

/** A trusted device fix. `timestamp` is epoch-ms from GeolocationPosition.timestamp. */
export interface LocationSample {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
}

/** Trust window for a retained fix — a sample older than this is no longer submit-ready. */
export const CONTINUOUS_LOCATION_FRESH_MAX_AGE_MS = 15_000;

/** Accuracy good enough to stop the watch + mark submit-ready. */
export const DEFAULT_REQUIRED_ACCURACY_METERS = 50;

/** Total budget for a cold-tap acquire (awaitAccurateSample). */
export const DEFAULT_SUBMIT_TIMEOUT_MS = 30_000;

/** Geolocation error codes (mirrors GeolocationPositionErrorCode + a synthetic one). */
export const GEOLOCATION_PERMISSION_DENIED = 1;
export const GEOLOCATION_POSITION_UNAVAILABLE = 2;
export const GEOLOCATION_TIMEOUT = 3;
export const GEOLOCATION_UNSUPPORTED = 0;
/** Synthetic: fix acquired but accuracy never met the threshold. */
export const GEOLOCATION_INACCURATE = 4;

export interface GeolocationError extends Error {
  code: number;
  accuracy?: number;
  requiredAccuracy?: number;
}

/** Runtime guard for errors shaped like a GeolocationPositionError (code: number). */
export function isGeolocationError(error: unknown): error is GeolocationError {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof (error as { code: unknown }).code === 'number';
}

export function createGeolocationError(code: number, message: string): GeolocationError {
  const err = new Error(message) as GeolocationError;
  err.code = code;
  err.name = 'GeolocationError';
  return err;
}

/** Synthetic error when the timeout fires but accuracy never met the threshold. */
export function createInaccurateGeolocationError(
  accuracy?: number,
  requiredAccuracy?: number,
): GeolocationError {
  const err = createGeolocationError(GEOLOCATION_INACCURATE, 'Tín hiệu GPS không đủ chính xác');
  err.accuracy = accuracy;
  err.requiredAccuracy = requiredAccuracy;
  return err;
}

/**
 * Is this error fatal (watch must stop + user must act) vs transient (ignore;
 * the next fix updates state)?
 *   - permission-denied: FATAL — recovery requires the user to grant location
 *     in OS settings, then tap retry.
 *   - position-unavailable / timeout: transient — ignored; the watch keeps
 *     running and the next fix wins.
 *   - unsupported: FATAL (no GPS hardware at all).
 *   - inaccurate: FATAL for a cold-tap await, but the warm watch just keeps
 *     going (the hook treats it as transient during warm acquire).
 */
export function isFatalGeolocationError(err: GeolocationError): boolean {
  return (
    err.code === GEOLOCATION_PERMISSION_DENIED
    || err.code === GEOLOCATION_UNSUPPORTED
  );
}

/** A retained sample is submit-ready if it is fresh AND accurate enough. */
export function isSampleSubmitReady(
  sample: LocationSample | null,
  requiredAccuracyMeters: number,
  now: number = Date.now(),
): boolean {
  if (!sample) return false;
  const fresh = now - sample.timestamp <= CONTINUOUS_LOCATION_FRESH_MAX_AGE_MS;
  return fresh && sample.accuracy <= requiredAccuracyMeters;
}

/**
 * Start a continuous watchPosition. Returns an unsubscribe() that clears the
 * watch. enableHighAccuracy + maximumAge 15s matches the payroll reference — a
 * browser-side `timeout` was deliberately omitted there because it pre-empted
 * slow cold GNSS fixes (the outer submit-timeout governs total wait instead).
 */
export interface WatchHandlers {
  onSample: (sample: LocationSample) => void;
  onError: (err: GeolocationError) => void;
}
export function watchContinuousLocation(handlers: WatchHandlers): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    handlers.onError(createGeolocationError(GEOLOCATION_UNSUPPORTED, 'Thiết bị không hỗ trợ GPS'));
    return () => {};
  }
  let watchId: number | null = null;
  try {
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        handlers.onSample({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        });
      },
      (error) => {
        handlers.onError(createGeolocationError(error.code, geolocationErrorMessage(error.code)));
      },
      { enableHighAccuracy: true, maximumAge: CONTINUOUS_LOCATION_FRESH_MAX_AGE_MS },
    );
  } catch {
    handlers.onError(createGeolocationError(GEOLOCATION_UNSUPPORTED, 'Thiết bị không hỗ trợ GPS'));
  }
  return () => {
    if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
  };
}

function geolocationErrorMessage(code: number): string {
  switch (code) {
    case GEOLOCATION_PERMISSION_DENIED: return 'Ứng dụng chưa được cấp quyền truy cập vị trí';
    case GEOLOCATION_POSITION_UNAVAILABLE: return 'Chưa bắt được GPS';
    case GEOLOCATION_TIMEOUT: return 'GPS phản hồi chậm';
    default: return 'Không lấy được vị trí';
  }
}

export type LocationPermissionIssueType = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'inaccurate';
export interface LocationPermissionIssue {
  type: LocationPermissionIssueType;
  title: string;
  /** Recovery is possible in-app (retry) without leaving the app. */
  canRetry: boolean;
  /** Recovery requires opening OS settings (permission grant). */
  requiresSettings: boolean;
}

/** Map a geolocation error to a user-facing Vietnamese issue. */
export function getLocationPermissionIssue(err: GeolocationError): LocationPermissionIssue {
  switch (err.code) {
    case GEOLOCATION_UNSUPPORTED:
      return { type: 'unsupported', title: 'Thiết bị không hỗ trợ GPS', canRetry: false, requiresSettings: false };
    case GEOLOCATION_PERMISSION_DENIED:
      return { type: 'denied', title: 'Cho phép truy cập vị trí', canRetry: true, requiresSettings: true };
    case GEOLOCATION_POSITION_UNAVAILABLE:
      return { type: 'unavailable', title: 'Chưa bắt được GPS', canRetry: true, requiresSettings: false };
    case GEOLOCATION_TIMEOUT:
      return { type: 'timeout', title: 'GPS phản hồi chậm', canRetry: true, requiresSettings: false };
    default:
      return { type: 'inaccurate', title: 'Chưa đạt độ chính xác GPS', canRetry: true, requiresSettings: false };
  }
}
