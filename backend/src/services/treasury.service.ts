import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { treasuryFundCodeSchema, type Role, type TreasuryFundCode, type TreasuryAccountFundInput } from '@tingting/shared';

import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
} from './governance-action-core.service';

export const TREASURY_PAYMENT_CONTRACT_VERSION = 2;

export interface TreasuryPaymentFields {
  treasuryAccountId?: number | null;
  valueDate?: string | null;
  physicalReference?: string | null;
}

export interface ResolvedTreasuryPaymentContract {
  treasuryAccountId: number | null;
  valueDate: string | null;
  physicalReference: string | null;
  paymentContractVersion: 1 | typeof TREASURY_PAYMENT_CONTRACT_VERSION;
}

export interface TreasuryPosition {
  accountId: number;
  code: string;
  name: string;
  type: string;
  fundCode: TreasuryFundCode | null;
  version: number;
  currency: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  bookBalance: number;
  completeness: 'COMPLETE' | 'PARTIAL';
  cutoverAt: string | null;
}

// Server-side sort keys for the treasury position table — one per data column.
// Applied in-memory over the computed positions (the endpoint's unit is the
// account aggregate, not a SQL row); accountId stays the stable tiebreaker and
// absent params keep the account-query order untouched.
export const TREASURY_SORT_KEYS = [
  'name',
  'openingBalance',
  'totalIn',
  'totalOut',
  'bookBalance',
  'completeness',
] as const;
export type TreasurySortKey = (typeof TREASURY_SORT_KEYS)[number];

const TREASURY_COMPLETENESS_RANK: Record<TreasuryPosition['completeness'], number> = {
  COMPLETE: 0,
  PARTIAL: 1,
};

export function sortTreasuryPositions(
  positions: TreasuryPosition[],
  sortBy?: TreasurySortKey,
  sortDir?: 'asc' | 'desc',
): TreasuryPosition[] {
  if (!sortBy) return positions;
  const direction = sortDir === 'desc' ? -1 : 1;
  const valueOf = (position: TreasuryPosition): string | number => {
    switch (sortBy) {
      case 'name': return position.name;
      case 'openingBalance': return position.openingBalance;
      case 'totalIn': return position.totalIn;
      case 'totalOut': return position.totalOut;
      case 'bookBalance': return position.bookBalance;
      case 'completeness': return TREASURY_COMPLETENESS_RANK[position.completeness];
    }
  };
  return [...positions].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (left === right) return a.accountId - b.accountId;
    return (left < right ? -1 : 1) * direction;
  });
}

export function calculateTreasuryBookBalance(
  openingBalance: number,
  totalIn: number,
  totalOut: number,
): number {
  if (![openingBalance, totalIn, totalOut].every(Number.isSafeInteger)) {
    throw new ApiError(409, 'Số liệu số dư kho quỹ không hợp lệ');
  }
  return openingBalance + totalIn - totalOut;
}

function assertWholeVndAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ApiError(400, 'Số tiền kho quỹ phải là số nguyên dương hợp lệ');
  }
}

function normalizeValueDate(value: string | null | undefined): string | null {
  const normalized = value?.trim() || null;
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ApiError(400, 'Ngày giá trị phải có định dạng YYYY-MM-DD');
  }
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new ApiError(400, 'Ngày giá trị không hợp lệ');
  }
  return normalized;
}

export function normalizeTreasuryPhysicalReference(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ').toUpperCase() || null;
  if (normalized && normalized.length > 160) {
    throw new ApiError(400, 'Mã giao dịch thực tế không được vượt quá 160 ký tự');
  }
  return normalized;
}

async function hasActiveCutoverAt(tx: Tx, requestedAt: Date): Promise<boolean> {
  const [row] = await tx.select({ id: s.treasuryAccounts.id })
    .from(s.treasuryAccounts)
    .where(and(
      eq(s.treasuryAccounts.status, 'ACTIVE'),
      lte(s.treasuryAccounts.cutoverAt, requestedAt),
    ))
    .limit(1);
  return Boolean(row);
}

/**
 * Freezes the money-attribution contract when a governance request is made.
 * The request timestamp, rather than a back-dated value date, controls cutover.
 */
export async function resolveTreasuryPaymentContract(
  tx: Tx,
  fields: TreasuryPaymentFields,
  requestedAt: Date,
): Promise<ResolvedTreasuryPaymentContract> {
  const treasuryAccountId = fields.treasuryAccountId == null
    ? null
    : Number(fields.treasuryAccountId);
  const valueDate = normalizeValueDate(fields.valueDate);
  const physicalReference = normalizeTreasuryPhysicalReference(fields.physicalReference);

  if (treasuryAccountId == null) {
    if (valueDate || physicalReference) {
      throw new ApiError(400, 'Phải chọn tài khoản tiền mặt/ngân hàng cho giao dịch thực tế');
    }
    if (await hasActiveCutoverAt(tx, requestedAt)) {
      throw new ApiError(422, 'Phải chọn tài khoản tiền mặt/ngân hàng sau thời điểm chuyển đổi kho quỹ');
    }
    return {
      treasuryAccountId: null,
      valueDate: null,
      physicalReference: null,
      paymentContractVersion: 1,
    };
  }

  if (!Number.isInteger(treasuryAccountId) || treasuryAccountId <= 0) {
    throw new ApiError(400, 'treasuryAccountId không hợp lệ');
  }
  const [account] = await tx.select({
    id: s.treasuryAccounts.id,
    status: s.treasuryAccounts.status,
    cutoverAt: s.treasuryAccounts.cutoverAt,
  }).from(s.treasuryAccounts)
    .where(eq(s.treasuryAccounts.id, treasuryAccountId))
    .limit(1)
    .for('update');
  if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');
  if (account.status !== 'ACTIVE') {
    throw new ApiError(409, 'Tài khoản tiền mặt/ngân hàng chưa hoạt động');
  }

  const cutoverApplies = account.cutoverAt != null && requestedAt >= account.cutoverAt;
  if ((valueDate == null) !== (physicalReference == null)) {
    throw new ApiError(400, 'Ngày giá trị và mã giao dịch thực tế phải được cung cấp cùng nhau');
  }
  if (cutoverApplies && (!valueDate || !physicalReference)) {
    throw new ApiError(422, 'Thiếu ngày giá trị hoặc mã giao dịch thực tế sau thời điểm chuyển đổi kho quỹ');
  }
  if (!valueDate || !physicalReference) {
    return {
      treasuryAccountId,
      valueDate: null,
      physicalReference: null,
      paymentContractVersion: 1,
    };
  }
  return {
    treasuryAccountId,
    valueDate,
    physicalReference,
    paymentContractVersion: TREASURY_PAYMENT_CONTRACT_VERSION,
  };
}

export async function insertTreasuryMovement(tx: Tx, input: {
  treasuryAccountId: number;
  direction: 'IN' | 'OUT';
  amount: number;
  valueDate: string;
  physicalReference: string;
  paymentContractVersion: number;
  paymentReceiptId?: number;
  ledgerEntryId?: number;
  sourceVersion: number;
  externalReference?: string | null;
  createdBy: number;
}) {
  assertWholeVndAmount(input.amount);
  const hasReceipt = input.paymentReceiptId != null;
  const hasLedger = input.ledgerEntryId != null;
  if (hasReceipt === hasLedger) {
    throw new ApiError(409, 'Giao dịch kho quỹ phải liên kết đúng một nguồn tiền');
  }

  const sourceFilter = hasReceipt
    ? eq(s.treasuryMovements.paymentReceiptId, input.paymentReceiptId!)
    : eq(s.treasuryMovements.ledgerEntryId, input.ledgerEntryId!);
  const [existingSource] = await tx.select().from(s.treasuryMovements)
    .where(and(
      eq(s.treasuryMovements.status, 'POSTED'),
      isNull(s.treasuryMovements.reversalOfId),
      sourceFilter,
    ))
    .limit(1);
  if (existingSource) {
    if (
      existingSource.treasuryAccountId === input.treasuryAccountId
      && existingSource.direction === input.direction
      && Number(existingSource.amount) === input.amount
      && existingSource.physicalReference === input.physicalReference
    ) return existingSource;
    throw new ApiError(409, 'Nguồn tiền đã liên kết với một giao dịch kho quỹ khác');
  }

  const [physicalConflict] = await tx.select({ id: s.treasuryMovements.id })
    .from(s.treasuryMovements)
    .where(and(
      eq(s.treasuryMovements.treasuryAccountId, input.treasuryAccountId),
      eq(s.treasuryMovements.direction, input.direction),
      eq(s.treasuryMovements.physicalReference, input.physicalReference),
      eq(s.treasuryMovements.status, 'POSTED'),
    ))
    .limit(1);
  if (physicalConflict) {
    throw new ApiError(409, 'Mã giao dịch thực tế đã được ghi nhận trên tài khoản này');
  }

  const [movement] = await tx.insert(s.treasuryMovements).values({
    treasuryAccountId: input.treasuryAccountId,
    direction: input.direction,
    amount: String(input.amount),
    valueDate: input.valueDate,
    paymentReceiptId: input.paymentReceiptId,
    ledgerEntryId: input.ledgerEntryId,
    sourceVersion: input.sourceVersion,
    paymentContractVersion: input.paymentContractVersion,
    physicalReference: input.physicalReference,
    externalReference: input.externalReference?.trim() || null,
    createdBy: input.createdBy,
  }).returning();
  return movement;
}

export async function appendTreasuryReversal(tx: Tx, input: {
  originalMovementId: number;
  amount: number;
  valueDate: string;
  sourceVersion: number;
  physicalReference: string;
  createdBy: number;
  ledgerEntryId?: number;
}) {
  assertWholeVndAmount(input.amount);
  const valueDate = normalizeValueDate(input.valueDate);
  const physicalReference = normalizeTreasuryPhysicalReference(input.physicalReference);
  if (!valueDate || !physicalReference) {
    throw new ApiError(400, 'Ngày giá trị và mã giao dịch đảo kho quỹ là bắt buộc');
  }
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion <= 0) {
    throw new ApiError(400, 'Phiên bản nguồn đảo kho quỹ không hợp lệ');
  }

  const [original] = await tx.select().from(s.treasuryMovements)
    .where(and(
      eq(s.treasuryMovements.id, input.originalMovementId),
      isNull(s.treasuryMovements.reversalOfId),
    ))
    .limit(1)
    .for('update');
  if (!original) throw new ApiError(404, 'Không tìm thấy giao dịch kho quỹ gốc');
  if (original.status !== 'POSTED') {
    throw new ApiError(409, 'Giao dịch kho quỹ gốc không còn hiệu lực');
  }

  const [existing] = await tx.select().from(s.treasuryMovements)
    .where(and(
      eq(s.treasuryMovements.reversalOfId, original.id),
      eq(s.treasuryMovements.sourceVersion, input.sourceVersion),
    ))
    .limit(1);
  if (existing) {
    if (
      existing.direction === (original.direction === 'IN' ? 'OUT' : 'IN')
      && Number(existing.amount) === input.amount
      && existing.physicalReference === physicalReference
      && existing.ledgerEntryId === (input.ledgerEntryId ?? original.ledgerEntryId)
      && existing.paymentReceiptId === (input.ledgerEntryId == null ? original.paymentReceiptId : null)
    ) return existing;
    throw new ApiError(409, 'Phiên bản nguồn đã liên kết với nội dung đảo kho quỹ khác');
  }

  const [reversed] = await tx.select({
    amount: sql<string>`coalesce(sum(${s.treasuryMovements.amount}), 0)`,
  }).from(s.treasuryMovements).where(and(
    eq(s.treasuryMovements.reversalOfId, original.id),
    eq(s.treasuryMovements.status, 'POSTED'),
  ));
  if (Number(reversed?.amount ?? 0) + input.amount > Number(original.amount)) {
    throw new ApiError(409, 'Tổng tiền đảo vượt quá giao dịch kho quỹ gốc');
  }

  const [reversal] = await tx.insert(s.treasuryMovements).values({
    treasuryAccountId: original.treasuryAccountId,
    direction: original.direction === 'IN' ? 'OUT' : 'IN',
    amount: String(input.amount),
    valueDate,
    status: 'POSTED',
    paymentReceiptId: input.ledgerEntryId == null ? original.paymentReceiptId : null,
    ledgerEntryId: input.ledgerEntryId ?? original.ledgerEntryId,
    sourceVersion: input.sourceVersion,
    paymentContractVersion: original.paymentContractVersion,
    physicalReference,
    externalReference: original.externalReference,
    reversalOfId: original.id,
    createdBy: input.createdBy,
  }).returning();
  return reversal;
}

export async function getTreasuryPosition(accountId: number, transaction?: Tx): Promise<TreasuryPosition> {
  const execute = async (tx: Tx) => {
    const [account] = await tx.select().from(s.treasuryAccounts)
      .where(eq(s.treasuryAccounts.id, accountId))
      .limit(1);
    if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');

    const [totals] = await tx.select({
      totalIn: sql<string>`coalesce(sum(case when ${s.treasuryMovements.direction} = 'IN' then ${s.treasuryMovements.amount} else 0 end), 0)`,
      totalOut: sql<string>`coalesce(sum(case when ${s.treasuryMovements.direction} = 'OUT' then ${s.treasuryMovements.amount} else 0 end), 0)`,
    }).from(s.treasuryMovements).where(and(
      eq(s.treasuryMovements.treasuryAccountId, accountId),
      eq(s.treasuryMovements.status, 'POSTED'),
    ));
    const openingBalance = Number(account.openingBalance);
    const totalIn = Number(totals?.totalIn ?? 0);
    const totalOut = Number(totals?.totalOut ?? 0);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      fundCode: account.fundCode,
      version: account.version,
      currency: account.currency,
      openingBalance,
      totalIn,
      totalOut,
      bookBalance: calculateTreasuryBookBalance(openingBalance, totalIn, totalOut),
      completeness: account.cutoverAt && account.cutoverAt <= new Date()
        ? 'COMPLETE' as const
        : 'PARTIAL' as const,
      cutoverAt: account.cutoverAt?.toISOString() ?? null,
    };
  };
  return runInTx(transaction, execute);
}

export async function getTreasuryPositions(accountIds: number[], transaction?: Tx): Promise<TreasuryPosition[]> {
  if (accountIds.length === 0) return [];
  const uniqueAccountIds = [...new Set(accountIds)];
  const execute = async (tx: Tx) => {
    const [accounts, totals] = await Promise.all([
      tx.select().from(s.treasuryAccounts)
        .where(inArray(s.treasuryAccounts.id, uniqueAccountIds)),
      tx.select({
        accountId: s.treasuryMovements.treasuryAccountId,
        totalIn: sql<string>`coalesce(sum(case when ${s.treasuryMovements.direction} = 'IN' then ${s.treasuryMovements.amount} else 0 end), 0)`,
        totalOut: sql<string>`coalesce(sum(case when ${s.treasuryMovements.direction} = 'OUT' then ${s.treasuryMovements.amount} else 0 end), 0)`,
      }).from(s.treasuryMovements).where(and(
        inArray(s.treasuryMovements.treasuryAccountId, uniqueAccountIds),
        eq(s.treasuryMovements.status, 'POSTED'),
      )).groupBy(s.treasuryMovements.treasuryAccountId),
    ]);
    const accountById = new Map(accounts.map(account => [account.id, account]));
    const totalsByAccountId = new Map(totals.map(total => [total.accountId, total]));
    return uniqueAccountIds.map((accountId) => {
      const account = accountById.get(accountId);
      if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');
      const accountTotals = totalsByAccountId.get(accountId);
      const openingBalance = Number(account.openingBalance);
      const totalIn = Number(accountTotals?.totalIn ?? 0);
      const totalOut = Number(accountTotals?.totalOut ?? 0);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      fundCode: account.fundCode,
      version: account.version,
        currency: account.currency,
        openingBalance,
        totalIn,
        totalOut,
        bookBalance: calculateTreasuryBookBalance(openingBalance, totalIn, totalOut),
        completeness: account.cutoverAt && account.cutoverAt <= new Date()
          ? 'COMPLETE' as const
          : 'PARTIAL' as const,
        cutoverAt: account.cutoverAt?.toISOString() ?? null,
      };
    });
  };
  return runInTx(transaction, execute);
}

function requiredText(value: unknown, label: string, max: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) {
    throw new ApiError(400, `${label} không hợp lệ`);
  }
  return normalized;
}

export async function requestTreasuryAccountSetup(input: {
  account: {
    code: string;
    name: string;
    type: 'CASH' | 'BANK';
    fundCode?: TreasuryFundCode | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    openingBalance: number;
    openingBalanceDate: string;
  };
  reason: string;
  openingBalanceEvidence: string;
  makerId: number;
  makerRole: Role | string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TREASURY_ACCOUNT_SETUP', input.makerRole);
  const code = requiredText(input.account.code, 'Mã tài khoản', 50).toUpperCase();
  const name = requiredText(input.account.name, 'Tên tài khoản', 160);
  const openingBalanceDate = normalizeValueDate(input.account.openingBalanceDate);
  if (!openingBalanceDate || !Number.isSafeInteger(input.account.openingBalance)) {
    throw new ApiError(400, 'Số dư hoặc ngày số dư đầu kỳ không hợp lệ');
  }
  const execute = async (tx: Tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`treasury-account-setup\u001f${code}`}, 0))`,
    );
    const [existing] = await tx.select({ id: s.treasuryAccounts.id })
      .from(s.treasuryAccounts).where(eq(s.treasuryAccounts.code, code)).limit(1);
    if (existing) throw new ApiError(409, 'Mã tài khoản tiền mặt/ngân hàng đã tồn tại');
    return buildGovernanceAction({
      subjectType: 'TREASURY_ACCOUNT',
      subjectKey: code,
      actionKind: 'TREASURY_ACCOUNT_SETUP',
      reason: requiredText(input.reason, 'Lý do', 1000),
      originalVersion: 1,
      beforeSnapshot: {},
      afterSnapshot: {
        code,
        name,
        type: input.account.type,
        fundCode: input.account.fundCode == null ? null : treasuryFundCodeSchema.parse(input.account.fundCode),
        currency: 'VND',
        bankName: input.account.bankName?.trim() || null,
        bankAccountNumber: input.account.bankAccountNumber?.trim() || null,
        openingBalance: input.account.openingBalance,
        openingBalanceDate,
      },
      deltaSnapshot: {
        openingBalanceEvidence: requiredText(input.openingBalanceEvidence, 'Chứng từ số dư đầu kỳ', 255),
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };
  return runInTx(input.transaction, execute);
}

/** Classify the existing account without changing opening balances or cash history. */
export async function updateTreasuryAccountFund(tx: Tx, accountId: number, input: TreasuryAccountFundInput, actor: { userId: number; role: Role | string }) {
  assertCanMakeGovernanceAction('TREASURY_ACCOUNT_SETUP', actor.role);
  const fundCode = treasuryFundCodeSchema.parse(input.fundCode);
  const reason = requiredText(input.reason, 'Lý do', 1000);
  const [account] = await tx.select().from(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, accountId)).for('update');
  if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');
  if (account.version !== input.expectedVersion) throw new ApiError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.');
  const [updated] = await tx.update(s.treasuryAccounts).set({ fundCode, version: account.version + 1, updatedBy: actor.userId, updatedAt: new Date() })
    .where(eq(s.treasuryAccounts.id, accountId)).returning();
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'TREASURY_ACCOUNT_FUND_CHANGED', entityType: 'treasury_account', entityId: accountId,
    payload: { before: { fundCode: account.fundCode, version: account.version }, after: { fundCode, version: updated.version }, reason } });
  return { id: updated.id, fundCode: updated.fundCode, version: updated.version };
}

export async function assertTreasuryFundAssigned(tx: Tx, accountId: number) {
  const [account] = await tx.select({ fundCode: s.treasuryAccounts.fundCode }).from(s.treasuryAccounts)
    .where(eq(s.treasuryAccounts.id, accountId)).for('update');
  if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');
  if (!treasuryFundCodeSchema.safeParse(account.fundCode).success) throw new ApiError(409, 'Tài khoản chưa phân nguồn quỹ. Cấu hình Quỹ công ty hoặc Quỹ TM tại Sổ quỹ / ngân hàng trước khi ghi phiếu.');
}

export async function requestTreasuryCutover(input: {
  accountId: number;
  expectedVersion: number;
  cutoverAt: string;
  reason: string;
  cutoverEvidence: string;
  makerId: number;
  makerRole: Role | string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TREASURY_CUTOVER', input.makerRole);
  const cutoverAt = new Date(input.cutoverAt);
  if (Number.isNaN(cutoverAt.getTime())) throw new ApiError(400, 'Thời điểm chuyển đổi không hợp lệ');
  const execute = async (tx: Tx) => {
    const [account] = await tx.select().from(s.treasuryAccounts)
      .where(eq(s.treasuryAccounts.id, input.accountId)).limit(1).for('update');
    if (!account) throw new ApiError(404, 'Không tìm thấy tài khoản tiền mặt/ngân hàng');
    if (account.version !== input.expectedVersion) throw new ApiError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.');
    if (account.status !== 'ACTIVE' || account.cutoverAt) throw new ApiError(409, 'Tài khoản không thể chuyển đổi ở trạng thái hiện tại');
    return buildGovernanceAction({
      subjectType: 'TREASURY_ACCOUNT',
      subjectId: account.id,
      actionKind: 'TREASURY_CUTOVER',
      reason: requiredText(input.reason, 'Lý do', 1000),
      originalVersion: account.version,
      beforeSnapshot: { status: account.status, cutoverAt: account.cutoverAt },
      afterSnapshot: { cutoverAt: cutoverAt.toISOString() },
      deltaSnapshot: { cutoverEvidence: requiredText(input.cutoverEvidence, 'Chứng từ chuyển đổi', 255) },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };
  return runInTx(input.transaction, execute);
}

export async function requestTreasuryMovementReversal(input: {
  movementId: number;
  expectedVersion: number;
  reason: string;
  reversalEvidence: string;
  makerId: number;
  makerRole: Role | string;
  transaction?: Tx;
}) {
  assertCanMakeGovernanceAction('TREASURY_MOVEMENT_REVERSAL', input.makerRole);
  const execute = async (tx: Tx) => {
    const [movement] = await tx.select().from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.id, input.movementId)).limit(1).for('update');
    if (!movement) throw new ApiError(404, 'Không tìm thấy giao dịch kho quỹ');
    if (movement.status !== 'POSTED') throw new ApiError(409, 'Giao dịch kho quỹ không còn hiệu lực');
    if (movement.reversalOfId != null) throw new ApiError(409, 'Không thể đảo một giao dịch đảo kho quỹ');
    const [expenseVoucher] = await tx.select({ id: s.expenseCashVouchers.id }).from(s.expenseCashVouchers)
      .where(and(eq(s.expenseCashVouchers.treasuryMovementId, movement.id), eq(s.expenseCashVouchers.status, 'RECORDED'))).limit(1);
    if (expenseVoucher) throw new ApiError(409, 'Giao dịch thuộc phiếu chi phí; dùng Hoàn tác tại lịch sử phiếu chi phí để cập nhật đồng thời công nợ và phân bổ.');
    if (movement.sourceVersion !== input.expectedVersion) {
      throw new ApiError(409, 'Giao dịch kho quỹ đã thay đổi. Vui lòng tải lại.');
    }
    if (movement.paymentReceiptId != null) {
      throw new ApiError(409, 'Giao dịch thu tiền chỉ được đảo qua nghiệp vụ hoàn tiền để đồng bộ công nợ và phân bổ.');
    }
    if (movement.ledgerEntryId != null) {
      throw new ApiError(409, 'Giao dịch chi tiền chỉ được đảo qua nghiệp vụ chứng từ nguồn để đồng bộ sổ cái và công nợ phải trả.');
    }
    const [existingReversal] = await tx.select({ id: s.treasuryMovements.id })
      .from(s.treasuryMovements)
      .where(eq(s.treasuryMovements.reversalOfId, movement.id))
      .limit(1);
    if (existingReversal) throw new ApiError(409, 'Giao dịch kho quỹ đã có bút toán đảo');
    return buildGovernanceAction({
      subjectType: 'TREASURY_MOVEMENT',
      subjectId: movement.id,
      actionKind: 'TREASURY_MOVEMENT_REVERSAL',
      reason: requiredText(input.reason, 'Lý do', 1000),
      originalVersion: movement.sourceVersion,
      beforeSnapshot: { ...movement },
      afterSnapshot: {
        direction: movement.direction === 'IN' ? 'OUT' : 'IN',
        amount: Number(movement.amount),
        sourceVersion: movement.sourceVersion + 1,
      },
      deltaSnapshot: { reversalEvidence: requiredText(input.reversalEvidence, 'Chứng từ đảo giao dịch', 255) },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };
  return runInTx(input.transaction, execute);
}

export async function applyTreasuryGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  const after = action.afterSnapshot as Record<string, unknown>;
  if (action.actionKind === 'TREASURY_ACCOUNT_SETUP') {
    const [account] = await tx.insert(s.treasuryAccounts).values({
      code: String(after.code),
      name: String(after.name),
      type: String(after.type),
      fundCode: after.fundCode == null ? null : treasuryFundCodeSchema.parse(after.fundCode),
      currency: 'VND',
      bankName: typeof after.bankName === 'string' ? after.bankName : null,
      bankAccountNumber: typeof after.bankAccountNumber === 'string' ? after.bankAccountNumber : null,
      openingBalance: String(after.openingBalance),
      openingBalanceDate: String(after.openingBalanceDate),
      status: 'ACTIVE',
      createdBy: action.makerId,
      updatedBy: action.approverId ?? action.makerId,
    }).returning();
    return { applicationResult: { treasuryAccountId: account.id, version: account.version } };
  }
  if (action.actionKind === 'TREASURY_CUTOVER') {
    const [account] = await tx.update(s.treasuryAccounts).set({
      cutoverAt: new Date(String(after.cutoverAt)),
      version: sql`${s.treasuryAccounts.version} + 1`,
      updatedBy: action.approverId ?? action.makerId,
      updatedAt: new Date(),
    }).where(and(
      eq(s.treasuryAccounts.id, action.subjectId!),
      eq(s.treasuryAccounts.version, action.originalVersion!),
      eq(s.treasuryAccounts.status, 'ACTIVE'),
    )).returning();
    if (!account) throw new ApiError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.');
    return { applicationResult: { treasuryAccountId: account.id, cutoverAt: account.cutoverAt?.toISOString(), version: account.version } };
  }
  if (action.actionKind === 'TREASURY_MOVEMENT_REVERSAL') {
    throw new ApiError(409, 'Yêu cầu đảo kho quỹ độc lập không còn được hỗ trợ; hãy đảo qua nghiệp vụ chứng từ nguồn.');
  }
  throw new ApiError(409, 'Loại yêu cầu kho quỹ không được hỗ trợ');
}
