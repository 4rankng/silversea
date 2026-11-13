// SIL-815 (id 943, UAT 12/11) — the journey card's container strip must read
// the trip's OWN containers (trip_containers), the exact grain the Chi tiết
// lệnh screen renders (listTripContainers). The old wire had only the
// fulfillment-bound shipment container (shipment_fulfillments.
// shipment_container_id), so driver 15H-104.03's card for R3P-677-R showed
// 1 cont (RTAU4011047) while the trip — and the detail screen — carried 2
// (RTAU4011047 + RTAU4011052): label + cont list between the card and the
// detail must match 100%.
//
// Db-free unit tree (2026-10-19 owner ruling): the board query itself is
// db-bound, so the grain laws are pinned on the source — the aggregate rides
// the trip, the not-yet-typed fallback keeps the declared container, and the
// declared-payload mirror (card 091026164520) applies to single-cont trips
// only, byte-for-byte the detail's own override law.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const board = readFileSync(join(here, '../../services/driver-journey-board.service.ts'), 'utf8');
const boardSlice = board.slice(
  board.indexOf('export async function getDriverJourneyBoard'),
  board.indexOf('const { items: tagRows }'),
);

test('the card container grain rides the trip (trip_containers aggregate), not the fulfillment binding', () => {
  // The aggregate selects the trip's own rows in id order — the same grain
  // listTripContainers renders on the detail screen.
  assert.match(boardSlice, /from \$\{s\.tripContainers\} tc/);
  assert.match(boardSlice, /left join \$\{s\.containerTypes\} ct on ct\.id = tc\.container_type_id/);
  assert.match(boardSlice, /where tc\.trip_id = \$\{s\.trips\.id\}/);
  assert.match(boardSlice, /json_agg\(json_build_object\(\s*'containerNumber', tc\.container_number/);
  assert.match(boardSlice, /order by tc\.id/);
  // The wire carries the list (and the singular fields stay for back-compat).
  assert.match(boardSlice, /containers: cardContainers,/);
});

test('a trip with no typed trip_containers falls back to the fulfillment-bound declared container', () => {
  assert.match(boardSlice, /tripContainers\.length > 0\s*\?\s*tripContainers\s*:\s*\[\{/);
  assert.match(boardSlice, /containerNumber: row\.containerNumber,/);
});

test('declared-payload mirror (card 091026164520) applies to a single-cont trip, mirroring the detail override', () => {
  assert.match(boardSlice, /if \(cardContainers\.length === 1 && declaredPayload != null\) \{\s*cardContainers\[0\] = \{ \.\.\.cardContainers\[0\], cargoWeightKg: declaredPayload \};\s*\}/);
});

test('multi-cont trips keep the trip-local weights — list and detail match 100%', () => {
  assert.match(boardSlice, /cargoWeightKg: entry\.cargoWeightKg == null \|\| entry\.cargoWeightKg === ''/);
});
