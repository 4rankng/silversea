/**
 * SIL-817 (id 946, QA FAIL 16/11 23:13 build dd198999, AC3b) — GET
 * /api/trips/:id must expose the lot's active lệnh phát. The lookup law lives
 * in trip-queries.service.ts (listStuckRunningTrips reads dispatch_handoffs
 * UNSEEN/SEEN per shipment, shape {id, status, handlerId}); the round-2 QA
 * passes saw `activeHandoff` on this very endpoint (handoff 664/776) — the
 * route stopped exposing it and AC3b became unverifiable without the 1-day
 * stuck delay. Static source pins (BE unit tests are db-free per the
 * 2026-10-19 owner ruling); the live response is proven by QA on staging.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const route = readFileSync(join(here, '..', '..', 'routes', 'trips', 'crud.ts'), 'utf8');
const queries = readFileSync(join(here, '..', '..', 'services', 'trip-queries.service.ts'), 'utf8');

test('SIL-817: GET /trips/:id attaches activeHandoff from the shared lookup', () => {
  assert.match(route, /getTripActiveHandoff\(trip\.shipmentId\)/);
  assert.match(route, /res\.json\(\{\s*\.\.\.trip,\s*factorySite,\s*costBreakdown:\s*breakdown,\s*activeHandoff(,\s*paymentTermWarning)?\s*\}\)/);
});

test('SIL-817: the lookup law stays in trip-queries.service (UNSEEN/SEEN, {id, status, handlerId})', () => {
  assert.match(queries, /export async function getTripActiveHandoff\(/);
  const body = queries.slice(
    queries.indexOf('export async function getTripActiveHandoff('),
    queries.indexOf('export async function getTripById('),
  );
  assert.match(body, /IN \('UNSEEN', 'SEEN'\)/);
  assert.match(body, /handlerId: s\.dispatchHandoffs\.handlerId/);
});
