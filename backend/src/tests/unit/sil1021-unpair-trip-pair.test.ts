/**
 * SIL-1021 — Không có cách nào hủy ghép cặp Kẹp/Kết hợp đã tạo (KB Ch.3
 * §3.5 K3.50: cặp ghép phải hủy được — hủy xong cập nhật quan hệ cặp, lịch
 * xe, cước và lương; không cần phê duyệt; thử lại không nhân đôi).
 *
 * Before this ticket: no endpoint existed (DELETE /api/trips/pairs/50 → 404,
 * POST .../unpair → 404, POST .../cancel → 403) and the paired row's ⋯ menu
 * only carried "Hủy phân xe" (cancels the whole dispatch, not the pair).
 *
 * The law: POST /api/trips/pairs/:id/unpair (dispatcher seat, symmetric with
 * the create) breaks the pair through breakPersistedTripPair — the same
 * governed break the cancellation flow uses — with breakReason UNPAIRED,
 * both legs surviving. The second trip's netted VETC toll restores (the
 * survivor branch targets the second trip), the stashed standard wage
 * returns, the PHÂN LOẠI stamps revert to Đơn (SIL-1020), and an already
 * broken pair answers the deterministic 409 — a retry can never double the
 * restore.
 *
 * BE unit-only ruling: the DB-bound command is pinned by source-scan (the
 * file's established pattern); the route mount is pinned the same way
 * sil668 pins POST /pairs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pairsSource = readFileSync(
  path.join(here, '../../services/trip-pairs.service.ts'),
  'utf8',
);
const routesSource = readFileSync(
  path.join(here, '../../routes/trips/crud.ts'),
  'utf8',
);
const tripsSchemaSource = readFileSync(
  path.join(here, '../../db/schema/trips.ts'),
  'utf8',
);
const journal = JSON.parse(readFileSync(
  path.join(here, '../../../drizzle/meta/_journal.json'),
  'utf8',
)) as { entries: Array<{ tag: string }> };

describe('SIL-1021 — unpairTripPair: the pair is unpairable again', () => {
  it('POST /api/trips/pairs/:id/unpair exists on the dispatcher seat, declared before /:id', () => {
    const routeIdx = routesSource.indexOf("router.post('/pairs/:id/unpair'");
    assert.ok(routeIdx > 0, 'the unpair route must be mounted');
    assert.match(routesSource, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.DISPATCHER\)/,
      'the unpair route must carry the same seat law as the create');
    const idRouteIdx = routesSource.indexOf("router.get('/:id'");
    assert.ok(routeIdx < idRouteIdx, "'pairs' must never be parsed as an /:id");
    assert.match(routesSource, /declareMaterialWrite\('trips\.pairs\.unpair'/,
      'the unpair must declare its material write registry row');
  });

  it('the unpair rides the idempotency envelope — a replay never breaks twice', () => {
    assert.match(routesSource, /endpoint: IDEMPOTENCY_ENDPOINTS\.TRIP_PAIR_UNPAIR/);
  });

  it('unpairTripPair refuses a missing pair and an already-broken pair', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    assert.ok(fnIdx > 0, 'unpairTripPairInTx must exist');
    const body = pairsSource.slice(fnIdx, fnIdx + 3000);
    assert.match(body, /throw new ApiError\(404, 'Không tìm thấy cặp ghép'\)/,
      'a missing pair answers the deterministic 404');
    assert.match(body, /throw new ApiError\(409, 'Cặp ghép này đã được gỡ trước đó\.'\)/,
      'a second unpair is the deterministic 409 — never a second break');
  });

  it('unpair breaks through breakPersistedTripPair with UNPAIRED, both legs surviving', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    const body = pairsSource.slice(fnIdx, fnIdx + 4000);
    assert.match(body, /breakReason: 'UNPAIRED'/);
    assert.match(body, /survivingTripId: pair\.secondTripId/,
      'the toll-restore survivor is the second leg — pairing netted ITS VETC toll');
    assert.match(body, /secondSalaryStash: pair\.secondSalaryStash != null \? Number\(pair\.secondSalaryStash\) : null/,
      'the stashed standard wage rides the break for the lương restore');
    assert.match(body, /await assertShipmentAccountingUnlocked\(tx, shipmentId\)/,
      'a kế-toan-locked lot refuses the unpair, mirroring the create');
  });

  it('UNPAIRED is a first-class break reason in both unions', () => {
    const pairingSource = readFileSync(
      path.join(here, '../../services/trip-pairing.service.ts'),
      'utf8',
    );
    assert.match(pairingSource, /\| 'UNPAIRED'/);
  });
});

describe('SIL-1021 round 27 — hủy ghép xong: re-pair được, không để lịch trùng', () => {
  const migrationTag = '20261126130000_trip_pairs_active_only_unique';
  const migrationSql = readFileSync(
    path.join(here, `../../../drizzle/${migrationTag}.sql`),
    'utf8',
  );

  it('the unique key is PARTIAL on ACTIVE — a broken pair never blocks re-pairing', () => {
    assert.match(tripsSchemaSource, /uniqueIndex\('trip_pairs_trip_order_uniq_idx'\)\.on\(table\.firstTripId, table\.secondTripId\)\s*\n\s*\.where\(sql`\$\{table\.status\} = 'ACTIVE'`\)/,
      'trip_pairs_trip_order_uniq_idx must be a partial unique index on ACTIVE rows');
    assert.match(migrationSql, /DROP INDEX IF EXISTS "trip_pairs_trip_order_uniq_idx";/);
    assert.match(migrationSql, /CREATE UNIQUE INDEX "trip_pairs_trip_order_uniq_idx"\s*\n\s*ON "trip_pairs" \("first_trip_id", "second_trip_id"\)\s*\n\s*WHERE "status" = 'ACTIVE';/,
      'the migration must rebuild the same index as ACTIVE-only');
    assert.ok(journal.entries.some((entry) => entry.tag === migrationTag),
      'the migration must be registered in the drizzle journal');
  });

  it('unpair releases the rig from leg 2 — no shared rig survives the break', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    const body = pairsSource.slice(fnIdx, pairsSource.indexOf('/** Arguments of the pairing core'));
    assert.match(body, /truckId: null,\s*\n\s*trailerId: null,/,
      'the released rig clears truck AND trailer from leg 2');
    assert.match(body, /eq\(s\.trips\.id, pair\.secondTripId\)/,
      'the rig release targets the second leg — the leg the pair economics already roll back');
    assert.match(body, /inArray\(s\.trips\.status, \[TripStatus\.CREATED, TripStatus\.IN_TRANSIT\]\)/,
      'only live schedules release — a terminal leg holds no rig claim');
    assert.match(body, /version: sql`\$\{s\.trips\.version\} \+ 1`/,
      'the release bumps the trip version so concurrent edits conflict honestly');
  });

  it('the release keeps the driver — the FB-081 acceptance law holds after unpair', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    const body = pairsSource.slice(fnIdx, pairsSource.indexOf('/** Arguments of the pairing core'));
    assert.doesNotMatch(body, /driverId: null,/,
      'unpair must never strip the driver: an acknowledged driver keeps the job');
  });
});

describe('SIL-1021 round 29 — TOCTOU double-break và leg terminal bị chặn', () => {
  it('the unpair pair read locks the row FOR UPDATE — two concurrent unpairs serialize', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    assert.ok(fnIdx > 0, 'unpairTripPairInTx must exist');
    const body = pairsSource.slice(fnIdx, fnIdx + 1500);
    assert.match(body, /\.from\(s\.tripPairs\)\.where\(eq\(s\.tripPairs\.id, pairId\)\)\.limit\(1\)\.for\('update'\)/,
      'the read must take the same row lock applyTripPairLifecycleEffects takes — '
      + 'a lockless read lets two concurrent unpairs both see ACTIVE');
  });

  it('breakPersistedTripPair only breaks an ACTIVE pair — the losing concurrent break 409s', () => {
    const breakIdx = pairsSource.indexOf('async function breakPersistedTripPair');
    assert.ok(breakIdx > 0, 'breakPersistedTripPair must exist');
    const body = pairsSource.slice(breakIdx, pairsSource.indexOf('export async function applyTripPairLifecycleEffects'));
    assert.match(body, /eq\(s\.tripPairs\.status, 'ACTIVE'\)/,
      'the break update must guard status = ACTIVE — eq(id) alone overwrites a '
      + 'broken pair (brokenAt/brokenBy, a 2nd fulfillment version bump, a rig '
      + 'clear after re-pair) and answers 200 instead of 409');
    assert.match(body, /\.returning\(\{ id: s\.tripPairs\.id \}\)/,
      'the break must observe how many rows it matched');
    assert.match(body, /throw new ApiError\(409, 'Cặp ghép này đã được gỡ trước đó\.'\)/,
      '0 matched rows is the deterministic already-broken 409, never a silent no-op 200');
  });

  it('unpair refuses a terminal leg — completed/canceled economics never half-revert', () => {
    const fnIdx = pairsSource.indexOf('async function unpairTripPairInTx');
    const body = pairsSource.slice(fnIdx, fnIdx + 4500);
    assert.match(body, /leg\.status === TripStatus\.COMPLETED \|\| leg\.status === TripStatus\.CANCELED/,
      'both terminal states refuse — the toll restore has no COMPLETED guard of '
      + 'its own and a canceled leg is zeroed by its own flow');
    assert.match(body, /'Không thể gỡ cặp ghép khi chuyến đã hoàn thành — dùng điều chỉnh có kiểm soát\.'/,
      'the completed-leg refusal names the governed-correction path');
    assert.match(body, /'Không thể gỡ cặp ghép khi chuyến đã hủy — dùng điều chỉnh có kiểm soát\.'/,
      'the canceled-leg refusal names the governed-correction path');
  });
});
