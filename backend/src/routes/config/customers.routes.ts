// Customers-screen backend slice (card 2026-09-20 _37): per-customer drawer
// history endpoints + bulk operations for the Khách hàng & Đối tác screen.
// Mounted in catalog-crud.routes.ts BEFORE the customers CRUD sub-router so
// the specific paths resolve first and everything else falls through to CRUD.
import { Router } from 'express';
import { and, count, desc, eq, isNull, sum } from 'drizzle-orm';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { Role } from '@tingting/shared';
import { ApiError } from '../../errors';
import { db } from '../../db';
import * as s from '../../db/schema';
import { parseId } from '../utils/parse-id';
import { getCustomerArSummary } from '../../services/ar-status.service';
import { runIdempotent } from '../../services/idempotency.service';
import { getRequestIdempotencyKey } from '../utils/idempotency';

const router = Router();

// Drawer audience: /customers is officeStaffOnly on the FE (ADMIN/MANAGER/
// ACCOUNTANT) and payment history is financial data, so the drawer mirrors
// that exact set. CUS/DISPATCHER keep their catalog-read bypass for the
// shipment-create dropdowns but get no drawer or bulk access.
const SCREEN_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

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

// ─── 1. Logistics history (drawer) ──────────────────────────────────────────

router.get('/:id/logistics-history', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ID khách hàng');
  await requireLiveCustomer(id);
  const limit = parseHistoryLimit(req.query.limit);

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

  res.json({ items, total: totals?.total ?? 0, limit });
}));

// ─── 2. Payment history (drawer) ────────────────────────────────────────────

router.get('/:id/payment-history', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  const id = parseId(req.params.id, 'ID khách hàng');
  const customer = await requireLiveCustomer(id);
  const limit = parseHistoryLimit(req.query.limit);

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

  res.json({
    items,
    total: totals?.total ?? 0,
    totals: {
      credit: Number(totals?.credit ?? 0),
      debit: Number(totals?.debit ?? 0),
    },
    outstanding: summary.outstanding,
  });
}));

export default router;
