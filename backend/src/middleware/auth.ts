import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Role } from '@tingting/shared';
import { isTokenBlacklisted } from '../lib/redis';
import { ApiError } from '../errors';
import { db } from '../db';
import { customers, users, userCustomerLinks } from '../db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';

function normalizeCustomerIds(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value != null && Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

async function loadCurrentCustomerIds(userId: number, primaryCustomerId: number | null): Promise<number[]> {
  const rows = await db.select({ customerId: customers.id })
    .from(customers)
    .leftJoin(userCustomerLinks, and(
      eq(userCustomerLinks.customerId, customers.id),
      eq(userCustomerLinks.userId, userId),
    ))
    .where(and(
      isNull(customers.deletedAt),
      or(
        eq(userCustomerLinks.userId, userId),
        eq(customers.id, primaryCustomerId ?? -1),
      ),
    ))
    .orderBy(customers.id);
  return rows.map((row) => row.customerId);
}

function tokenCustomerIds(payload: AuthUser): number[] {
  if (payload.customerIds?.length) return normalizeCustomerIds(payload.customerIds);
  if (payload.customerId != null) return [payload.customerId];
  return [];
}

function sameCustomerScope(currentIds: number[], tokenIds: number[], payload: AuthUser): boolean {
  if (currentIds.length === 0) {
    return tokenIds.length === 0 && (payload.customerId == null) && (!payload.customerIds || payload.customerIds.length === 0);
  }
  if (currentIds.length === 1) {
    if (payload.customerIds && payload.customerIds.length > 0) {
      return tokenIds.length === 1 && tokenIds[0] === currentIds[0];
    }
    return tokenIds.length === 1 && tokenIds[0] === currentIds[0];
  }
  return payload.customerIds != null && tokenIds.length === currentIds.length && tokenIds.every((id, idx) => id === currentIds[idx]);
}

export interface AuthUser {
  userId: number;
  username: string | null;
  email: string | null;
  /** Human-readable Vietnamese name. Used as the actor label in audit logs. */
  fullName: string | null;
  role: Role;
  /**
   * Wave 0: legacy primary customer pointer for a CUSTOMER-role user.
   * Kept for compatibility with older single-link tokens and API payloads.
   */
  customerId?: number | null;
  /**
   * Wave 0: full customer link set for a CUSTOMER-role user. Used by the
   * portal list routes and token revalidation when a user is linked to
   * multiple customers.
   */
  customerIds?: number[];
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
    const [current] = await db.select({
      role: users.role,
      customerId: users.customerId,
    }).from(users).where(and(
      eq(users.id, payload.userId),
      eq(users.status, 'ACTIVE'),
      isNull(users.deletedAt),
    )).limit(1);
    const currentCustomerIds = current?.role === Role.CUSTOMER
      ? await loadCurrentCustomerIds(payload.userId, current.customerId)
      : [];
    const tokenIds = tokenCustomerIds(payload);
    if (!current || current.role !== payload.role || !sameCustomerScope(currentCustomerIds, tokenIds, payload)) {
      return res.status(401).json({ error: 'Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại' });
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
    const [current] = await db.select({
      role: users.role,
      customerId: users.customerId,
    }).from(users).where(and(
      eq(users.id, payload.userId),
      eq(users.status, 'ACTIVE'),
      isNull(users.deletedAt),
    )).limit(1);
    const currentCustomerIds = current?.role === Role.CUSTOMER
      ? await loadCurrentCustomerIds(payload.userId, current.customerId)
      : [];
    const tokenIds = tokenCustomerIds(payload);
    if (!current || current.role !== payload.role || !sameCustomerScope(currentCustomerIds, tokenIds, payload)) {
      return res.status(401).json({ error: 'Quyền tài khoản đã thay đổi, vui lòng đăng nhập lại' });
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
