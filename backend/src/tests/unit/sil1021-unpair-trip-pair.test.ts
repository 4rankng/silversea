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
