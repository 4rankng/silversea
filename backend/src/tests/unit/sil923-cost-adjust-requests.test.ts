/**
 * SIL-923 — Đề nghị điều chỉnh trên lô đã khóa chi phí: sau khi khóa, nút
 * [Khóa lô] nhường chỗ cho [Đề nghị điều chỉnh] (người khóa mà không có
 * quyền mở khóa — nhóm CUS) hoặc [Mở khóa] (bộ mở khóa Quản trị · Giám đốc ·
 * Kế toán). BE: bảng `shipment_cost_adjust_requests`, POST
 * /:id/cost-adjust-requests (gate mirrors /lock), GET
 * /cost-adjust-requests/pending (gate mirrors /unlock, SIL-721), và mở khóa
 * giải quyết mọi đề nghị PENDING của lô. Static source pins (BE unit tests
 * are db-free per the 2026-10-19 owner ruling).
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

test('SIL-923 route: POST /:id/cost-adjust-requests gates CUS·ACCOUNTANT·ADMIN and demands idempotency', () => {
  const block = routes.slice(routes.indexOf("'/:id/cost-adjust-requests'"), routes.indexOf('/cost-adjust-requests/pending'));
  assert.ok(block.includes("declareMaterialWrite('shipments.cost-adjust-request'"), 'material-write envelope present');
  assert.match(block, /requireRoles\(Role\.CUS, Role\.ACCOUNTANT, Role\.ADMIN\)/);
  assert.match(block, /assertCusLotVisible\(shipmentId, getUser\(req\)\)/, 'CUS scope law mirrors /lock');
  assert.match(block, /requireShipmentIdempotencyKey\(req/);
  assert.match(block, /reason: z\.string\(\)\.trim\(\)\.min\(1/);
  assert.match(block, /requestShipmentCostAdjust\(\{/);
});

test('SIL-923 route: GET /cost-adjust-requests/pending reads under the unlock trio clearance', () => {
  const block = routes.slice(routes.indexOf("'/cost-adjust-requests/pending'"));
  assert.match(block, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT\)/);
  assert.match(block, /listPendingShipmentCostAdjustRequests\(\)/);
});

test('SIL-923 service: a request exists only on an ACTIVE cost lock, replayed by key', () => {
  const fn = svc.slice(svc.indexOf('export async function requestShipmentCostAdjust'), svc.indexOf('export async function listPendingShipmentCostAdjustRequests'));
  assert.match(fn, /SHIPMENT_COST_NOT_LOCKED_MESSAGE/, '409 when the lot is not locked');
  assert.match(fn, /idempotencyKey, input\.idempotencyKey\)\)\s*\.limit\(1\)/, 'replay lookup by key');
  assert.match(fn, /reason\.length > 2000/, 'reason cap mirrors the unlock/adjust channel');
  assert.match(fn, /SHIPMENT_COST_ADJUST_REQUESTED/, 'audit row names the request');
  assert.match(fn, /persistNotificationInTx/, 'the handling trio gets a bell entry');
  assert.match(fn, /targetRoles: \[Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT\]/);
});

test('SIL-923 service: the pending queue filters PENDING + non-deleted lots, newest first', () => {
  const fn = svc.slice(svc.indexOf('export async function listPendingShipmentCostAdjustRequests'), svc.indexOf('/** Ruling 2026-09-19'));
  assert.match(fn, /eq\(s\.shipmentCostAdjustRequests\.status, 'PENDING'\)/);
  assert.match(fn, /isNull\(s\.shipments\.deletedAt\)/);
  assert.match(fn, /desc\(s\.shipmentCostAdjustRequests\.requestedAt\)/);
});

test('SIL-923 service: unlocking the lot resolves its PENDING requests with the unlock reason', () => {
  const unlockBody = svc.slice(svc.indexOf('export async function unlockShipmentCost'), svc.indexOf('export interface ShipmentCostLockHistoryEvent'));
  assert.match(unlockBody, /export async function unlockShipmentCost/);
  const resolveBlock = unlockBody.slice(unlockBody.indexOf('SIL-923'), unlockBody.indexOf('await tx.insert(s.auditLogs)'));
  assert.match(resolveBlock, /status: 'RESOLVED'/);
  assert.match(resolveBlock, /resolvedBy: input\.actor\.userId/);
  assert.match(resolveBlock, /resolutionNote: reason/);
  assert.match(resolveBlock, /eq\(s\.shipmentCostAdjustRequests\.status, 'PENDING'\)/);
});

test('SIL-923 schema: one row per idempotency key + a PENDING lookup index', () => {
  const table = schema.slice(schema.indexOf('shipmentCostAdjustRequests = pgTable'), schema.indexOf('Card 20260921_21'));
  assert.match(table, /idempotencyKey: varchar\('idempotency_key', \{ length: 120 \}\)\.notNull\(\)\.unique\(\)/);
  assert.match(table, /status: varchar\('status', \{ length: 16 \}\)\.notNull\(\)\.default\('PENDING'\)/);
  assert.match(table, /index\('shipment_cost_adjust_requests_pending_idx'\)/);
});
