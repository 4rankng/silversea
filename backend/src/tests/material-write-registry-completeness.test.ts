// Card 20260924_5 — registry-completeness sweep for MATERIAL_WRITE_RULES.
// The 2026-09-24 rung (card 20260923_12) proved the failure class: a new
// runIdempotent endpoint whose MATERIAL_WRITE_RULES entry is missing answers
// 500 on EVERY live call (the audit context exists for all requests —
// app.use(auditLogMiddleware) is global — while the audit success-persist
// refuses undeclared material writes), with every service-level suite still
// green. The registry of record for idempotent write endpoints is
// IDEMPOTENCY_ENDPOINTS itself: every live material-write endpoint is
// registered there and consumed by a route through its constant, so the
// gate is: every VALUE in IDEMPOTENCY_ENDPOINTS must be declared in
// MATERIAL_WRITE_RULES (rule.endpoint or a rule's canonicalAliases) or
// carry a documented exemption below.
//
// Source-level call-site scanning was tried first and rejected: route files
// reference endpoints through many constant roots and computed expressions
// (buildCrudIdempotencyEndpoint, ternaries, per-file consts), which a static
// regex cannot resolve without flakiness. The constants registry is complete
// by construction (a new endpoint starts as a new constant).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listDeclaredMaterialWriteEndpoints } from '../middleware/material-write';
import { IDEMPOTENCY_ENDPOINTS } from '../services/idempotency.service';

/**
 * Endpoints exempt from registry coverage, with the reason. Keep SHORT — an
 * entry here means an idempotency constant whose material-write registry row
 * is intentionally absent. Dead constants (no route consumes them) belong
 * here until they are removed.
 */
const EXEMPT: Record<string, string> = {
  // No route consumes these via runIdempotent — leftover constants from
  // decommissioned flows (approval workflow removed 2026-09-15; legacy
  // change-request/fulfillment/completion/debt-offset paths re-routed).
  'shipments.change-requests.review': 'dead constant — no route consumes it',
  'shipments.fulfillments.assign': 'dead constant — no route consumes it',
  'shipments.completion.recompute': 'dead constant — no route consumes it',
  'debt-offsets.approve': 'dead constant — no route consumes it',
  'trip-expenses.approve': 'dead constant — approval flow removed 2026-09-15',
  'trip-expenses.reject': 'dead constant — approval flow removed 2026-09-15',
};

test('every idempotency write endpoint is declared in MATERIAL_WRITE_RULES (or exempt)', () => {
  const declared = new Set(listDeclaredMaterialWriteEndpoints());
  const missing = Object.values(IDEMPOTENCY_ENDPOINTS)
    .filter((value) => !declared.has(value) && !(value in EXEMPT));
  assert.deepEqual(
    missing,
    [],
    'IDEMPOTENCY_ENDPOINTS values WITHOUT a MATERIAL_WRITE_RULES entry — register the endpoint in material-write.ts (a missing rule 500s every live call while service suites stay green) or exempt it here with a reason:',
  );
});
