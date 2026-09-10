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
  // Same screen, same need for the customer catalog: CUS/Dispatchers may add
  // the missing customer inline. POST-only and customer-scoped; the intake
  // strip in the customers beforeCreate keeps financially material fields
  // out of their payload, and updates/deletes stay Casbin-denied.
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)
    && req.method === 'POST'
    && /^\/customers\/?$/.test(req.path)
  ) {
    return true;
  }
  // Same screen, same need for the port/yard catalog (Cảng nâng/hạ): CUS/
  // Dispatchers may add a missing port inline. POST-only; the ports CRUD
  // stays fully Casbin-governed for every other verb and role.
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)
    && req.method === 'POST'
    && /^\/ports\/?$/.test(req.path)
  ) {
    return true;
  }
  // CUS also needs to read the customer and route catalogs to populate the
  // shipment-create dropdown and the catalog management pages. DISPATCHER
  // already has config:read via Casbin policy; CUS does not, so this
  // route-scoped GET bypass bridges the gap.
  if (
    resource === 'config'
    && req.user.role === Role.CUS
    && req.method === 'GET'
    && /^\/(customers|routes)(\/|\?|$)/.test(req.path)
  ) {
    return true;
  }
  // The driver portal's journey cards resolve shipments.operationalNotes
  // task tags into chips, which needs the dispatch task-tag pool (a shared
  // read-only reference list). DRIVER holds no `shipments` Casbin grant by
  // design; this GET-only, single-route bypass widens nothing else. Writes
  // to the pool (POST/PATCH/DELETE) stay dispatcher-and-above via
  // requireRoles in dispatch-planning.routes.ts.
  if (
    resource === 'shipments'
    && req.user.role === Role.DRIVER
    && req.method === 'GET'
    && /^\/dispatch-task-tags\/?(\?|$)/.test(req.path)
  ) {
    return true;
  }
  // CUS and DISPATCHER may update or delete identity fields on customers and
  // routes from the catalog management pages. POST already allowed above for
  // create; PUT/DELETE extends the same pattern to edit and undo recent
  // creates. Financial/cost fields are stripped by intake restriction
  // services; the beforeDelete hook enforces a 1-day age gate so only
  // recently created entities are deletable.
  if (
    resource === 'config'
    && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)
    && (req.method === 'PUT' || req.method === 'DELETE')
    && /^\/(customers|routes)\/\d+\/?$/.test(req.path)
  ) {
    return true;
  }
  // Dispatcher full CRUD on the three resource-catalog rows it staffs dispatch
  // plans from (trucks, drivers, suppliers). Every other config write stays
  // Casbin-denied.
  if (
    resource === 'config'
    && req.user.role === Role.DISPATCHER
    && (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE')
    && /^\/(trucks|drivers|suppliers)(\/\d+)?\/?$/.test(req.path)
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
    // Staff close for external-carrier trips (feedback 2026-09-08): the
    // external driver has no app session, so dispatch/CUS complete on the
    // driver's behalf. Distinct allowlist from the governed close-maker
    // branch below — no evidence gate can ever apply to these trips.
    const isExternalClose = req.method === 'POST'
      && /^\/\d+\/complete-external\/?$/.test(req.path);
    if (isExternalClose) {
      const staffCloseRoles = [Role.ADMIN, Role.MANAGER, Role.DISPATCHER, Role.CUS];
      if (req.user && staffCloseRoles.includes(req.user.role as Role)) {
        next();
        return;
      }
      return res.status(403).json({ error: 'Không có quyền truy cập' });
    }
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
