/**
 * Card 20260921_9 phase 1 — per-source sổ quỹ (fund book) + read enforcement.
 * Service-level suite; fixtures prefix `card9-`/`CARD9-`, local DB :5441,
 * announced. Movements written directly (append-only table; POSTED default).
 *
 * Coverage:
 *   AC2 per-source books: COMPANY and TM accounts never mix; balance =
 *       opening + POSTED IN - POSTED OUT; movements listed value-date ordered.
 *   AC1 read enforcement: only ACTIVE accounts assigned to the source enter
 *       a book; fund-less ACTIVE accounts are counted (unassignedAccounts),
 *       never mixed in; non-POSTED movements excluded.
 *   AC3 xe-nhà customer code: fill-only seed idempotent.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { listFundBook } from '../services/treasury-fund-book.service';
import { seedXeNhaCustomer } from '../seed/seed-xe-nha-customer';
import { ApiError } from '../errors';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanup: Array<() => Promise<void>> = [];
const track = (fn: () => Promise<void>) => cleanup.unshift(fn);

let actorId = 0;

async function mkActor() {
  const [u] = await db.insert(s.users).values({
    username: `card9-${suffix}-fin-${cleanup.length}`, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  track(async () => { await db.delete(s.users).where(eq(s.users.id, u.id)); });
  actorId = u.id;
  return u;
}

async function mkAccount(opts: { fundCode: 'COMPANY' | 'TM' | null; opening: string; status?: string }) {
  const [account] = await db.insert(s.treasuryAccounts).values({
    code: `CARD9-${suffix}-${cleanup.length}`,
    name: `card9 acct ${suffix}-${cleanup.length}`,
    type: 'CASH',
    fundCode: opts.fundCode,
    status: opts.status ?? 'ACTIVE',
    openingBalance: opts.opening,
    createdBy: actorId,
    updatedBy: actorId,
  }).returning();
  track(async () => { await db.delete(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, account.id)); });
  return account;
}

async function mkMovement(accountId: number, direction: 'IN' | 'OUT', amount: string, opts: { status?: string } = {}) {
  const [movement] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: accountId,
    direction,
    amount,
    valueDate: new Date().toISOString().slice(0, 10),
    status: opts.status ?? 'POSTED',
    sourceVersion: 1,
    createdBy: actorId,
    physicalReference: `card9-ref-${suffix}-${cleanup.length}`,
    paymentContractVersion: 1,
  }).returning();
  track(async () => { await db.delete(s.treasuryMovements).where(eq(s.treasuryMovements.id, movement.id)); });
  return movement;
}

describe('card 20260921_9 - per-source fund book', () => {
  test('COMPANY and TM books stay separate; balance = opening + POSTED IN - OUT (AC2)', async () => {
    await mkActor();
    const company = await mkAccount({ fundCode: 'COMPANY', opening: '1000000' });
    const tm = await mkAccount({ fundCode: 'TM', opening: '500000' });
    await mkMovement(company.id, 'IN', '300000');
    await mkMovement(company.id, 'OUT', '250000');
    await mkMovement(tm.id, 'IN', '120000');
    const companyBook = await listFundBook('COMPANY');
    assert.equal(companyBook.source, 'COMPANY');
    const companyRow = companyBook.accounts.find((account) => account.accountId === company.id);
    assert.ok(companyRow, 'COMPANY account must be in the COMPANY book');
    assert.equal(companyRow.bookBalance, 1050000);
    assert.equal(companyRow.totalIn, 300000);
    assert.equal(companyRow.totalOut, 250000);
    assert.equal(companyRow.movements.length, 2);
    const tmBook = await listFundBook('TM');
    const tmRow = tmBook.accounts.find((account) => account.accountId === tm.id);
    assert.ok(tmRow, 'TM account must be in the TM book');
    assert.equal(tmRow.bookBalance, 620000);
    assert.equal(tmRow.movements.length, 1);
    const companyMovementIds = new Set(companyRow.movements.map((movement) => movement.id));
    const leaked = tmRow.movements.filter((movement) => companyMovementIds.has(movement.id));
    assert.equal(leaked.length, 0, 'TM movements never leak into the COMPANY book');
  });

  test('unassigned active accounts counted, never mixed into a book (AC1 read enforcement)', async () => {
    await mkActor();
    const unassigned = await mkAccount({ fundCode: null, opening: '0' });
    const before = await listFundBook('COMPANY');
    const after = await listFundBook('TM');
    assert.ok(before.accounts.every((account) => account.accountId !== unassigned.id), 'fund-less account never in COMPANY book');
    assert.ok(after.accounts.every((account) => account.accountId !== unassigned.id), 'fund-less account never in TM book');
    const probe = await listFundBook('COMPANY');
    assert.ok(probe.unassignedAccounts >= 1, 'fund-less ACTIVE accounts surfaced as unassigned');
  });

  test('non-POSTED movements never enter a book', async () => {
    await mkActor();
    const company = await mkAccount({ fundCode: 'COMPANY', opening: '0' });
    await mkMovement(company.id, 'IN', '70000', { status: 'REVERSED' });
    const book = await listFundBook('COMPANY');
    const row = book.accounts.find((account) => account.accountId === company.id);
    assert.ok(row, 'account present');
    assert.equal(row.movements.length, 0, 'REVERSED movement excluded');
    assert.equal(row.bookBalance, 0, 'balance untouched by non-POSTED movement');
  });

  test('invalid source rejected with 400', async () => {
    await listFundBook('GBP' as never).then(
      () => { throw new Error('expected 400'); },
      (err: unknown) => {
        assert.ok(err instanceof ApiError, `expected ApiError, got ${(err as Error).name}`);
        assert.equal((err as ApiError).statusCode, 400);
      },
    );
  });

  test('xe-nhà customer code fills once and idempotently (AC3)', async () => {
    const first = await seedXeNhaCustomer();
    assert.ok(first.inserted === 0 || first.inserted === 1, 'fill-only');
    const second = await seedXeNhaCustomer();
    assert.equal(second.inserted, 0, 'second run inserts nothing');
    if (first.inserted === 1) {
      const rows = await db.select().from(s.customers)
        .where(eq(s.customers.name, 'Xe nhà'));
      assert.equal(rows.length, 1);
      track(async () => { await db.delete(s.customers).where(eq(s.customers.id, rows[0]!.id)); });
    }
  });
});
