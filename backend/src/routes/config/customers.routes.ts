// Customers-screen backend slice (card 2026-09-20 _37): per-customer drawer
// history endpoints + bulk operations for the Khách hàng & Đối tác screen.
// Mounted in catalog-crud.routes.ts BEFORE the customers CRUD sub-router so
// the specific paths resolve first and everything else falls through to CRUD.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { getUser } from '../../middleware/auth';
import { Role } from '@tingting/shared';
import { parseId } from '../utils/parse-id';
import { getRequestIdempotencyKey } from '../utils/idempotency';
import { getCustomerLogisticsHistory, getCustomerPaymentHistory, notifyCustomers, setCustomersStatus } from '../../services/customers-screen.service';
import { getCustomerDebtSummary } from '../../services/customer-debt-summary.service';
import { declareMaterialWrite } from '../../middleware/material-write';

const router = Router()

// Drawer audience: /customers is officeStaffOnly on the FE (ADMIN/MANAGER/
// ACCOUNTANT) and payment history is financial data, so the drawer mirrors
// that exact set. CUS/DISPATCHER keep their catalog-read bypass for the
// shipment-create dropdowns but get no drawer or bulk access.
const SCREEN_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

// ─── 0. Debt projection (card 20260928_177) ─────────────────────────────────
//
// The screen's "Bỏ xe công ty" tick must never be a client-side subtraction:
// the export shows the same number, so the server owns the arithmetic. The
// response carries, per shipment/trip line, whether it ran on a company vehicle
// (`isOwnFleet` / `carrierKey === 'OWN'`), plus each customer's freight figures
// recomputed under `excludeOwnFleet`. Declared here rather than in shared/src
// (another lane owns that file this run) — the FE reads it from this contract.
const debtSummaryQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày bắt đầu không hợp lệ').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày kết thúc không hợp lệ').optional(),
  excludeOwnFleet: z.enum(['true', 'false']).optional(),
  customerIds: z.string().optional(),
});

router.get('/debt-summary', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  const query = debtSummaryQuerySchema.parse(req.query);
  const customerIds = (query.customerIds ?? '')
    .split(',')
    .map((raw) => Number(raw.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 200);
  res.json(await getCustomerDebtSummary({
    from: query.from,
    to: query.to,
    excludeOwnFleet: query.excludeOwnFleet === 'true',
    customerIds: customerIds.length > 0 ? customerIds : undefined,
  }));
}));

// ─── 1. Logistics history (drawer) ──────────────────────────────────────────

router.get('/:id/logistics-history', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  res.json(await getCustomerLogisticsHistory(parseId(req.params.id, 'ID khách hàng'), req.query.limit));
}));

// ─── 2. Payment history (drawer) ────────────────────────────────────────────

router.get('/:id/payment-history', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  res.json(await getCustomerPaymentHistory(parseId(req.params.id, 'ID khách hàng'), req.query.limit));
}));

// ─── 3. Bulk notification (RBAC + Idempotency-Key + audit) ─────────────────

const bulkNotifySchema = z.object({
  customerIds: z.array(z.number().int().positive()).min(1).max(500),
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
});

router.post('/bulk-notify', declareMaterialWrite('customers.bulk-notify', { method: 'POST', path: '/api/customers/bulk-notify' }),  requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  res.json(await notifyCustomers(bulkNotifySchema.parse(req.body), getUser(req).userId, getRequestIdempotencyKey(req)));
}));


// ─── 4. Bulk status lock/unlock (RBAC + Idempotency-Key + audit) ────────────

const bulkStatusSchema = z.object({
  customerIds: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(['LOCKED', 'ACTIVE']),
});

// Mass status flip is an admin action: intentionally last-write-wins (no
// expected_updated_at optimistic guard) — the actor's decision supersedes any
// concurrent single-row edit, and the per-request transaction keeps the flip
// atomic.
router.post('/bulk-status', declareMaterialWrite('customers.bulk-status', { method: 'POST', path: '/api/customers/bulk-status' }),  requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  res.json(await setCustomersStatus(bulkStatusSchema.parse(req.body), getUser(req).userId, getRequestIdempotencyKey(req)));
}));

export default router;

