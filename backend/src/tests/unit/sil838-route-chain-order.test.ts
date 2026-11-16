/**
 * SIL-838 round-3 (id 967, QA 16/11 19:51 SGT build dd198999) — the chot-debit
 * '→' tuyến line is a PICKUP → DELIVERY pair. Round-2 landed the chain but let
 * a route CATALOG NAME (no arrow: 'KCN QUẾ VÕ, BẮC NINH') resolve in the
 * container/trip tiers and mask the pair the ticket asks for — QA read the
 * arrow-less name as factory text and the line as missing on R3M-KR1/R3M-KR2/
 * R3K-J1/R3P-KR1 (containers carry cảng nâng/hạ — intake-required) and on LCL
 * R3Q-679-B/JWLEM26100907 (pickupLocation/deliveryLocation — FB-105). This pin
 * keeps the tier ORDER honest in the board projection source: every pair tier
 * sits above every arrow-less catalog fallback. Static source pins (BE unit
 * tests are db-free per the 2026-10-19 owner ruling); the rendered board rows
 * are proven by the qa driver (testplan/qa/scripts/2026-11-16-sil838-ui-verify.mjs).
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

test('SIL-838 round-3: the container tier label leads with the cảng nâng → cảng hạ pair', () => {
  const label = source.slice(
    source.indexOf('const debitBoardContainerRouteLabel'),
    source.indexOf('const debitBoardTripRoute'),
  );
  const pickupArm = label.indexOf("nullif(btrim(${debitBoardPickupPort.name}), '') || ' → ' || nullif(btrim(${debitBoardDropPort.name}), '')");
  assert.ok(pickupArm >= 0, 'port-pair arm present in the container label');
  const catalogArm = label.indexOf('operationalName(debitBoardContainerRoute');
  assert.ok(pickupArm < catalogArm, 'the pair arm outranks the route catalog name');
});

test('SIL-838 round-3: the trip tier is the CANONICAL PAIR only — no inline catalog fallback', () => {
  const label = source.slice(
    source.indexOf('const debitBoardTripRouteLabel'),
    source.indexOf('const debitBoardTripRouteCatalogLabel'),
  );
  assert.match(label, /canonicalOrigin[\s\S]*' → '[\s\S]*canonicalDestination/);
  assert.doesNotMatch(label, /debit_board_trip_route\.(short_name|name)/);
});

test('SIL-838 round-3: chain order — container pair → trip pair → LCL points → trip catalog → ROUTE_DISPLAY_NAME → factory route', () => {
  const chain = chainSlice(source);
  const tiers = [
    ['container pair tier', 'debit_board_pickup_port'],
    ['trip canonical pair tier', 'debitBoardTripRouteLabel'],
    ['LCL operating points tier', 'pickupLocation'],
    ['trip catalog fallback tier', 'debitBoardTripRouteCatalogLabel'],
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

test('SIL-838 round-3: the trip catalog fallback tier keeps its own routes join', () => {
  const chain = chainSlice(source);
  const catalogTier = chain.slice(
    chain.indexOf('debitBoardTripRouteCatalogLabel'),
    chain.indexOf('ROUTE_DISPLAY_NAME'),
  );
  assert.match(catalogTier, /left join \$\{s\.routes\} debit_board_trip_route/);
});
