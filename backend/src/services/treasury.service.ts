import { and, eq, lte, sql } from 'drizzle-orm';
import type { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';

type GovernanceActionRow = typeof s.governanceActions.$inferSelect;

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
  currency: string;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  bookBalance: number;
  completeness: 'COMPLETE' | 'PARTIAL';
  cutoverAt: string | null;
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
  governanceActionId: number;
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
    .where(and(eq(s.treasuryMovements.status, 'POSTED'), sourceFilter))
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
    governanceActionId: input.governanceActionId,
    createdBy: input.createdBy,
  }).returning();
  return movement;
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
  return transaction ? execute(transaction) : db.transaction(execute);
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
    const [existing] = await tx.select({ id: s.treasuryAccounts.id })
      .from(s.treasuryAccounts).where(eq(s.treasuryAccounts.code, code)).limit(1);
    if (existing) throw new ApiError(409, 'Mã tài khoản tiền mặt/ngân hàng đã tồn tại');
    const [action] = await tx.insert(s.governanceActions).values({
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
    }).returning();
    return action;
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
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
    const [action] = await tx.insert(s.governanceActions).values({
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
    }).returning();
    return action;
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function requestTreasuryMovementReversal(input: {
  movementId: number;
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
    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'TREASURY_MOVEMENT',
      subjectId: movement.id,
      actionKind: 'TREASURY_MOVEMENT_REVERSAL',
      reason: requiredText(input.reason, 'Lý do', 1000),
      originalVersion: movement.sourceVersion,
      beforeSnapshot: { ...movement },
      afterSnapshot: { status: 'REVERSED' },
      deltaSnapshot: { reversalEvidence: requiredText(input.reversalEvidence, 'Chứng từ đảo giao dịch', 255) },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function applyTreasuryGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  const after = action.afterSnapshot as Record<string, unknown>;
  if (action.actionKind === 'TREASURY_ACCOUNT_SETUP') {
    const [account] = await tx.insert(s.treasuryAccounts).values({
      code: String(after.code),
      name: String(after.name),
      type: String(after.type),
      currency: 'VND',
      bankName: typeof after.bankName === 'string' ? after.bankName : null,
      bankAccountNumber: typeof after.bankAccountNumber === 'string' ? after.bankAccountNumber : null,
      openingBalance: String(after.openingBalance),
      openingBalanceDate: String(after.openingBalanceDate),
      openingGovernanceActionId: action.id,
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
      eq(s.treasuryAccounts.version, action.originalVersion),
      eq(s.treasuryAccounts.status, 'ACTIVE'),
    )).returning();
    if (!account) throw new ApiError(409, 'Tài khoản đã thay đổi. Vui lòng tải lại.');
    return { applicationResult: { treasuryAccountId: account.id, cutoverAt: account.cutoverAt?.toISOString(), version: account.version } };
  }
  if (action.actionKind === 'TREASURY_MOVEMENT_REVERSAL') {
    const [original] = await tx.update(s.treasuryMovements).set({ status: 'REVERSED' })
      .where(and(
        eq(s.treasuryMovements.id, action.subjectId!),
        eq(s.treasuryMovements.status, 'POSTED'),
      )).returning();
    if (!original) throw new ApiError(409, 'Giao dịch kho quỹ đã được xử lý');
    const [reversal] = await tx.insert(s.treasuryMovements).values({
      treasuryAccountId: original.treasuryAccountId,
      direction: original.direction === 'IN' ? 'OUT' : 'IN',
      amount: original.amount,
      valueDate: new Date().toISOString().slice(0, 10),
      status: 'POSTED',
      paymentReceiptId: original.paymentReceiptId,
      ledgerEntryId: original.ledgerEntryId,
      sourceVersion: original.sourceVersion + 1,
      paymentContractVersion: original.paymentContractVersion,
      physicalReference: `REVERSAL:${original.id}`,
      externalReference: original.externalReference,
      governanceActionId: action.id,
      reversalOfId: original.id,
      createdBy: action.makerId,
    }).returning();
    return { applicationResult: { treasuryMovementId: reversal.id, reversalOfId: original.id } };
  }
  throw new ApiError(409, 'Loại yêu cầu kho quỹ không được hỗ trợ');
}
