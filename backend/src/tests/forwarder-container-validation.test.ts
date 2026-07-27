import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { forwarderTripContainerSchema } from '../routes/forwarder';

describe('forwarder container input', () => {
  test('requires a non-blank container number', () => {
    const missing = forwarderTripContainerSchema.safeParse({ tripId: 1 });
    const blank = forwarderTripContainerSchema.safeParse({
      tripId: 1,
      containerNumber: '   ',
    });

    assert.equal(missing.success, false);
    assert.equal(blank.success, false);
  });

  test('accepts a non-empty container number', () => {
    const result = forwarderTripContainerSchema.safeParse({
      tripId: 1,
      containerNumber: 'CONT-001',
    });

    assert.equal(result.success, true);
  });
});
