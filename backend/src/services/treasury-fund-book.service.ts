import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { getTreasuryPositions } from './treasury.service';
import { ApiError } from '../errors';

export const FUND_SOURCES = ['COMPANY', 'TM'] as const;
export type FundSource = typeof FUND_SOURCES[number];

export interface FundBookMovement {
  id: number; direction: 'IN' | 'OUT'; amount: string; valueDate: string;
  status: string; postedAt: Date; ledgerEntryId: number | null;
}
export interface FundBookAccount {
  accountId: number; code: string; name: string; currency: string;
  openingBalance: number; openingBalanceDate: string | null; cutoverAt: string | null;
  totalIn: number; totalOut: number; bookBalance: number;
  movements: FundBookMovement[];
}
export interface FundBook {
  source: FundSource;
  accounts: FundBookAccount[];
  totals: { openingBalance: number; totalIn: number; totalOut: number; bookBalance: number };
  unassignedAccounts: number;
}

/** Card 20260921_9 phase 1 — the per-source sổ quỹ (fund book): the append-only
 *  treasury ledger grouped strictly by one fund source. Read enforcement: only
 *  ACTIVE accounts assigned to the requested fund enter the book; fund-less
 *  active accounts are counted, never mixed in; only POSTED movements count
 *  (the same filter as the existing position math). Balance math is the
 *  existing calculateTreasuryBookBalance via getTreasuryPositions — this
 *  service adds grouping + the movement listing, never new money math. */
export async function listFundBook(source: FundSource): Promise<FundBook> {
  if (!FUND_SOURCES.includes(source)) {
    throw new ApiError(400, 'Nguồn quỹ không hợp lệ (COMPANY | TM).');
  }
  const accounts = await db.select().from(s.treasuryAccounts).where(and(
    eq(s.treasuryAccounts.fundCode, source),
    eq(s.treasuryAccounts.status, 'ACTIVE'),
  ));
  const [unassigned] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), isNull(s.treasuryAccounts.fundCode)));
  const accountIds = accounts.map((account) => account.id);
  const positions = await getTreasuryPositions(accountIds);
  const positionByAccount = new Map(positions.map((position) => [position.accountId, position] as const));
  const movements = accountIds.length
    ? await db.select({
        id: s.treasuryMovements.id,
        treasuryAccountId: s.treasuryMovements.treasuryAccountId,
        direction: s.treasuryMovements.direction,
        amount: s.treasuryMovements.amount,
        valueDate: s.treasuryMovements.valueDate,
        status: s.treasuryMovements.status,
        postedAt: s.treasuryMovements.postedAt,
        ledgerEntryId: s.treasuryMovements.ledgerEntryId,
      }).from(s.treasuryMovements)
        .where(and(
          inArray(s.treasuryMovements.treasuryAccountId, accountIds),
          eq(s.treasuryMovements.status, 'POSTED'),
        ))
        .orderBy(asc(s.treasuryMovements.valueDate), asc(s.treasuryMovements.id))
    : [];
  const movementsByAccount = new Map<number, FundBookMovement[]>();
  for (const movement of movements) {
    const list = movementsByAccount.get(movement.treasuryAccountId) ?? [];
    const { treasuryAccountId: _drop, ...rest } = movement;
    list.push({ ...rest, direction: rest.direction as 'IN' | 'OUT' });
    movementsByAccount.set(movement.treasuryAccountId, list);
  }
  const bookAccounts: FundBookAccount[] = accounts.map((account) => {
    const position = positionByAccount.get(account.id)!;
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      currency: account.currency,
      openingBalance: position.openingBalance,
      openingBalanceDate: account.openingBalanceDate ?? null,
      cutoverAt: account.cutoverAt?.toISOString() ?? null,
      totalIn: position.totalIn,
      totalOut: position.totalOut,
      bookBalance: position.bookBalance,
      movements: movementsByAccount.get(account.id) ?? [],
    };
  });
  const totals = {
    openingBalance: bookAccounts.reduce((sum, account) => sum + account.openingBalance, 0),
    totalIn: bookAccounts.reduce((sum, account) => sum + account.totalIn, 0),
    totalOut: bookAccounts.reduce((sum, account) => sum + account.totalOut, 0),
    bookBalance: bookAccounts.reduce((sum, account) => sum + account.bookBalance, 0),
  };
  return { source, accounts: bookAccounts, totals, unassignedAccounts: unassigned?.total ?? 0 };
}
