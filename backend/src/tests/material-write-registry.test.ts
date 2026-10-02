/**
 * Card 20260928_166 defect class — a route wrapped in the material-write
 * pipeline (runShipmentWrite) MUST be declared in MATERIAL_WRITE_RULES, or the
 * audit middleware refuses the write at persist time and every real request
 * 500s ("Material write audit context is incomplete"). The batch assignment
 * route shipped with service-level tests only, which skip the router — the
 * suite was green while the endpoint was dead in every deployed build.
 *
 * This pin holds the registry and the route table together: the batch path
 * must match a declared material-write rule. (Watched failing red before the
 * rule landed, 30/09. The runtime half is gated by the standing one-HTTP-
 * round-trip probe against the deployed environment.)
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { matchDeclaredMaterialWrite } from '../middleware/material-write';
// Migrated route families self-declare their registry rows at import time
// (card 20260930_230); importing the registration module registers them here.
import '../routes/material-write-registration';

describe('material-write registry covers the assignment batch route', () => {
  test('POST /api/expense-accounting/assignments/batch is a declared material write', () => {
    const declared = matchDeclaredMaterialWrite('POST', '/api/expense-accounting/assignments/batch');
    assert.ok(declared, 'the batch assignment route must be declared — otherwise the audit middleware 500s every real request');
    assert.equal(declared.endpoint, 'expense-accounting.assign-batch');
  });

  test('the single-truck assignment stays declared beside it', () => {
    assert.ok(matchDeclaredMaterialWrite('POST', '/api/expense-accounting/assignments'), 'single assign route');
    assert.ok(matchDeclaredMaterialWrite('PUT', '/api/expense-accounting/phoi-phieu/trucks/12/accountant'), 'phoi-phieu reassignment route');
  });
});
