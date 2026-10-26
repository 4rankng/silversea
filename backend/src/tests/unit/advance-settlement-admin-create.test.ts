/**
 * SIL-487 — Kế toán lập phiếu hoàn ứng (nghiệp vụ chi hộ): the admin-side
 * create + eligibility surface on financial/advances.routes.ts.
 *
 * Unit pins only (no app boot, no DB):
 *   1. POST /advance-settlements is a REAL material write on the same durable
 *      envelope as its siblings (declareMaterialWrite + runIdempotent +
 *      IDEMPOTENCY_ENDPOINTS.ADVANCE_SETTLEMENT_CREATE) and is gated to the
 *      finance-review roles (ADMIN/ACCOUNTANT — MANAGER reads the tab but does
 *      not create phiếu, matching the /check and /reversal guards).
 *   2. GET /advance-settlements/eligibility is registered BEFORE
 *      `GET /advance-settlements/:id` — Express matches in registration
 *      order, and parseInt('eligibility') would NaN if the parameter route
 *      won (regression R8, testplan 2026-10-26-sil487).
 *   3. The admin payload schema is the SHARED adminCreateAdvanceSettlementSchema
 *      (signed refundAmount + unique id lists + forwarderId) — not a local
 *      fork — so the accountant form obeys the same payload law as Ops.
 * The full write path (eligibility query → create → duyệt) is the QA probe
 * against a running stack (SIL-176 /check replay contract).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  adminCreateAdvanceSettlementSchema,
} from '@tingting/shared';

const routesSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/routes/financial/advances.routes.ts'),
  'utf8',
);

describe('SIL-487 — admin advance-settlement create + eligibility routes', () => {
  it('POST /advance-settlements: material write on the durable envelope, ADMIN/ACCOUNTANT only', () => {
    const routeStart = routesSource.indexOf("router.post('/advance-settlements',");
    assert.ok(routeStart >= 0, 'admin create route missing');
    // Slice to the handler's end — the next top-level route registration.
    const nextRoute = routesSource.indexOf("router.post('/advance-settlements/:id/check'", routeStart);
    const body = routesSource.slice(routeStart, nextRoute > 0 ? nextRoute : undefined);

    assert.match(body, /declareMaterialWrite\('advance-settlements\.create'/,
      'route must self-declare in the material-write registry');
    assert.match(body, /requireRoles\(Role\.ADMIN, Role\.ACCOUNTANT\)/,
      'create is a finance-review act: ADMIN/ACCOUNTANT, not MANAGER');
    assert.match(body, /\brunIdempotent\(/,
      'material write must cross the durable command boundary');
    assert.match(body, /IDEMPOTENCY_ENDPOINTS\.ADVANCE_SETTLEMENT_CREATE/,
      'replay key must be the declared enum member');
    assert.match(body, /approvedBy: actor\.userId/,
      'FB-100 Option B: the accountant submitter is the "xác nhận hoàn ứng" stamp');
  });

  it('GET /advance-settlements/eligibility registers BEFORE /:id (parameter route must not swallow it)', () => {
    const eligibility = routesSource.indexOf("router.get('/advance-settlements/eligibility'");
    const byId = routesSource.indexOf("router.get('/advance-settlements/:id'");
    assert.ok(eligibility >= 0, 'eligibility route missing');
    assert.ok(byId > 0, 'settlement detail route missing');
    assert.ok(eligibility < byId, 'eligibility must win the literal-segment match (parseInt NaN guard)');
  });

  it('eligibility read keeps MANAGER (same read authority as the settlement detail)', () => {
    const eligibility = routesSource.indexOf("router.get('/advance-settlements/eligibility'");
    const body = routesSource.slice(eligibility, eligibility + 400);
    assert.match(body, /requireRoles\(Role\.ADMIN, Role\.MANAGER, Role\.ACCOUNTANT\)/);
  });

  it('admin payload schema: forwarderId required, signed refundAmount inherited (FB-100 số âm)', () => {
    const parsed = adminCreateAdvanceSettlementSchema.safeParse({
      forwarderId: 9,
      advanceRequestIds: [41],
      tripExpenseIds: [82],
      totalExpenseAmount: 150000,
      refundAmount: -50000,
      note: 'Chi hộ 2 chuyến 10/2026',
    });
    assert.ok(parsed.success, JSON.stringify(parsed.error));
    assert.equal(parsed.data.refundAmount, -50000);

    assert.equal(
      adminCreateAdvanceSettlementSchema.safeParse({ advanceRequestIds: [1] }).success,
      false,
      'forwarderId is mandatory — the accountant names the staff the phiếu settles',
    );
    assert.equal(
      adminCreateAdvanceSettlementSchema.safeParse({ forwarderId: 0, advanceRequestIds: [1] }).success,
      false,
    );
    assert.equal(
      adminCreateAdvanceSettlementSchema.safeParse({ forwarderId: 9, advanceRequestIds: [] }).success,
      false,
      'at least one advance request, same as the Ops form',
    );
  });
});
