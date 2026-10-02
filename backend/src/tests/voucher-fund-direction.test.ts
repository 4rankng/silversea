import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSE_COST_GROUPS } from '@tingting/shared';

import { VOUCHER_REQUIRED_FUND, assertVoucherFundMatches } from '../services/treasury.service';
import { inArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';

/**
 * Card 20260928_167 criterion 2: "Dòng chi phí có hóa đơn (nâng/hạ/lưu bãi… của
 * chi hộ) chỉ được gán TK TM; dòng cược cont / tạm ứng Ops / tiền đường lái xe
 * chỉ được gán TK công ty — gán sai thì hệ thống chặn (kiểm chứng bằng test)."
 *
 * The rule did not exist. `assertTreasuryFundAssigned` only throws when an
 * account has NO fund at all; it never compared the account's fund with the one
 * the cost lines require. So a customer-reimbursed chi-hộ cost could be paid
 * out of the company account, or a driver's road fee out of TM, and both
 * postings looked valid — the fund book ends up wrong on both sides with
 * nothing to reconcile against.
 */
const tag = `fundmatch-${Date.now()}`;
const accountIds: number[] = [];
after(async () => {
  if (accountIds.length) await db.delete(s.treasuryAccounts).where(inArray(s.treasuryAccounts.id, accountIds));
});

async function mkAccount(fundCode: 'COMPANY' | 'TM'): Promise<number> {
  const [a] = await db.insert(s.treasuryAccounts).values({
    code: `${tag}-${fundCode}-${accountIds.length}`, name: `${tag} ${fundCode}`,
    type: 'CASH', fundCode, status: 'ACTIVE', createdBy: 0, updatedBy: 0,
  }).returning();
  accountIds.push(a.id);
  return a.id;
}

describe('voucher fund direction (card 20260928_167)', () => {
  test('every cost group is mapped to a fund — read from the source, not restated', () => {
    const missing = EXPENSE_COST_GROUPS.filter((g) => !VOUCHER_REQUIRED_FUND[g]);
    assert.deepEqual(missing, [],
      `these cost groups have no required fund, so a line like them passes any account: ${missing.join(', ')}`);
    // Same reading, stated so the intent cannot drift into the inverse:
    // invoiced chi-hộ is the CUSTOMER's money; everything else is the company's.
    for (const g of ['INVOICED_LIFT', 'INVOICED_DROP', 'INVOICED_OTHER', 'INVOICE_SERVICE'] as const) {
      assert.equal(VOUCHER_REQUIRED_FUND[g], 'TM', `${g} is billed to the customer, so it is TM money`);
    }
    for (const g of ['OPS_REGULAR', 'OPS_INCIDENTAL', 'DRIVER_SHIPMENT', 'DRIVER_ROAD'] as const) {
      assert.equal(VOUCHER_REQUIRED_FUND[g], 'COMPANY', `${g} is company-fronted, so it is company money`);
    }
  });

  test('a mixed-fund voucher is refused, and the message names the offending line', async () => {
    const company = await mkAccount('COMPANY');
    await assert.rejects(
      assertVoucherFundMatches(db as never, company, [
        { costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường' },
        { costGroup: 'INVOICED_LIFT', feeName: 'Phí nâng vỏ' },
      ]),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 400);
        // A bare "wrong fund" would send the operator hunting; the line is named.
        // Both sides named, and the operator told what to do — a bare "wrong
        // fund" would send them hunting through the ledger.
        assert.match(err.message, /Phí nâng vỏ/, 'the TM line is named');
        assert.match(err.message, /Tiền đường/, 'the company line is named');
        assert.match(err.message, /tách phiếu/i);
        return true;
      },
      'mixing TM and company money in one voucher must be refused',
    );
  });

  test('a single-fund voucher passes against the matching account', async () => {
    const tm = await mkAccount('TM');
    await assert.doesNotReject(assertVoucherFundMatches(db as never, tm, [
      { costGroup: 'INVOICED_LIFT', feeName: 'Phí nâng vỏ' },
      { costGroup: 'INVOICED_DROP', feeName: 'Phí hạ hàng' },
    ]), 'an invoiced chi-hộ voucher belongs in TM');
  });

  test('a company-fronted voucher passes against the company account', async () => {
    const company = await mkAccount('COMPANY');
    await assert.doesNotReject(assertVoucherFundMatches(db as never, company, [
      { costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường' },
      { costGroup: 'OPS_REGULAR', feeName: 'Phí làm hàng' },
    ]), 'road fees and Ops advances are company money');
  });

  test('a single line never conflicts with itself', async () => {
    const company = await mkAccount('COMPANY');
    await assert.doesNotReject(assertVoucherFundMatches(db as never, company, [
      { costGroup: 'DRIVER_ROAD', feeName: 'Tiền đường' },
    ]), 'the guard must not fire on an ordinary one-group voucher');
  });

  test('a line with no cost group is not guessed at', async () => {
    const company = await mkAccount('COMPANY');
    await assert.doesNotReject(assertVoucherFundMatches(db as never, company, [
      { costGroup: null, feeName: 'Khoản chưa phân nhóm' },
    ]), 'an ungrouped line has no required fund, so it cannot create a false conflict');
  });
});
