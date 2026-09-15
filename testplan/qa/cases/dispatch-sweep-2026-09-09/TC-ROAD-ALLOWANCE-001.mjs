// testplan/qa/cases/dispatch-sweep-2026-09-09/TC-ROAD-ALLOWANCE-001.mjs
// TC-ROAD-ALLOWANCE-001 — Road allowance resolves against finalTrailerType, never falls back to previous type
// Source: KP-159 — trailer type change must not silently fall back to old type's rate

export const caseId = 'TC-ROAD-ALLOWANCE-001';
export const role = 'ADMIN';

/**
 * Regression: changing trailerType on a trip MUST resolve roadAllowanceBaseApplied
 * using the NEW trailer type only. When the new type has no rate for the route,
 * roadAllowanceBaseApplied must be 0 (missing) — it must NOT fall back to the
 * old trailer type's rate.
 *
 * Precondition: route R has a road_allowance for type A but NOT for type B.
 *   1. Create trip on route R with trailerType=A → allowance = rate for A
 *   2. Update trip to trailerType=B (no rate for B on route R) → allowance must be 0
 *
 * Before the fix, step 2 would fall back to the old type A's rate.
 */
export default async function (ctx) {
  const { api } = ctx;

  // ── Step 1: Find a route with a road_allowance for exactly one trailer type ──
  const routesRes = await api.get('/api/routes');
  if (!routesRes.ok) return { verdict: 'BLOCKED', errors: ['Cannot fetch routes'] };
  const routes = routesRes.data;

  let targetRoute = null;
  let typeWithRate = null;
  let typeWithoutRate = null;

  for (const route of routes) {
    const allowancesRes = await api.get(`/api/road-allowances?routeId=${route.id}`);
    if (!allowancesRes.ok) continue;
    const allowances = allowancesRes.data;
    const types = allowances.map((a) => a.trailerType);

    if (types.includes('20FT') && !types.includes('40FT')) {
      targetRoute = route;
      typeWithRate = '20FT';
      typeWithoutRate = '40FT';
      break;
    }
    if (types.includes('40FT') && !types.includes('20FT')) {
      targetRoute = route;
      typeWithRate = '40FT';
      typeWithoutRate = '20FT';
      break;
    }
  }

  if (!targetRoute) {
    return {
      verdict: 'BLOCKED',
      errors: ['No route found with road_allowance for exactly one trailer type. Need a route with rate for A but not B.'],
    };
  }

  // ── Step 2: Create a trip on that route with the type that HAS a rate ──
  const createRes = await api.post('/api/trips', {
    routeId: targetRoute.id,
    trailerType: typeWithRate,
    // Minimal required fields; fill with defaults
    customerId: null,
  });
  if (!createRes.ok) {
    return { verdict: 'BLOCKED', errors: [`Trip creation failed: ${createRes.status}`] };
  }
  const tripId = createRes.data.id;
  const initialAllowance = Number(createRes.data.roadAllowanceBaseApplied || 0);

  // Sanity: the initial trip should have picked up a nonzero allowance
  if (initialAllowance === 0) {
    return {
      verdict: 'BLOCKED',
      errors: [`Route ${targetRoute.id} type ${typeWithRate} has allowance in DB but initial trip got 0. Check seed data.`],
    };
  }

  // ── Step 3: Update the trip to the type that has NO rate ──
  const updateRes = await api.patch(`/api/trips/${tripId}`, {
    trailerType: typeWithoutRate,
  });
  if (!updateRes.ok) {
    return { verdict: 'BLOCKED', errors: [`Trip update failed: ${updateRes.status}`] };
  }

  const updatedAllowance = Number(updateRes.data.roadAllowanceBaseApplied || 0);

  // ── Verdict ──
  // After the fix: allowance for the missing type MUST be 0, not the old type's rate.
  const pass = updatedAllowance === 0;

  return {
    verdict: pass ? 'PASS' : 'FAIL',
    routeId: targetRoute.id,
    typeWithRate,
    typeWithoutRate,
    initialAllowance,
    updatedAllowance,
    ...(pass ? {} : {
      errors: [
        `Expected roadAllowanceBaseApplied=0 after switching to ${typeWithoutRate} (no rate).`,
        `Got ${updatedAllowance} — this is the old ${typeWithRate} rate, indicating fallback to previous trailer type.`,
      ],
    }),
  };
}
