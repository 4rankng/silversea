/**
 * SIL-601 (id 702, owner ruling 30/10/2026) — "mỗi lô hàng lẻ tương đương
 * 1 lô cont chỉ có 1 cont": one LCL lot counts as exactly ONE container at
 * every lot/container-unit site — never 0 (empty shipment_containers rows),
 * never Σ (a multi-trip lot). FCL keeps its real count.
 *
 * The shared law itself is pinned in shared/src/constants/lcl-lot-cont.test.ts;
 * this file pins the backend call sites — every per-lot cont count routes LCL
 * through the law (static source scan; the backend tree is unit-only by the
 * 2026-10-19 owner ruling, so the DB paths cannot be exercised here).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const service = (name: string) =>
  readFileSync(join(here, '../../services', name), 'utf8');

test('SIL-601-C2 debit-summary phone meta: LCL routes through the count law', () => {
  const source = service('shipment-debit-summary.service.ts');
  assert.match(source, /containerCount:\s*effectiveLotContainerCount\(lot\.cargoMode,/);
});

test('SIL-601-C3 detail reads: the lot count routes through the law', () => {
  const source = service('shipment-detail-reads.service.ts');
  assert.match(source, /containerCount:\s*effectiveLotContainerCount\(shipment\.cargoMode,\s*containers\.length\)/);
});

test('SIL-601-C3 CUS workspace totalContainers: LCL reads 1, sub-counts stay row-based', () => {
  const source = service('cus-workspace-builders.service.ts');
  assert.match(source, /const totalContainers = effectiveLotContainerCount\(row\.shipment\.cargoMode,\s*containers\.length\)/);
});

test('SIL-601-C3 forwarder summary: LCL counts 1 instead of the empty row count', () => {
  const source = service('forwarder-trip-query.service.ts');
  assert.match(source, /CASE WHEN \$\{s\.shipments\.cargoMode\} = 'LCL' THEN 1/);
});

test('SIL-601-C3 billing draft qty: LCL renders 1, FCL keeps `|| null`', () => {
  const source = service('billing-document-draft.service.ts');
  assert.match(source, /containerCount:\s*input\.trip\.cargoMode === 'LCL' \? 1 : \(containerCount \|\| null\)/);
});

test('SIL-601-C3 ops orders: the count reads 1 for LCL, numbered count for FCL', () => {
  const source = service('ops-orders.service.ts');
  assert.match(source, /containerCount:\s*row\.cargoMode === 'LCL' \? 1 : numbered\.length/);
});

test('SIL-601-C3 dispatch readiness: LCL never warns about its lawful 0 rows', () => {
  const source = service('shipment-documents.service.ts');
  assert.match(source, /containerCount === 0 && shipment\.cargoMode !== s\.CARGO_MODE\.LCL/);
});

test('SIL-601-C3 settlement expenses carry cargoMode for the FE count law', () => {
  const source = service('advance-settlement.service.ts');
  assert.match(source, /cargoMode:\s*s\.shipments\.cargoMode/);
});
