/**
 * Audit 2026-11-04 §2.1 — Mở khóa lô (unlock the lot cost lock). Static
 * source pins (unit-only tree: no db connection, no app boot, per the
 * 2026-10-19 owner ruling). The db-bound unlock cannot run here; these pins
 * assert the LAW the service + route carry:
 *   - unlock closes the ACTIVE lock (unlockedBy/unlockedAt/unlockReason),
 *     never deletes history — a re-lock inserts a NEW active row (the partial
 *     unique index permits it);
 *   - reason is mandatory, 1–2000 chars (lock-family bounds);
 *   - no active lock ⇒ 409 with the dedicated message;
 *   - a lot claimed by an unreleased Debit Note refuses unlock naming the
 *     document (mirror of expense-accounting-correction's claim guard);
 *   - the accounting lock is deliberately NOT asserted on unlock;
 *   - route gate is Quản trị · Giám đốc · Kế toán (SIL-721, owner 07/11 —
 *     supersedes SIL-679's admin-only clearance; MANAGER is the role
 *     'Giám đốc' accounts hold per seed-prod ROLE_BY_GROUP).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/shipment-cost-lock.service.ts'), 'utf8');
const routes = readFileSync(join(here, '../../routes/shipments/core.routes.ts'), 'utf8');
const schema = readFileSync(join(here, '../../db/schema/financial.ts'), 'utf8');

const unlock = () => svc.slice(
  svc.indexOf('export async function unlockShipmentCost'),
  svc.indexOf('export interface AdjustShipmentCostInput'),
);
const unlockRoute = () => routes.slice(
  routes.indexOf("coreRoutes.post(\n  '/:id/unlock'"),
  routes.indexOf('// ─── POST/GET /:id/cost-adjustments'),
);

test('unlock closes the ACTIVE lock with actor + reason + timestamp (never deletes)', () => {
  const body = unlock();
  assert.match(body, /from\(s\.shipmentCostLocks\)[\s\S]*?isNull\(s\.shipmentCostLocks\.unlockedAt\)/);
  assert.match(body, /\.for\('update'\)/);
  assert.match(body, /tx\.update\(s\.shipmentCostLocks\)\.set\(\{\s*unlockedBy: input\.actor\.userId,\s*unlockedAt: new Date\(\),\s*unlockReason: reason,\s*\}\)/);
  // History survives: the update targets ONLY the active row by id — no
  // delete, no snapshot rewrite ("mở kỳ mới không đổi số đã khóa").
  assert.doesNotMatch(body, /tx\.delete\(s\.shipmentCostLocks\)/);
  assert.doesNotMatch(body, /costSnapshot/);
});

test('unlock writes its audit record inside the same transaction', () => {
  const body = unlock();
  assert.match(body, /tx\.insert\(s\.auditLogs\)\.values\(\{\s*userId: input\.actor\.userId,/);
  assert.match(body, /message: 'SHIPMENT_COST_UNLOCKED'/);
});

test('reason is mandatory with the lock-family bounds (1–2000, 400 on empty)', () => {
  const body = unlock();
  assert.match(body, /const reason = input\.reason\?\.trim\(\) \?\? '';/);
  assert.match(body, /if \(!reason\) throw new ApiError\(400, 'Vui lòng nhập lý do mở khóa\.'\)/);
  assert.match(body, /reason\.length > 2000/);
});

test('no active lock ⇒ 409 with the dedicated message', () => {
  assert.match(unlock(), /if \(!active\) throw new ApiError\(409, 'Lô hàng chưa khóa chi phí — không có khóa nào để mở\.'\)/);
});
test('a lot claimed by an unreleased Debit Note refuses unlock naming the document', () => {
  const body = unlock();
  assert.match(body, /from\(s\.debitNoteLots\)[\s\S]*?eq\(s\.debitNoteLots\.shipmentId, input\.shipmentId\)/);
  assert.match(body, /isNull\(s\.debitNoteLots\.releasedAt\)/);
  assert.match(body, /Lô đã nằm trong Debit Note #\$\{claim\.documentId\} — xử lý chứng từ trước khi mở khóa lô\./);
});

test('unlock deliberately does NOT assert the accounting lock (that lock keeps its own ADMIN reopen)', () => {
  assert.doesNotMatch(unlock(), /assertShipmentAccountingUnlocked/);
});

test('re-lock after unlock lands as a NEW active row (partial unique index)', () => {
  // lockShipmentCost's active check reads unlockedAt IS NULL — an unlocked
  // history row no longer matches, so the insert creates a fresh active lock.
  const lockBody = svc.slice(
    svc.indexOf('export async function lockShipmentCost'),
    svc.indexOf('export interface UnlockShipmentCostInput'),
  );
  assert.match(lockBody, /isNull\(s\.shipmentCostLocks\.unlockedAt\)/);
  assert.match(lockBody, /tx\.insert\(s\.shipmentCostLocks\)/);
  assert.match(schema, /shipment_cost_locks_active_uniq.*\.where\(sql`unlocked_at is null`\)/);
});

test('the 409 message names the three-role unlock channel (SIL-721 clean cutover)', () => {
  assert.match(
    svc,
    /export const SHIPMENT_COST_LOCKED_MESSAGE = 'Lô hàng đã khóa chi phí\. Cần Quản trị, Giám đốc hoặc Kế toán mở khóa \(kèm lý do\) để chỉnh sửa chi phí\.';/,
  );
  assert.doesNotMatch(svc, /Cần ADMIN mở khóa/);
  assert.doesNotMatch(svc, /sẽ cấp sau/);
});

test('route: Quản trị · Giám đốc (MANAGER) · Kế toán gate + reason body + optimistic version', () => {
  const route = unlockRoute();
  assert.match(route, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT\)/);
  // Other roles stay out — CUS locks but never unlocks (SIL-721 scope).
  assert.doesNotMatch(route, /Role\.CUS|Role\.DISPATCHER|Role\.OPS|Role\.DRIVER/);
  assert.match(route, /reason: z\.string\(\)\.trim\(\)\.min\(1, 'Vui lòng nhập lý do mở khóa\.'\)\.max\(2000\)/);
  assert.match(route, /expectedShipmentVersion: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
  assert.match(route, /declareMaterialWrite\('shipments\.cost-unlock'/);
});

test('route registers its durable boundary in the material-write registry', () => {
  const registry = readFileSync(join(here, '../material-write-registry-exhaustive.test.ts'), 'utf8');
  assert.match(registry, /\['shipments\/core\.routes\.ts\|POST\|\/:id\/unlock', \{\s*serviceFile:[^}]*marker: 'export async function unlockShipmentCost\('/);
});
