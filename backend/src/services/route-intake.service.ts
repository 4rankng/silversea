import { Role, type RouteInput } from '@tingting/shared';

/**
 * CUS and Dispatchers may create a missing route from shipment intake, but
 * they are not route-cost administrators. Keep their raw HTTP payload from
 * setting fuel, toll, salary, terrain, or default-leg configuration.
 */
export function restrictRouteCreateForIntake(data: RouteInput, role: Role): RouteInput {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  return {
    name: data.name,
    shortName: data.shortName?.trim() || data.name.trim(),
    distanceKm: data.distanceKm,
    isMountain: false,
  };
}
