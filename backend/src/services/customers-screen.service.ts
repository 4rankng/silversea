import { and, count, desc, eq, inArray, isNull, sum } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { getCustomerArSummary } from './ar-status.service';
import { runIdempotent } from './idempotency.service';

// Drawer sections are "recent history" lists, not data exports — cap small.
const HISTORY_MAX_LIMIT = 100;
const HISTORY_DEFAULT_LIMIT = 20;

function parseHistoryLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return HISTORY_DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ApiError(400, 'limit không hợp lệ');
  }
  return Math.min(limit, HISTORY_MAX_LIMIT);
}

async function requireLiveCustomer(id: number) {
  const [customer] = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.id, id), isNull(s.customers.deletedAt)))
    .limit(1);
  if (!customer) throw new ApiError(404, 'Không tìm thấy khách hàng');
  return customer;
}

export async function getCustomerLogisticsHistory(id: number, rawLimit: unknown) {
  await requireLiveCustomer(id);
  const limit = parseHistoryLimit(rawLimit);

  const where = and(eq(s.shipments.customerId, id), isNull(s.shipments.deletedAt));
  const [items, [totals]] = await Promise.all([
    db.select({
      id: s.shipments.id,
      shipmentCode: s.shipments.shipmentCode,
      blNumber: s.shipments.blNumber,
      bookingRef: s.shipments.bookingRef,
      status: s.shipments.status,
      tradeDirection: s.shipments.tradeDirection,
      expectedDeliveryDate: s.shipments.expectedDeliveryDate,
      createdAt: s.shipments.createdAt,
    }).from(s.shipments).where(where).orderBy(desc(s.shipments.createdAt), desc(s.shipments.id)).limit(limit),
    db.select({ total: count() }).from(s.shipments).where(where),
  ]);

  return { items, total: totals?.total ?? 0, limit };
}

export async function getCustomerPaymentHistory(id: number, rawLimit: unknown) {
  const customer = await requireLiveCustomer(id);
  const limit = parseHistoryLimit(rawLimit);

  const where = and(eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, id));
  const [items, [totals], summary] = await Promise.all([
    db.select({
      id: s.ledger.id,
      timestamp: s.ledger.timestamp,
      txnType: s.ledger.txnType,
      receiptId: s.ledger.receiptId,
      credit: s.ledger.credit,
      debit: s.ledger.debit,
      balance: s.ledger.balance,
      note: s.ledger.note,
    }).from(s.ledger).where(where).orderBy(desc(s.ledger.id)).limit(limit),
    db.select({ total: count(), credit: sum(s.ledger.credit), debit: sum(s.ledger.debit) }).from(s.ledger).where(where),
    getCustomerArSummary(id, customer.paymentTermDays ?? 30),
  ]);

  return {
    items,
    total: totals?.total ?? 0,
    totals: {
      credit: Number(totals?.credit ?? 0),
      debit: Number(totals?.debit ?? 0),
    },
    outstanding: summary.outstanding,
  };
}

export async function notifyCustomers(input: { customerIds: number[]; title: string; message: string }, actorId: number, idempotencyKey: string | undefined) {
  const { customerIds, title, message } = input;
  const { result } = await runIdempotent({
    endpoint: 'customers.bulk-notify',
    idempotencyKey,
    payload: { customerIds, title, message },
    createdBy: actorId,
    create: async (tx) => {
      const liveCustomers = await tx.select({ id: s.customers.id })
        .from(s.customers)
        .where(and(inArray(s.customers.id, customerIds), isNull(s.customers.deletedAt)));
      const liveIds = liveCustomers.map((row) => row.id);
      const targets = liveIds.length === 0 ? [] : await tx.select({ id: s.users.id, customerId: s.users.customerId })
        .from(s.users)
        .where(and(
          inArray(s.users.customerId, liveIds),
          eq(s.users.role, Role.CUSTOMER),
          eq(s.users.status, 'ACTIVE'),
          isNull(s.users.deletedAt),
        ));
      if (targets.length > 0) {
        await tx.insert(s.notifications).values(targets.map((target) => ({
          userId: target.id,
          type: 'SYSTEM_ANNOUNCEMENT' as const,
          title,
          message,
          relatedEntityType: 'CUSTOMER',
          relatedEntityId: target.customerId,
        })));
      }
      return {
        requested: customerIds.length,
        matchedCustomers: liveIds.length,
        notified: targets.length,
      };
    },
  });
  return result;
}

export async function setCustomersStatus(input: { customerIds: number[]; status: 'LOCKED' | 'ACTIVE' }, actorId: number, idempotencyKey: string | undefined) {
  const { customerIds, status } = input;
  const ids = [...new Set(customerIds)];
  const { result } = await runIdempotent({
    endpoint: 'customers.bulk-status',
    idempotencyKey,
    payload: { customerIds: ids, status },
    createdBy: actorId,
    create: async (tx) => {
      const flipped = await tx.update(s.customers)
        .set({ status, updatedAt: new Date() })
        .where(and(inArray(s.customers.id, ids), isNull(s.customers.deletedAt)))
        .returning({ id: s.customers.id, status: s.customers.status });
      return {
        requested: ids.length,
        updated: flipped.length,
        skipped: ids.length - flipped.length,
        status,
      };
    },
  });
  return result;
}
