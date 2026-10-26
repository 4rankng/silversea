// SIL-495 — the /ops/orders search box advertises
// "Bill/Booking · Khách hàng · Số cont", but listOpsOrders' WHERE only
// matched shipmentCode / customer name / container numbers: searching the
// Bill/Booking code shown IN the rows ("R42DIS-01", "R42…") returned
// "0 lô". The service is db-bound (BE unit-only ruling 2026-10-19: no
// connection, no app boot), so this pin asserts the SEARCH LAW the query
// carries — every advertised surface must be in the or() needle list, the
// Bill/Booking pair bl_number + booking_ref first among them.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const svc = readFileSync(join(here, '../../services/ops-orders.service.ts'), 'utf8');

/** The search block of listOpsOrders (needle → or(...) conditions). */
const searchBlock = () => {
  const start = svc.indexOf('if (search && search.trim())');
  const end = svc.indexOf('const rows = await db');
  assert.ok(start > 0 && end > start, 'search block not found in ops-orders.service.ts');
  return svc.slice(start, end);
};

test('SIL-495: search khớp đúng cột Bill/Booking hiển thị (bl_number + booking_ref)', () => {
  const block = searchBlock();
  // The rendered "Bill / Booking" column is the case
  // trade_direction='IMPORT' → bl_number else booking_ref — BOTH columns
  // must ride the needle or an advertised search keeps returning 0 lô.
  assert.match(block, /ilike\(s\.shipments\.blNumber, needle\)/);
  assert.match(block, /ilike\(s\.shipments\.bookingRef, needle\)/);
});

test('SIL-495: các mặt còn lại của placeholder không bị mất (mã lô · khách hàng · số cont)', () => {
  const block = searchBlock();
  assert.match(block, /ilike\(s\.shipments\.shipmentCode, needle\)/);
  assert.match(block, /ilike\(s\.customers\.name, needle\)/);
  assert.match(block, /sc\.container_number ilike \$\{needle\}/);
});

test('SIL-495: needle là chuỗi trim + LIKE wildcard (không exact-match)', () => {
  const block = searchBlock();
  assert.match(block, /const needle = `%\$\{search\.trim\(\)\}%`/);
});
