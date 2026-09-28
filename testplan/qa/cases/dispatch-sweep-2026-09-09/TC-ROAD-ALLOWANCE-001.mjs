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
  const routes = routesRes.data.items;

  let targetRoute = null;
  let typeWithRate = null;
  let typeWithoutRate = null;

  for (const route of routes) {
    const allowancesRes = await api.get(`/api/road-allowances?routeId=${route.id}`);
    if (!allowancesRes.ok) continue;
    const allowances = allowancesRes.data.items;
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
  //
  // Card 20260928_196. This step could never run. The payload sent
  // `{routeId, trailerType, customerId: null}` under a comment claiming
  // "minimal required fields", but createTripSchema requires customerId (>0),
  // cargoTypeId, departureDate and containerTypeId. The POST came back 400 and
  // the case reported "Trip creation failed: 400" — which read like a product
  // defect and sent the hunt for missing data instead of for a case that had
  // never been able to pass. Two separate faults stacked:
  //
  //   1. ctx.api never sent Idempotency-Key, so every write through the shared
  //      client 400'd before validation even ran. Fixed in testplan/qa/lib/
  //      harness.mjs. Two cases had hand-rolled their own fetch with the
  //      header, which is why the gap survived so long.
  //   2. The payload itself is invalid. Fixed here.
  //
  // The ids are resolved from the live catalog rather than hardcoded, so the
  // case survives a reseed — the same rule the fixture-sweep work established:
  // identify by shape, never by one environment's literal values.
  const [cargoTypes, containerTypes, customers] = await Promise.all([
    api.get('/api/cargo-types?pageSize=1'),
    api.get('/api/container-types?pageSize=1'),
    api.get('/api/customers?pageSize=1'),
  ]);
  const cargoTypeId = cargoTypes?.data?.items?.[0]?.id;
  const containerTypeId = containerTypes?.data?.items?.[0]?.id;
  const customerId = customers?.data?.items?.[0]?.id;
  if (!cargoTypeId || !containerTypeId || !customerId) {
    return {
      verdict: 'BLOCKED',
      errors: [`Cannot resolve the ids createTripSchema requires — cargoTypeId=${cargoTypeId}, containerTypeId=${containerTypeId}, customerId=${customerId}. This env's master data is empty, which is a seed problem, not a case problem.`],
    };
  }

  // The trailer type must be able to carry a container for the row to be
  // coherent: the route priced for 20FT but the first container type this env
  // offers may be 40FT. Match on the code so the trip agrees with the rate.
  const containers = containerTypes?.data?.items ?? [];
  const matching = containers.find((c) => (c.code || '').startsWith(typeWithRate.replace('FT', '')));
  const chosenContainerTypeId = matching?.id ?? containerTypeId;

  // A driver carries an assignedTruckId, so one lookup is enough when the env
  // has a linked pair; the plain truck list is the fallback.
  const driversRes = await api.get('/api/drivers?pageSize=5');
  const driver = driversRes?.data?.items?.find((d) => d.assignedTruckId && d.status !== 'INACTIVE') ?? null;
  let truckId = driver?.assignedTruckId ?? null;
  if (!truckId) {
    const trucksRes = await api.get('/api/trucks');
    const trucks = Array.isArray(trucksRes?.data) ? trucksRes.data : trucksRes?.data?.items ?? [];
    truckId = trucks.find((t) => t.status === 'ACTIVE')?.id ?? trucks[0]?.id ?? null;
  }
  const driverId = driver?.id ?? null;
  if (!truckId) {
    return {
      verdict: 'BLOCKED',
      errors: ['No tractor unit on this env — createTripSchema requires truckId for an internal trip. That is a seed problem, not a case problem.'],
    };
  }

  const createRes = await api.post('/api/trips', {
    routeId: targetRoute.id,
    trailerType: typeWithRate,
    customerId,
    cargoTypeId,
    containerTypeId: chosenContainerTypeId,
    departureDate: new Date().toISOString().slice(0, 10),
    // An internal trip needs a tractor unit; the server says so by name
    // ("Xe đầu kéo là bắt buộc cho chuyến xe nội bộ"). /api/trucks rejects
    // the pageSize filter, so it is read plain and the first ACTIVE unit wins.
    truckId,
    driverId,
  });
  if (!createRes.ok) {
    // Surface the server's reason. A bare status sent this case's investigation
    // after the wrong thing twice; the body names the offending field.
    const detail = typeof createRes.data === 'string'
      ? createRes.data
      : createRes.data?.error || JSON.stringify(createRes.data?.details ?? createRes.data);
    return { verdict: 'BLOCKED', errors: [`Trip creation failed: ${createRes.status} — ${String(detail).slice(0, 300)}`] };
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
