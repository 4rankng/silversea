/**
 * SIL-679 r2 (QA comment 3834 §1) — audit observability for the lot cost
 * lock. QA: every lock-related GET 404'd and the lock/unlock responses
 * carried id only, so no surface could show who unlocked, why, when, or the
 * lot's lock/unlock history. Static source pins + route pins (unit-only
 * tree, 2026-10-19 owner ruling — the db-bound read cannot run here):
 *   - POST lock/unlock responses carry the audit fields themselves;
 *   - GET /:id/cost-lock-history is ADMIN-only and returns the LOCK/UNLOCK
 *     event list (actor name, reason, timestamp) with the unreleased Debit
 *     Note claim attached.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');
const routes = readFileSync(join(here, '../../routes/shipments/core.routes.ts'), 'utf8');

const history = () => svc.slice(
  svc.indexOf('export interface ShipmentCostLockHistoryEvent'),
  svc.indexOf('export interface AdjustShipmentCostInput'),
);
const lockRoute = () => routes.slice(
  routes.indexOf("coreRoutes.post(\n  '/:id/lock'"),
  routes.indexOf('// ─── POST /:id/unlock'),
);
const unlockRoute = () => routes.slice(
  routes.indexOf("coreRoutes.post(\n  '/:id/unlock'"),
  routes.indexOf('// ─── GET /:id/cost-lock-history'),
);
const historyRoute = () => routes.slice(
  routes.indexOf('// ─── GET /:id/cost-lock-history'),
  routes.indexOf('// ─── POST/GET /:id/cost-adjustments'),
);

test('lock response carries actor, timestamp and note — never id-only', () => {
  const body = svc.slice(svc.indexOf('export async function lockShipmentCost'), svc.indexOf('export interface UnlockShipmentCostInput'));
  assert.match(body, /lockedByName: input\.actor\.fullName \?\? input\.actor\.username \?\? null/);
  assert.match(body, /lockedAt: row\.lockedAt\.toISOString\(\)/);
  assert.match(body, /lockNote: row\.lockNote/);
  // The route forwards the whole audit payload, not an id wrapper.
  assert.match(lockRoute(), /res\.status\(201\)\.json\(lock\);/);
  assert.doesNotMatch(lockRoute(), /res\.status\(201\)\.json\(\{ id: lock\.id \}\)/);
});

test('unlock response carries actor, timestamp and reason — never id-only', () => {
  const body = svc.slice(svc.indexOf('export async function unlockShipmentCost'), svc.indexOf('export interface ShipmentCostLockHistoryEvent'));
  assert.match(body, /unlockedByName: input\.actor\.fullName \?\? input\.actor\.username \?\? null/);
  assert.match(body, /unlockedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(body, /unlockReason: reason/);
  assert.match(unlockRoute(), /res\.status\(200\)\.json\(lock\);/);
  assert.doesNotMatch(unlockRoute(), /res\.status\(200\)\.json\(\{ id: lock\.id \}\)/);
});

test('history GET is ADMIN-only (the unlock governance mirrors its read clearance)', () => {
  assert.match(historyRoute(), /requireRoles\(Role\.ADMIN\)/);
  assert.match(historyRoute(), /'\/:id\/cost-lock-history'/);
  assert.match(historyRoute(), /listShipmentCostLockHistory\(shipmentId\)/);
  // A read, not a material write — no declareMaterialWrite on the history route.
  assert.doesNotMatch(historyRoute(), /declareMaterialWrite/);
});

test('history builds LOCK + UNLOCK events with actor name, reason, timestamp', () => {
  const body = history();
  // Both aliases resolve real names (actor id alone was the QA complaint —
  // "response chỉ có id").
  assert.match(body, /const locker = alias\(s\.users, 'cost_lock_locker'\);/);
  assert.match(body, /const unlocker = alias\(s\.users, 'cost_lock_unlocker'\);/);
  assert.match(body, /action: 'LOCK'/);
  assert.match(body, /reason: row\.lockNote \?\? null/);
  assert.match(body, /action: 'UNLOCK'/);
  assert.match(body, /reason: row\.unlockReason \?\? null/);
  assert.match(body, /timestamp: row\.unlockedAt\.toISOString\(\)/);
  // Chronological: locked order first, one event per lock plus its unlock.
  assert.match(body, /orderBy\(asc\(s\.shipmentCostLocks\.lockedAt\), asc\(s\.shipmentCostLocks\.id\)\)/);
  assert.match(body, /if \(row\.unlockedAt != null\) \{/);
});

test('history attaches the lot\u2019s unreleased Debit Note claim (liên kết debit note nếu có)', () => {
  const body = history();
  assert.match(body, /isNull\(s\.debitNoteLots\.releasedAt\)/);
  assert.match(body, /const debitNoteId = claims\[0\]\?\.documentId \?\? null;/);
  assert.match(body, /debitNoteId,/);
});

test('history 404s a missing or soft-deleted lot with the house message', () => {
  assert.match(history(), /if \(!shipment \|\| shipment\.deletedAt\) throw new ApiError\(404, 'Lô hàng không tồn tại hoặc đã bị xóa\.'\)/);
});
