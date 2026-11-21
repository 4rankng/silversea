/**
 * SIL-865 (hotfix CR-009.1, 21/11) — the chot-debit Lô column's TUYẾN ĐƯỜNG
 * line names the ROUTE, in catalog-name form ('KCN Đồng Văn, Hà Nam'), and
 * the customer struck every cảng-named tier from the column: the port-pair
 * tiers of SIL-838 round-3 (container cảng nâng→hạ, trip canonicalOrigin→
 * destination, LCL pickup/delivery points) printed 'Cảng Đình Vũ → Cảng
 * Đình Vũ' / 'Cảng Mipec → Cảng Vimc' where a tuyến belongs, and a route-less
 * lot must stay NULL (the FE renders no line / '—'), never a port name.
 * The nhà máy line likewise lost its warehouse-site fallback (pickup
 * warehouse sites are port-named on prod). This pin keeps the chain honest
 * in the board projection source. Static source pins (BE unit tests are
 * db-free per the 2026-10-19 owner ruling).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', '..', 'services', 'accounting-debit-close.service.ts'), 'utf8');

function chainSlice(source: string): string {
  const start = source.indexOf('routeName: sql<string | null>`coalesce(');
  assert.ok(start >= 0, 'routeName chain present');
  const end = source.indexOf(')`', start);
  return source.slice(start, end);
}

test('SIL-865: the route chain carries NO port-pair tier anywhere', () => {
  const chain = chainSlice(source);
  assert.ok(!chain.includes('pickupPort'), 'no cảng nâng port join in the chain');
  assert.ok(!chain.includes('dropoffPortId'), 'no cảng hạ port join in the chain');
  assert.ok(!chain.includes('canonicalOrigin'), 'no trip canonical port pair in the chain');
  assert.ok(!chain.includes('pickupLocation'), 'no LCL operating points pair in the chain');
  assert.ok(!chain.includes("|| ' → ' ||"), 'no hand-built arrow pair in the chain');
});

test('SIL-865: chain order — trip catalog → container catalog → ROUTE_DISPLAY_NAME → factory route', () => {
  const chain = chainSlice(source);
  const tiers = [
    ['trip route catalog tier', 'debitBoardTripRouteCatalogLabel'],
    ['container route catalog tier', 'debitBoardContainerRouteCatalogLabel'],
    ['ROUTE_DISPLAY_NAME tier', 'ROUTE_DISPLAY_NAME'],
    ['factory site route tier', 'debitBoardFactoryRoute'],
  ].map(([name, marker]) => {
    const at = chain.indexOf(marker);
    assert.ok(at >= 0, `${name} present in the chain`);
    return { name, at };
  });
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(tiers[i].at > tiers[i - 1].at, `${tiers[i].name} must sit after ${tiers[i - 1].name}`);
  }
});

test('SIL-865: every catalog tier keeps its own routes join', () => {
  const chain = chainSlice(source);
  const tripTier = chain.slice(
    chain.indexOf('debitBoardTripRouteCatalogLabel'),
    chain.indexOf('debitBoardContainerRouteCatalogLabel'),
  );
  assert.match(tripTier, /left join \$\{s\.routes\} debit_board_trip_route/);
  const containerTier = chain.slice(
    chain.indexOf('debitBoardContainerRouteCatalogLabel'),
    chain.indexOf('ROUTE_DISPLAY_NAME'),
  );
  assert.match(containerTier, /left join \$\{s\.routes\} debit_board_container_route/);
});

test('SIL-865: the factoryName coalesce has no warehouse-site fallback', () => {
  const start = source.indexOf('factoryName: sql<string | null>`coalesce(');
  assert.ok(start >= 0, 'factoryName coalesce present');
  const body = source.slice(start, source.indexOf(')`', start));
  assert.ok(!body.includes('WarehouseSite'), 'no warehouse site tier in factoryName');
  assert.match(body, /debitBoardFactorySite/);
  assert.match(body, /shipments\.factoryName/);
});
