/**
 * SIL-666 (id 762) — the rig-conflict busy message must NAME the conflict.
 *
 * QA 03/11 (follow-up AC on the 22/12 Kẹp leg): a real conflict on
 * 15H-061.14 answered `{"error":"Đầu xe 15H-061.14 đã được gán cho lô/tác vụ
 * khác trong khung giờ trùng lặp:."}` — an EMPTY reference after the colon.
 * Repro (local adf1c2e6 + qa/scripts/2026-11-03-sil666-repro.mjs): the
 * blocking holder was a DISPATCHED TRIP — truck 39's own fulfillment-less
 * BULK task (BULK-TR-0180, CREATED, 26/08→02/09/2026) — and both rig guards'
 * hard/warn tiers rendered only their plan-row holder list, so a trip-only
 * conflict produced `trùng lặp: .` byte-for-byte.
 *
 * Pinned here:
 *  - the busy template renders plan-row holders ("Lô …") AND dispatched-trip
 *    conflicts under one label law: a lot-backed trip shows its lot reference,
 *    a fulfillment-less task shows "Lệnh <tripCode>" — the "tác vụ khác" half
 *    of the copy the message itself promises; the claimed-window suffix rides
 *    the shared vi-VN display law (" (từ 07:00 26-08)");
 *  - the reference list is never empty when a conflict exists: with nothing
 *    renderable the colon is dropped entirely ("…trùng lặp." / "…trùng lặp.
 *    Vẫn lưu?"), never an empty string after ':';
 *  - the tiers keep their verbatim tails ("." hard, ". Vẫn lưu?" warn-once);
 *  - the wiring: BOTH guards (dispatch-planning-detail-plan.service and
 *    dispatch-plan-conflict-scan.service) build their busy copy through
 *    rigConflictBusyMessage with the trip conflicts attached, and both trip
 *    conflict scans select the identity fields (tripCode + the origin lot's
 *    references) the label law needs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import {
  rigConflictBusyMessage,
  rigHolderSlotSuffix,
  rigTripHolderLabel,
  type RigConflictRowRef,
  type RigConflictTripRef,
} from '../../services/trip-pair-rules.service';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string): string =>
  readFileSync(path.join(here, '../../services', name), 'utf8');

/** Truck 39's real conflicting task shape (qa/2026-11-03-sil666/before.log):
 *  fulfillment-less BULK trip, staged 2026-08-26T00:00Z → 26/08 07:00 +07. */
const bulkTask: RigConflictTripRef = {
  tripId: 326,
  tripCode: 'BULK-TR-0180',
  plannedStartAt: new Date('2026-08-26T00:00:00Z'),
  shipmentId: null,
  shipmentCode: null,
  blNumber: null,
  bookingRef: null,
};

const lotBackedTrip: RigConflictTripRef = {
  tripId: 401,
  tripCode: 'TRP-202611-0035',
  plannedStartAt: '2026-12-22 08:00:00', // naive wall time — +07 anchored
  shipmentId: 155,
  shipmentCode: 'SHP-2610-00091',
  blNumber: null,
  bookingRef: null,
};

const planRowHolder: RigConflictRowRef = {
  shipmentId: 156,
  shipmentCode: 'SHP-2610-00092',
  blNumber: null,
  bookingRef: null,
  slotAt: new Date('2026-10-30T01:00:00Z'),
};

describe('SIL-666 — the busy message names the conflicting trip', () => {
  it('a fulfillment-less BULK task renders as "Lệnh <tripCode> (từ …)"', () => {
    const label = rigTripHolderLabel(bulkTask);
    assert.match(label, /^Lệnh BULK-TR-0180 \(từ \d{2}:\d{2} \d{2}-\d{2}\)$/);
    assert.match(label, /\(từ 07:00 26-08\)/);
  });

  it('a lot-backed trip prefers the lot reference the grid shows', () => {
    const label = rigTripHolderLabel(lotBackedTrip);
    assert.match(label, /^Lô SHP-2610-00091 \(từ \d{2}:\d{2} \d{2}-\d{2}\)$/);
    // Naive wall-time strings are +07 anchored, never server-zone anchored.
    assert.match(label, /\(từ 08:00 22-12\)/);
  });

  it('hard tier: trip-only conflict — the colon part is NEVER empty', () => {
    const msg = rigConflictBusyMessage('15H-061.14', [], [bulkTask]);
    assert.match(msg, /^Đầu xe 15H-061\.14 đã được gán cho lô\/tác vụ khác trong khung giờ trùng lặp: .+\.$/);
    assert.ok(msg.includes('Lệnh BULK-TR-0180'));
    assert.ok(!msg.includes(': .'), `empty reference: ${msg}`);
  });

  it('both conflict sources render in one list, plan rows first', () => {
    const msg = rigConflictBusyMessage('15H-061.14', [planRowHolder], [bulkTask, lotBackedTrip]);
    const colonPart = (msg.split('khung giờ trùng lặp:')[1] ?? '').trim().replace(/\.$/, '');
    const refs = colonPart.split(', ');
    assert.equal(refs.length, 3);
    assert.match(refs[0], /^Lô SHP-2610-00092 \(từ \d{2}:\d{2} \d{2}-\d{2}\)$/);
    assert.match(refs[1], /^Lệnh BULK-TR-0180/);
    assert.match(refs[2], /^Lô SHP-2610-00091/);
  });

  it('warn-once tier keeps the ". Vẫn lưu?" tail and names the conflict', () => {
    const msg = rigConflictBusyMessage('15H-061.14', [], [bulkTask], '. Vẫn lưu?');
    assert.ok(msg.endsWith('Lệnh BULK-TR-0180 (từ 07:00 26-08). Vẫn lưu?'));
  });

  it('no renderable reference → the colon is dropped, never left hanging', () => {
    const hard = rigConflictBusyMessage('15H-061.14', [], []);
    assert.equal(hard, 'Đầu xe 15H-061.14 đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp.');
    const warn = rigConflictBusyMessage('15H-061.14', [], [], '. Vẫn lưu?');
    assert.equal(warn, 'Đầu xe 15H-061.14 đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp. Vẫn lưu?');
    assert.ok(!hard.includes(':') , 'no colon without a reference');
  });

  it('slot suffix: Date and naive wall-time string anchor identically', () => {
    assert.equal(rigHolderSlotSuffix(null), '');
    assert.equal(rigHolderSlotSuffix(new Date('not-a-date')), '');
    // A naive wall time is ALREADY +07 — it renders as written (00:00 wall).
    assert.match(rigHolderSlotSuffix('2026-08-26 00:00:00'), /\(từ 00:00 26-08\)/);
    assert.match(rigHolderSlotSuffix('2026-08-26T00:00:00+07:00'), /\(từ 00:00 26-08\)/);
    // A UTC instant renders in the business zone (00:00Z = 07:00 +07).
    assert.match(rigHolderSlotSuffix(new Date('2026-08-26T00:00:00Z')), /\(từ 07:00 26-08\)/);
  });
});

describe('SIL-666 — the guards build the busy copy through the shared template', () => {
  const detailPlan = read('dispatch-planning-detail-plan.service.ts');
  const conflictScan = read('dispatch-plan-conflict-scan.service.ts');

  it('no guard concatenates the busy template inline anymore (the empty-ref hole)', () => {
    const inline = 'đã được gán cho lô/tác vụ khác trong khung giờ trùng lặp: ';
    assert.ok(!detailPlan.includes(inline), 'detail-plan still builds the busy copy by hand');
    assert.ok(!conflictScan.includes(inline), 'conflict-scan still builds the busy copy by hand');
  });

  it('both guards throw through rigConflictBusyMessage (hard + warn tiers)', () => {
    for (const [name, source] of [['detail-plan', detailPlan], ['conflict-scan', conflictScan]] as const) {
      const sites = source.split('rigConflictBusyMessage(plate,').length - 1;
      assert.equal(sites, 2, `${name}: hard + warn tiers must both use the template (found ${sites})`);
    }
  });

  it('both trip conflict scans carry the identity fields the label law reads', () => {
    assert.match(conflictScan,
      /activeConflictsRaw = await tx\.select\(\{[\s\S]*?code: s\.trips\.tripCode[\s\S]*?shipmentCode: s\.shipments\.shipmentCode[\s\S]*?blNumber: s\.shipments\.blNumber/);
    assert.match(detailPlan,
      /tripConflictsRaw = await tx\.select\(\{[\s\S]*?code: s\.trips\.tripCode[\s\S]*?shipmentCode: s\.shipments\.shipmentCode[\s\S]*?blNumber: s\.shipments\.blNumber/);
  });

  it('both guards attach the trip conflicts to the message', () => {
    assert.ok(detailPlan.includes('tripConflictRefs(tripConflicts)'));
    assert.ok(conflictScan.includes('tripConflictRefs(activeConflicts)'));
  });
});
