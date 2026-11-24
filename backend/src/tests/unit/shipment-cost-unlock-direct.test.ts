/**
 * Locked-lot unlock per KB Ch.10 §10.1.5 (ruling 24/11): the ticketing
 * [Đề nghị điều chỉnh] flow is rejected (Scope Creep, ngoài SRS V6.0) — no
 * route, handler, service or schema may serve it. A locked lot unlocks
 * directly through unlockShipmentCost (Quản trị · Giám đốc · Kế toán) with a
 * mandatory reason and one audit row carrying the unlocker's role, the
 * reason and the moment. Static source pins (BE unit tests are db-free per
 * the 2026-10-19 owner ruling).
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
const core = readFileSync(join(here, '../../db/schema/core.ts'), 'utf8');

test('no route, handler, service or table serves the rejected adjustment-request flow', () => {
  assert.ok(!routes.includes('cost-adjust-requests'), 'no cost-adjust-requests route');
  assert.ok(!svc.includes('requestShipmentCostAdjust'), 'no request service');
  assert.ok(!svc.includes('listPendingShipmentCostAdjustRequests'), 'no pending queue');
  assert.ok(!schema.includes('shipmentCostAdjustRequests'), 'no request table in schema');
  assert.ok(!svc.includes('shipmentCostAdjustRequests'), 'unlock never touches request rows');
});

test('the direct unlock demands a reason and logs role + reason + moment', () => {
  const unlockBody = svc.slice(svc.indexOf('export async function unlockShipmentCost'), svc.indexOf('export interface ShipmentCostLockHistoryEvent'));
  assert.match(unlockBody, /if \(!reason\) throw new ApiError\(400/, 'reason is mandatory');
  assert.match(unlockBody, /await tx\.insert\(s\.auditLogs\)\.values\(\{[\s\S]*?message: 'SHIPMENT_COST_UNLOCKED'/, 'one audit row per unlock');
  assert.match(unlockBody, /payload: \{ lockId: active\.id, reason, role: input\.actor\.role \}/, 'the log carries the unlocker role + reason');
  assert.match(unlockBody, /unlockedAt: new Date\(\)/, 'the lock row stamps the moment');
  const auditTable = core.slice(core.indexOf('auditLogs = pgTable'), core.indexOf('(table) => [', core.indexOf('auditLogs = pgTable')));
  assert.match(auditTable, /timestamp: timestamp\('timestamp'\)\.defaultNow\(\)\.notNull\(\)/, 'the audit row stamps its moment');
});
