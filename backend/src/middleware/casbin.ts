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
    const isClerkCloseRequest = req.user?.role === Role.CLERK
      && req.method === 'POST'
      && /^\/\d+\/complete\/?$/.test(req.path);
    if (isClerkCloseRequest) {
      next();
      return;
    }
    return authorizeTrips(req, res, next);
  };
}
