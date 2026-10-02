// cases/portal-customer/index.mjs — CUSTOMER (portal khách hàng) topic.
//
// Card 20260928_157. LOCAL-ONLY topic: prod has no customer-portal users, so
// `make stgdb` mirrors no CUSTOMER account to staging. Pointing this topic at
// staging is not an error — run-all reports every case BLOCKED naming the env
// (lib/env.mjs blockedForMissingRole) instead of dying with a FATAL.
//
// Re-run with:
//   node testplan/qa/scripts/run-all.mjs portal-customer

export const cases = [
  // Portal shell + row-scoped lot list + no cross-customer leak
  { id: 'TC-PORTAL-SHIP-001', role: 'CUSTOMER', file: 'TC-PORTAL-SHIP-001.mjs' },
];
