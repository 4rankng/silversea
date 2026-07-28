import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';

/** ms-compatible duration string (e.g. '7d', '24h', '3600s') for jwt SignOptions.expiresIn. */
type DurationString = `${number}` | `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`;
import { config } from '../config';
import { db } from '../db';
import * as s from '../db/schema';
import { Role, loginSchema, createUserSchema, updateUserSchema, updateProfileSchema, changePasswordSchema } from '@tingting/shared';
import { authMiddleware, getUser } from '../middleware/auth';
import { casbinAuthz } from '../middleware/casbin';
import { blacklistToken } from '../lib/redis';
import * as userService from '../services/user.service';
import { getAppSettings } from '../services/app-settings.service';
import { registerAuditEvent } from '../services/audit-registry';
import { AuditEvent } from '../services/audit-types';
import { asyncHandler } from '../middleware/asyncHandler';
import { ApiError } from '../errors';
import type { Request, Response } from 'express';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Audit event registrations
registerAuditEvent('POST', '/api/auth/login', AuditEvent.USER_LOGIN);
registerAuditEvent('POST', '/api/auth/logout', AuditEvent.USER_LOGOUT);

const router = Router();
export const AUTH_COMMANDS = {
  PROFILE_UPDATE: 'auth.profile.update',
  PASSWORD_CHANGE: 'auth.password.change',
  USERS_CREATE: 'auth.users.create',
  USERS_UPDATE: 'auth.users.update',
  USERS_DELETE: 'auth.users.delete',
  BUSINESS_UNITS_CREATE: 'auth.business-units.create',
  BUSINESS_UNITS_UPDATE: 'auth.business-units.update',
  BUSINESS_UNITS_DEACTIVATE: 'auth.business-units.deactivate',
} as const;

function requireAdmin(req: Request, message: string): void {
  if (req.user?.role !== Role.ADMIN) {
    throw new ApiError(403, message);
  }
}

async function blacklistCurrentToken(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new ApiError(401, 'Token không hợp lệ');
  const payload = jwt.decode(token) as { jti?: string; exp?: number } | null;
  if (payload?.jti && payload?.exp) {
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await blacklistToken(payload.jti, ttl);
  }
}

async function revokeCurrentTokenOrThrow(req: Request, failureMessage: string): Promise<void> {
  try {
    await blacklistCurrentToken(req);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, failureMessage);
  }
}

function requireIdempotencyKey(req: Request, message: string): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) throw new ApiError(400, message);
  return key;
}

function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) throw new ApiError(428, message);
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

function assertNoDriverSalaryWrite(
  data: { baseSalary?: unknown; socialInsurance?: unknown },
  message = 'Lương cơ bản và BHXH của lái xe phải chỉnh qua cấu hình lái xe.',
): void {
  if (data.baseSalary !== undefined || data.socialInsurance !== undefined) {
    throw new ApiError(400, message);
  }
}

async function lockRowVersion(
  tx: Tx,
  lookup: () => Promise<Date | null>,
  id: number,
  expected: Date,
  notFoundMessage: string,
) {
  const updatedAt = await lookup();
  if (!updatedAt) throw new ApiError(404, notFoundMessage);
  if (updatedAt.getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

async function lockUserVersion(tx: Tx, id: number, expected: Date, notFoundMessage: string) {
  return lockRowVersion(
    tx,
    async () => {
      const [row] = await tx.select({ updatedAt: s.users.updatedAt })
        .from(s.users)
        .where(and(eq(s.users.id, id), isNull(s.users.deletedAt)))
        .limit(1)
        .for('update');
      return row?.updatedAt ?? null;
    },
    id,
    expected,
    notFoundMessage,
  );
}

async function lockBusinessUnitVersion(tx: Tx, id: number, expected: Date, notFoundMessage: string) {
  return lockRowVersion(
    tx,
    async () => {
      const [row] = await tx.select({ updatedAt: s.businessUnits.updatedAt })
        .from(s.businessUnits)
        .where(eq(s.businessUnits.id, id))
        .limit(1)
        .for('update');
      return row?.updatedAt ?? null;
    },
    id,
    expected,
    notFoundMessage,
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = loginSchema.parse(req.body);

  const user = await userService.authenticate(identifier, password);

  const displayName = await userService.resolveDisplayName(user);

  const token = jwt.sign(
    {
      userId: user.id, username: user.username, email: user.email,
      fullName: displayName, role: user.role, jti: crypto.randomUUID(),
      // Wave 0: carry both the legacy primary customerId and the full
      // customerIds link set so portal scoping can stay DB-backed while
      // old single-link payloads remain compatible.
      customerId: user.customerId ?? undefined,
      customerIds: user.customerIds?.length ? user.customerIds : undefined,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as DurationString }
  );

  const capabilities = await userService.getCapabilities(user.role);
  const settings = await getAppSettings();
  res.json({ token, user: { ...user, fullName: displayName, capabilities, botEnabled: settings.botEnabled, onboardingEnabled: settings.tutorialEnabled } });
}));

// ─── Current user ────────────────────────────────────────────────────────────

router.get('/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const profile = await userService.getUserProfile(getUser(req).userId);
  if (getUser(req).role !== profile.role) {
    throw new ApiError(401, 'Vai trò đã thay đổi, vui lòng đăng nhập lại');
  }
  const capabilities = await userService.getCapabilities(profile.role);
  const settings = await getAppSettings();
  res.json({ ...profile, capabilities, botEnabled: settings.botEnabled, onboardingEnabled: settings.tutorialEnabled });
}));

router.post('/logout', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  await revokeCurrentTokenOrThrow(
    req,
    'Phiên đăng nhập chưa được thu hồi trên máy chủ. Vui lòng thử lại.',
  );
  res.json({ success: true });
}));

router.patch('/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const user = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật hồ sơ.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản hồ sơ. Vui lòng tải lại trước khi cập nhật.',
  );
  const payload = updateProfileSchema.parse(req.body);
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.PROFILE_UPDATE,
    idempotencyKey,
    payload: { userId: user.userId, body: payload, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: user.userId,
    entityType: 'users',
    create: async (tx) => {
      await lockUserVersion(tx, user.userId, expectedUpdatedAt, 'Không tìm thấy người dùng');
      return userService.updateProfileWithTx(user.userId, payload, tx);
    },
  });
  res.json({ ...result, replayed });
}));

router.post('/change-password', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đổi mật khẩu.');
  const nextPasswordHash = await bcrypt.hash(newPassword, 10);
  const { replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.PASSWORD_CHANGE,
    idempotencyKey,
    payload: { userId: user.userId, currentPassword, newPassword },
    createdBy: user.userId,
    entityType: 'users',
    create: async (tx) => {
      await userService.changePasswordWithTx(user.userId, currentPassword, nextPasswordHash, tx);
      return { success: true };
    },
  });
  await revokeCurrentTokenOrThrow(
    req,
    'Mật khẩu đã được đổi nhưng phiên đăng nhập cũ chưa được thu hồi. Vui lòng thử lại để hoàn tất.',
  );
  res.json({ success: true, replayed });
}));

// ─── User management (admin) ─────────────────────────────────────────────────

router.get('/users', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  res.json(await userService.listUsers(req.user?.role));
}));

router.post('/users', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === Role.ACCOUNTANT) {
    throw new ApiError(403, 'Kế toán không thể tạo người dùng');
  }
  const data = createUserSchema.parse(req.body);
  assertNoDriverSalaryWrite(data);
  if (req.user?.role !== Role.ADMIN && data.role === Role.ADMIN) {
    throw new ApiError(403, 'Chỉ quản trị viên mới có thể gán vai trò ADMIN');
  }
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo người dùng.');
  const payload = {
    username: data.username,
    email: data.email,
    phone: data.phone,
    fullName: data.fullName,
    password: data.password,
    role: data.role,
    status: data.status,
    assignedTruckId: data.assignedTruckId,
    customerId: data.customerId,
    customerIds: data.customerIds,
    businessUnitIds: data.businessUnitIds,
    shipmentIds: data.shipmentIds,
    assignmentAdminOnly: req.user?.role !== Role.ADMIN,
  };
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.USERS_CREATE,
    idempotencyKey,
    payload,
    createdBy: actor.userId,
    entityType: 'users',
    responseStatusCode: 201,
    create: (tx) => userService.createUserWithTx(tx, payload),
  });
  res.status(201).json({ ...result, replayed });
}));

router.patch('/users/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật người dùng.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản người dùng. Vui lòng tải lại trước khi cập nhật.',
  );
  const data = updateUserSchema.parse(req.body);
  assertNoDriverSalaryWrite(data);
  let payload: Parameters<typeof userService.updateUser>[1];
  if (req.user?.role === Role.ACCOUNTANT) {
    payload = {
      fullName: data.fullName,
      phone: data.phone,
      assignedTruckId: data.assignedTruckId,
      requireDriverTarget: true,
    };
  } else {
    if (req.user?.role !== Role.ADMIN && data.role === Role.ADMIN) {
      throw new ApiError(403, 'Chỉ quản trị viên mới có thể gán vai trò ADMIN');
    }
    payload = {
      role: data.role,
      status: data.status,
      password: data.password,
      username: data.username,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      assignedTruckId: data.assignedTruckId,
      customerId: data.customerId,
      customerIds: data.customerIds,
      businessUnitIds: data.businessUnitIds,
      shipmentIds: data.shipmentIds,
      assignmentAdminOnly: req.user?.role !== Role.ADMIN,
    };
  }
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.USERS_UPDATE,
    idempotencyKey,
    payload: { id, body: payload, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'users',
    create: async (tx) => {
      await lockUserVersion(tx, id, expectedUpdatedAt, 'Không tìm thấy người dùng');
      return userService.updateUserWithTx(id, payload, tx);
    },
  });
  res.json({ ...result, replayed });
}));

const businessUnitSchema = z.object({
  code: z.string().trim().min(1).max(50).optional().nullable(),
  name: z.string().trim().min(1, 'Tên đơn vị là bắt buộc').max(255),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const updateBusinessUnitSchema = z.object({
  code: z.string().trim().min(1).max(50).optional().nullable(),
  name: z.string().trim().min(1, 'Tên đơn vị là bắt buộc').max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

router.get('/business-units', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await userService.listBusinessUnits() });
}));

router.post('/business-units', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req, 'Chỉ quản trị viên mới có thể tạo đơn vị phụ trách');
  const data = businessUnitSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo đơn vị phụ trách.');
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.BUSINESS_UNITS_CREATE,
    idempotencyKey,
    payload: data,
    createdBy: actor.userId,
    entityType: 'business-units',
    responseStatusCode: 201,
    create: (tx) => userService.createBusinessUnitWithTx(data, tx),
  });
  res.status(201).json({ ...result, replayed });
}));

router.patch('/business-units/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req, 'Chỉ quản trị viên mới có thể cập nhật đơn vị phụ trách');
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  const data = updateBusinessUnitSchema.parse(req.body);
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật đơn vị phụ trách.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản đơn vị phụ trách. Vui lòng tải lại trước khi cập nhật.',
  );
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.BUSINESS_UNITS_UPDATE,
    idempotencyKey,
    payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'business-units',
    create: async (tx) => {
      await lockBusinessUnitVersion(tx, id, expectedUpdatedAt, 'Không tìm thấy đơn vị phụ trách');
      return userService.updateBusinessUnitWithTx(id, data, tx);
    },
  });
  res.json({ ...result, replayed });
}));

router.delete('/business-units/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req, 'Chỉ quản trị viên mới có thể ngưng sử dụng đơn vị phụ trách');
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi ngưng đơn vị phụ trách.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản đơn vị phụ trách. Vui lòng tải lại trước khi cập nhật.',
  );
  const { result, replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.BUSINESS_UNITS_DEACTIVATE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'business-units',
    create: async (tx) => {
      await lockBusinessUnitVersion(tx, id, expectedUpdatedAt, 'Không tìm thấy đơn vị phụ trách');
      return userService.updateBusinessUnitWithTx(id, { status: 'INACTIVE' }, tx);
    },
  });
  res.json({ ...result, replayed });
}));

router.delete('/users/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === Role.ACCOUNTANT) {
    throw new ApiError(403, 'Kế toán không thể xóa người dùng');
  }
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  const actor = getUser(req);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi xóa người dùng.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản người dùng. Vui lòng tải lại trước khi cập nhật.',
  );
  const { replayed } = await runIdempotent({
    endpoint: AUTH_COMMANDS.USERS_DELETE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'users',
    create: async (tx) => {
      await lockUserVersion(tx, id, expectedUpdatedAt, 'Không tìm thấy người dùng');
      await userService.deleteUserWithTx(id, actor.userId, tx);
      return { success: true };
    },
  });
  res.json({ success: true, replayed });
}));

export default router;
