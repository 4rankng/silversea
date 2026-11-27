// SIL-1061 R4 (K2.118 / K2.150) — the SECOND partial refund on one deposit row
// must post its own treasury movement under its own mã giao dịch, not die on
// the account-level physical-reference conflict. Owner firsthand 27/11: tick
// 500.000₫ on a 2.000.000₫ bet → 200 (build 23a8fa17), tick the remaining
// 1.500.000₫ → 409 'Mã giao dịch thực tế đã được ghi nhận trên tài khoản này'
// — the movement code HOAN-CUOC-{id}-{bill} was per-DEPOSIT, and the treasury
// uniqueness key (account + direction + physicalReference) rejected installment
// 2. The rotation law follows the phoi-phieu -R2/-R3 pattern (a6cdb613):
// installment 1 keeps the readable base, installment n ≥ 2 takes `-n`.
// Also pins the PATCH /dates contract (SIL-1061 API 2): the two recovery
// fields edit with the row while it is still CHUA_HOAN_CUOC, and số đã hoàn
// cannot DECREASE once a bút toán quỹ movement has posted.
// Integration family (real dev DB, tracked cleanup) — same seam as
// sil1102-as-of-totals.test.ts: the unit family pins the pure laws, this pins
// the two-tick treasury path end to end.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, like } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '../db';
import * as s from '../db/schema';
import { Role } from '@tingting/shared';
import { disconnectRedis } from '../lib/redis';
import { ApiError } from '../errors';
import {
  depositRefundLedgerEntry,
  depositRefundPhysicalReference,
  markDepositRefunded,
  updateDepositTrackerDates,
} from '../services/deposit-refund-tracker.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type TrackedTable = PgTable & { id: PgColumn };
const cleanup: Array<{ table: TrackedTable; id: number }> = [];
function track(table: TrackedTable, id: number) {
  cleanup.unshift({ table, id });
}

const httpStatus = async (run: () => unknown | Promise<unknown>): Promise<number> => {
  try {
    await run();
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.statusCode;
    throw error;
  }
};

// Treasury movements + ledger rows the tick posts are NOT entity-tracked (the
// service creates them internally), so the fixture self-cleans by the tracker
// ids it created — the movement code is always HOAN-CUOC-{id}-… and the ledger
// receipt DEPOSIT_TRACKER:{id}. Quy định fixture: không để rác trên DB thật.
const fixtureTrackerIds: number[] = [];

after(async () => {
  for (const trackerId of fixtureTrackerIds) {
    await db.delete(s.treasuryMovements)
      .where(like(s.treasuryMovements.physicalReference, `HOAN-CUOC-${trackerId}-%`));
    await db.delete(s.ledger).where(and(
      eq(s.ledger.receiptId, `DEPOSIT_TRACKER:${trackerId}`),
      eq(s.ledger.entityType, 'CARRIER'),
      eq(s.ledger.entityId, trackerId),
    ));
  }
  for (const { table, id } of cleanup) await db.delete(table).where(eq(table.id, id));
  await disconnectRedis();
});

interface Fixture {
  adminId: number;
  trackerId: number;
  billNumber: string;
  baseReference: string;
}

async function mkTracker(): Promise<Fixture> {
  const tag = `${suffix}-${cleanup.length}`;
  const [admin] = await db.insert(s.users).values({
    username: `r43a1061-${tag}`, passwordHash: 't', role: Role.ADMIN, status: 'ACTIVE',
  }).returning({ id: s.users.id });
  track(s.users, admin.id);
  // resolveCompanyAccount posts to the FIRST active COMPANY-fund account;
  // the dev DB may have none, so the fixture provides one (refs are
  // tracker-id-prefixed, so whichever account the law picks stays clean).
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `QA-R43A-STK-${tag}`, name: `QA R43A quỹ công ty ${tag}`, type: 'BANK',
    fundCode: 'COMPANY', status: 'ACTIVE', createdBy: admin.id, updatedBy: admin.id,
  }).returning({ id: s.treasuryAccounts.id });
  track(s.treasuryAccounts, account.id);
  const billNumber = `QA-R43A-${tag}`;
  const [row] = await db.insert(s.depositRefundTrackers).values({
    // shipmentId NULL — the ledger entity is then the tracker row itself, so
    // the fixture's ledger rows are self-contained and deletable.
    shipmentId: null,
    billNumber,
    customerName: 'QA R43A SIL-1061',
    carrierName: 'QA',
    depositAmount: '2000000',
    depositDate: '2026-11-27',
    status: 'CHUA_HOAN_CUOC',
  }).returning({ id: s.depositRefundTrackers.id });
  track(s.depositRefundTrackers, row.id);
  fixtureTrackerIds.push(row.id);
  return { adminId: admin.id, trackerId: row.id, billNumber, baseReference: `HOAN-CUOC-${row.id}-${billNumber}` };
}

async function postedReferences(trackerId: number, billNumber: string) {
  return (await db.select({ reference: s.treasuryMovements.physicalReference, amount: s.treasuryMovements.amount })
    .from(s.treasuryMovements)
    .where(like(s.treasuryMovements.physicalReference, `HOAN-CUOC-${trackerId}-${billNumber}%`)))
    .sort((a, b) => a.reference.localeCompare(b.reference));
}

describe('SIL-1061 R4 — hai đợt hoàn trên cùng một dòng cược (treasury thật)', () => {
  test('hoàn 500.000 rồi 1.500.000 → 2 movement 2 mã, mã đợt 2 xoay -2; đợt 3 → 409', async () => {
    const fx = await mkTracker();
    const actor = { userId: fx.adminId, role: Role.ADMIN };

    // Đợt 1 — partial 500.000₫ (regression: the R1–R3 base code is unchanged).
    const row1 = await markDepositRefunded(actor, fx.trackerId, undefined, {
      recoveredAmount: 500000, refundReceivedDate: '2026-11-27',
    });
    assert.equal(row1.status, 'CHUA_HOAN_CUOC', 'đợt 1 chưa đủ — dòng giữ trạng thái chưa hoàn hết');
    assert.equal(Number(row1.recoveredAmount), 500000);

    // Đợt 2 — the remaining 1.500.000₫. RED history: before the rotation fix
    // this died 409 'Mã giao dịch thực tế đã được ghi nhận trên tài khoản này'.
    const row2 = await markDepositRefunded(actor, fx.trackerId, undefined, {
      recoveredAmount: 1500000, refundReceivedDate: '2026-11-27',
    });
    assert.equal(row2.status, 'DA_HOAN_CUOC');
    assert.equal(Number(row2.recoveredAmount), 2000000);
    assert.notEqual(row2.refundPostedMovementId, row1.refundPostedMovementId, 'mỗi đợt một movement riêng');

    const refs = await postedReferences(fx.trackerId, fx.billNumber);
    assert.equal(refs.length, 2, `hai đợt = hai movement (thực tế: ${JSON.stringify(refs)})`);
    assert.deepEqual(refs.map((r) => r.reference), [
      fx.baseReference,
      depositRefundPhysicalReference({ id: fx.trackerId, billNumber: fx.billNumber }, 2),
    ], 'đợt 1 giữ mã gốc, đợt 2 xoay hậu tố -2');
    assert.deepEqual(refs.map((r) => Number(r.amount)), [500000, 1500000], 'mỗi movement đúng số tiền đợt đó');

    // Đợt 3 — dòng đã đủ → 409 đúng như staging đã ghi nhận (R1–R3 law).
    assert.equal(await httpStatus(() => markDepositRefunded(actor, fx.trackerId, undefined, {
      recoveredAmount: 100000, refundReceivedDate: '2026-11-27',
    })), 409, 'dòng đã đủ phải chặn tick tiếp');
    assert.equal((await postedReferences(fx.trackerId, fx.billNumber)).length, 2, 'đợt bị chặn không post thêm movement');
  });

  test('PATCH dates: 2 trường ghi được trên dòng CHUA_HOAN_CUOC, không giảm được số đã hoàn sau khi bút toán đã chạy', async () => {
    const fx = await mkTracker();
    const actor = { userId: fx.adminId, role: Role.ADMIN };

    await markDepositRefunded(actor, fx.trackerId, undefined, {
      recoveredAmount: 500000, refundReceivedDate: '2026-11-27',
    });

    // Decrease after a posted movement → blocked (SIL-1061 API 2 law).
    assert.equal(await httpStatus(() => updateDepositTrackerDates(
      { userId: fx.adminId, role: Role.ADMIN, fullName: 'QA', username: `r43a1061-${suffix}` },
      fx.trackerId, { recoveredAmount: 300000 },
    )), 400, 'giảm số đã hoàn sau khi bút toán quỹ đã chạy bị chặn');
    const still = await db.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.id, fx.trackerId)).limit(1);
    assert.equal(Number(still[0]!.recoveredAmount), 500000, 'lần giảm bị chặn không đụng số liệu');

    // Editing the received day rides the same PATCH (row still CHUA_HOAN_CUOC).
    const patched = await updateDepositTrackerDates(
      { userId: fx.adminId, role: Role.ADMIN, fullName: 'QA', username: `r43a1061-${suffix}` },
      fx.trackerId, { refundReceivedDate: '2026-11-28' },
    );
    assert.equal(patched.refundReceivedDate, '2026-11-28');
    assert.equal(Number(patched.recoveredAmount), 500000);

    // And the ledger identity stays the receipt-coded fund ADJUSTMENT (§3 pin
    // lives in the unit family; this is the end-to-end shape of the same law).
    const [movement] = await db.select().from(s.treasuryMovements)
      .where(and(like(s.treasuryMovements.physicalReference, `${fx.baseReference}`))).limit(1);
    assert.ok(movement, 'movement đợt 1 tồn tại');
    const [ledgerRow] = await db.select().from(s.ledger).where(eq(s.ledger.id, movement.ledgerEntryId!)).limit(1);
    assert.equal(ledgerRow?.receiptId, `DEPOSIT_TRACKER:${fx.trackerId}`);
    assert.equal(Number(ledgerRow?.credit), 500000);
    assert.equal(Number(ledgerRow?.debit), 0);
    assert.equal(depositRefundLedgerEntry({ id: fx.trackerId, shipmentId: null, billNumber: fx.billNumber }, 500000).txnType, 'ADJUSTMENT');
  });
});
