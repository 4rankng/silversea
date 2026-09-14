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

  // The single-add path previously accepted any non-empty string — 'ABC'
  // persisted as a container and became a cost-allocation group. It now
  // enforces the SAME shared ISO 6346 validator the batch PUT uses.
  test('rejects malformed numbers like ABC or CONT-001', () => {
    for (const bad of ['ABC', 'CONT-001', 'TOOSHORT', 'TOOLONGCONTAINER12345']) {
      const result = forwarderTripContainerSchema.safeParse({ tripId: 1, containerNumber: bad });
      assert.equal(result.success, false, bad);
      if (!result.success) {
        assert.equal(result.error.issues[0].message, 'Số container sai định dạng (4 chữ cái + 7 số).');
      }
    }
  });

  test('rejects a well-formed number with a wrong check digit', () => {
    // TCKU123456's true ISO 6346 check digit is 0 — so ...567 is malformed
    // only at the digit level (the exact near-miss users type).
    const result = forwarderTripContainerSchema.safeParse({ tripId: 1, containerNumber: 'TCKU1234567' });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.issues[0].message, 'Số container sai chữ số kiểm tra — kiểm tra lại.');
    }
  });

  test('accepts a valid ISO 6346 number, including separator/lowercase input', () => {
    const plain = forwarderTripContainerSchema.safeParse({ tripId: 1, containerNumber: 'TCKU1234560' });
    const spaced = forwarderTripContainerSchema.safeParse({ tripId: 1, containerNumber: 'tcku 123456 0' });
    const hyphen = forwarderTripContainerSchema.safeParse({ tripId: 1, containerNumber: 'TCKU-123456-0' });

    assert.equal(plain.success, true);
    assert.equal(spaced.success, true);
    assert.equal(hyphen.success, true);
  });
});
