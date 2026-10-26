/**
 * SIL-176 — POST /advance-settlements/:id/check reviewed durable command
 * boundary (board issue id 209).
 *
 * Standing red being pinned shut (card 191019215621): the route declared
 * itself a material write but its body never crossed a durable command
 * envelope, so `material-write-registry-exhaustive` failed with
 * "no reviewed durable command boundary" while both siblings in the same
 * file (/reversal, /update) already crossed `runIdempotent`.
 *
 * Unit pins only (no app boot, no DB — source-contract pins, same pattern as
 * advance-settlement-admin-create.test.ts and the material-write registry
 * tests):
 *   1. The handler crosses `runIdempotent` under the declared enum member
 *      IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CHECK, so a double-submit
 *      with the same Idempotency-Key replays the stored snapshot
 *      (`replayed: true`) WITHOUT re-running checkAdvanceSettlement — the
 *      checked_by/checked_at stamp, the conditional version bump and the
 *      notification cannot double-apply.
 *   2. The duyệt act stays attributable: ADMIN/ACCOUNTANT role guard and the
 *      res.locals.auditEntityKey audit line survive envelope changes.
 *   3. A retry that does NOT reuse the key still cannot double-apply — the
 *      service state-transition guards refuse it (terminal real-accountant
 *      check, same-actor legacy re-click, DRAFT/non-RECORDED states) and the
 *      version bump is conditional (optimistic concurrency under FOR UPDATE).
 *   4. runIdempotent's refusal laws hold for this endpoint: missing key →
 *      400, same key different actor/payload → 409 (these make the replay
 *      contract deterministic instead of accidental).
 * The live double-submit probe (two POSTs against a running stack) is the QA
 * integration script — BE units stay pure by the 2026-10-19 owner ruling.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const routesSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/routes/financial/advances.routes.ts'),
  'utf8',
);
const serviceSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/advance-settlement.service.ts'),
  'utf8',
);
const idempotencySource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/idempotency.service.ts'),
  'utf8',
);

function checkRouteBody(): string {
  const start = routesSource.indexOf("router.post('/advance-settlements/:id/check'");
  assert.ok(start >= 0, '/check route missing from advances.routes.ts');
  const next = routesSource.indexOf("router.post('/advance-settlements/:id/reversal'", start);
  assert.ok(next > start, '/reversal sibling route must follow /check (slice bound)');
  return routesSource.slice(start, next);
}

describe('SIL-176 — /advance-settlements/:id/check durable command boundary', () => {
  it('crosses runIdempotent under the declared enum member (double-submit replays, no double-apply)', () => {
    const body = checkRouteBody();
    assert.match(body, /declareMaterialWrite\('advance-settlements\.check'/,
      'route must self-declare in the material-write registry');
    assert.match(body, /\brunIdempotent\(\{/,
      'the duyệt stamp is a material write — it must cross the durable command boundary');
    assert.match(body, /IDEMPOTENCY_ENDPOINTS\.ADVANCE_SETTLEMENT_CHECK/,
      'replay lookup keys on (endpoint, key) — the enum member is the endpoint identity');
    assert.match(body, /getRequestIdempotencyKey\(req\)/,
      'the envelope must consume the request Idempotency-Key');
    assert.match(body, /getEntityId: \(\) => id/,
      'replay must resolve the stamped settlement id (snapshot/entity identity)');
    assert.match(body, /create: \(tx\) => checkAdvanceSettlement\(/,
      'the business write must run inside the envelope transaction');
    // Replay path never re-invokes create: the notification lives inside
    // checkAdvanceSettlement, so a replayed duyệt cannot re-notify either.
    const enumSource = idempotencySource;
    assert.match(enumSource, /ADVANCE_SETTLEMENT_CHECK: 'advance-settlements\.check'/,
      'enum member must stay registered for the replay lookup');
  });

  it('duyệt stays auditable and finance-review-gated (role + audit envelope)', () => {
    const body = checkRouteBody();
    assert.match(body, /requireRoles\(Role\.ADMIN, Role\.ACCOUNTANT\)/,
      'duyệt is a finance-review act: ADMIN/ACCOUNTANT, not MANAGER');
    assert.match(body, /res\.locals\.auditEntityKey = `phiếu hoàn ứng \$\{result\.code\} — duyệt`/,
      'the duyệt act must stay attributable in the audit trail');
  });

  it('retry with a different key still cannot double-apply (service state-transition guards)', () => {
    const guardStart = serviceSource.indexOf('export async function checkAdvanceSettlement(');
    assert.ok(guardStart >= 0, 'checkAdvanceSettlement function missing from advance-settlement.service.ts');
    const guard = serviceSource.slice(
      guardStart,
      serviceSource.indexOf('/** Internal: ledger and reconciliation effects'),
    );
    assert.match(guard, /\.for\('update'\)/,
      'concurrent duyệt must serialize on the settlement row lock');
    assert.match(guard, /throw new AdvanceError\(409, 'Phiếu chưa hoàn tất — không duyệt được\.'\)/,
      'DRAFT phiếu must not be stampable');
    assert.match(guard, /throw new AdvanceError\(409, 'Phiếu đã hủy\/hoàn tác — không duyệt được\.'\)/,
      'only RECORDED phiếu accepts a duyệt stamp');
    assert.match(guard, /throw new AdvanceError\(409, 'Phiếu đã được kế toán duyệt\.'\)/,
      'a real accountant check is terminal — a different-key retry must refuse');
    assert.match(guard, /throw new AdvanceError\(409, 'Bạn đã duyệt phiếu này rồi\.'\)/,
      'the same actor re-clicking their own duyệt is a double-submit, not a new act');
    assert.match(guard, /eq\(s\.advanceSettlements\.version, version\)/,
      'the version bump must be conditional (optimistic concurrency)');
  });

  it('runIdempotent refusal laws hold (key required, replay identity enforced)', () => {
    assert.match(idempotencySource,
      /throw new ApiError\(400, 'Idempotency-Key là bắt buộc cho thao tác ghi dữ liệu này\.'\)/,
      'a duyệt without an Idempotency-Key must be refused, not silently un-guarded');
    assert.match(idempotencySource, /requestedActor !== persistedActor/,
      'same key from another actor must 409 — replay identity includes the caller');
    assert.match(idempotencySource, /existing\.payloadHash !== payloadHash/,
      'same key with a different payload must 409, never replay across intents');
  });
});
