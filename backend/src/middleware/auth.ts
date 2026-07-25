import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Role } from '@tingting/shared';
import { isTokenBlacklisted } from '../lib/redis';
import { ApiError } from '../errors';

export interface AuthUser {
  userId: number;
  username: string | null;
  email: string | null;
  /** Human-readable Vietnamese name. Used as the actor label in audit logs. */
  fullName: string | null;
  role: Role;
  /**
   * Wave 0: optional 1:1 link from a CUSTOMER-role user to the AR customer
   * whose data they may see in the customer portal (Wave 2). Populated from
   * the `users.customer_id` column at login and carried in the JWT. Non-
   * CUSTOMER roles leave this undefined. The `scopedByCustomer` helper
   * reads it to row-scope list queries; for an unmapped CUSTOMER (undefined)
   * it applies a deny-all sentinel.
   */
  customerId?: number | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token không hợp lệ' });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser & { jti?: string };
    if (payload.jti && await isTokenBlacklisted(payload.jti)) {
      return res.status(401).json({ error: 'Token đã bị thu hồi' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token hết hạn hoặc không hợp lệ' });
  }
}

/**
 * Auth middleware for routes that serve static assets (e.g., <img src> tags)
 * which cannot set Authorization headers. Accepts JWT via `?token=` query param
 * in addition to the standard Bearer header. Scoped narrowly to avoid exposing
 * tokens in URL logs/Referer on general API routes.
 */
export async function assetAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  let token = req.headers.authorization?.replace('Bearer ', '');
  if (!token && typeof req.query.token === 'string') {
    token = req.query.token;
  }
  if (!token) return res.status(401).json({ error: 'Token không hợp lệ' });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser & { jti?: string };
    if (payload.jti && await isTokenBlacklisted(payload.jti)) {
      return res.status(401).json({ error: 'Token đã bị thu hồi' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token hết hạn hoặc không hợp lệ' });
  }
}

/**
 * Type-safe helper to extract authenticated user from request.
 * Throws 401 if user is not set (should never happen behind authMiddleware,
 * but prevents non-null assertion crashes if routes are reorganized).
 */
export function getUser(req: Request): AuthUser {
  if (!req.user) throw new ApiError(401, 'Chưa xác thực');
  return req.user;
}
