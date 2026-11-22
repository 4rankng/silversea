// SIL-895 — the Chi phí Ops board's KHÁCH HÀNG / NHÀ MÁY column must read the
// SAME catalog-first identity law Kiểm soát phiếu renders: customer via the
// operationalName coalesce (shortName over the legal name) and the factory
// line through the container's catalog site, then the shipment's, with the
// shipment's raw free-text factory standing in LAST. The raw text alone let a
// legal-form company name ("CÔNG TY TNHH MTV …") print whole under the column
// and squeeze the Bill/Cont columns off the board.
//
// listOpsExpenses is a SQL projection (BE unit tests are db-free, owner
// ruling 2026-10-19), so the law is pinned against the service source the way
// sil817-handoff-claim pins its route.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, '../../services/ops-expenses.service.ts'), 'utf8');

const projection = serviceSource.slice(
  serviceSource.indexOf('export async function listOpsExpenses'),
);

test('SIL-895: the accountant board reads customer short names (operationalName coalesce)', () => {
  assert.match(
    projection,
    /customerName: operationalName\(s\.customers\.shortName, s\.customers\.name\)/,
    'KHÁCH HÀNG line must read the house short-name law, never the raw legal name',
  );
});

test('SIL-895: the factory line is catalog-first (container site, shipment site, raw text last)', () => {
  const coalesce = projection.match(
    /factoryName: sql<string \| null>`coalesce\(([\s\S]*?)\)`,/,
  )?.[1] ?? '';
  assert.ok(coalesce, 'listOpsExpenses declares the catalog-first factoryName coalesce');
  const containerIdx = coalesce.indexOf('operationalName(containerFactory.shortName, containerFactory.name)');
  const shipmentIdx = coalesce.indexOf('operationalName(shipmentFactory.shortName, shipmentFactory.name)');
  const rawIdx = coalesce.indexOf("nullif(btrim(${s.shipments.factoryName}), '')");
  assert.ok(containerIdx !== -1, 'the container catalog site comes first');
  assert.ok(shipmentIdx !== -1, 'the shipment catalog site is the second tier');
  assert.ok(rawIdx !== -1, 'the raw free-text factory stays as the last fallback');
  assert.ok(containerIdx < shipmentIdx && shipmentIdx < rawIdx, 'fallback order is container → shipment → raw');
});

test('SIL-895: both catalog sites are joined (container-level and shipment-level)', () => {
  assert.match(
    projection,
    /\.leftJoin\(containerFactory, eq\(containerFactory\.id, s\.shipmentContainers\.operationalSiteId\)\)/,
  );
  assert.match(
    projection,
    /\.leftJoin\(shipmentFactory, eq\(shipmentFactory\.id, s\.shipments\.operationalSiteId\)\)/,
  );
});
