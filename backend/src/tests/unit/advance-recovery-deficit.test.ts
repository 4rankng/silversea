/**
 * SIL-728 — Xác nhận hoàn ứng staff-level: thu hồi số dư ứng ÂM về Quỹ công ty.
 *
 * The report computes a per-staff SIGNED advance balance
 * (`getSignedOutstandingAdvanceBalances`): âm = staff holds MORE money than they
 * may (Nguyễn Huy Hoàng −420.000₫, Vũ Đình Cường −4.300.000₫). Until this flow
 * the only collection paths were per-đợt (reconciliation refund) — a staff with
 * no đợt filter had no lối vào, so the âm balance sat uncollectable.
 *
 * Unit pins only (no app boot, no DB — 2026-10-19 owner ruling):
 *   1. The deficit decision (pure helper `advanceRecoveryDeficitDecision`) —
 *      exact collection allowed, partial allowed (thu từng phần), over-collection
 *      refused naming the exact deficit, zero/positive balance refused, and
 *      non-positive amounts refused. No number is invented anywhere: the 409
 *      message carries the authority's deficit.
 *   2. The recovery books the SAME voucher family the signed-balance authority
 *      reads: the IN-voucher branch of `getSignedOutstandingAdvanceBalances`
 *      counts every RECORDED FORWARDER IN voucher WITHOUT a reconciliationId
 *      filter, and the recovery insert writes `reconciliationId: null` — so one
 *      phiếu reduces the staff balance exactly once and the report converges
 *      (PM ruling 2026-09-29: "hoàn ứng thực tế giảm nghĩa vụ còn lại đúng một
 *      lần").
 *   3. The route boundary: POST /advance-recovery is a declared material write
 *      crossing `runIdempotent` under endpoint 'expense-advance.recover' with
 *      the Idempotency-Key header, inside one tx (`create: async tx => …`), and
 *      the handler's per-staff lock mirrors the đợt path
 *      ('expense-reconciliation-user') so a recovery and a đợt refund cannot
 *      interleave two IN vouchers against one âm balance.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { advanceRecoveryDeficitDecision } from '../../services/expense-accounting-reconciliation.service';

const sharedSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/advance-shared.service.ts'),
  'utf8',
);
const reconciliationSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/expense-accounting-reconciliation.service.ts'),
  'utf8',
);
const routesSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/routes/expense-accounting-cash.ts'),
  'utf8',
);

describe('advance-recovery — the deficit decision (SIL-728, pure math)', () => {
  it('collects the exact deficit: −420.000 âm cho thu đúng 420.000', () => {
    const decision = advanceRecoveryDeficitDecision(-420_000, 420_000);
    assert.deepEqual(decision, { ok: true, deficit: 420_000 });
  });

  it('collects the larger reported case: −4.300.000 âm cho thu đúng 4.300.000', () => {
    const decision = advanceRecoveryDeficitDecision(-4_300_000, 4_300_000);
    assert.deepEqual(decision, { ok: true, deficit: 4_300_000 });
  });

  it('allows partial recovery — thu từng phần', () => {
    const decision = advanceRecoveryDeficitDecision(-420_000, 300_000);
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.deficit, 420_000);
  });

  it('refuses over-collection naming the exact remaining deficit (409)', () => {
    const decision = advanceRecoveryDeficitDecision(-420_000, 430_000);
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 409);
      assert.ok(decision.message.includes('420.000'), `message must name the deficit, got: ${decision.message}`);
    }
  });

  it('refuses when the balance is not negative — zero and positive held money', () => {
    for (const outstanding of [0, 100_000]) {
      const decision = advanceRecoveryDeficitDecision(outstanding, 1);
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.status, 409);
    }
  });

  it('refuses non-positive amounts', () => {
    for (const amount of [0, -420_000]) {
      const decision = advanceRecoveryDeficitDecision(-420_000, amount);
      assert.equal(decision.ok, false);
      if (!decision.ok) assert.equal(decision.status, 409);
    }
  });
});

describe('advance-recovery — the voucher family the authority reads (SIL-728)', () => {
  it('the signed balance counts IN vouchers WITHOUT a reconciliationId filter', () => {
    // The returned-vouchers branch of getSignedOutstandingAdvanceBalances: a
    // staff-level recovery phiếu (reconciliationId NULL) must land in this
    // branch, or the âm balance would never move and the report would diverge
    // from the fund book. The where clause carries counterpartyType/direction/
    // status filters and the optional staff filter — nothing else.
    const branch = sharedSource.match(/executor\.select\(\{ staffId: s\.expenseCashVouchers\.counterpartyId[\s\S]*?\)\),\n  \]/)?.[0] ?? '';
    assert.notEqual(branch, '', 'the IN-voucher branch source must exist');
    assert.ok(branch.includes("counterpartyType, 'FORWARDER'"), 'FORWARDER counterparty filter must stay');
    assert.ok(branch.includes("direction, 'IN'"), 'IN direction filter must stay');
    assert.ok(branch.includes("status, 'RECORDED'"), 'RECORDED status filter must stay');
    assert.ok(!branch.includes('reconciliationId'), 'no reconciliationId filter — NULL reconciliationId phiếu still counts');
  });

  it('the recovery insert writes reconciliationId null in the same OPS_SETTLEMENT + IN movement family', () => {
    const fn = reconciliationSource.match(/export async function recoverOpsAdvanceDeficit[\s\S]*?\n}/)?.[0] ?? '';
    assert.notEqual(fn, '', 'recoverOpsAdvanceDeficit must exist');
    assert.ok(fn.includes('TxnType.OPS_SETTLEMENT'), 'ledger debit rides OPS_SETTLEMENT like the đợt refund');
    assert.ok(fn.includes("entityType: 'FORWARDER'"), 'the debit names the staff (FORWARDER entity)');
    assert.ok(fn.includes("direction: 'IN'"), 'the treasury movement is IN — money returns to the company fund');
    assert.ok(fn.includes('reconciliationId: null'), 'no đợt is claimed — the staff-level phiếu stands alone');
    // One authority read INSIDE the tx, under the per-staff lock.
    assert.ok(fn.includes("getSignedOutstandingAdvanceBalances(input.opsUserId, tx)"), 'deficit re-read under tx');
    assert.ok(fn.includes("lockApplicationOwnedUniqueness(tx, 'expense-reconciliation-user'"), 'per-staff lock mirrors the đợt path');
    assert.ok(fn.includes('advanceRecoveryDeficitDecision'), 'the write path runs the pinned pure decision');
    assert.ok(!/phê duyệt|phê duyệt/i.test(fn), 'owner wording 07/11: Xác nhận, never phê duyệt');
  });
});

describe('advance-recovery — the route boundary (SIL-728)', () => {
  it('POST /advance-recovery is a declared material write crossing runIdempotent with the key header', () => {
    const route = routesSource.match(/router\.post\('\/advance-recovery'[\s\S]*?}\)\);/)?.[0] ?? '';
    assert.notEqual(route, '', 'the advance-recovery route must exist');
    assert.ok(route.includes("declareMaterialWrite('expense-advance.recover'"), 'material write declared');
    assert.ok(route.includes("path: '/api/expense-accounting/advance-recovery'"), 'canonical path declared');
    assert.ok(route.includes("req.header('Idempotency-Key')"), 'idempotency key from the header');
    assert.ok(route.includes("endpoint: 'expense-advance.recover'"), 'runIdempotent envelope');
    assert.ok(route.includes('create: async tx =>'), 'the whole flow runs in one tx');
    assert.ok(route.includes('recoverOpsAdvanceDeficit(tx, actor, input)'), 'handler calls the shared service');
  });
});
