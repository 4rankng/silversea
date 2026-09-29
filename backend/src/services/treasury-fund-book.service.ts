import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { calculateTreasuryBookBalance } from './treasury.service';
import { getOutstandingAdvanceBalances } from './advance-shared.service';
import { ApiError } from '../errors';

export const FUND_SOURCES = ['COMPANY', 'TM'] as const;
export type FundSource = typeof FUND_SOURCES[number];

/** Card 20260928_168 (PM ruling 2026-09-29, câu 2): the sổ quỹ accepts a
 *  from/to period; the opening balance becomes the CARRIED opening — số dư
 *  đầu kỳ lũy kế đến 'from' — so the book reads "tiền đường trong ngày" style
 *  windows without losing what came before. */
export interface FundBookPeriod {
  from?: string;
  to?: string;
}

export interface FundBookMovement {
  id: number; direction: 'IN' | 'OUT'; amount: string; valueDate: string;
  status: string; postedAt: Date; ledgerEntryId: number | null;
}
export interface FundBookAccount {
  accountId: number; code: string; name: string; currency: string;
  /** With a period: the carried opening (base opening + every POSTED movement
   *  before `from`). Without one: the account's base opening — the card 9
   *  whole-history contract. */
  openingBalance: number; openingBalanceDate: string | null; cutoverAt: string | null;
  totalIn: number; totalOut: number; bookBalance: number;
  movements: FundBookMovement[];
}
/** The "TÀI KHOẢN OPS" entry of the sổ quỹ (card 20260928_168, PM ruling
 *  2026-09-29 câu 1): the tạm ứng money the OPS staff still hold, read from
 *  the SAME canonical authority the 169 reimbursement report reads —
 *  min(đã ứng, đã cấp) − đã tiêu, cash returned included — so the book's
 *  closing and the report's "Còn phải hoàn ứng" are one number by
 *  construction, never two definitions that can drift. */
export interface FundBookOpsAdvance {
  totalOutstanding: number;
  items: Array<{ staffId: number; staffName: string | null; outstanding: number }>;
}
export interface FundBook {
  source: FundSource;
  period: { from: string | null; to: string | null };
  accounts: FundBookAccount[];
  totals: { openingBalance: number; totalIn: number; totalOut: number; bookBalance: number };
  unassignedAccounts: number;
  opsAdvance: FundBookOpsAdvance;
}

/** Card 20260921_9 phase 1 — the per-source sổ quỹ (fund book): the append-only
 *  treasury ledger grouped strictly by one fund source. Read enforcement: only
 *  ACTIVE accounts assigned to the requested fund enter the book; fund-less
 *  active accounts are counted, never mixed in; only POSTED movements count
 *  (the same filter as the existing position math). Balance math is the
 *  existing calculateTreasuryBookBalance — this service adds grouping, the
 *  period window and the movement listing, never new money math. */
export async function listFundBook(source: FundSource, period: FundBookPeriod = {}): Promise<FundBook> {
  if (!FUND_SOURCES.includes(source)) {
    throw new ApiError(400, 'Nguồn quỹ không hợp lệ (COMPANY | TM).');
  }
  const { from, to } = period;
  if (from && to && from > to) {
    throw new ApiError(400, 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  }
  const accounts = await db.select().from(s.treasuryAccounts).where(and(
    eq(s.treasuryAccounts.fundCode, source),
    eq(s.treasuryAccounts.status, 'ACTIVE'),
  ));
  const [unassigned] = await db.select({ total: sql<number>`count(*)::int` })
    .from(s.treasuryAccounts)
    .where(and(eq(s.treasuryAccounts.status, 'ACTIVE'), isNull(s.treasuryAccounts.fundCode)));
  const accountIds = accounts.map((account) => account.id);
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
  const byAccount = new Map<number, typeof movements>();
  for (const movement of movements) {
    const list = byAccount.get(movement.treasuryAccountId) ?? [];
    list.push(movement);
    byAccount.set(movement.treasuryAccountId, list);
  }
  const bookAccounts: FundBookAccount[] = accounts.map((account) => {
    const rows = byAccount.get(account.id) ?? [];
    const inWindow = (valueDate: string) => (!from || valueDate >= from) && (!to || valueDate <= to);
    // The carried opening: base opening + every POSTED movement before `from`
    // (số dư đầu kỳ lũy kế). Without `from` this is the base opening and the
    // window is whole history — the card 9 numbers, unchanged.
    const before = rows.filter((row) => from ? row.valueDate < from : false);
    const window = rows.filter((row) => inWindow(row.valueDate));
    const carriedOpening = before.reduce(
      (sum, row) => sum + (row.direction === 'IN' ? 1 : -1) * Math.round(Number(row.amount)),
      Math.round(Number(account.openingBalance)),
    );
    const totalIn = window.reduce((sum, row) => sum + (row.direction === 'IN' ? Math.round(Number(row.amount)) : 0), 0);
    const totalOut = window.reduce((sum, row) => sum + (row.direction === 'OUT' ? Math.round(Number(row.amount)) : 0), 0);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      currency: account.currency,
      openingBalance: carriedOpening,
      openingBalanceDate: account.openingBalanceDate ?? null,
      cutoverAt: account.cutoverAt?.toISOString() ?? null,
      totalIn,
      totalOut,
      bookBalance: calculateTreasuryBookBalance(carriedOpening, totalIn, totalOut),
      movements: window.map(({ treasuryAccountId: _accountId, ...movement }) => ({
        ...movement,
        direction: movement.direction as 'IN' | 'OUT',
      })),
    };
  });
  const totals = {
    openingBalance: bookAccounts.reduce((sum, account) => sum + account.openingBalance, 0),
    totalIn: bookAccounts.reduce((sum, account) => sum + account.totalIn, 0),
    totalOut: bookAccounts.reduce((sum, account) => sum + account.totalOut, 0),
    bookBalance: bookAccounts.reduce((sum, account) => sum + account.bookBalance, 0),
  };
  const outstanding = await getOutstandingAdvanceBalances();
  return {
    source,
    period: { from: from ?? null, to: to ?? null },
    accounts: bookAccounts,
    totals,
    unassignedAccounts: unassigned?.total ?? 0,
    opsAdvance: {
      totalOutstanding: outstanding.totalOutstanding,
      items: outstanding.items.map((item) => ({ staffId: item.forwarderId, staffName: item.name, outstanding: item.outstanding })),
    },
  };
}
