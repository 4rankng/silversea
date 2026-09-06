import { Role, type RouteInput } from '@tingting/shared';

const INTAKE_ROUTE_KEYS = new Set(['name', 'shortName', 'distanceKm', 'code', 'loadPoint', 'note']);

/**
 * CUS and Dispatchers may create a missing route from shipment intake, but
 * they are not route-cost administrators. Keep their raw HTTP payload from
 * setting fuel, toll, salary, terrain, or default-leg configuration.
 * Descriptive fields (code / loadPoint / note) are identity-level: they are
 * the columns the config table renders and RouteFormModal edits, so they
 * travel with the intake-safe set.
 */
export function restrictRouteCreateForIntake(data: RouteInput, role: Role): RouteInput {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  return {
    name: data.name,
    shortName: data.shortName?.trim() || data.name.trim(),
    distanceKm: data.distanceKm,
    code: data.code ?? null,
    loadPoint: data.loadPoint ?? null,
    note: data.note ?? null,
    isMountain: false,
  };
}

/**
 * CUS may update a route's identity fields (name, shortName, distanceKm) but
 * not cost/itinerary parameters. Mirrors restrictRouteCreateForIntake's field
 * set for updates — strip everything except the intake-safe keys.
 */
export function restrictRouteUpdateForIntake(
  data: Partial<RouteInput>,
  role: Role,
): Partial<RouteInput> {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => INTAKE_ROUTE_KEYS.has(key)),
  ) as Partial<RouteInput>;
}
