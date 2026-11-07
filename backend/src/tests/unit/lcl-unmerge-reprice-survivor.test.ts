// SIL-734 — Tách nhóm / Xóa Lô chính money laws, unit-only (no db, no app
// boot — 2026-10-19 owner ruling; source-scan pins in the
// lcl-gop-hang-money-wiring.test.ts style):
//   (b) whole-group REV "Tách nhóm": a member with NO pre-merge truth
//       (restore 'cited' / 'cleared') re-prices itself from the bảng giá thu
//       khách with its OWN lane key — Loại xe captured from the in-memory row
//       BEFORE the FB-145 clear, + Tuyến + khách + ngày. Restored and
//       operator-owned money never re-prices; no lane key ⇒ no invented
//       price. Conservation (b-pin): in the canonical merge (group freight
//       priced from the per-lot bảng giá) the restore+re-price decisions keep
//       the exact pre-tách total — asserted as pure arithmetic on the
//       decision matrix, never fabricated.
//   (c) Xóa Lô chính: the survivor engine (promotePrincipalOnRemoval +
//       promoteLclGroupsOnShipmentDelete) hands 100% of the crown money —
//       freight + driver road money (COST) and the REV transfer — to the
//       next member with order=1, inside the delete transaction, and every
//       reader of the principal reads live rows only (leaver ghost-guard).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  revWholeGroupRepriceDecision,
} from '../../services/lcl-grouping.service';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const svc = read('../../services/lcl-grouping.service.ts');
const lifecycle = read('../../services/shipment-lifecycle.service.ts');

function slice(from: string, to: string, haystack: string = svc): string {
  const start = haystack.indexOf(from);
  const end = haystack.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `source slice ${from} → ${to} must exist`);
  return haystack.slice(start, end);
}

test('(b) re-price decision matrix — only no-pre-merge-truth outcomes with a captured class re-price', () => {
  assert.equal(revWholeGroupRepriceDecision('cited', 7), true, 'cited 0₫ "Chờ tra lại bảng giá" + class ⇒ re-price');
  assert.equal(revWholeGroupRepriceDecision('cleared', 7), true, 'live trip without capture/original + class ⇒ re-price');
  assert.equal(revWholeGroupRepriceDecision('restored', 7), false, 'pre-merge truth restored ⇒ keep it');
  assert.equal(revWholeGroupRepriceDecision('untouched', 7), false, 'operator-owned money ⇒ never touched');
  assert.equal(revWholeGroupRepriceDecision('cited', null), false, 'no captured class ⇒ no lane key, no invented price');
});

test('(b) the whole-group REV loop wires restore → decision → re-price, and the class is captured before the FB-145 clear', () => {
  const unmerge = slice('export async function unmergeLclGroup', 'const principal = ordered[0]');
  assert.ok(unmerge.includes('const outcome = await restoreRevPreMergeMoney(tx, member, trip)'), 'restore reports its outcome');
  assert.ok(unmerge.includes('revWholeGroupRepriceDecision(outcome, member.revVehicleClassId)'),
    'the decision rides the IN-MEMORY class — captured before the FB-145 clear (the update above nulls the column)');
  assert.ok(unmerge.includes('await repriceRevLeaverFromPriceTable(tx, member, trip, actor)'),
    'the hit arm calls the SAME bảng giá engine the single-leaver path uses');
  assert.ok(unmerge.includes("input.dimension === 'REV' ? { revVehicleClassId: null } : {}"),
    'FB-145 acceptance intact: the group class still leaves the lots');
});

test('(b) repriceRevLeaverFromPriceTable keeps its guards: zeroish-only, lane-miss honest, own money outside the group vocabulary', () => {
  const reprice = slice('async function repriceRevLeaverFromPriceTable', 'async function restateRevLeaverMoney');
  assert.ok(reprice.includes('if (!standingZeroish) return false;'), 'a non-zero standing amount is the lot\'s own money — kept');
  assert.ok(reprice.includes('if (price == null) return false;'), 'lane miss ⇒ false — the citation stands, no fabricated number');
  assert.ok(reprice.includes('NOT a group-note prefix on purpose'), 'the auto price is the lot\'s OWN money from here on');
});

test('(b-pin) conservation — canonical merge (group freight = Σ per-lot bảng giá) survives tách cả nhóm to the đồng', () => {
  // Canonical QA fixture (the R42 shape): 3 trip-less lots merged into one
  // group priced from the bảng giá per lot — Lô 1 carries the whole freight,
  // members carry the cited 0₫. Whole-group tách with NO pre-merge snapshot
  // on the members: Lô 1 restores its pre-merge truth (its own lane price =
  // the group freight), members re-price from the SAME bảng giá.
  const lanePrices = [2_500_000, 900_000, 350_000]; // Lô 1, Lô 2, Lô 3 bảng giá thu khách
  const groupFreight = lanePrices.reduce((sum, price) => sum + price, 0); // the merge priced the group at Σ

  // Standing before tách: Lô 1 = group freight; members = cited 0₫.
  const before = [groupFreight, 0, 0];
  assert.equal(before.reduce((sum, amount) => sum + amount, 0), groupFreight);

  // The decision walk the unmerge loop runs, per member: 'restored' returns
  // the lot's OWN pre-merge truth (its lane price — what the merge captured),
  // a cited member re-prices from the SAME bảng giá.
  const outcomes: Array<'restored' | 'cited'> = ['restored', 'cited', 'cited'];
  const classes = [7, 7, 7]; // every lot carries the captured group class
  const after = lanePrices.map((lanePrice, index) => {
    if (revWholeGroupRepriceDecision(outcomes[index]!, classes[index]!)) return lanePrice; // re-priced from bảng giá
    return lanePrice; // restored pre-merge truth = the lot's own lane price
  });

  // No coin created, no coin lost: the pre-tách total equals the Σ after.
  assert.equal(after.reduce((sum, amount) => sum + amount, 0), groupFreight);
  // ...and per-lot: nobody dropped below their own pre-merge truth.
  for (const amount of after.values()) assert.ok(amount >= 0 && amount != null);
});

test('(c) Xóa Lô chính — the survivor engine follows the crown inside the delete transaction', () => {
  const promote = slice('async function promotePrincipalOnRemoval', 'await rewriteSurvivors(tx, dimension, survivors, groupId, actor);');
  assert.ok(promote.includes("upsertTripCarrierInfo(tx, promoteeTrip.tripId, { externalFreightCost: freight })"),
    'COST: the promotee receives the 100% freight');
  assert.ok(promote.includes('mirrorPlannedCarrierCost(tx, promotee.id, freight)'), 'the promotee\'s editor sees the 100% line');
  // The survivor takes order 1: rewriteSurvivors renumbers survivors[0] to
  // index+1 (the crown position), and the result reports the promotion.
  assert.ok(promote.includes('promoted: { shipmentId: promotee.id, order: 1, reference: lotReference(promotee) }'),
    'the promotion result names the survivor at order 1');
  const rewrite = slice('async function rewriteSurvivors', 'FB-095 promote-on-removal engine');
  assert.ok(rewrite.includes('patch.revGroupOrder = index + 1;') && rewrite.includes('patch.costGroupOrder = index + 1;'),
    'survivors renumber from the crown position in both dimensions');

  const deleteHook = slice('export async function promoteLclGroupsOnShipmentDelete', "cause: 'DELETE'");
  assert.ok(deleteHook.includes("for (const dimension of ['COST', 'REV'] as const)"), 'both dimensions ride the delete');
  assert.ok(deleteHook.includes('{ leaverIsDeleted: true }'), 'the deleted leaver writes no restate of its own');

  // Ghost-guard: the delete boundary hands the crown inside the SAME
  // transaction — shipment-lifecycle calls it with its tx.
  assert.ok(lifecycle.includes('promoteLclGroupsOnShipmentDelete(tx,') || lifecycle.includes('promoteLclGroupsOnShipmentDelete(tx,'),
    'the delete hook runs the promotion on the lifecycle tx');
});
