// SIL-944 (K9.19) — the debit-merge wire's 'Thông số' facts: the FB-094
// label law + the LIVE group-principal ref law, unit-pinned beside the
// board's own shape so the merge grid can never drift from chot-debit.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { debitMergeLclParams } from '../../services/debit-merge.service';

const classCodes = new Map<number, string>([[7, 'CONT20.LIGHT'], [9, '2.5T'], [12, '10T']]);
const principalRefs = new Map<string, string>([['GRP-REV-1', 'BL-9'], ['GRP-COST-1', 'BL-1']]);

const base = {
  cargoMode: 'LCL' as string | null,
  revVehicleClassId: 7 as number | null,
  costVehicleClassId: 12 as number | null,
  revGroupId: 'GRP-REV-1' as string | null,
  revGroupOrder: 2 as number | null,
  costGroupId: null as string | null,
  costGroupOrder: null as number | null,
};

describe('debitMergeLclParams — Thông số cell facts (SIL-944)', () => {
  it('FCL/ungrouped rows carry no params — absence is not data', () => {
    assert.equal(debitMergeLclParams({ ...base, cargoMode: 'FCL' }, classCodes, principalRefs), null);
    assert.equal(debitMergeLclParams({ ...base, cargoMode: null }, classCodes, principalRefs), null);
  });

  it('the label joins Lẻ + the thu/tra CLASS CODES (never names), order pinned', () => {
    // base is an order-2 REV member — the ref rides along; the LABEL law is
    // what this case pins.
    assert.deepEqual(
      debitMergeLclParams(base, classCodes, principalRefs),
      { label: 'Lẻ · Thu: CONT20.LIGHT · Trả: 10T', ghepCungRef: 'BL-9' },
    );
    // An unconfigured side drops its segment, never fabricates a class.
    assert.equal(
      debitMergeLclParams({ ...base, costVehicleClassId: null }, classCodes, principalRefs)?.label,
      'Lẻ · Thu: CONT20.LIGHT',
    );
    assert.equal(debitMergeLclParams({ ...base, revVehicleClassId: null, costVehicleClassId: null }, classCodes, principalRefs)?.label, 'Lẻ');
  });

  it('a REV member reads its group principal; the principal itself reads null', () => {
    // order 1 — and an unset order (?? 1) — IS the principal: no ref.
    assert.equal(
      debitMergeLclParams({ ...base, revGroupOrder: 1 }, classCodes, principalRefs)?.ghepCungRef,
      null,
    );
    assert.equal(
      debitMergeLclParams({ ...base, revGroupOrder: null }, classCodes, principalRefs)?.ghepCungRef,
      null,
    );
    // The member (base carries order 2) reads its group's LIVE principal.
    assert.equal(debitMergeLclParams(base, classCodes, principalRefs)?.ghepCungRef, 'BL-9');
    // Ghép TRẢ ĐV (cost-merged): revGroupId null — the cost principal ref.
    assert.equal(
      debitMergeLclParams({
        ...base, revGroupId: null, revGroupOrder: null, costGroupId: 'GRP-COST-1', costGroupOrder: 3,
      }, classCodes, principalRefs)?.ghepCungRef,
      'BL-1',
    );
    // Order 2 with NO live principal row (ghost guard) → null, never junk.
    assert.equal(
      debitMergeLclParams({ ...base, revGroupId: 'GRP-GONE', revGroupOrder: 2 }, classCodes, principalRefs)?.ghepCungRef,
      null,
    );
  });
});
