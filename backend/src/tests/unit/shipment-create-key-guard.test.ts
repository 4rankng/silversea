// Contract guard for the shipment-create bodies: unknown keys must be REJECTED
// by name instead of silently stripped. The failure this pins is the one QA hit
// on staging 2026-10-17 — a helper posted the create form's field ids
// (`quantity`/`weightKg`/`volumeCbm`) and got a 201 whose lot carried no cargo
// facts, so the loss was invisible on both sides.
//
// Pure unit test — no database, no HTTP.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_SHIPMENT_KEYS, QUICK_CREATE_SHIPMENT_KEYS } from '@tingting/shared';
import { assertKnownShipmentKeys } from '../../routes/shipments/shipment-shared';

describe('shipment create key guard', () => {
  it('rejects every unknown key by name', () => {
    assert.throws(
      () => assertKnownShipmentKeys({ customerId: 1, quantity: '5', weightKg: '1900' }, CREATE_SHIPMENT_KEYS, 'tạo lô hàng'),
      (error: Error) => {
        assert.match(error.message, /quantity/);
        assert.match(error.message, /weightKg/);
        assert.match(error.message, /tạo lô hàng/);
        return true;
      },
    );
  });

  it('keeps the deliberate advice for a containers payload on the create route', () => {
    assert.throws(
      () => assertKnownShipmentKeys({ customerId: 1, containers: [{ containerNumber: 'BAD0000000' }] }, CREATE_SHIPMENT_KEYS, 'tạo lô hàng'),
      /PUT \/api\/shipments\/\{id\}\/containers/,
    );
  });

  it('accepts an unknown key holding an EMPTY array — no data to lose', () => {
    assert.doesNotThrow(() => assertKnownShipmentKeys({ customerId: 1, containers: [] }, CREATE_SHIPMENT_KEYS, 'tạo lô hàng'));
  });

  it('ignores non-object bodies (zod owns those errors)', () => {
    for (const body of [null, undefined, 'x', 7, [1, 2]]) {
      assert.doesNotThrow(() => assertKnownShipmentKeys(body, CREATE_SHIPMENT_KEYS, 'tạo lô hàng'));
    }
  });

  it('quick-create carries exactly three extra channels over the create list', () => {
    const extra = QUICK_CREATE_SHIPMENT_KEYS.filter((key) => !CREATE_SHIPMENT_KEYS.includes(key));
    assert.deepEqual(extra.slice().sort(), ['_requestId', 'containers', 'declarationNumber']);
    // …and the create route must NOT accept the quick-only channels.
    assert.equal(CREATE_SHIPMENT_KEYS.includes('containers'), false);
    assert.equal(CREATE_SHIPMENT_KEYS.includes('_requestId'), false);
  });

  it('every accepted key passes the guard', () => {
    const body = Object.fromEntries(CREATE_SHIPMENT_KEYS.map((key) => [key, null]));
    assert.doesNotThrow(() => assertKnownShipmentKeys(body, CREATE_SHIPMENT_KEYS, 'tạo lô hàng'));
  });
});
