/**
 * Provider-neutral vehicle reading. Each GPS source (public API, web portal)
 * maps its raw response into this shape so the rest of the service — cache,
 * trip join, response — is agnostic to where the data came from.
 */
import type { LiveFleetDetails } from '@tingting/shared';

export interface NormalizedGpsVehicle {
  numberPlate: string;
  deviceId: string | null;
  /** Portal CarID — the key the report endpoints expect (null from the public API). */
  carId?: number | null;
  driverName: string | null;
  lat: number;
  lng: number;
  speed: number;
  angle: number;
  address: string | null;
  ignitionOn: boolean;
  fuel: number | null;
  lastSeenAt: Date | null;
  /** Device reports no GPS/signal (e.g. "Mất tín hiệu" / GPSStatus=false). */
  lostSignal: boolean;
  /** Extended telemetry (portal only); null when the public API is the source. */
  details?: LiveFleetDetails | null;
}

/**
 * A GPS data source behind a common interface. `isConfigured` lets the selector
 * skip a provider whose credentials aren't set without making a failing call.
 */
export interface GpsProvider {
  readonly name: string;
  isConfigured(): Promise<boolean>;
  fetchVehicles(): Promise<NormalizedGpsVehicle[]>;
}
