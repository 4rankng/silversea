import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useGeolocation } from './useGeolocation';
import { GEOLOCATION_PERMISSION_DENIED, type LocationSample } from '../lib/gps/geolocation';

/**
 * useGeolocation warm-fix capture tests. navigator.geolocation is mocked per
 * test so the hook's watch lifecycle (warm fix → isSubmitReady; visibility-pause;
 * fatal permission-denied) is deterministic without real GPS hardware.
 */

type GeoCB = (pos: GeolocationPosition) => void;
type ErrCB = (err: GeolocationPositionError) => void;

interface MockWatch {
  success: GeoCB;
  error: ErrCB;
  options?: PositionOptions;
}

function makePosition(lat: number, lng: number, accuracy: number, ageMs = 0): GeolocationPosition {
  return {
    coords: { latitude: lat, longitude: lng, accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null } as GeolocationCoordinates,
    timestamp: Date.now() - ageMs,
    toJSON() { return this; },
  } as GeolocationPosition;
}

function makeError(code: number): GeolocationPositionError {
  return { code, message: '', name: 'GeolocationPositionError', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

let watchMock: MockWatch | null = null;

function installGeolocation() {
  watchMock = null;
  const watchPosition = vi.fn((success: GeoCB, error: ErrCB, options?: PositionOptions) => {
    watchMock = { success, error, options };
    return 1; // watchId
  });
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition, clearWatch, getCurrentPosition: vi.fn() },
  });
  return { watchPosition, clearWatch };
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom defaults to document.visibilityState === 'visible'.
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  vi.useRealTimers();
  watchMock = null;
});

describe('useGeolocation', () => {
  it('warms a fix and flips isSubmitReady true once accuracy meets the threshold', () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    // Accurate fix arrives → sample stored + submit-ready + watch paused.
    act(() => {
      watchMock!.success(makePosition(10.78, 106.69, 12));
    });
    expect(result.current.sample).not.toBeNull();
    expect(result.current.sample!.lat).toBe(10.78);
    expect(result.current.isSubmitReady).toBe(true);
    expect(result.current.isWatching).toBe(false); // accuracy-paused
  });

  it('is NOT submit-ready while accuracy exceeds the threshold', () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    act(() => {
      watchMock!.success(makePosition(10.78, 106.69, 120));
    });
    expect(result.current.sample).not.toBeNull();
    expect(result.current.isSubmitReady).toBe(false);
    expect(result.current.isWatching).toBe(true); // still watching for a better fix
  });

  it('flips isSubmitReady to false when the freshness window (15s) lapses', () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    act(() => {
      watchMock!.success(makePosition(10.78, 106.69, 12));
    });
    expect(result.current.isSubmitReady).toBe(true);
    // Advance past the 15s freshness window.
    act(() => { vi.advanceTimersByTime(16_000); });
    expect(result.current.isSubmitReady).toBe(false);
  });

  it('stops the watch and clears the sample on visibility hidden', () => {
    const { clearWatch } = installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    act(() => { watchMock!.success(makePosition(10.78, 106.69, 12)); });
    expect(result.current.sample).not.toBeNull();

    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.sample).toBeNull();
    expect(result.current.isWatching).toBe(false);
    expect(clearWatch).toHaveBeenCalled();
  });

  it('treats permission-denied as fatal (surfaces fatalError, stops watching)', () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    act(() => { watchMock!.error(makeError(GEOLOCATION_PERMISSION_DENIED)); });
    expect(result.current.fatalError).not.toBeNull();
    expect(result.current.fatalError!.code).toBe(GEOLOCATION_PERMISSION_DENIED);
    expect(result.current.isWatching).toBe(false);
  });

  it('awaitAccurateSample resolves immediately on the warm path', async () => {
    installGeolocation();
    const { result } = renderHook(() => useGeolocation({ requiredAccuracyMeters: 50 }));
    act(() => { watchMock!.success(makePosition(10.78, 106.69, 12)); });
    let resolved: unknown = 'pending';
    await act(async () => {
      result.current.awaitAccurateSample().then((s) => { resolved = s; }).catch(() => { resolved = 'rejected'; });
    });
    expect((resolved as LocationSample).lat).toBe(10.78);
  });
});
