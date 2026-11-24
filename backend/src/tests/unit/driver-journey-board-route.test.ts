// SIL-946 (KB Ch.10 §10.4.2) — the journey card's line under the factory
// name is the TUYẾN (the route the owner configured), never the factory site
// address.
//
// The route catalog carries two labels: routes.name ("KCN Quế Võ, Nam Sơn,
// Bắc Ninh" — the address-shaped long name) and routes.short_name ("KCN
// QUẾ VÕ, BẮC NINH" — the operational label). The trip payload already
// returns the short name (driver.service.ts ROUTE_OPERATIONAL_NAME), so the
// board MUST resolve the same label: the card and the trip detail must match
// 100%, and a card that showed the long name read as the address (QA
// 24/11, driver btdung / my-trips, build df7b2a73).
//
// Db-free unit tree (2026-10-19 owner ruling): the board query is db-bound,
// so the label law is pinned on the source.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const board = readFileSync(join(here, '../../services/driver-journey-board.service.ts'), 'utf8');
const detail = readFileSync(join(here, '../../services/driver.service.ts'), 'utf8');

test('SIL-946 — the card route label is the route SHORT name, not the address-shaped long name', () => {
  assert.match(board, /routeName: operationalName\(s\.routes\.shortName, s\.routes\.name\),/);
  // The long name must not reach the card on its own.
  assert.doesNotMatch(board, /routeName: s\.routes\.name,/);
});

test('SIL-946 — card and trip detail resolve the route label from the same helper', () => {
  assert.match(detail, /const ROUTE_OPERATIONAL_NAME = operationalName\(s\.routes\.shortName, s\.routes\.name\);/);
});
