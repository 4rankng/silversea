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

const router = Router();

// Drawer audience: /customers is officeStaffOnly on the FE (ADMIN/MANAGER/
// ACCOUNTANT) and payment history is financial data, so the drawer mirrors
// that exact set. CUS/DISPATCHER keep their catalog-read bypass for the
// shipment-create dropdowns but get no drawer or bulk access.
const SCREEN_ROLES = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

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

router.post('/bulk-notify', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
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
router.post('/bulk-status', requireRoles(...SCREEN_ROLES), asyncHandler(async (req, res) => {
  res.json(await setCustomersStatus(bulkStatusSchema.parse(req.body), getUser(req).userId, getRequestIdempotencyKey(req)));
}));

export default router;

