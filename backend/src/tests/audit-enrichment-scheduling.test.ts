import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { shouldScheduleAuditEnrichmentForTest } from '../services/audit.service';
import { AuditEvent } from '../services/audit-types';

describe('audit enrichment scheduling', () => {
  test('skips detached enrichment when the audit entry already has an entity key', () => {
    assert.equal(shouldScheduleAuditEnrichmentForTest({
      event: AuditEvent.PROFIT_DISTRIBUTION_REQUESTED,
      entityType: 'reports',
      entityKey: 'Quý 1/2026',
      metadata: {},
    }), false);
  });

  test('skips detached enrichment for unsupported entity types without an entity key', () => {
    assert.equal(shouldScheduleAuditEnrichmentForTest({
      event: AuditEvent.ENTITY_UPDATED,
      entityType: 'governance-actions',
      entityId: 42,
      metadata: {},
    }), false);
  });

  test('keeps detached enrichment only for supported entities that can gain a key later', () => {
    assert.equal(shouldScheduleAuditEnrichmentForTest({
      event: AuditEvent.ENTITY_CREATED,
      entityType: 'payments',
      entityId: 7,
      metadata: {
        body: {
          customerId: 3,
          payments: [{ tripId: 9, amount: 120000 }],
        },
      },
    }), true);
  });
});
