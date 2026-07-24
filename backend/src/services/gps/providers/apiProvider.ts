import { config } from '../../../config';
import { parseBachKhoaResponse } from '@tingting/shared';
import type { BachKhoaVehicle } from '@tingting/shared';
import { parseBachKhoaDate } from '../parse';
import { getGpsSettings } from '../settings';
import type { GpsProvider, NormalizedGpsVehicle } from './types';

/**
 * Documented public API source: GET /BachKhoaAPI/GetInfoCar?username=&password=.
 * Stateless — credentials travel in the querystring (so never log the URL).
 * Needs the vendor's API-gateway access enabled on the account; otherwise the
 * provider returns an empty array and the `auto` selector falls back to portal.
 */
function mapApiVehicle(v: BachKhoaVehicle): NormalizedGpsVehicle {
  const carStatus = (v.CarStatus ?? '').toLowerCase();
  return {
    numberPlate: v.NumberPlate,
    deviceId: v.DeviceID,
    driverName: v.DriverName,
    lat: v.Lt,
    lng: v.Ln,
    speed: v.Speed,
    angle: v.Angle,
    address: v.Address,
    ignitionOn: (v.Acc ?? '').toLowerCase().includes('bật'),
    fuel: v.Oil && v.Oil > 0 ? v.Oil : null,
    lastSeenAt: parseBachKhoaDate(v.Date),
    lostSignal: carStatus.includes('mất tín'),
  };
}

export const apiProvider: GpsProvider = {
  name: 'api',
  isConfigured: async () => {
    const settings = await getGpsSettings();
    return !!(settings.username && settings.password);
  },
  async fetchVehicles(): Promise<NormalizedGpsVehicle[]> {
    const settings = await getGpsSettings();
    if (!settings.username || !settings.password) return [];

    const base = config.bachKhoaApiUrl.endsWith('/')
      ? config.bachKhoaApiUrl
      : `${config.bachKhoaApiUrl}/`;
    const url = new URL('GetInfoCar', base);
    url.searchParams.set('username', settings.username);
    url.searchParams.set('password', settings.password);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.bachKhoaTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        // Status only — credentials are in the querystring, never log the URL.
        console.error(`[gps][api] GetInfoCar → HTTP ${res.status}`);
        return [];
      }
      return parseBachKhoaResponse(await res.json()).map(mapApiVehicle);
    } catch (err) {
      console.error('[gps][api] GetInfoCar fetch failed:', err instanceof Error ? err.message : err);
      return [];
    } finally {
      clearTimeout(timer);
    }
  },
};
