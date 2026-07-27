/**
 * Financial operations service — owns all mutating financial transactions:
 * payment recording, trip adjustments, and penalty creation.
 *
 * Routes are thin HTTP adapters; all business logic lives here.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, inArray, sql, desc, isNull } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import { requestTripArAdjustment } from './adjustment-governance.service';
import {
  recordPaymentReceipt,
  recordPaymentReceiptIdempotent,
  type PaymentReceiptInput,
} from './payment-allocation.service';

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

// ─── Driver payout (B1 — feedback202606 GAP 4) ───────────────────────────────

export interface DriverPayoutInput {
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
export async function recordDriverPayout(input: DriverPayoutInput) {
  return db.transaction(async (tx) => {
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
  });
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
}

/**
 * Submit a financial adjustment (điều chỉnh) for independent checking and
 * approval. No ledger effect is posted until the governance action is approved.
 */
export async function createAdjustment(input: AdjustmentInput) {
  return requestTripArAdjustment({
    tripId: input.tripId,
    amount: input.amount,
    reason: input.note,
    signedAgreementRef: input.signedAgreementRef,
    makerId: input.makerId,
    makerRole: input.makerRole,
    expectedTripVersion: input.expectedTripVersion,
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
export async function createPenalty(input: PenaltyInput) {
  return db.transaction(async (tx) => {
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

    // Create ledger entry for driver
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
  });
}

/**
 * List penalties with optional driver filter.
 */
export async function getPenalties(driverId?: number) {
  const conditions = [isNull(s.penalties.deletedAt)];
  if (driverId) conditions.push(eq(s.penalties.driverId, driverId));

  const items = await db.select({
    id: s.penalties.id, driverId: s.penalties.driverId, tripId: s.penalties.tripId,
    reasonId: s.penalties.reasonId, customReason: s.penalties.customReason,
    amount: s.penalties.amount, date: s.penalties.date, status: s.penalties.status,
    driverName: s.drivers.name,
    reasonText: s.penaltyReasons.reasonText,
    tripCode: s.trips.tripCode,
  }).from(s.penalties)
    .leftJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
    .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
    .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
    .where(and(...conditions))
    .orderBy(desc(s.penalties.date));

  return { items, total: items.length };
}

/**
 * Cancel (void) a penalty — reverses the driver ledger entry.
 */
export async function cancelPenalty(penaltyId: number, reason?: string) {
  return db.transaction(async (tx) => {
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
      note: reason || `Hủy kỷ luật #${penalty.id}`,
    });

    return claimed;
  });
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

export interface VendorPaymentInput {
  supplierId: number;
  receiptId?: string;
  amount: string;
  date: string;
  note?: string;
  confirmOverpay?: boolean;
}

export async function recordVendorPayment(input: VendorPaymentInput) {
  return db.transaction(async (tx) => {
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
        `Thanh toán ${paymentAmount.toLocaleString('vi-VN')}₫ vượt công nợ hiện tại ${currentBalance.toLocaleString('vi-VN')}₫. Số dư sẽ âm. Bạn có chắc chắn muốn tiếp tục?`
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
    });

    // Per spec §4.15: "Khớp FIFO theo tổng số dư, không khớp từng khoản chi"
    // Vendor payments reduce the aggregate balance only — individual expense
    // paymentStatus is NOT tied to aggregate payments.

    return {
      ...posted,
      ...(wouldOverpay ? {
        warning: `Thanh toán ${paymentAmount.toLocaleString('vi-VN')}₫ vượt công nợ hiện tại ${currentBalance.toLocaleString('vi-VN')}₫. Số dư sẽ âm.`,
        overpayment: paymentAmount - currentBalance,
      } : {}),
    };
  });
}

/**
 * Record an outbound payment to an external carrier.
 *
 * Carriers live in the customer catalog, but their transport costs form a
 * separate payable projection. Only carrier costs and prior carrier payments
 * participate in the overpayment guard; customer receivables are deliberately
 * excluded.
 */
export async function recordCarrierPayment(input: VendorPaymentInput) {
  return db.transaction(async (tx) => {
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
        `Thanh toán ${paymentAmount.toLocaleString('vi-VN')}₫ vượt công nợ thuê ngoài hiện tại ${currentBalance.toLocaleString('vi-VN')}₫. Bạn có chắc chắn muốn tiếp tục?`,
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

    return {
      ...posted,
      ...(wouldOverpay ? {
        warning: `Thanh toán vượt công nợ thuê ngoài ${currentBalance.toLocaleString('vi-VN')}₫.`,
        overpayment: paymentAmount - currentBalance,
      } : {}),
    };
  });
}
