import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { matchDeclaredMaterialWrite } from '../middleware/material-write';
import { FORWARDER_IDEMPOTENCY_ENDPOINTS } from '../routes/forwarder';

describe('Q23 forwarder material-write registry', () => {
  test('declares every forwarder runIdempotent material route as fail-closed', () => {
    const routes = [
      ['POST', '/api/forwarder/me/trips/1/containers', FORWARDER_IDEMPOTENCY_ENDPOINTS.CONTAINER_CREATE],
      ['POST', '/api/forwarder/me/expenses', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_CREATE],
      ['PATCH', '/api/forwarder/me/expenses/1', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_UPDATE],
      ['DELETE', '/api/forwarder/me/expenses/1', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_DELETE],
      ['PUT', '/api/forwarder/me/trips/1/expense-completion', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_COMPLETION],
      ['POST', '/api/forwarder/me/advance-requests', 'forwarder.advance-requests.create'],
      ['POST', '/api/forwarder/me/advance-settlements', 'forwarder.advance-settlements.create'],
      ['POST', '/api/forwarder/me/expenses/1/photos', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_CREATE],
      ['DELETE', '/api/forwarder/me/expense-photos/9', FORWARDER_IDEMPOTENCY_ENDPOINTS.EXPENSE_PHOTO_DELETE],
      ['POST', '/api/forwarder/me/shipments/1/order-exchange/start', FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_START],
      ['POST', '/api/forwarder/me/shipments/1/order-exchange/complete', FORWARDER_IDEMPOTENCY_ENDPOINTS.ORDER_EXCHANGE_COMPLETE],
      ['POST', '/api/forwarder/me/trips/1/paper-order-collection', FORWARDER_IDEMPOTENCY_ENDPOINTS.PAPER_ORDER_COLLECTION],
    ] as const;

    for (const [method, path, endpoint] of routes) {
      assert.equal(matchDeclaredMaterialWrite(method, path)?.endpoint, endpoint, `${method} ${path}`);
    }
  });
});
