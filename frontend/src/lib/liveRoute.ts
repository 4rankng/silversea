import { decodePolyline } from './maps';
import type { LiveFleetLeg, LoadingType } from '@tingting/shared';

/**
 * Detect a truck's current route leg and the remaining path to its destination.
 *
 * The crux (đi vs về): a round trip retraces the same road, so the truck is
 * geometrically close to BOTH the outbound and return legs. We resolve it with
 * the truck's GPS heading — among the nearest candidate legs, pick the one whose
 * travel bearing best matches the heading. The chosen leg's `loadingType` then
 * labels đi (HANG) vs về (VO).
 *
 * Distances for leg selection use a planar degree approximation (only needed for
 * comparison); the reported distance-to-destination is a true haversine km.
 */

export interface RemainingRoute {
  legIndex: number;
  loadingType: LoadingType;
  destinationName: string;
  destinationPoint: [number, number] | null;
  /** Polyline points from the truck's projection to the destination. */
  remainingPath: [number, number][];
  /** Straight-line km from the truck to the destination. */
  distanceKm: number;
}

const R = 6371; // earth radius, km
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Compass bearing a→b in degrees (0 = north, clockwise). */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

interface LegScore {
  legIndex: number;
  loadingType: LoadingType;
  destinationName: string;
  minD2: number;
  segIndex: number;
  closest: [number, number];
  bearing: number;
  points: [number, number][];
}

export function computeRemainingRoute(
  lat: number,
  lng: number,
  heading: number | undefined,
  legs: LiveFleetLeg[] | undefined,
): RemainingRoute | null {
  if (!legs || legs.length === 0) return null;

  const scores: LegScore[] = [];
  legs.forEach((leg, legIndex) => {
    if (!leg.polylinePath) return;
    const pts = decodePolyline(leg.polylinePath) as [number, number][];
    if (pts.length < 2) return;

    let bestD2 = Infinity;
    let bestI = 0;
    let bestClosest: [number, number] = pts[0];
    let bestBearing = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b[1] - a[1];
      const dy = b[0] - a[0];
      const denom = dx * dx + dy * dy;
      const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((lng - a[1]) * dx + (lat - a[0]) * dy) / denom));
      const c: [number, number] = [a[0] + t * dy, a[1] + t * dx];
      const d2 = (lat - c[0]) ** 2 + (lng - c[1]) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestI = i;
        bestClosest = c;
        bestBearing = bearingDeg(a, b);
      }
    }
    scores.push({
      legIndex,
      loadingType: leg.loadingType,
      destinationName: leg.destination,
      minD2: bestD2,
      segIndex: bestI,
      closest: bestClosest,
      bearing: bestBearing,
      points: pts,
    });
  });

  if (scores.length === 0) return null;

  const minD2 = Math.min(...scores.map((s) => s.minD2));
  // Candidate legs: within ~2× the nearest distance (handles GPS jitter + roads
  // that briefly diverge/merge). Among these, heading breaks the tie.
  const threshold = minD2 * 4 + 1e-9;
  const candidates = scores.filter((s) => s.minD2 <= threshold);
  let chosen = candidates[0];
  if (heading !== undefined && heading >= 0 && candidates.length > 1) {
    chosen = candidates.reduce((best, s) =>
      angularDiff(heading, s.bearing) < angularDiff(heading, best.bearing) ? s : best,
      candidates[0],
    );
  }

  const destPoint = chosen.points[chosen.points.length - 1];
  const remainingPath = [chosen.closest, ...chosen.points.slice(chosen.segIndex + 1)];
  return {
    legIndex: chosen.legIndex,
    loadingType: chosen.loadingType,
    destinationName: chosen.destinationName,
    destinationPoint: destPoint,
    remainingPath,
    distanceKm: haversineKm([lat, lng], destPoint),
  };
}
