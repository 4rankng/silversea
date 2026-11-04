/**
 * QA 2026-11-04 (e2e flow walk) — createRateAdjustmentRequests answered with
 * `requested: number[]` of SHIPMENT ids, while confirm/withdraw take REQUEST
 * ids (DB row ids). A caller echoing create's array into withdraw silently
 * no-opped (`{"withdrawn":0}`) — reproduced live. The response now also
 * carries `requestIds`: the created rows' ids in the same order as
 * `requested`. Pins the service contract and the frontend client typing.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const client = readFileSync(join(here, '../../../../frontend/src/api/accountingDebitClient.ts'), 'utf8');
const svc = readFileSync(join(here, '../../services/accounting-debit-close.service.ts'), 'utf8');

const create = svc.slice(
  svc.indexOf('export async function createRateAdjustmentRequests'),
  svc.indexOf('export async function confirmRateAdjustmentRequests'),
);

test('create returns requestIds — the created rows, ordered like `requested`', () => {
  assert.match(create, /Promise<\{ requested: number\[\]; alreadyPending: number\[\]; locked: number\[\]; requestIds: number\[\] \}>/);
  assert.match(create, /\.returning\(\{ id: s\.shipmentRateAdjustmentRequests\.id, shipmentId: s\.shipmentRateAdjustmentRequests\.shipmentId \}\)/);
  assert.match(create, /const idByShipment = new Map\(inserted\.map\(\(row\) => \[row\.shipmentId, row\.id\]\)\)/);
  assert.match(create, /const requestIds = requested\.map\(\(shipmentId\) => idByShipment\.get\(shipmentId\)\)/);
});

test('the empty-input early return keeps the four-field shape', () => {
  assert.match(create, /return \{ requested, alreadyPending, locked, requestIds: \[\] \};/);
});

test('frontend client types requestIds on the create call', () => {
  assert.match(client, /sendRateAdjustmentRequests[\s\S]*Promise<\{ requested: number\[\]; alreadyPending: number\[\]; locked: number\[\]; requestIds: number\[\] \}>/);
});
