import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOperationalSitesListQuery } from '../../services/shipment-intake.service';
import { ApiError } from '../../errors';

/**
 * Card 261022093245 (Zalo 22/10): GET /operational-sites query contract.
 * `?customerId=<id>` must keep the historical customer-scoped behavior
 * (missing/invalid customerId stays the same 400), while `?scope=shared`
 * switches the endpoint to the shared Kho (CFS/Cảng) catalog across all
 * customers. Unknown scopes reject instead of silently falling back — a typo
 * must not quietly empty the dropdown.
 */

test('customerId query keeps the historical customer-scoped mode', () => {
  assert.deepEqual(resolveOperationalSitesListQuery({ customerId: '25282' }), {
    kind: 'customer',
    customerId: 25282,
  });
  // Numeric query values (Express gives strings; callers may pass numbers).
  assert.deepEqual(resolveOperationalSitesListQuery({ customerId: 1 }), {
    kind: 'customer',
    customerId: 1,
  });
});

test('scope=shared selects the shared-warehouse catalog mode', () => {
  assert.deepEqual(
    resolveOperationalSitesListQuery({ scope: 'shared' }),
    { kind: 'shared-warehouses' },
  );
  // Whitespace tolerated; customerId is irrelevant in shared mode.
  assert.deepEqual(
    resolveOperationalSitesListQuery({ scope: ' shared ', customerId: 'bogus' }),
    { kind: 'shared-warehouses' },
  );
});

test('missing customerId without scope keeps the 400 (no silent behavior change)', () => {
  assert.throws(() => resolveOperationalSitesListQuery({}), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.message, 'customerId không hợp lệ.');
    return true;
  });
  assert.throws(() => resolveOperationalSitesListQuery({ customerId: 'abc' }), ApiError);
  assert.throws(() => resolveOperationalSitesListQuery({ customerId: '0' }), ApiError);
  assert.throws(() => resolveOperationalSitesListQuery({ customerId: '-3' }), ApiError);
  assert.throws(() => resolveOperationalSitesListQuery({ customerId: '1.5' }), ApiError);
});

test('unknown scope values reject 400 instead of falling back to customer mode', () => {
  for (const scope of ['all', 'warehouse', 'SHARED', 'customer']) {
    assert.throws(
      () => resolveOperationalSitesListQuery({ scope, customerId: '5' }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, 'scope không hợp lệ.');
        return true;
      },
      scope,
    );
  }
});
