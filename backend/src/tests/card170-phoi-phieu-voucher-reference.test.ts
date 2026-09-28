// Card 20260928_170 — the phơi-phiếu screen's self-generated physicalReference.
//
// The screen never sends `physicalReference`, so createPhoiPhieuVoucher always
// built one itself by joining every selected trip id. The treasury authority
// (normalizeTreasuryPhysicalReference) rejects anything over 160 chars, so the
// card's own headline requirement — "được phép tích chọn All hoặc chọn từng
// dòng … để lập phiếu thu/chi tổng hợp" — could not be met on a lot with
// enough trips. The reference is ALSO the uniqueness key
// (lockApplicationOwnedUniqueness: treasuryAccountId + direction +
// physicalReference), so the fix must be deterministic and collision-free.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { phoiPhieuPhysicalReference } from '../services/phoi-phieu-control.service';

const MAX = 160;

test('a small selection stays human-readable in the fund book', () => {
  const ref = phoiPhieuPhysicalReference('CUS-12-2026-09', [7, 3]);
  assert.equal(ref, 'PHOI-PHIEU-CUS-12-2026-09-3-7');
});

test('a large selection stays inside the 160-char treasury authority', () => {
  // 40 trips at 2-3 digits each overflows the old joined form.
  const tripIds = Array.from({ length: 40 }, (_, i) => 1000 + i * 37);
  const ref = phoiPhieuPhysicalReference('CUS-12-2026-09', tripIds);
  assert.ok(ref.length <= MAX, `reference must fit the authority, got ${ref.length}`);
});

test('the same selection always yields the same reference', () => {
  // The uniqueness key must not drift on a retry of the same batch — this is
  // what makes the phơi phiếu safe to re-send.
  const a = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 500 + i));
  const b = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 500 + i));
  assert.equal(a, b);
});

test('order of the incoming ids does not change the reference', () => {
  // Selection order is UI state, not identity; sorting is what makes the
  // reference reproducible when a driver re-ticks the same rows in a new order.
  const forward = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 500 + i));
  const reversed = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 500 + i).reverse());
  assert.equal(forward, reversed);
});

test('two DIFFERENT large selections never collide', () => {
  // Guards against the "truncate to 160" shortcut, which would let two
  // distinct batches share one uniqueness key.
  const a = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 500 + i));
  const b = phoiPhieuPhysicalReference('G1', Array.from({ length: 40 }, (_, i) => 900 + i));
  assert.notEqual(a, b);
});

test('a large selection is still distinguishable from its own prefix', () => {
  const ids = Array.from({ length: 40 }, (_, i) => 500 + i);
  const first = phoiPhieuPhysicalReference('G1', ids);
  const oneChanged = phoiPhieuPhysicalReference('G1', [ids[0] + 1, ...ids.slice(1)]);
  assert.notEqual(first, oneChanged);
});

test('an empty selection still produces a usable reference', () => {
  const ref = phoiPhieuPhysicalReference('G1', []);
  assert.equal(ref, 'PHOI-PHIEU-G1-');
});
