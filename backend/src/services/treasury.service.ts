import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
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
    governanceActionId: input.governanceActionId,
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
  governanceActionId: number;
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
      && existing.governanceActionId === input.governanceActionId
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
    governanceActionId: input.governanceActionId,
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

async function assertNoActiveTreasuryGovernanceAction(tx: Tx, input: {
  subjectType: 'TREASURY_ACCOUNT' | 'TREASURY_MOVEMENT';
  actionKind: 'TREASURY_ACCOUNT_SETUP' | 'TREASURY_CUTOVER' | 'TREASURY_MOVEMENT_REVERSAL';
  subjectId?: number;
  subjectKey?: string;
  originalVersion: number;
}): Promise<void> {
  const identity = input.subjectId == null
    ? eq(s.governanceActions.subjectKey, input.subjectKey!)
    : eq(s.governanceActions.subjectId, input.subjectId);
  const [existing] = await tx.select({ id: s.governanceActions.id })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, input.subjectType),
      eq(s.governanceActions.actionKind, input.actionKind),
      eq(s.governanceActions.originalVersion, input.originalVersion),
      inArray(s.governanceActions.status, ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE']),
      identity,
    ))
    .limit(1);
  if (existing) throw new ApiError(409, 'Đã có yêu cầu kho quỹ đang được xử lý');
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
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`treasury-account-setup\u001f${code}`}, 0))`,
    );
    const [existing] = await tx.select({ id: s.treasuryAccounts.id })
      .from(s.treasuryAccounts).where(eq(s.treasuryAccounts.code, code)).limit(1);
    if (existing) throw new ApiError(409, 'Mã tài khoản tiền mặt/ngân hàng đã tồn tại');
    await assertNoActiveTreasuryGovernanceAction(tx, {
      subjectType: 'TREASURY_ACCOUNT',
      subjectKey: code,
      actionKind: 'TREASURY_ACCOUNT_SETUP',
      originalVersion: 1,
    });
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
    await assertNoActiveTreasuryGovernanceAction(tx, {
      subjectType: 'TREASURY_ACCOUNT',
      subjectId: account.id,
      actionKind: 'TREASURY_CUTOVER',
      originalVersion: account.version,
    });
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
    await assertNoActiveTreasuryGovernanceAction(tx, {
      subjectType: 'TREASURY_MOVEMENT',
      subjectId: movement.id,
      actionKind: 'TREASURY_MOVEMENT_REVERSAL',
      originalVersion: movement.sourceVersion,
    });
    const [action] = await tx.insert(s.governanceActions).values({
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
    throw new ApiError(409, 'Yêu cầu đảo kho quỹ độc lập không còn được hỗ trợ; hãy đảo qua nghiệp vụ chứng từ nguồn.');
  }
  throw new ApiError(409, 'Loại yêu cầu kho quỹ không được hỗ trợ');
}
