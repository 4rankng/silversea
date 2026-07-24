import { EventEmitter } from 'events';
import { renderAuditMessage } from './audit-templates';
import { db } from '../db';
import * as s from '../db/schema';
import { auditLogs } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import type { AuditPayload } from './audit-types';

// Inlined event bus — sole consumer is this module.
const eventBus = new EventEmitter();
eventBus.setMaxListeners(50);
const AUDIT_LOG_EVENT = 'audit:log';

export interface AuditEntry extends AuditPayload {
  userId?: number;
  ipAddress?: string;
}

/**
 * Resolve human-readable identifiers for entities whose audit row only has the
 * numeric foreign key in the request body (payments, adjustments, penalties
 * all reference a trip via `trip_id`). Runs async out-of-band so it doesn't
 * delay the response.
 */
/**
 * Resolve human-readable identifiers for entities dynamically from the database.
 * This runs async out-of-band so it doesn't block the API response.
 */
async function enrichEntityKey(payload: AuditEntry): Promise<string | undefined> {
  const body = (payload.metadata?.body || {}) as Record<string, unknown>;

  // 1. Resolve based on entity type first

  // Expenses entity
  if (payload.entityType === 'expenses' && payload.entityId) {
    try {
      const [expense] = await db.select({
        amount: s.expenses.amount,
        categoryName: s.expenseCategories.name,
        supplierName: s.suppliers.name,
        truckPlate: s.trucks.licensePlate,
      }).from(s.expenses)
        .leftJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
        .leftJoin(s.suppliers, eq(s.expenses.supplierId, s.suppliers.id))
        .leftJoin(s.trucks, eq(s.expenses.truckId, s.trucks.id))
        .where(eq(s.expenses.id, payload.entityId))
        .limit(1);
      if (expense) {
        const amt = Number(expense.amount).toLocaleString('vi-VN') + ' ₫';
        return `chi phí ${expense.categoryName} với số tiền ${amt} (Nhà cung cấp: ${expense.supplierName}${expense.truckPlate ? `, Xe: ${expense.truckPlate}` : ''})`;
      }
    } catch (e) { console.warn('[audit] enrich expenses failed:', e); }
  }

  // Trip Expenses entity
  if ((payload.entityType === 'trip-expenses' || payload.entityType === 'forwarder-expenses') && payload.entityId) {
    try {
      const [expense] = await db.select({
        buyAmount: s.tripExpenses.buyAmount,
        typeName: s.forwarderExpenseTypes.name,
        tripCode: s.trips.tripCode,
        supplierName: s.suppliers.name,
      }).from(s.tripExpenses)
        .leftJoin(s.forwarderExpenseTypes, eq(s.tripExpenses.expenseType, s.forwarderExpenseTypes.code))
        .leftJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
        .leftJoin(s.suppliers, eq(s.tripExpenses.supplierId, s.suppliers.id))
        .where(eq(s.tripExpenses.id, payload.entityId))
        .limit(1);
      if (expense) {
        const buyAmt = Number(expense.buyAmount).toLocaleString('vi-VN') + ' ₫';
        const tripPart = expense.tripCode ? ` cho chuyến ${expense.tripCode}` : '';
        const supplierPart = expense.supplierName ? ` (Nhà cung cấp: ${expense.supplierName})` : '';
        return `phí ${expense.typeName || 'hộ'} với số tiền chi ${buyAmt}${tripPart}${supplierPart}`;
      }
    } catch (e) { console.warn('[audit] enrich trip/forwarder expenses failed:', e); }
  }

  // Penalties entity
  if (payload.entityType === 'penalties' && payload.entityId) {
    try {
      const [penalty] = await db.select({
        amount: s.penalties.amount,
        driverName: s.drivers.name,
        reasonText: s.penaltyReasons.reasonText,
        customReason: s.penalties.customReason,
        tripCode: s.trips.tripCode,
      }).from(s.penalties)
        .innerJoin(s.drivers, eq(s.penalties.driverId, s.drivers.id))
        .leftJoin(s.penaltyReasons, eq(s.penalties.reasonId, s.penaltyReasons.id))
        .leftJoin(s.trips, eq(s.penalties.tripId, s.trips.id))
        .where(eq(s.penalties.id, payload.entityId))
        .limit(1);
      if (penalty) {
        const amt = Number(penalty.amount).toLocaleString('vi-VN') + ' ₫';
        const reason = penalty.reasonText || penalty.customReason || 'Không rõ lý do';
        return `lái xe ${penalty.driverName} với số tiền ${amt} (Lý do: ${reason}${penalty.tripCode ? `, Chuyến: ${penalty.tripCode}` : ''})`;
      }
    } catch (e) { console.warn('[audit] enrich penalties failed:', e); }
  }

  // Payments entity (Customer or Vendor payment)
  if (payload.entityType === 'payments') {
    // A. Vendor payment (has supplierId)
    if (body.supplierId && body.amount) {
      try {
        const [supplier] = await db.select({ name: s.suppliers.name })
          .from(s.suppliers).where(eq(s.suppliers.id, Number(body.supplierId))).limit(1);
        const amt = Number(body.amount).toLocaleString('vi-VN') + ' ₫';
        return `cho nhà cung cấp ${supplier?.name || `ID ${body.supplierId}`} với số tiền ${amt}${body.receiptId ? ` (Số hóa đơn: ${body.receiptId})` : ''}`;
      } catch (e) { console.warn('[audit] enrich vendor payment failed:', e); }
    }
    // B. Customer payment (has customerId)
    if (body.customerId && Array.isArray(body.payments)) {
      try {
        const [customer] = await db.select({ name: s.customers.name })
          .from(s.customers).where(eq(s.customers.id, Number(body.customerId))).limit(1);
        const payments = body.payments as Array<Record<string, unknown>>;
        const ids = payments.map((p) => p?.tripId || p?.trip_id).filter((x): x is number => typeof x === 'number');
        let tripDetail = '';
        if (ids.length > 0) {
          const rows = await db.select({ tripCode: s.trips.tripCode })
            .from(s.trips).where(inArray(s.trips.id, ids));
          const codes = rows.map(r => r.tripCode).filter((c): c is string => Boolean(c));
          if (codes.length > 0) {
            tripDetail = ` cho ${codes.length === 1 ? `chuyến ${codes[0]}` : `${codes.length} chuyến (${codes.join(', ')})`}`;
          }
        }
        const totalAmt = payments.reduce((sum: number, p: Record<string, unknown>) => sum + Number(p?.amount || 0), 0);
        const amtStr = totalAmt > 0 ? ` số tiền ${totalAmt.toLocaleString('vi-VN')} ₫` : '';
        return `từ khách hàng ${customer?.name || `ID ${body.customerId}`}${amtStr}${tripDetail}${body.receiptId ? ` (Số hóa đơn: ${body.receiptId})` : ''}`;
      } catch (e) { console.warn('[audit] enrich customer payment failed:', e); }
    }
  }

  // Adjustments (posted directly to ledger with tripId and amount)
  if (payload.entityType === 'adjustments') {
    const tripId = body.tripId || body.trip_id;
    if (typeof tripId === 'number' && body.amount !== undefined) {
      try {
        const [trip] = await db.select({ tripCode: s.trips.tripCode })
          .from(s.trips).where(eq(s.trips.id, tripId)).limit(1);
        if (trip?.tripCode) {
          const amt = Number(body.amount).toLocaleString('vi-VN') + ' ₫';
          return `cho chuyến ${trip.tripCode} với số tiền điều chỉnh ${amt}${body.note ? ` (Ghi chú: ${body.note})` : ''}`;
        }
      } catch (e) { console.warn('[audit] enrich adjustment failed:', e); }
    }
  }

  // 2. Fall back to manual key if present
  if (payload.entityKey) return payload.entityKey;

  // 3. Single-trip ref fallback
  const singleTripId = body.trip_id ?? body.tripId;
  if (typeof singleTripId === 'number') {
    try {
      const [trip] = await db.select({ tripCode: s.trips.tripCode })
        .from(s.trips).where(eq(s.trips.id, singleTripId)).limit(1);
      if (trip?.tripCode) return `cho chuyến ${trip.tripCode}`;
    } catch (e) { console.warn('[audit] enrich single-trip fallback failed:', e); }
  }

  // 4. Multi-trip ref fallback
  if (Array.isArray(body.payments)) {
    const payments = body.payments as Array<Record<string, unknown>>;
    const ids = payments.map((p) => p?.trip_id || p?.tripId).filter((x): x is number => typeof x === 'number');
    if (ids.length > 0) {
      try {
        const rows = await db.select({ tripCode: s.trips.tripCode })
          .from(s.trips).where(inArray(s.trips.id, ids));
        const codes = rows.map(r => r.tripCode).filter((c): c is string => Boolean(c));
        if (codes.length > 0) return `cho ${codes.length === 1 ? `chuyến ${codes[0]}` : `${codes.length} chuyến (${codes.join(', ')})`}`;
      } catch (e) { console.warn('[audit] enrich multi-trip fallback failed:', e); }
    }
  }

  // 5. Query basic entities by entityId if deleted or missing
  if (payload.entityId) {
    try {
      if (payload.entityType === 'customers') {
        const [row] = await db.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'routes') {
        const [row] = await db.select({ name: s.routes.name }).from(s.routes).where(eq(s.routes.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'cargo-types') {
        const [row] = await db.select({ name: s.cargoTypes.name }).from(s.cargoTypes).where(eq(s.cargoTypes.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'drivers') {
        const [row] = await db.select({ name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'trucks') {
        const [row] = await db.select({ licensePlate: s.trucks.licensePlate }).from(s.trucks).where(eq(s.trucks.id, payload.entityId)).limit(1);
        if (row?.licensePlate) return row.licensePlate;
      } else if (payload.entityType === 'suppliers') {
        const [row] = await db.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'expense-categories') {
        const [row] = await db.select({ name: s.expenseCategories.name }).from(s.expenseCategories).where(eq(s.expenseCategories.id, payload.entityId)).limit(1);
        if (row?.name) return row.name;
      } else if (payload.entityType === 'trips') {
        const [row] = await db.select({ tripCode: s.trips.tripCode }).from(s.trips).where(eq(s.trips.id, payload.entityId)).limit(1);
        if (row?.tripCode) return row.tripCode;
      }
    } catch (e) { console.warn(`[audit] enrich basic entity (${payload.entityType}) failed:`, e); }
  }

  return undefined;
}

export function initAuditService() {
  eventBus.on(AUDIT_LOG_EVENT, async (payload: AuditEntry) => {
    try {
      // Out-of-band metadata resolution for all entities
      if (!payload.entityKey) {
        try { payload.entityKey = await enrichEntityKey(payload); } catch (e) { console.warn('[audit] enrichEntityKey failed:', e); }
      }
      const message = renderAuditMessage(payload);
      await db.insert(auditLogs).values({
        userId: payload.userId ?? null,
        actorName: payload.actorName ?? null,
        message,
        entityType: payload.entityType,
        entityId: payload.entityId ?? null,
        payload: { event: payload.event, ...payload.metadata },
        ipAddress: payload.ipAddress ?? null,
      });
    } catch (err) {
      console.error('Audit log write failed:', err);
    }
  });
}

export function emitAudit(payload: AuditEntry) {
  eventBus.emit(AUDIT_LOG_EVENT, payload);
}
