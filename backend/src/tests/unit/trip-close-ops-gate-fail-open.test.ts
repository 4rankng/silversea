// SIL-694 (id 806) — the Ops expense-declaration completion gate must not
// dead-end trips with no assigned Ops user (source-scan, unit-only tree: no
// db connection, no app boot). QA trip 380: the gate demanded trip-expense
// completion scopes whose ONLY writer (PUT /forwarder/me/trips/:id/expense-
// completion) 404s without a user_shipment_links assignment — every close
// path stayed blocked forever. New law: both close gates fail open without
// an ACTIVE OPS assignment and keep their scope law byte-for-byte with one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const shared = readFileSync(join(here, '../../services/shipment-shared.service.ts'), 'utf8');
const readiness = readFileSync(join(here, '../../services/trip-close-readiness.service.ts'), 'utf8');
const forwarderScope = readFileSync(join(here, '../../services/forwarder-trip-query.service.ts'), 'utf8');

test('SIL-694: the assignment probe keys on the SAME link the Ops toggle requires', () => {
  // The probe mirrors getForwarderByUserId's ACTIVE-OPS definition.
  assert.match(shared, /eq\(s\.users\.role, 'OPS'\)/);
  assert.match(shared, /eq\(s\.users\.status, 'ACTIVE'\)/);
  assert.match(shared, /tripShipmentHasActiveOpsAssignment/);
  assert.match(shared, /eq\(s\.userShipmentLinks\.shipmentId, trip\.shipmentId\)/);
  // The toggle's own scope guard requires the same user_shipment_links row,
  // so "no assignment ⇒ gate fails open" is exactly "gate blocks only when
  // the confirming toggle is reachable".
  assert.match(forwarderScope, /eq\(s\.userShipmentLinks\.userId, forwarderId\)/);
  assert.match(forwarderScope, /Không tìm thấy chuyến đi/);
});

test('SIL-694: governed close — ops gate runs only behind the assignment probe', () => {
  const body = readiness.slice(
    readiness.indexOf('export async function requireTripCloseReadiness'),
    readiness.indexOf('export function assertTripCloseEvidenceBinding'),
  );
  // The e-POD gate stays unconditional…
  const podAt = body.indexOf("currentPod.status === TripPodStatus.DRAFT");
  const probeAt = body.indexOf('await tripShipmentHasActiveOpsAssignment(tx, tripId)');
  assert.ok(podAt > -1 && probeAt > podAt, 'the e-POD gate precedes the ops probe');
  // …while the Ops-scope 409 is wrapped by the probe — exactly one throw,
  // inside the wrapper.
  assert.match(body, /if \(await tripShipmentHasActiveOpsAssignment\(tx, tripId\)\) \{[\s\S]*?Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container\./);
  assert.equal(body.split("'Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container.'").length - 1, 1);
});

test('SIL-694: shipment direct close — same fail-open wrapper', () => {
  const body = shared.slice(
    shared.indexOf('export async function assertShipmentDirectCloseTripReadiness'),
    shared.indexOf('// Trips-split: ops keys come from trips'),
  );
  assert.match(
    body,
    /await tripShipmentHasActiveOpsAssignment\(tx, tripId\)\s*\n\s*&& !hasCompletedExpenseScopes\(/,
  );
  assert.match(body, /Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container\./);
});
