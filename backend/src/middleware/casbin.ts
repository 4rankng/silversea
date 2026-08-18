import type { Request, Response, NextFunction } from 'express';
import { getEnforcer } from '../casbin/enforcer';
import { Role } from '@tingting/shared';

const ACTION_MAP: Record<string, string> = {
  GET: 'read',
  POST: 'write',
  PUT: 'write',
  PATCH: 'write',
  DELETE: 'delete',
};

function hasRouteScopedRoleAllowance(req: Request, resource: string) {
  if (!req.user) return false;
  if (
    resource === 'shipments'
    && req.user.role === Role.OPS
    && req.method === 'POST'
    && /^\/\d+\/recovery-facts\/?$/.test(req.path)
  ) {
    return true;
  }
  // The shipment-create screen is shared by CUS and Dispatchers. Permit only
  // creation of the missing route they need; all other config writes and all
  // route updates/deletes remain governed by the normal config policy.
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)
    && req.method === 'POST'
    && /^\/routes\/?$/.test(req.path)
  ) {
    return true;
  }
  // Other Dispatcher catalog creates: DISPATCHER may POST exactly the three
  // resource-catalog rows it staffs dispatch plans from (trucks, drivers,
  // suppliers). Every other config write stays Casbin-denied, and
  // PUT/DELETE on these three are not matched here.
  if (
    resource === 'config'
    && req.user.role === Role.DISPATCHER
    && req.method === 'POST'
    && /^\/(trucks|drivers|suppliers)\/?$/.test(req.path)
  ) {
    return true;
  }
  return false;
}

/**
 * Role-restriction middleware. Use when Casbin's resource-level policy
 * is too broad and specific endpoints need tighter role gating.
 *
 * Usage: router.post('/distribute-profit', requireRoles(Role.ADMIN, Role.MANAGER), handler);
 */
export function requireRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    if (!roles.includes(req.user.role as Role)) {
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    }
    next();
  };
}

/**
 * Casbin authorization middleware factory.
 * Pass the resource name explicitly at the route mount point.
 *
 * Usage: app.use('/api/trips', authMiddleware, casbinAuthz('trips'), tripRoutes);
 */
export function casbinAuthz(resource: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Chưa đăng nhập' });
    }

    const sub = req.user.role;
    const act = ACTION_MAP[req.method] || 'read';

    try {
      if (hasRouteScopedRoleAllowance(req, resource)) {
        next();
        return;
      }
      const enforcer = getEnforcer();
      const allowed = await enforcer.enforce(sub, resource, act);
      if (allowed) {
        next();
      } else {
        res.status(403).json({ error: 'Không có quyền truy cập' });
      }
    } catch (err) {
      console.error('[casbin] Authorization check failed:', err);
      res.status(500).json({ error: 'Lỗi kiểm tra quyền' });
    }
  };
}

/**
 * Authorizes the trip surface while exposing only the CUS close-maker command
 * required by the O2C PRD. All other CUS trip operations remain denied.
 */
export function tripRouteAuthz() {
  const authorizeTrips = casbinAuthz('trips');
  return (req: Request, res: Response, next: NextFunction) => {
    const isCloseRequest = req.method === 'POST'
      && /^\/\d+\/complete\/?$/.test(req.path);
    if (isCloseRequest) {
      const closeMakerRoles = [Role.ACCOUNTANT, Role.CUS];
      if (req.user && closeMakerRoles.includes(req.user.role as Role)) {
        next();
        return;
      }
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    }
    return authorizeTrips(req, res, next);
  };
}
