// SIL-1102 (K2.124 Điểm thêm) — the phơi-phiếu fallback reference names the
// SELECTION, not the issuance, so the second phiếu thu over the same selection
// collided on the receipt id ('Mã biên lai đã tồn tại với khách hàng hoặc nội
// dung khác') and one chuyến could only ever hold one phiếu thu (QA 26/11:
// chuyến 6's newly confirmed khoản 89/90 → 409 on CP-2-IN-PHOI-PHIEU-OPS:1-6).
//
// The engine stores the reference UPPERCASED (normalizeTreasuryPhysical-
// Reference), so these pins judge the STORED form: the rotation suffix is
// uppercase too, and a raw lowercase base still rotates against the stored
// uppercase movements.
//
// These pins cover the ROTATION: first issuance keeps the readable base, every
// later one takes the next free -RN suffix, different selections never share a
// reference, and a base too long for the treasury authority hashes whole (the
// house pattern of phoiPhieuPhysicalReference).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Tx } from '../../db';
import { nextPhoiPhieuPhysicalReference } from '../../services/phoi-phieu-control.service';

/** A minimal Tx double: no-op advisory locks, treasury-movement read answered
 *  with the given (stored-form) references. */
function stubTx(taken: string[]): Tx {
  return {
    execute: async () => { /* pg_advisory_xact_lock — not under test here */ },
    select: () => ({
      from: () => ({
        where: async () => taken.map((reference) => ({ reference })),
      }),
    }),
  } as unknown as Tx;
}

const ACCOUNT = 2;

test('an unissued selection keeps the readable base reference, stored uppercase', async () => {
  const tx = stubTx([]);
  const ref = await nextPhoiPhieuPhysicalReference(tx, ACCOUNT, 'IN', 'PHOI-PHIEU-ops:5-6');
  assert.equal(ref, 'PHOI-PHIEU-OPS:5-6');
});

test('the second issuance over the same selection takes -R2, not a collision', async () => {
  const tx = stubTx(['PHOI-PHIEU-OPS:5-6']);
  const ref = await nextPhoiPhieuPhysicalReference(tx, ACCOUNT, 'IN', 'PHOI-PHIEU-ops:5-6');
  assert.equal(ref, 'PHOI-PHIEU-OPS:5-6-R2');
});

test('the rotation walks past taken suffixes to the first free one', async () => {
  const tx = stubTx(['PHOI-PHIEU-OPS:5-6', 'PHOI-PHIEU-OPS:5-6-R2', 'PHOI-PHIEU-OPS:5-6-R3']);
  const ref = await nextPhoiPhieuPhysicalReference(tx, ACCOUNT, 'IN', 'PHOI-PHIEU-OPS:5-6');
  assert.equal(ref, 'PHOI-PHIEU-OPS:5-6-R4');
});

test('a longer sibling selection pre-filtered by the LIKE never shifts the verdict', async () => {
  // '…-1-60' shares the prefix '…-1-6' — it may enter the candidate set but
  // must never make the base (or a suffix) look taken.
  const tx = stubTx(['PHOI-PHIEU-OPS:5-1-60', 'PHOI-PHIEU-OPS:5-1-60-R2']);
  const ref = await nextPhoiPhieuPhysicalReference(tx, ACCOUNT, 'IN', 'PHOI-PHIEU-ops:5-1-6');
  assert.equal(ref, 'PHOI-PHIEU-OPS:5-1-6');
});

test('a suffix push past the 150 cap hashes whole instead of truncating', async () => {
  // Production bases come from phoiPhieuPhysicalReference (≤150). The hash
  // branch guards the SUFFIX push: a 150-char base + '-R2' exceeds the cap.
  const longBase = `PHOI-PHIEU-ops:5-${'7-'.repeat(66)}7`;
  assert.equal(longBase.length, 150);
  const tx = stubTx([longBase.toUpperCase()]);
  const ref = await nextPhoiPhieuPhysicalReference(tx, ACCOUNT, 'IN', longBase);
  // The helper returns the raw lowercase hex; the engine uppercases it on the
  // way into the movement, so either case is a legal stored form here.
  assert.match(ref, /^PHOI-PHIEU-[0-9a-f]{64}$/i);
  assert.notEqual(ref, longBase.toUpperCase());
});
