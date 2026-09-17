import { driverCommandIdentity, vendorCommandIdentity } from './cash-command-identity.service';
/**
 * Financial operations service — owns all mutating financial transactions:
 * payment recording, trip adjustments, and penalty creation.
 *
 * Routes are thin HTTP adapters; all business logic lives here.
 */
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, inArray, sql, desc, isNull } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { autoApplyGovernanceAction, requestTripArAdjustment } from './adjustment-governance.service';
import { assertCanMakeGovernanceAction } from './governance-policy';
import { settleExpensesForPayment } from './expense.service';
import {
  buildGovernanceAction,
  type GovernanceActionRow,
} from './governance-action-core.service';
import {
  recordPaymentReceipt,
  recordPaymentReceiptIdempotent,
  type PaymentReceiptInput,
} from './payment-allocation.service';
import { IDEMPOTENCY_ENDPOINTS, runIdempotent } from './idempotency.service';
import type { Tx } from './trip-shared';
import {
  insertTreasuryMovement,
  resolveTreasuryPaymentContract,
  type TreasuryPaymentFields,
} from './treasury.service';

// ─── Payment recording ─────────────────────────────────────────────────────────

export type PaymentInput = PaymentReceiptInput;

/**
 * Record a customer payment against one or more trips.
 * Resolves trip codes for human-readable ledger notes.
 */
export async function recordPayment(input: PaymentInput) {
  return recordPaymentReceipt(input);
}

export { recordPaymentReceiptIdempotent };

type LedgerEntryRow = typeof s.ledger.$inferSelect;
type PenaltyRow = typeof s.penalties.$inferSelect;
type VendorPaymentResult = LedgerEntryRow & {
  warning?: string;
  overpayment?: number;
};

function buildVendorOverpaymentWarning(previousBalance: number, paymentAmount: number) {
  return `Thanh toán ${paymentAmount.toLocaleString('vi-VN')}₫ vượt công nợ hiện tại ${previousBalance.toLocaleString('vi-VN')}₫. Số dư sẽ âm. Bạn có chắc chắn muốn tiếp tục?`;
}

function buildCarrierOverpaymentWarning(previousBalance: number, paymentAmount: number) {
  return `Thanh toán ${paymentAmount.toLocaleString('vi-VN')}₫ vượt công nợ thuê ngoài hiện tại ${previousBalance.toLocaleString('vi-VN')}₫. Bạn có chắc chắn muốn tiếp tục?`;
}

async function loadLedgerEntryTx(tx: Tx, ledgerId: number): Promise<LedgerEntryRow> {
  const [row] = await tx.select().from(s.ledger)
    .where(eq(s.ledger.id, ledgerId))
    .limit(1);
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy bút toán');
  }
  return row;
}

function applyOverpaymentMetadata(
  row: LedgerEntryRow,
  warningBuilder: (previousBalance: number, paymentAmount: number) => string,
): VendorPaymentResult {
  const newBalance = Number(row.balance);
  if (newBalance >= 0) return row;
  const paymentAmount = Number(row.debit);
  const previousBalance = newBalance + paymentAmount;
  return {
    ...row,
    warning: warningBuilder(previousBalance, paymentAmount),
    overpayment: Math.abs(newBalance),
  };
}

function latestEntityLedgerVersionTx(
  tx: Tx,
  entityType: 'CUSTOMER' | 'VENDOR' | 'DRIVER' | 'CARRIER',
  entityId: number,
) {
  const entityTypes = entityType === 'CARRIER' ? ['CUSTOMER', 'CARRIER'] as const : [entityType];
  return tx.select({ id: s.ledger.id })
    .from(s.ledger)
    .where(and(
      inArray(s.ledger.entityType, entityTypes),
      eq(s.ledger.entityId, entityId),
    ))
    .orderBy(desc(s.ledger.id))
    .limit(1);
}

async function getEntityLedgerVersionTx(
  tx: Tx,
  entityType: 'CUSTOMER' | 'VENDOR' | 'DRIVER' | 'CARRIER',
  entityId: number,
): Promise<number> {
  const [row] = await latestEntityLedgerVersionTx(tx, entityType, entityId);
  return row?.id ?? 0;
}

function buildVendorPaymentReason(input: VendorPaymentInput, label: string): string {
  return input.note?.trim() || `Đề nghị ghi nhận ${label} ${input.receiptId ?? ''}`.trim();
}

function buildVendorPaymentSubjectKey(
  prefix: 'vendor' | 'carrier',
  supplierId: number,
  input: VendorPaymentInput,
): string {
  const legacyKey = [
    prefix,
    supplierId,
    input.receiptId ?? '',
    input.date,
    input.amount,
    input.confirmOverpay ? '1' : '0',
  ].join(':');
  if (
    input.treasuryAccountId == null
    && input.valueDate == null
    && input.physicalReference == null
  ) return legacyKey;
  return [
    legacyKey,
    input.treasuryAccountId ?? '',
    input.valueDate ?? '',
    input.physicalReference ?? '',
  ].join(':');
}

function buildDriverPayoutReason(input: DriverPayoutInput): string {
  return input.note?.trim() || `Đề nghị ghi nhận thanh toán lái xe ${input.receiptId ?? input.payoutDate}`;
}

function buildDriverPayoutSubjectKey(driverId: number, input: DriverPayoutInput): string {
  return `driver:${driverId}:${input.receiptId ?? ''}:${input.payoutDate}:${input.amount}:${input.method}`;
}

function buildPenaltyCreateReason(input: PenaltyInput): string {
  return input.customReason?.trim() || 'Đề nghị ghi nhận kỷ luật lái xe';
}

function buildPenaltyCreateSubjectKey(input: PenaltyInput): string {
  return `penalty:${input.driverId}:${input.tripId ?? 0}:${input.reasonId ?? 0}:${input.date}:${input.amount}`;
}

function penaltyVersionFromTimestamp(updatedAt: Date): number {
  return Math.max(1, Math.floor(updatedAt.getTime() / 1000));
}

// ─── Driver payout (B1 — feedback202606 GAP 4) ───────────────────────────────

export interface DriverPayoutInput extends TreasuryPaymentFields {
  driverId: number;
  amount: number;          // VND, integer-scale
  method: 'CASH' | 'BANK';
  payoutDate: string;      // ISO date (YYYY-MM-DD)
  note?: string;
  receiptId?: string;
}

/**
 * Record a driver salary/cash payout. Posts ONE DRIVER_PAYOUT debit on the
 * DRIVER ledger, reducing the company's payable balance for that driver.
 *
 * Mirrors recordPayment: advisory-lock the entity, guard against overpay
 * (debit may not exceed the current payable balance + 1 for rounding), then
 * post a single append-only ledger entry.
 */
export async function recordDriverPayoutTx(tx: Tx, input: DriverPayoutInput): Promise<LedgerEntryRow> {
  // Resolve driver name for a human-readable overpay error message
  // (no raw IDs in UI text — per project convention).
  const [driver] = await tx.select({ name: s.drivers.name })
    .from(s.drivers)
    .where(eq(s.drivers.id, input.driverId))
    .limit(1);
  const driverLabel = driver?.name ?? `ID ${input.driverId}`;

  // Advisory lock — serialize concurrent payouts for the same driver
  await LedgerService.lockEntity(tx, 'DRIVER', input.driverId);

  // DRIVER ledger balance = payable (what the company still owes the driver).
  const balance = await LedgerService.getBalanceTx(tx, 'DRIVER', input.driverId);
  if (input.amount > balance + 1) {  // +1 to absorb rounding
    throw new ApiError(422,
      `Số thanh toán vượt quá số công nợ còn lại của lái xe ${driverLabel} (còn ${balance.toLocaleString('vi-VN')} ₫, nhập ${input.amount.toLocaleString('vi-VN')} ₫)`);
  }

  const methodLabel = input.method === 'BANK' ? 'chuyển khoản' : 'tiền mặt';
  const note = `Thanh toán lương (${methodLabel}) — ${input.payoutDate}${input.note ? ' — ' + input.note : ''}`;

  return LedgerService.postEntry(tx, {
    txnType: TxnType.DRIVER_PAYOUT,
    entityType: 'DRIVER',
    entityId: input.driverId,
    debit: input.amount,
    credit: 0,
    receiptId: input.receiptId,
    note,
  });
}

export async function recordDriverPayout(input: DriverPayoutInput) {
  return db.transaction((tx) => recordDriverPayoutTx(tx, input));
}

/** OPS ledger credits are cash handed to OPS; expenses consume them as debits. */
export async function recordOpsReimbursementTx(tx: Tx, input: { opsUserId: number; amount: number; receiptId: string; note?: string; date: string }) {
  await LedgerService.lockEntity(tx, 'FORWARDER', input.opsUserId);
  const balance = await LedgerService.getBalanceTx(tx, 'FORWARDER', input.opsUserId);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > Math.max(0, -balance)) {
    throw new ApiError(409, 'Số hoàn ứng vượt khoản còn phải trả cho OPS.');
  }
  return LedgerService.postEntry(tx, { txnType: TxnType.OPS_SETTLEMENT, entityType: 'FORWARDER', entityId: input.opsUserId,
    debit: 0, credit: input.amount, receiptId: input.receiptId, note: input.note ?? 'Hoàn chi phí cho OPS',
    timestamp: new Date(`${input.date}T00:00:00+07:00`) });
}

export async function recordDriverPayoutIdempotent(args: {
  input: DriverPayoutInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}) {
  return runIdempotent<LedgerEntryRow>({
    endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT,
    idempotencyKey: args.idempotencyKey,
    payload: driverCommandIdentity(args.input),
    createdBy: args.createdBy ?? null,
    entityType: 'ledger',
    replayResult: async (snapshot, tx) => {
      const saved = snapshot as { id: number; ledgerEntryId?: number | null; applicationResult?: { ledgerId?: number } };
      return loadLedgerEntryTx(tx, saved.ledgerEntryId ?? saved.applicationResult?.ledgerId ?? saved.id);
    },
    create: async (tx) => {
      const treasury = await resolveTreasuryPaymentContract(tx, args.input, new Date());
      const row = await recordDriverPayoutTx(tx, args.input);
      if (treasury.treasuryAccountId && treasury.valueDate && treasury.physicalReference) {
        if (!args.createdBy) throw new ApiError(400, 'Cần người ghi nhận giao dịch quỹ.');
        await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT', amount: Number(args.input.amount),
          valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId: row.id,
          sourceVersion: row.id, paymentContractVersion: treasury.paymentContractVersion, createdBy: args.createdBy });
      }
      return row;
    },
    load: async (entityId, tx) => loadLedgerEntryTx(tx, entityId),
  });
}

export async function requestDriverPayoutGovernance(input: {
  payout: DriverPayoutInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('DRIVER_PAYOUT', input.makerRole);

  const execute = async (tx: Tx) => {
    const [driver] = await tx.select({ id: s.drivers.id, name: s.drivers.name })
      .from(s.drivers)
      .where(eq(s.drivers.id, input.payout.driverId))
      .limit(1);
    if (!driver) {
      throw new ApiError(404, 'Không tìm thấy lái xe');
    }

    const treasury = await resolveTreasuryPaymentContract(tx, input.payout, new Date());
    await LedgerService.lockEntity(tx, 'DRIVER', input.payout.driverId);
    const currentBalance = await LedgerService.getBalanceTx(tx, 'DRIVER', input.payout.driverId);
    if (input.payout.amount > currentBalance + 1) {
      throw new ApiError(
        422,
        `Số thanh toán vượt quá số công nợ còn lại của lái xe ${driver.name} (còn ${currentBalance.toLocaleString('vi-VN')} ₫, nhập ${input.payout.amount.toLocaleString('vi-VN')} ₫)`,
      );
    }
    const currentVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', input.payout.driverId);

    return buildGovernanceAction({
      subjectType: 'DRIVER_PAYOUT',
      subjectId: null,
      subjectKey: buildDriverPayoutSubjectKey(input.payout.driverId, input.payout),
      actionKind: 'DRIVER_PAYOUT',
      reason: buildDriverPayoutReason(input.payout),
      originalVersion: currentVersion,
      beforeSnapshot: {
        driverId: input.payout.driverId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        driverId: input.payout.driverId,
        amount: input.payout.amount,
        method: input.payout.method,
        payoutDate: input.payout.payoutDate,
        note: input.payout.note?.trim() || '',
        receiptId: input.payout.receiptId ?? '',
        ...treasury,
      },
      deltaSnapshot: {
        driverBalanceDelta: -input.payout.amount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyDriverPayoutGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'DRIVER_PAYOUT' || action.subjectType !== 'DRIVER_PAYOUT') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc thanh toán lái xe');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const driverId = Number(afterSnapshot?.driverId);
  if (!Number.isInteger(driverId) || driverId <= 0) {
    throw new ApiError(409, 'Yêu cầu thanh toán lái xe không có dữ liệu hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'DRIVER', driverId);
  const currentVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', driverId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Công nợ lái xe đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const posted = await recordDriverPayoutTx(tx, {
    driverId,
    amount: Number(afterSnapshot?.amount),
    method: afterSnapshot?.method === 'BANK' ? 'BANK' : 'CASH',
    payoutDate: String(afterSnapshot?.payoutDate ?? ''),
    note: typeof afterSnapshot?.note === 'string' ? afterSnapshot.note : undefined,
    receiptId: typeof afterSnapshot?.receiptId === 'string' && afterSnapshot.receiptId
      ? afterSnapshot.receiptId
      : undefined,
  });

  const treasury = await resolveTreasuryPaymentContract(tx, {
    treasuryAccountId: afterSnapshot?.treasuryAccountId == null ? null : Number(afterSnapshot.treasuryAccountId),
    valueDate: typeof afterSnapshot?.valueDate === 'string' ? afterSnapshot.valueDate : null,
    physicalReference: typeof afterSnapshot?.physicalReference === 'string' ? afterSnapshot.physicalReference : null,
  }, action.createdAt);
  let treasuryMovementId: number | null = null;
  if (treasury.treasuryAccountId && treasury.valueDate && treasury.physicalReference) {
    const movement = await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT',
      amount: Number(afterSnapshot?.amount), valueDate: treasury.valueDate, physicalReference: treasury.physicalReference,
      paymentContractVersion: treasury.paymentContractVersion, ledgerEntryId: posted.id, sourceVersion: posted.id,
      createdBy: action.makerId, externalReference: posted.receiptId });
    treasuryMovementId = movement.id;
  }

  return {
    ledgerEntryId: posted.id,
    applicationResult: {
      ledgerId: posted.id,
      driverId,
      receiptId: posted.receiptId,
      treasuryMovementId,
    },
  };
}

// ─── Adjustments ────────────────────────────────────────────────────────────────

export interface AdjustmentInput {
  tripId: number;
  amount: number;
  note: string;
  signedAgreementRef: string;
  makerId: number;
  makerRole: string;
  expectedTripVersion: number;
  transaction?: Tx;
}

/**
 * Submit a financial adjustment (điều chỉnh) for independent checking and
 * approval. No ledger effect is posted until the governance action is approved.
 */
export async function createAdjustment(input: AdjustmentInput) {
  // The make stage only BUILDS the transient governance action — without
  // this apply wrap the route 201'd with no ledger entry and no readback
  // (staging round-5: POST 201 → GET adjustments [] → revenue unchanged).
  // Applying in-request posts the ADJUSTMENT ledger entry atomically
  // (applyTripGovernanceAction via the subjectType dispatch).
  return autoApplyGovernanceAction({
    make: (tx) => requestTripArAdjustment({
      tripId: input.tripId,
      amount: input.amount,
      reason: input.note,
      signedAgreementRef: input.signedAgreementRef,
      makerId: input.makerId,
      makerRole: input.makerRole,
      expectedTripVersion: input.expectedTripVersion,
      transaction: tx,
    }),
    actorId: input.makerId,
    actorRole: input.makerRole,
    transaction: input.transaction,
  });
}

/**
 * Get all adjustments for a specific trip.
 */
export async function getTripAdjustments(tripId: number) {
  return db.select().from(s.ledger)
    .where(and(eq(s.ledger.txnType, TxnType.ADJUSTMENT), eq(s.ledger.txnId, tripId)))
    .orderBy(desc(s.ledger.id));
}

// ─── Penalties ──────────────────────────────────────────────────────────────────

export interface PenaltyInput {
  driverId: number;
  tripId?: number;
  reasonId?: number;
  customReason?: string;
  amount: number;
  date: string;
}

/**
 * Create a driver penalty and post the corresponding ledger entry.
 */
async function loadPenaltyTx(tx: Tx, penaltyId: number): Promise<PenaltyRow> {
  const [row] = await tx.select().from(s.penalties)
    .where(eq(s.penalties.id, penaltyId))
    .limit(1);
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy kỷ luật');
  }
  return row;
}

function toPenaltyCreateSnapshot(row: PenaltyRow): PenaltyRow {
  return {
    ...row,
    status: 'ACTIVE',
    updatedAt: row.createdAt,
  };
}

async function createPenaltyTx(tx: Tx, input: PenaltyInput): Promise<PenaltyRow> {
  // Advisory lock to prevent concurrent penalty races
  await LedgerService.lockEntity(tx, 'DRIVER', input.driverId);

  const [penalty] = await tx.insert(s.penalties).values({
    driverId: input.driverId,
    tripId: input.tripId ?? null,
    reasonId: input.reasonId ?? null,
    customReason: input.customReason ?? null,
    amount: String(input.amount),
    date: input.date,
  }).returning();

  // Resolve trip code so the driver's ledger note reads naturally.
  let tripLabel = '';
  if (input.tripId) {
    const [trip] = await tx.select({ tripCode: s.trips.tripCode })
      .from(s.trips).where(eq(s.trips.id, input.tripId)).limit(1);
    tripLabel = trip?.tripCode || '';
  }

  await LedgerService.postEntry(tx, {
    txnType: TxnType.PENALTY,
    txnId: penalty.id,
    entityType: 'DRIVER',
    entityId: input.driverId,
    debit: input.amount,
    credit: 0,
    note: input.customReason
      || (tripLabel ? `Kỷ luật chuyến ${tripLabel}` : 'Kỷ luật vi phạm'),
  });

  return penalty;
}

export async function createPenalty(input: PenaltyInput) {
  return db.transaction((tx) => createPenaltyTx(tx, input));
}

export async function createPenaltyIdempotent(args: {
  input: PenaltyInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}) {
  return runIdempotent<PenaltyRow>({
    endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CREATE,
    idempotencyKey: args.idempotencyKey,
    payload: {
      driverId: args.input.driverId,
      tripId: args.input.tripId ?? null,
      reasonId: args.input.reasonId ?? null,
      customReason: args.input.customReason ?? '',
      amount: args.input.amount,
      date: args.input.date,
    },
    createdBy: args.createdBy ?? null,
    entityType: 'penalty',
    create: async (tx) => createPenaltyTx(tx, args.input),
    load: async (entityId, tx) => toPenaltyCreateSnapshot(await loadPenaltyTx(tx, entityId)),
  });
}

export async function requestPenaltyCreateGovernance(input: {
  penalty: PenaltyInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('PENALTY_CREATE', input.makerRole);

  const execute = async (tx: Tx) => {
    const [driver] = await tx.select({ id: s.drivers.id })
      .from(s.drivers)
      .where(eq(s.drivers.id, input.penalty.driverId))
      .limit(1);
    if (!driver) {
      throw new ApiError(404, 'Không tìm thấy lái xe');
    }

    await LedgerService.lockEntity(tx, 'DRIVER', input.penalty.driverId);
    const currentBalance = await LedgerService.getBalanceTx(tx, 'DRIVER', input.penalty.driverId);
    const currentVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', input.penalty.driverId);

    return buildGovernanceAction({
      subjectType: 'PENALTY',
      subjectId: null,
      subjectKey: buildPenaltyCreateSubjectKey(input.penalty),
      actionKind: 'PENALTY_CREATE',
      reason: buildPenaltyCreateReason(input.penalty),
      originalVersion: currentVersion,
      beforeSnapshot: {
        driverId: input.penalty.driverId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        driverId: input.penalty.driverId,
        tripId: input.penalty.tripId ?? null,
        reasonId: input.penalty.reasonId ?? null,
        customReason: input.penalty.customReason ?? '',
        amount: input.penalty.amount,
        date: input.penalty.date,
      },
      deltaSnapshot: {
        driverBalanceDelta: -input.penalty.amount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyPenaltyCreateGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'PENALTY_CREATE' || action.subjectType !== 'PENALTY') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc tạo kỷ luật');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const driverId = Number(afterSnapshot?.driverId);
  if (!Number.isInteger(driverId) || driverId <= 0) {
    throw new ApiError(409, 'Yêu cầu kỷ luật không có dữ liệu hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'DRIVER', driverId);
  const currentVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', driverId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Sổ cái lái xe đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const penalty = await createPenaltyTx(tx, {
    driverId,
    tripId: afterSnapshot?.tripId == null ? undefined : Number(afterSnapshot.tripId),
    reasonId: afterSnapshot?.reasonId == null ? undefined : Number(afterSnapshot.reasonId),
    customReason: typeof afterSnapshot?.customReason === 'string' ? afterSnapshot.customReason : undefined,
    amount: Number(afterSnapshot?.amount),
    date: String(afterSnapshot?.date ?? ''),
  });

  return {
    applicationResult: {
      penaltyId: penalty.id,
      driverId: penalty.driverId,
    },
  };
}

/**
 * Cancel (void) a penalty — reverses the driver ledger entry.
 */
async function cancelPenaltyTx(tx: Tx, penaltyId: number, reason?: string): Promise<PenaltyRow> {
  const [penalty] = await tx.select().from(s.penalties)
    .where(eq(s.penalties.id, penaltyId))
    .limit(1)
    .for('update');
  if (!penalty) throw new ApiError(404, 'Không tìm thấy kỷ luật');
  if (penalty.status === 'CANCELED') throw new ApiError(409, 'Kỷ luật đã được hủy trước đó');

  // Lock order: controlling penalty row first, then shared driver ledger lock.
  // That matches the Q23 first-winner pattern and avoids duplicate reversals.
  await LedgerService.lockEntity(tx, 'DRIVER', penalty.driverId);

  const [claimed] = await tx.update(s.penalties)
    .set({ status: 'CANCELED', updatedAt: new Date() })
    .where(and(
      eq(s.penalties.id, penaltyId),
      eq(s.penalties.status, 'ACTIVE'),
    ))
    .returning();
  if (!claimed) throw new ApiError(409, 'Kỷ luật đã bị hủy bởi người khác. Vui lòng tải lại.');

  await LedgerService.postEntry(tx, {
    txnType: TxnType.ADJUSTMENT,
    txnId: penalty.id,
    entityType: 'DRIVER',
    entityId: penalty.driverId,
    debit: 0,
    credit: Number(penalty.amount),
    note: reason || 'Hủy quyết định kỷ luật lái xe',
  });

  return claimed;
}

export async function cancelPenalty(penaltyId: number, reason?: string) {
  return db.transaction((tx) => cancelPenaltyTx(tx, penaltyId, reason));
}

export async function cancelPenaltyIdempotent(args: {
  penaltyId: number;
  reason?: string;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}) {
  return runIdempotent<PenaltyRow>({
    endpoint: IDEMPOTENCY_ENDPOINTS.PENALTIES_CANCEL,
    idempotencyKey: args.idempotencyKey,
    payload: {
      penaltyId: args.penaltyId,
      reason: args.reason ?? '',
    },
    createdBy: args.createdBy ?? null,
    entityType: 'penalty',
    create: async (tx) => cancelPenaltyTx(tx, args.penaltyId, args.reason),
    load: async (entityId, tx) => loadPenaltyTx(tx, entityId),
  });
}

export async function requestPenaltyCancelGovernance(input: {
  penaltyId: number;
  reason?: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('PENALTY_CANCEL', input.makerRole);

  const execute = async (tx: Tx) => {
    const [penalty] = await tx.select().from(s.penalties)
      .where(eq(s.penalties.id, input.penaltyId))
      .limit(1)
      .for('update');
    if (!penalty) throw new ApiError(404, 'Không tìm thấy kỷ luật');
    if (penalty.status === 'CANCELED') throw new ApiError(409, 'Kỷ luật đã được hủy trước đó');

    await LedgerService.lockEntity(tx, 'DRIVER', penalty.driverId);
    const driverVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', penalty.driverId);

    return buildGovernanceAction({
      subjectType: 'PENALTY',
      subjectId: penalty.id,
      subjectKey: `penalty:${penalty.id}:cancel`,
      actionKind: 'PENALTY_CANCEL',
      reason: input.reason?.trim() || 'Đề nghị hủy quyết định kỷ luật lái xe',
      originalVersion: penaltyVersionFromTimestamp(penalty.updatedAt),
      beforeSnapshot: {
        driverId: penalty.driverId,
        driverLedgerVersion: driverVersion,
        penaltyStatus: penalty.status,
        penaltyAmount: Number(penalty.amount),
      },
      afterSnapshot: {
        penaltyId: penalty.id,
        reason: input.reason?.trim() || '',
      },
      deltaSnapshot: {
        driverBalanceDelta: Number(penalty.amount),
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyPenaltyCancelGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'PENALTY_CANCEL' || action.subjectType !== 'PENALTY' || action.subjectId == null) {
    throw new ApiError(409, 'Loại yêu cầu không thuộc hủy kỷ luật');
  }

  const [penalty] = await tx.select().from(s.penalties)
    .where(eq(s.penalties.id, action.subjectId))
    .limit(1)
    .for('update');
  if (!penalty) throw new ApiError(404, 'Không tìm thấy kỷ luật');
  if (penalty.status === 'CANCELED') throw new ApiError(409, 'Kỷ luật đã được hủy trước đó');
  if (penaltyVersionFromTimestamp(penalty.updatedAt) !== action.originalVersion) {
    throw new ApiError(409, 'Quyết định kỷ luật đã thay đổi; yêu cầu này không thể áp dụng');
  }

  await LedgerService.lockEntity(tx, 'DRIVER', penalty.driverId);
  const driverVersion = await getEntityLedgerVersionTx(tx, 'DRIVER', penalty.driverId);
  const beforeSnapshot = action.beforeSnapshot as Record<string, unknown> | null;
  if (driverVersion !== Number(beforeSnapshot?.driverLedgerVersion ?? -1)) {
    throw new ApiError(409, 'Sổ cái lái xe đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const canceled = await cancelPenaltyTx(
    tx,
    penalty.id,
    typeof afterSnapshot?.reason === 'string' && afterSnapshot.reason ? afterSnapshot.reason : undefined,
  );

  return {
    applicationResult: {
      penaltyId: canceled.id,
      driverId: canceled.driverId,
    },
  };
}

// ─── Ledger balances ────────────────────────────────────────────────────────────

/**
 * Get current balances for all entities of a given type.
 * Uses the latest ledger row per entity (running balance).
 */
export async function getEntityBalances(entityType: string) {
  const rows = await db.selectDistinctOn([s.ledger.entityId], {
    entityId: s.ledger.entityId,
    balance: s.ledger.balance,
    timestamp: s.ledger.timestamp,
  })
  .from(s.ledger)
  .where(eq(s.ledger.entityType, entityType))
  .orderBy(s.ledger.entityId, desc(s.ledger.id));

  return rows.map(r => ({
    entityId: r.entityId,
    balance: parseFloat(r.balance),
    timestamp: r.timestamp,
  }));
}

// ─── Vendor payments ───────────────────────────────────────────────────────────

export interface VendorPaymentInput extends TreasuryPaymentFields {
  supplierId: number;
  receiptId?: string;
  amount: string;
  date: string;
  note?: string;
  confirmOverpay?: boolean;
  /** KP-075: explicit per-expense allocations with amounts. */
  allocations?: Array<{ expenseId: number; amount: number }>;
}

export async function recordVendorPaymentTx(tx: Tx, input: VendorPaymentInput): Promise<VendorPaymentResult> {
  await LedgerService.lockEntity(tx, 'VENDOR', input.supplierId);

  const [latestRow] = await tx.select({ balance: s.ledger.balance })
    .from(s.ledger)
    .where(and(eq(s.ledger.entityType, 'VENDOR'), eq(s.ledger.entityId, input.supplierId)))
    .orderBy(desc(s.ledger.id))
    .limit(1);

  const currentBalance = latestRow ? parseFloat(latestRow.balance) : 0;
  const paymentAmount = parseFloat(input.amount);
  const wouldOverpay = paymentAmount > currentBalance;

  if (wouldOverpay && !input.confirmOverpay) {
    throw new ApiError(
      422,
      buildVendorOverpaymentWarning(currentBalance, paymentAmount),
    );
  }

  const posted = await LedgerService.postEntry(tx, {
    txnType: TxnType.VENDOR_PAYMENT,
    entityType: 'VENDOR',
    entityId: input.supplierId,
    debit: paymentAmount,
    credit: 0,
    receiptId: input.receiptId,
    note: input.note || 'Thanh toán nhà cung cấp',
    timestamp: new Date(`${input.date}T00:00:00+07:00`),
  });

  return wouldOverpay
    ? {
      ...posted,
      warning: buildVendorOverpaymentWarning(currentBalance, paymentAmount),
      overpayment: paymentAmount - currentBalance,
    }
    : posted;
}

async function loadVendorPaymentResultTx(tx: Tx, ledgerId: number): Promise<VendorPaymentResult> {
  const row = await loadLedgerEntryTx(tx, ledgerId);
  return applyOverpaymentMetadata(row, buildVendorOverpaymentWarning);
}

export async function recordVendorPayment(input: VendorPaymentInput) {
  return db.transaction((tx) => recordVendorPaymentTx(tx, input));
}

export async function recordVendorPaymentIdempotent(args: {
  input: VendorPaymentInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}) {
  return runIdempotent<VendorPaymentResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR,
    idempotencyKey: args.idempotencyKey,
    payload: vendorCommandIdentity(args.input),
    createdBy: args.createdBy ?? null,
    entityType: 'ledger',
    replayResult: async (snapshot, tx) => {
      const saved = snapshot as { id: number; ledgerEntryId?: number | null; applicationResult?: { ledgerId?: number } };
      return loadVendorPaymentResultTx(tx, saved.ledgerEntryId ?? saved.applicationResult?.ledgerId ?? saved.id);
    },
    create: async (tx) => {
      const treasury = await resolveTreasuryPaymentContract(tx, args.input, new Date());
      const row = await recordVendorPaymentTx(tx, args.input);
      if (treasury.treasuryAccountId && treasury.valueDate && treasury.physicalReference) {
        if (!args.createdBy) throw new ApiError(400, 'Cần người ghi nhận giao dịch quỹ.');
        await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT', amount: Number(args.input.amount),
          valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId: row.id,
          sourceVersion: row.id, paymentContractVersion: treasury.paymentContractVersion, createdBy: args.createdBy });
      }
      return row;
    },
    load: async (entityId, tx) => loadVendorPaymentResultTx(tx, entityId),
  });
}

export async function requestVendorPaymentGovernance(input: {
  payment: VendorPaymentInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('VENDOR_PAYMENT', input.makerRole);

  const execute = async (tx: Tx) => {
    const requestedAt = new Date();
    const treasury = await resolveTreasuryPaymentContract(tx, {
      treasuryAccountId: input.payment.treasuryAccountId,
      valueDate: input.payment.valueDate
        ?? (input.payment.treasuryAccountId ? input.payment.date : null),
      physicalReference: input.payment.physicalReference,
    }, requestedAt);
    const [supplier] = await tx.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(and(eq(s.suppliers.id, input.payment.supplierId), isNull(s.suppliers.deletedAt)))
      .limit(1);
    if (!supplier) {
      throw new ApiError(404, 'Không tìm thấy nhà cung cấp');
    }

    await LedgerService.lockEntity(tx, 'VENDOR', input.payment.supplierId);
    const currentBalance = await LedgerService.getBalanceTx(tx, 'VENDOR', input.payment.supplierId);
    const paymentAmount = Number(input.payment.amount);
    if (paymentAmount > currentBalance && !input.payment.confirmOverpay) {
      throw new ApiError(422, buildVendorOverpaymentWarning(currentBalance, paymentAmount));
    }
    const currentVersion = await getEntityLedgerVersionTx(tx, 'VENDOR', input.payment.supplierId);

    return buildGovernanceAction({
      subjectType: 'VENDOR_PAYMENT',
      subjectId: null,
      subjectKey: buildVendorPaymentSubjectKey('vendor', input.payment.supplierId, input.payment),
      actionKind: 'VENDOR_PAYMENT',
      reason: buildVendorPaymentReason(input.payment, 'thanh toán NCC'),
      originalVersion: currentVersion,
      beforeSnapshot: {
        supplierId: input.payment.supplierId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        supplierId: input.payment.supplierId,
        receiptId: input.payment.receiptId ?? '',
        amount: paymentAmount,
        date: input.payment.date,
        note: input.payment.note ?? '',
        confirmOverpay: input.payment.confirmOverpay ?? false,
        treasuryAccountId: treasury.treasuryAccountId,
        valueDate: treasury.valueDate,
        physicalReference: treasury.physicalReference,
        paymentContractVersion: treasury.paymentContractVersion,
      },
      deltaSnapshot: {
        vendorBalanceDelta: -paymentAmount,
        allocations: Array.isArray(input.payment?.allocations)
          ? input.payment.allocations.map((a) => ({ expenseId: Number(a.expenseId), amount: Number(a.amount) }))
          : [],
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
      createdAt: requestedAt,
      updatedAt: requestedAt,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyVendorPaymentGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'VENDOR_PAYMENT' || action.subjectType !== 'VENDOR_PAYMENT') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc thanh toán nhà cung cấp');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const supplierId = Number(afterSnapshot?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    throw new ApiError(409, 'Yêu cầu thanh toán NCC không có dữ liệu hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'VENDOR', supplierId);
  const currentVersion = await getEntityLedgerVersionTx(tx, 'VENDOR', supplierId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Công nợ nhà cung cấp đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const posted = await recordVendorPaymentTx(tx, {
    supplierId,
    receiptId: typeof afterSnapshot?.receiptId === 'string' && afterSnapshot.receiptId
      ? afterSnapshot.receiptId
      : undefined,
    amount: String(afterSnapshot?.amount ?? ''),
    date: String(afterSnapshot?.date ?? ''),
    note: typeof afterSnapshot?.note === 'string' ? afterSnapshot.note : undefined,
    confirmOverpay: Boolean(afterSnapshot?.confirmOverpay),
  });

  const treasury = await resolveTreasuryPaymentContract(tx, {
    treasuryAccountId: afterSnapshot?.treasuryAccountId == null
      ? null
      : Number(afterSnapshot.treasuryAccountId),
    valueDate: typeof afterSnapshot?.valueDate === 'string' ? afterSnapshot.valueDate : null,
    physicalReference: typeof afterSnapshot?.physicalReference === 'string'
      ? afterSnapshot.physicalReference
      : null,
  }, action.createdAt);
  const snapshottedContractVersion = Number(afterSnapshot?.paymentContractVersion ?? 1);
  if (snapshottedContractVersion !== treasury.paymentContractVersion) {
    throw new ApiError(409, 'Phiên bản hợp đồng thanh toán không còn phù hợp với thời điểm chuyển đổi kho quỹ');
  }
  let treasuryMovementId: number | null = null;
  if (
    treasury.paymentContractVersion >= 2
    && treasury.treasuryAccountId
    && treasury.valueDate
    && treasury.physicalReference
  ) {
    const movement = await insertTreasuryMovement(tx, {
      treasuryAccountId: treasury.treasuryAccountId,
      direction: 'OUT',
      amount: Number(afterSnapshot?.amount),
      valueDate: treasury.valueDate,
      physicalReference: treasury.physicalReference,
      paymentContractVersion: treasury.paymentContractVersion,
      ledgerEntryId: posted.id,
      sourceVersion: posted.id,
      externalReference: posted.receiptId,
      createdBy: action.makerId,
    });
    treasuryMovementId = movement.id;
  }

  // KP-079: settle the linked expenses inside the same transaction — the
  // payment posts its ledger entry above; the listed rows now flip PAID with
  // settledByPaymentId so expense status and supplier debt agree.
  const delta = (action.deltaSnapshot ?? {}) as Record<string, unknown>;
  const allocations = Array.isArray(delta.allocations)
    ? (delta.allocations as Array<{ expenseId: unknown; amount: unknown }>)
        .map((a) => ({ expenseId: Number(a.expenseId), amount: Number(a.amount) }))
        .filter((a) => Number.isInteger(a.expenseId) && a.expenseId > 0 && Number.isFinite(a.amount) && a.amount > 0)
    : [];
  let settledExpenseIds: number[] = [];
  if (allocations.length > 0) {
    settledExpenseIds = await settleExpensesForPayment({
      allocations,
      supplierId,
      paymentLedgerId: posted.id,
      paymentAmount: Number(afterSnapshot?.amount ?? 0),
      transaction: tx,
    });
  }

  return {
    ledgerEntryId: posted.id,
    applicationResult: {
      ledgerId: posted.id,
      supplierId,
      receiptId: posted.receiptId,
      overpayment: posted.overpayment ?? null,
      treasuryMovementId,
      paymentContractVersion: treasury.paymentContractVersion,
      settledExpenseIds,
    },
  };
}

/**
 * Record an outbound payment to an external carrier.
 *
 * Carriers live in the customer catalog, but their transport costs form a
 * separate payable projection. Only carrier costs and prior carrier payments
 * participate in the overpayment guard; customer receivables are deliberately
 * excluded.
 */
export async function recordCarrierPaymentTx(tx: Tx, input: VendorPaymentInput): Promise<VendorPaymentResult> {
  const [carrier] = await tx.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      eq(s.customers.id, input.supplierId),
      eq(s.customers.isCarrier, true),
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
    ))
    .limit(1);
  if (!carrier) {
    throw new ApiError(404, 'Không tìm thấy nhà vận chuyển');
  }

  await LedgerService.lockEntity(tx, 'CARRIER', input.supplierId);

  const [balanceRow] = await tx.select({
    balance: sql<string>`coalesce(sum(
      case
        when ${s.ledger.txnType} = ${TxnType.EXTERNAL_CARRIER_COST}
          then ${s.ledger.credit} - ${s.ledger.debit}
        when ${s.ledger.txnType} = ${TxnType.VENDOR_PAYMENT}
          then ${s.ledger.credit} - ${s.ledger.debit}
        when ${s.ledger.txnType} = ${TxnType.UNLOCK_REVERSAL}
          and ${s.ledger.note} like 'Cước thuê ngoài%'
          then ${s.ledger.credit} - ${s.ledger.debit}
        else 0
      end
    ), 0)`,
  }).from(s.ledger).where(and(
    inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
    eq(s.ledger.entityId, input.supplierId),
  ));

  const currentBalance = Number(balanceRow?.balance ?? 0);
  const paymentAmount = parseFloat(input.amount);
  const wouldOverpay = paymentAmount > currentBalance;

  if (wouldOverpay && !input.confirmOverpay) {
    throw new ApiError(
      422,
      buildCarrierOverpaymentWarning(currentBalance, paymentAmount),
    );
  }

  const posted = await LedgerService.postEntry(tx, {
    txnType: TxnType.VENDOR_PAYMENT,
    entityType: 'CARRIER',
    entityId: input.supplierId,
    debit: paymentAmount,
    credit: 0,
    receiptId: input.receiptId,
    note: input.note || 'Thanh toán cước vận chuyển thuê ngoài',
    timestamp: new Date(`${input.date}T00:00:00+07:00`),
  });

  return wouldOverpay
    ? {
      ...posted,
      warning: buildCarrierOverpaymentWarning(currentBalance, paymentAmount),
      overpayment: paymentAmount - currentBalance,
    }
    : posted;
}

async function loadCarrierPaymentResultTx(tx: Tx, ledgerId: number): Promise<VendorPaymentResult> {
  const row = await loadLedgerEntryTx(tx, ledgerId);
  return applyOverpaymentMetadata(row, buildCarrierOverpaymentWarning);
}

export async function recordCarrierPayment(input: VendorPaymentInput) {
  return db.transaction((tx) => recordCarrierPaymentTx(tx, input));
}

export async function recordCarrierPaymentIdempotent(args: {
  input: VendorPaymentInput;
  idempotencyKey: string | undefined;
  createdBy?: number | null;
}) {
  return runIdempotent<VendorPaymentResult>({
    endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_CARRIER,
    idempotencyKey: args.idempotencyKey,
    payload: vendorCommandIdentity(args.input),
    createdBy: args.createdBy ?? null,
    entityType: 'ledger',
    replayResult: async (snapshot, tx) => {
      const saved = snapshot as { id: number; ledgerEntryId?: number | null; applicationResult?: { ledgerId?: number } };
      return loadCarrierPaymentResultTx(tx, saved.ledgerEntryId ?? saved.applicationResult?.ledgerId ?? saved.id);
    },
    create: async (tx) => {
      const treasury = await resolveTreasuryPaymentContract(tx, args.input, new Date());
      const row = await recordCarrierPaymentTx(tx, args.input);
      if (treasury.treasuryAccountId && treasury.valueDate && treasury.physicalReference) {
        if (!args.createdBy) throw new ApiError(400, 'Cần người ghi nhận giao dịch quỹ.');
        await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT', amount: Number(args.input.amount),
          valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId: row.id,
          sourceVersion: row.id, paymentContractVersion: treasury.paymentContractVersion, createdBy: args.createdBy });
      }
      return row;
    },
    load: async (entityId, tx) => loadCarrierPaymentResultTx(tx, entityId),
  });
}

async function getCarrierCurrentBalanceTx(tx: Tx, carrierId: number): Promise<number> {
  const [balanceRow] = await tx.select({
    balance: sql<string>`coalesce(sum(
      case
        when ${s.ledger.txnType} = ${TxnType.EXTERNAL_CARRIER_COST}
          then ${s.ledger.credit} - ${s.ledger.debit}
        when ${s.ledger.txnType} = ${TxnType.VENDOR_PAYMENT}
          then ${s.ledger.credit} - ${s.ledger.debit}
        when ${s.ledger.txnType} = ${TxnType.UNLOCK_REVERSAL}
          and ${s.ledger.note} like 'Cước thuê ngoài%'
          then ${s.ledger.credit} - ${s.ledger.debit}
        else 0
      end
    ), 0)`,
  }).from(s.ledger).where(and(
    inArray(s.ledger.entityType, ['CUSTOMER', 'CARRIER']),
    eq(s.ledger.entityId, carrierId),
  ));
  return Number(balanceRow?.balance ?? 0);
}

export async function requestCarrierPaymentGovernance(input: {
  payment: VendorPaymentInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('CARRIER_PAYMENT', input.makerRole);

  const execute = async (tx: Tx) => {
    const requestedAt = new Date();
    const treasury = await resolveTreasuryPaymentContract(tx, {
      treasuryAccountId: input.payment.treasuryAccountId,
      valueDate: input.payment.valueDate
        ?? (input.payment.treasuryAccountId ? input.payment.date : null),
      physicalReference: input.payment.physicalReference,
    }, requestedAt);
    const [carrier] = await tx.select({ id: s.customers.id })
      .from(s.customers)
      .where(and(
        eq(s.customers.id, input.payment.supplierId),
        eq(s.customers.isCarrier, true),
        eq(s.customers.status, 'ACTIVE'),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!carrier) {
      throw new ApiError(404, 'Không tìm thấy nhà vận chuyển');
    }

    await LedgerService.lockEntity(tx, 'CARRIER', input.payment.supplierId);
    const currentBalance = await getCarrierCurrentBalanceTx(tx, input.payment.supplierId);
    const paymentAmount = Number(input.payment.amount);
    if (paymentAmount > currentBalance && !input.payment.confirmOverpay) {
      throw new ApiError(422, buildCarrierOverpaymentWarning(currentBalance, paymentAmount));
    }
    const currentVersion = await getEntityLedgerVersionTx(tx, 'CARRIER', input.payment.supplierId);

    return buildGovernanceAction({
      subjectType: 'CARRIER_PAYMENT',
      subjectId: null,
      subjectKey: buildVendorPaymentSubjectKey('carrier', input.payment.supplierId, input.payment),
      actionKind: 'CARRIER_PAYMENT',
      reason: buildVendorPaymentReason(input.payment, 'thanh toán nhà vận chuyển'),
      originalVersion: currentVersion,
      beforeSnapshot: {
        carrierId: input.payment.supplierId,
        currentBalance,
        currentVersion,
      },
      afterSnapshot: {
        supplierId: input.payment.supplierId,
        receiptId: input.payment.receiptId ?? '',
        amount: paymentAmount,
        date: input.payment.date,
        note: input.payment.note ?? '',
        confirmOverpay: input.payment.confirmOverpay ?? false,
        treasuryAccountId: treasury.treasuryAccountId,
        valueDate: treasury.valueDate,
        physicalReference: treasury.physicalReference,
        paymentContractVersion: treasury.paymentContractVersion,
      },
      deltaSnapshot: {
        carrierBalanceDelta: -paymentAmount,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
      createdAt: requestedAt,
      updatedAt: requestedAt,
    });
  };

  return runInTx(input.transaction, execute);
}

export async function applyCarrierPaymentGovernanceAction(tx: Tx, action: GovernanceActionRow) {
  if (action.actionKind !== 'CARRIER_PAYMENT' || action.subjectType !== 'CARRIER_PAYMENT') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc thanh toán nhà vận chuyển');
  }

  const afterSnapshot = action.afterSnapshot as Record<string, unknown> | null;
  const supplierId = Number(afterSnapshot?.supplierId);
  if (!Number.isInteger(supplierId) || supplierId <= 0) {
    throw new ApiError(409, 'Yêu cầu thanh toán nhà vận chuyển không có dữ liệu hợp lệ');
  }

  await LedgerService.lockEntity(tx, 'CARRIER', supplierId);
  const currentVersion = await getEntityLedgerVersionTx(tx, 'CARRIER', supplierId);
  if (currentVersion !== action.originalVersion) {
    throw new ApiError(409, 'Công nợ nhà vận chuyển đã thay đổi; yêu cầu này không thể áp dụng');
  }

  const posted = await recordCarrierPaymentTx(tx, {
    supplierId,
    receiptId: typeof afterSnapshot?.receiptId === 'string' && afterSnapshot.receiptId
      ? afterSnapshot.receiptId
      : undefined,
    amount: String(afterSnapshot?.amount ?? ''),
    date: String(afterSnapshot?.date ?? ''),
    note: typeof afterSnapshot?.note === 'string' ? afterSnapshot.note : undefined,
    confirmOverpay: Boolean(afterSnapshot?.confirmOverpay),
  });

  const treasury = await resolveTreasuryPaymentContract(tx, {
    treasuryAccountId: afterSnapshot?.treasuryAccountId == null
      ? null
      : Number(afterSnapshot.treasuryAccountId),
    valueDate: typeof afterSnapshot?.valueDate === 'string' ? afterSnapshot.valueDate : null,
    physicalReference: typeof afterSnapshot?.physicalReference === 'string'
      ? afterSnapshot.physicalReference
      : null,
  }, action.createdAt);
  const snapshottedContractVersion = Number(afterSnapshot?.paymentContractVersion ?? 1);
  if (snapshottedContractVersion !== treasury.paymentContractVersion) {
    throw new ApiError(409, 'Phiên bản hợp đồng thanh toán không còn phù hợp với thời điểm chuyển đổi kho quỹ');
  }
  let treasuryMovementId: number | null = null;
  if (
    treasury.paymentContractVersion >= 2
    && treasury.treasuryAccountId
    && treasury.valueDate
    && treasury.physicalReference
  ) {
    const movement = await insertTreasuryMovement(tx, {
      treasuryAccountId: treasury.treasuryAccountId,
      direction: 'OUT',
      amount: Number(afterSnapshot?.amount),
      valueDate: treasury.valueDate,
      physicalReference: treasury.physicalReference,
      paymentContractVersion: treasury.paymentContractVersion,
      ledgerEntryId: posted.id,
      sourceVersion: posted.id,
      externalReference: posted.receiptId,
      createdBy: action.makerId,
    });
    treasuryMovementId = movement.id;
  }

  return {
    ledgerEntryId: posted.id,
    applicationResult: {
      ledgerId: posted.id,
      carrierId: supplierId,
      receiptId: posted.receiptId,
      overpayment: posted.overpayment ?? null,
      treasuryMovementId,
      paymentContractVersion: treasury.paymentContractVersion,
    },
  };
}
