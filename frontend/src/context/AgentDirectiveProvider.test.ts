import { describe, it, expect } from 'vitest';
import { resolvePath } from './AgentDirectiveProvider';

/**
 * Regression guard for the directive-bridge path resolver. The bot emits a
 * navigate directive as { routeKey, params }; resolvePath must turn it into the
 * concrete SPA path using the catalog builder's declared param key.
 *
 * History: tire pages read `p.truckId`/`p.trailerId` while every other detail
 * route reads `p.id`. resolvePath used to hardcode `{ id }`, so a bot navigation
 * to fleetTires landed on /fleet/undefined/tires. The fix passes the value under
 * `entry.requiresParams[0]`. These cases pin that behavior.
 */
describe('resolvePath — parametric route resolution', () => {
  it('resolves fleetTires with truckId (NOT /fleet/undefined/tires)', () => {
    expect(resolvePath('fleetTires', { truckId: 1 })).toBe('/fleet/1/tires');
    expect(resolvePath('fleetTires', { truckId: 42 })).toBe('/fleet/42/tires');
  });

  it('resolves fleetTrailerTires with trailerId', () => {
    expect(resolvePath('fleetTrailerTires', { trailerId: 7 })).toBe('/fleet/trailers/7/tires');
  });

  it('still resolves p.id-based detail routes (tripDetail)', () => {
    expect(resolvePath('tripDetail', { id: 99 })).toBe('/trips/99');
  });

  it('falls back to the first numeric param when the LLM emits an odd key', () => {
    // The guardrail/model may pass { truckId: 1 } or { id: 1 }; both must work.
    expect(resolvePath('fleetTires', { id: 5 })).toBe('/fleet/5/tires');
  });

  it('resolves a static route with no params', () => {
    expect(resolvePath('dashboard')).toBe('/dashboard');
  });
});
