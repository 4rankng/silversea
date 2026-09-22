import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { listFundBook } from '../services/treasury-fund-book.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cleanup: Array<{ table: any; id: number }> = [];
async function track<T extends { id: number }>(table: any, row: T): Promise<T> {
  cleanup.unshift({ table, id: row.id });
  return row;
}

async function mkAccount(input: { code: string; name: string; status?: string; fundCode?: 'COMPANY' | 'TM' | null; opening?: string }) {
  const [row] = await db.insert(s.treasuryAccounts).values({
    code: input.code, name: input.name, type: 'BANK',
    status: input.status ?? 'ACTIVE',
    fundCode: input.fundCode === undefined ? null : input.fundCode,
    openingBalance: input.opening ?? '0',
    createdBy: 1, updatedBy: 1,
  }).returning();
  return track(s.treasuryAccounts, row);
}

async function mkMovement(input: { accountId: number; direction: 'IN' | 'OUT'; amount: string; ref: string }) {
  const [row] = await db.insert(s.treasuryMovements).values({
    treasuryAccountId: input.accountId,
    direction: input.direction, amount: input.amount,
    valueDate: '2026-09-10', status: 'POSTED',
    sourceVersion: 1, paymentContractVersion: 1,
    physicalReference: input.ref,
    createdBy: 1,
  }).returning();
  return track(s.treasuryMovements, row);
}

const MERGE_SQL = sql`update treasury_accounts set fund_code = 'COMPANY' where fund_code is null`;

describe('card 20260921_9 phase 2 — legacy fund history merges into the ACB stream', () => {
  test('classification flip imports history without touching a single movement byte', async () => {
    const legacy = await mkAccount({ code: `CARD9M-${suffix}-L1`, name: 'Legacy single-ledger', opening: '250000' });
    const move = await mkMovement({ accountId: legacy.id, direction: 'IN', amount: '300000', ref: `CARD9M-${suffix}-r1` });
    const tmAcct = await mkAccount({ code: `CARD9M-${suffix}-T1`, name: 'TM active', fundCode: 'TM', opening: '700000' });
    const tmMove = await mkMovement({ accountId: tmAcct.id, direction: 'OUT', amount: '120000', ref: `CARD9M-${suffix}-t1` });

    const before = await db.select().from(s.treasuryMovements)
      .where(sql`${s.treasuryMovements.id} in (${move.id}, ${tmMove.id})`);
    const companyBefore = await listFundBook('COMPANY');

    await db.execute(MERGE_SQL);

    const [afterAccount] = await db.select().from(s.treasuryAccounts)
      .where(sql`${s.treasuryAccounts.id} = ${legacy.id}`);
    assert.equal(afterAccount.fundCode, 'COMPANY', 'legacy account classified into the ACB stream');
    const after = await db.select().from(s.treasuryMovements)
      .where(sql`${s.treasuryMovements.id} in (${move.id}, ${tmMove.id})`);
    assert.deepEqual(after, before, 'M2: movement rows byte-for-byte identical');

    const companyAfter = await listFundBook('COMPANY');
    const merged = companyAfter.accounts.find((account) => account.accountId === legacy.id);
    assert.ok(merged, 'M3: formerly-unclassified ACTIVE account enters the COMPANY book');
    assert.ok(merged.movements.some((m) => m.id === move.id), 'old entry appears in the new report immediately');
    assert.equal(companyAfter.totals.bookBalance - companyBefore.totals.bookBalance,
      250000 + 300000, 'M3: running totals continuous (opening + imported movement)');
    const tmAfter = await listFundBook('TM');
    assert.ok(tmAfter.accounts.every((account) => account.accountId !== legacy.id), 'M4: TM untouched');
  });

  test('merge is idempotent and classifies DRAFT legacy accounts without activating them', async () => {
    const draft = await mkAccount({ code: `CARD9M-${suffix}-D1`, name: 'Legacy draft', status: 'DRAFT', opening: '42000' });
    await mkMovement({ accountId: draft.id, direction: 'IN', amount: '90000', ref: `CARD9M-${suffix}-d1` });
    const active = await mkAccount({ code: `CARD9M-${suffix}-A1`, name: 'Legacy active 2', opening: '1000' });

    await db.execute(MERGE_SQL);
    await db.execute(MERGE_SQL);

    const [draftRow] = await db.select().from(s.treasuryAccounts)
      .where(sql`${s.treasuryAccounts.id} = ${draft.id}`);
    assert.equal(draftRow.fundCode, 'COMPANY', 'DRAFT legacy classified too');
    const [activeRow] = await db.select().from(s.treasuryAccounts)
      .where(sql`${s.treasuryAccounts.id} = ${active.id}`);
    assert.equal(activeRow.fundCode, 'COMPANY');
    const book = await listFundBook('COMPANY');
    assert.ok(!book.accounts.some((account) => account.accountId === draft.id),
      'M5: DRAFT stays out of the book (status filter unchanged)');
    assert.ok(book.accounts.some((account) => account.accountId === active.id),
      'ACTIVE classified account enters the book');
  });
});

after(async () => {
  try {
    for (const { table, id } of cleanup) {
      await db.delete(table).where(sql`${table.id} = ${id}`);
    }
  } catch { /* best-effort cleanup */ }
});
