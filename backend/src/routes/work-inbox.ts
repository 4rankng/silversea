import { Router } from 'express';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { requireRoles } from '../middleware/casbin';
import { getDriverByUserId } from '../services/driver.service';
import { canAccessCustomer, scopedByCustomer } from '../lib/scoped-by-customer';
import { ApiError } from '../errors';
import { adminHealth, customerWorkInbox, driverWorkInbox, financialWorkInbox, managerDecisionInbox, operationsWorkInbox, type InboxQuery } from '../services/work-inbox.service';
import { resolveCustomerDeliveryDispute } from '../services/customer-delivery-response.service';
import { z } from 'zod';

function query(req: Request): InboxQuery {
  const page = Number(req.query.page ?? 1); const limit = Number(req.query.limit ?? 25);
  if (!Number.isInteger(page) || page < 1) throw new ApiError(400, 'Trang không hợp lệ');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'Giới hạn phải từ 1 đến 100');
  return { view: typeof req.query.view === 'string' ? req.query.view : undefined, search: typeof req.query.search === 'string' ? req.query.search : undefined, page, limit };
}
function selectedCustomer(req: Request): number {
  const user = getUser(req); const raw = typeof req.query.customerId === 'string' ? Number(req.query.customerId) : undefined;
  if (raw != null) { if (!Number.isInteger(raw) || raw <= 0 || !canAccessCustomer(user, raw)) throw new ApiError(404, 'Không tìm thấy khách hàng'); return raw; }
  return scopedByCustomer(user, { customerId: undefined }).customerId ?? -1;
}

export const forwarderWorkInboxRouter = Router();
forwarderWorkInboxRouter.get('/work-inbox', asyncHandler(async (req: Request, res: Response) => res.json(await operationsWorkInbox(getUser(req).userId, query(req)))));

export const driverWorkInboxRouter = Router();
driverWorkInboxRouter.get('/work-inbox', asyncHandler(async (req: Request, res: Response) => { const driver = await getDriverByUserId(getUser(req).userId); res.json(await driverWorkInbox(driver.id, query(req))); }));

export const portalWorkInboxRouter = Router();
portalWorkInboxRouter.get('/work-inbox', asyncHandler(async (req: Request, res: Response) => res.json(await customerWorkInbox(selectedCustomer(req), query(req)))));

export const financialWorkInboxRouter = Router();
financialWorkInboxRouter.get('/work-inbox', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => res.json(await financialWorkInbox(query(req)))));

export const dashboardWorkInboxRouter = Router();
dashboardWorkInboxRouter.get('/decision-inbox', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => res.json(await managerDecisionInbox(getUser(req).userId, query(req)))));
dashboardWorkInboxRouter.post('/delivery-disputes/:responseId/resolve', requireRoles(Role.ADMIN, Role.MANAGER), asyncHandler(async (req: Request, res: Response) => {
  const responseId = Number(req.params.responseId);
  if (!Number.isInteger(responseId) || responseId <= 0) throw new ApiError(400, 'Phản hồi không hợp lệ');
  const input = z.object({ resolution: z.string().trim().min(1, 'Cần nêu kết quả xử lý').max(2_000) }).parse(req.body);
  res.json(await resolveCustomerDeliveryDispute({ responseId, actor: getUser(req), resolution: input.resolution }));
}));

export const systemWorkInboxRouter = Router();
systemWorkInboxRouter.get('/admin-health', requireRoles(Role.ADMIN), asyncHandler(async (req: Request, res: Response) => res.json(await adminHealth(query(req)))));
