import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import type { Tx } from './trip-shared';
import {
  resolveCustomerPaymentDueDate,
  type PaymentDatePolicy,
} from './business-calendar.service';

/** Common trip shape for ledger lock/unlock operations */
interface TripLedgerParams {
  id: number;
  customerId: number;
  driverId: number | null;
  tripCode: string | null;
  departureDate?: string | Date;
  revenue: string | null;
  driverSalary: string | null;
  carrierType?: string;
  externalCarrierId?: number | null;
  externalFreightCost?: string | null;
  fuelSupplierId?: number | null;
  totalFuelCost?: string | null;
  ancillaryFees?: Array<{
    id: number;
    buyAmount: string;
    sellAmount: string;
    settlementMethod: string;
    supplierId: number | null;
    forwarderId: number | null;
    approvalStatus: string;
  }>;
}

export interface LedgerPostRequest {
  txnType: TxnType;
  txnId?: number;
  receiptId?: string;
  entityType: 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER';
  entityId: number;
  debit: number;
  credit: number;
  note?: string;
  timestamp?: Date;
  originalDueDate?: string | null;
  processingDueDate?: string | null;
  paymentTermDaysApplied?: number | null;
  paymentDatePolicyApplied?: PaymentDatePolicy | null;
}

export class LedgerService {
  /**
   * Safe hashing to map entity type to key for pg_advisory_xact_lock
   */
  private static getEntityTypeKey(type: string): number {
    if (type === 'CUSTOMER') return 1;
    if (type === 'DRIVER') return 2;
    if (type === 'VENDOR') return 3;
    if (type === 'FORWARDER') return 4;
    if (type === 'CARRIER') return 5;
    return 6;
  }

  /**
   * Acquire a transaction-level advisory lock on entityType + entityId
   */
  static async lockEntity(tx: Tx, entityType: string, entityId: number) {
    const typeKey = this.getEntityTypeKey(entityType);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${typeKey}, ${entityId})`);
  }

  /**
   * Acquire sorted locks for multiple entities to prevent deadlocks
   */
  static async lockEntities(tx: Tx, entities: { entityType: 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER'; entityId: number }[]) {
    // Sort entities globally to prevent deadlocks
    const sorted = [...entities].sort((a, b) => {
      const aKey = this.getEntityTypeKey(a.entityType);
      const bKey = this.getEntityTypeKey(b.entityType);
      if (aKey !== bKey) return aKey - bKey;
      return a.entityId - b.entityId;
    });

    for (const entity of sorted) {
      await this.lockEntity(tx, entity.entityType, entity.entityId);
    }
  }

  /**
   * Collect all ledger entities involved in a trip lock/unlock.
   * Shared between postTripLock and postTripUnlock to avoid duplication.
   */
  private static collectTripEntities(
    trip: TripLedgerParams
  ): Array<{ entityType: 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER'; entityId: number }> {
    const carrierType = trip.carrierType ?? 'OWN';
    const entities: Array<{ entityType: 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER'; entityId: number }> = [];

    entities.push({ entityType: 'CUSTOMER', entityId: trip.customerId });

    if (carrierType === 'EXTERNAL' && trip.externalCarrierId) {
      entities.push({ entityType: 'CARRIER', entityId: trip.externalCarrierId });
    }

    if (carrierType === 'OWN' && trip.driverId) {
      entities.push({ entityType: 'DRIVER', entityId: trip.driverId });
    }

    if (trip.fuelSupplierId) {
      if (!entities.find(e => e.entityType === 'VENDOR' && e.entityId === trip.fuelSupplierId)) {
        entities.push({ entityType: 'VENDOR', entityId: trip.fuelSupplierId });
      }
    }

    return entities;
  }

  /**
   * Immutable insert of a ledger row inside transaction
   */
  static async postEntry(tx: Tx, request: LedgerPostRequest) {
    // First lock the entity we are about to modify
    await this.lockEntity(tx, request.entityType, request.entityId);

    // Get latest ledger entry to compute running balance
    const [lastEntry] = await tx.select()
      .from(s.ledger)
      .where(and(eq(s.ledger.entityType, request.entityType), eq(s.ledger.entityId, request.entityId)))
      .orderBy(desc(s.ledger.id))
      .limit(1);

    const prevBalance = lastEntry ? Number(lastEntry.balance) : 0;
    
    // Sign convention rules:
    // Customer: Debit increases outstanding balance, Credit decreases outstanding balance
    // Driver/Vendor: Credit increases payable balance, Debit decreases payable balance
    let newBalance = prevBalance;
    if (request.entityType === 'CUSTOMER') {
      newBalance = prevBalance + request.debit - request.credit;
    } else if (request.entityType === 'DRIVER' || request.entityType === 'VENDOR' || request.entityType === 'FORWARDER' || request.entityType === 'CARRIER') {
      newBalance = prevBalance + request.credit - request.debit;
    }

    const [inserted] = await tx.insert(s.ledger).values({
      txnType: request.txnType,
      txnId: request.txnId ?? null,
      receiptId: request.receiptId ?? null,
      entityType: request.entityType,
      entityId: request.entityId,
      debit: String(request.debit),
      credit: String(request.credit),
      balance: String(newBalance),
      note: request.note ?? null,
      timestamp: request.timestamp,
      originalDueDate: request.originalDueDate ?? null,
      processingDueDate: request.processingDueDate ?? null,
      paymentTermDaysApplied: request.paymentTermDaysApplied ?? null,
      paymentDatePolicyApplied: request.paymentDatePolicyApplied ?? null,
    }).returning();

    return inserted;
  }

  /**
   * Ancillary services/ocean-fee amounts are now receivables-only: they may
   * post SERVICE_FEE to the customer ledger for debit notes, but they no longer
   * create payable/cost ledger entries. Keep this compatibility seam so callers
   * that surface skipped-fee warnings do not need to change.
   */
  private static validateAncillaryFees(
    fees: TripLedgerParams['ancillaryFees'],
    opts: { strict: boolean },
  ): number[] {
    void fees;
    void opts;
    return [];
  }

  /**
   * Seam to handle financial ledger posting when a trip is locked.
   * Isolates financial calculations and notes from the trip lifecycle machine.
   *
   * Returns the ids of ancillary fees that were skipped (non-strict mode only);
   * in strict mode (default) a bad fee throws before any posting occurs.
   */
  static async postTripLock(
    tx: Tx,
    trip: TripLedgerParams,
    opts?: { strict?: boolean },
  ): Promise<number[]> {
    const revenue = Number(trip.revenue || 0);
    const driverSalary = Number(trip.driverSalary || 0);
    const carrierType = trip.carrierType ?? 'OWN';
    const fees = trip.ancillaryFees ?? [];
    const label = trip.tripCode || '';

    // ── 0. Validate ancillary fees — reject or skip null-counterparty buy sides ──
    const skippedFeeIds = this.validateAncillaryFees(fees, { strict: opts?.strict ?? true });
    const postableFees = skippedFeeIds.length
      ? fees.filter(f => !skippedFeeIds.includes(f.id))
      : fees;

    // ── 1. Collect all entities to lock (sorted globally to prevent deadlocks) ──
    // Lock only entities for fees we will actually post, keeping the locked set
    // consistent with the posted set.
    const tripForLock = skippedFeeIds.length ? { ...trip, ancillaryFees: postableFees } : trip;
    const entitiesToLock = this.collectTripEntities(tripForLock);
    await this.lockEntities(tx, entitiesToLock);

    // Resolve once, inside this transaction, and stamp every customer debit
    // created by this trip with the same immutable contract/calendar snapshot.
    let departureDate = trip.departureDate;
    if (!departureDate) {
      const [storedTrip] = await tx.select({ departureDate: s.trips.departureDate })
        .from(s.trips)
        .where(eq(s.trips.id, trip.id))
        .limit(1);
      departureDate = storedTrip?.departureDate;
    }
    if (!departureDate) {
      throw new Error(`Chuyến #${trip.id} không có ngày khởi hành để chốt hạn thanh toán`);
    }
    const basisDate = departureDate instanceof Date
      ? departureDate.toISOString().slice(0, 10)
      : String(departureDate).slice(0, 10);
    const dueDateSnapshot = await resolveCustomerPaymentDueDate(
      tx,
      trip.customerId,
      basisDate,
    );
    const dueDateFields = {
      originalDueDate: dueDateSnapshot.originalDate,
      processingDueDate: dueDateSnapshot.processingDate,
      paymentTermDaysApplied: dueDateSnapshot.paymentTermDays,
      paymentDatePolicyApplied: dueDateSnapshot.policy,
    } as const;

    // ── 2. Customer freight revenue (always incl-VAT, unchanged) ──
    // Skip zero-value entries to avoid polluting ledger with meaningless rows.
    if (revenue > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.TRIP_REVENUE,
        txnId: trip.id,
        entityType: 'CUSTOMER',
        entityId: trip.customerId,
        debit: revenue,
        credit: 0,
        note: label ? `Doanh thu chuyến ${label}` : 'Doanh thu chuyến',
        ...dueDateFields,
      });
    }

    // ── 3. OWN: driver salary ──
    if (carrierType === 'OWN' && trip.driverId && driverSalary > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.DRIVER_SALARY,
        txnId: trip.id,
        entityType: 'DRIVER',
        entityId: trip.driverId,
        debit: 0,
        credit: driverSalary,
        note: label ? `Lương sản lượng chuyến ${label}` : 'Lương sản lượng chuyến',
      });
    }

    // ── OWN/EXTERNAL: fuel supplier payable ──
    const fuelCost = Number(trip.totalFuelCost || 0);
    if (trip.fuelSupplierId && fuelCost > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.FUEL_EXPENSE,
        txnId: trip.id,
        entityType: 'VENDOR',
        entityId: trip.fuelSupplierId,
        debit: 0,
        credit: fuelCost,
        note: label ? `Chi phí dầu chuyến ${label}` : 'Chi phí dầu chuyến',
      });
    }

    // ── 4. EXTERNAL: carrier payable on its isolated CARRIER ledger ──
    if (carrierType === 'EXTERNAL' && trip.externalCarrierId && Number(trip.externalFreightCost || 0) > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.EXTERNAL_CARRIER_COST,
        txnId: trip.id,
        entityType: 'CARRIER',
        entityId: trip.externalCarrierId,
        debit: 0,
        credit: Number(trip.externalFreightCost),  // credit → negative balance = we owe them
        note: label ? `Cước thuê ngoài chuyến ${label}` : 'Cước thuê ngoài',
      });
    }

    // ── 5. Ancillary fees — sell side only (customer AR for phí chi hộ) ──
    // These amounts exist to feed debit notes/statements and customer AR. Their
    // buy side, payable, and profit are intentionally outside this transport
    // management scope.
    for (const fee of postableFees) {
      if (fee.approvalStatus !== 'APPROVED') continue;
      const sellAmt = Number(fee.sellAmount);
      if (sellAmt <= 0) continue;
      await this.postEntry(tx, {
        txnType: TxnType.SERVICE_FEE,
        txnId: fee.id,
        entityType: 'CUSTOMER',
        entityId: trip.customerId,
        debit: sellAmt,
        credit: 0,
        note: label ? `Phí chi hộ chuyến ${label}` : 'Phí chi hộ',
        ...dueDateFields,
      });
    }

    return skippedFeeIds;
  }

  /**
   * Reverse the ledger entries posted during postTripLock().
   * Posts compensating entries (swap debit↔credit) with UNLOCK_REVERSAL txnType.
   * The ledger is append-only — this does not modify existing rows.
   */
  static async postTripUnlock(
    tx: Tx,
    trip: TripLedgerParams,
    opts?: { strict?: boolean },
  ): Promise<number[]> {
    const revenue = Number(trip.revenue || 0);
    const driverSalary = Number(trip.driverSalary || 0);
    const carrierType = trip.carrierType ?? 'OWN';
    const fees = trip.ancillaryFees ?? [];
    const label = trip.tripCode || '';

    // ── 0. Validate ancillary fees — reject or skip null-counterparty buy sides ──
    // The unlock path must reverse exactly what the lock path posted, so we apply
    // the same filter to keep lock/unlock symmetric (skipped fees appear on
    // neither side in either direction).
    const skippedFeeIds = this.validateAncillaryFees(fees, { strict: opts?.strict ?? true });
    const postableFees = skippedFeeIds.length
      ? fees.filter(f => !skippedFeeIds.includes(f.id))
      : fees;

    // ── 1. Collect entities to lock (same as postTripLock) ──
    const tripForLock = skippedFeeIds.length ? { ...trip, ancillaryFees: postableFees } : trip;
    const entitiesToLock = this.collectTripEntities(tripForLock);
    await this.lockEntities(tx, entitiesToLock);

    // ── 2. Reverse customer freight revenue (swap debit↔credit) ──
    if (revenue > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.UNLOCK_REVERSAL,
        txnId: trip.id,
        entityType: 'CUSTOMER',
        entityId: trip.customerId,
        debit: 0,
        credit: revenue,
        note: label ? `Doanh thu chuyến ${label} (Hoàn tác)` : 'Doanh thu chuyến (Hoàn tác)',
      });
    }

    // ── 3. Reverse OWN: driver salary ──
    if (carrierType === 'OWN' && trip.driverId && driverSalary > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.UNLOCK_REVERSAL,
        txnId: trip.id,
        entityType: 'DRIVER',
        entityId: trip.driverId,
        debit: driverSalary,
        credit: 0,
        note: label ? `Lương sản lượng chuyến ${label} (Hoàn tác)` : 'Lương sản lượng chuyến (Hoàn tác)',
      });
    }

    // ── Reverse OWN/EXTERNAL: fuel supplier payable ──
    const fuelCost = Number(trip.totalFuelCost || 0);
    if (trip.fuelSupplierId && fuelCost > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.UNLOCK_REVERSAL,
        txnId: trip.id,
        entityType: 'VENDOR',
        entityId: trip.fuelSupplierId,
        debit: fuelCost,
        credit: 0,
        note: label ? `Chi phí dầu chuyến ${label} (Hoàn tác)` : 'Chi phí dầu (Hoàn tác)',
      });
    }

    // ── 4. Reverse EXTERNAL: carrier payable ──
    if (carrierType === 'EXTERNAL' && trip.externalCarrierId && Number(trip.externalFreightCost || 0) > 0) {
      await this.postEntry(tx, {
        txnType: TxnType.UNLOCK_REVERSAL,
        txnId: trip.id,
        entityType: 'CARRIER',
        entityId: trip.externalCarrierId,
        debit: Number(trip.externalFreightCost),
        credit: 0,
        note: label ? `Cước thuê ngoài chuyến ${label} (Hoàn tác)` : 'Cước thuê ngoài (Hoàn tác)',
      });
    }

    // ── 5. Reverse ancillary fees — sell side (customer AR for phí chi hộ) ──
    // Mirrors section 5 of postTripLock: swap debit↔credit so the net customer
    // contribution from this trip's sell-side fees returns to zero.
    for (const fee of postableFees) {
      if (fee.approvalStatus !== 'APPROVED') continue;
      const sellAmt = Number(fee.sellAmount);
      if (sellAmt <= 0) continue;
      await this.postEntry(tx, {
        txnType: TxnType.UNLOCK_REVERSAL,
        txnId: fee.id,
        entityType: 'CUSTOMER',
        entityId: trip.customerId,
        debit: 0,
        credit: sellAmt,
        note: label ? `Phí chi hộ chuyến ${label} (Hoàn tác)` : 'Phí chi hộ (Hoàn tác)',
      });
    }

    return skippedFeeIds;
  }

  // ─── Read methods ────────────────────────────────────────────────────────────

  /**
   * Paginated ledger query with optional entity filters.
   */
  static async getEntries(opts: {
    entityType?: string;
    entityId?: number;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(10_000, opts.limit ?? 50);
    const conditions = [];
    if (opts.entityType) conditions.push(eq(s.ledger.entityType, opts.entityType));
    if (opts.entityId !== undefined) conditions.push(eq(s.ledger.entityId, opts.entityId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, [countRow]] = await Promise.all([
      db.select().from(s.ledger)
        .where(where)
        .orderBy(desc(s.ledger.id))
        .limit(limit).offset((page - 1) * limit),
      db.select({ count: sql<number>`count(*)` }).from(s.ledger).where(where),
    ]);

    return { items, total: Number(countRow?.count ?? 0), page, pageSize: limit };
  }

  /**
   * All ledger rows for a specific entity, newest first.
   */
  static async getEntriesByEntity(entityType: string, entityId: number) {
    return db.select().from(s.ledger)
      .where(and(eq(s.ledger.entityType, entityType), eq(s.ledger.entityId, entityId)))
      .orderBy(desc(s.ledger.id));
  }

  /**
   * Current (latest) balance for an entity. Returns 0 if no entries exist.
   */
  static async getBalance(entityType: string, entityId: number): Promise<number> {
    const [last] = await db.select({ balance: s.ledger.balance })
      .from(s.ledger)
      .where(and(eq(s.ledger.entityType, entityType), eq(s.ledger.entityId, entityId)))
      .orderBy(desc(s.ledger.id))
      .limit(1);
    return last ? Number(last.balance) : 0;
  }

  /**
   * Transaction-scoped balance read — use inside a db.transaction() callback
   * to see uncommitted entries from the current transaction.
   */
  static async getBalanceTx(tx: Tx, entityType: string, entityId: number): Promise<number> {
    const [last] = await tx.select({ balance: s.ledger.balance })
      .from(s.ledger)
      .where(and(eq(s.ledger.entityType, entityType), eq(s.ledger.entityId, entityId)))
      .orderBy(desc(s.ledger.id))
      .limit(1);
    return last ? Number(last.balance) : 0;
  }

  /**
   * Batch balance lookup — single query for multiple entities.
   * Replaces N individual getBalance() calls with one DISTINCT ON query.
   * Returns a Map keyed by "entityType:entityId".
   */
  static async getBalancesBatch(
    entries: Array<{ entityType: string; entityId: number }>,
  ): Promise<Map<string, number>> {
    if (entries.length === 0) return new Map();

    // Build WHERE clause: (entity_type = 'X' AND entity_id = Y) OR ...
    const conditions = entries.map(e =>
      sql`(entity_type = ${e.entityType} AND entity_id = ${e.entityId})`
    );

    const result = await db.execute(sql`
      SELECT DISTINCT ON (entity_type, entity_id)
        entity_type, entity_id, balance
      FROM ledger
      WHERE ${sql.join(conditions, sql` OR `)}
      ORDER BY entity_type, entity_id, id DESC
    `);

    const rows = result as unknown as Array<{ entity_type: string; entity_id: number; balance: string }>;
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(`${row.entity_type}:${row.entity_id}`, Number(row.balance));
    }
    return map;
  }
}
