import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/** ms-compatible duration string (e.g. '7d', '24h', '3600s') for jwt SignOptions.expiresIn. */
type DurationString = `${number}` | `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`;
import { config } from '../config';
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

// Audit event registrations
registerAuditEvent('POST', '/api/auth/login', AuditEvent.USER_LOGIN);
registerAuditEvent('POST', '/api/auth/logout', AuditEvent.USER_LOGOUT);

const router = Router();

async function blacklistCurrentToken(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new ApiError(401, 'Token không hợp lệ');
  const payload = jwt.decode(token) as { jti?: string; exp?: number } | null;
  if (payload?.jti && payload?.exp) {
    const ttl = payload.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await blacklistToken(payload.jti, ttl);
  }
}

// ─── Login ───────────────────────────────────────────────────────────────────

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = loginSchema.parse(req.body);

  const user = await userService.authenticate(identifier, password);

  const displayName = await userService.resolveDisplayName(user);

  const token = jwt.sign(
    { userId: user.id, username: user.username, email: user.email, fullName: displayName, role: user.role, jti: crypto.randomUUID() },
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
  await blacklistCurrentToken(req);
  res.json({ success: true });
}));

router.patch('/me', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const updated = await userService.updateProfile(getUser(req).userId, updateProfileSchema.parse(req.body));
  res.json(updated);
}));

router.post('/change-password', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await userService.changePassword(getUser(req).userId, currentPassword, newPassword);
  await blacklistCurrentToken(req);
  res.json({ success: true });
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
  if (req.user?.role !== Role.ADMIN && data.role === Role.ADMIN) {
    throw new ApiError(403, 'Chỉ quản trị viên mới có thể gán vai trò ADMIN');
  }
  const created = await userService.createUser({
    username: data.username,
    email: data.email,
    phone: data.phone,
    fullName: data.fullName,
    password: data.password,
    role: data.role,
    status: data.status,
    baseSalary: data.baseSalary,
    socialInsurance: data.socialInsurance,
    assignedTruckId: data.assignedTruckId,
  });
  res.status(201).json(created);
}));

router.patch('/users/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  const data = updateUserSchema.parse(req.body);
  // Accountants may only edit DRIVER users, and only driver-relevant fields.
  // Positive allowlist + requireDriverTarget moves the role check into the
  // same transaction, eliminating the TOCTOU race from a separate getUserRole call.
  if (req.user?.role === Role.ACCOUNTANT) {
    const updated = await userService.updateUser(id, {
      fullName: data.fullName,
      phone: data.phone,
      baseSalary: data.baseSalary,
      socialInsurance: data.socialInsurance,
      assignedTruckId: data.assignedTruckId,
      requireDriverTarget: true,
    });
    res.json(updated);
    return;
  }
  if (req.user?.role !== Role.ADMIN && data.role === Role.ADMIN) {
    throw new ApiError(403, 'Chỉ quản trị viên mới có thể gán vai trò ADMIN');
  }
  const updated = await userService.updateUser(id, {
    role: data.role,
    status: data.status,
    password: data.password,
    username: data.username,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    baseSalary: data.baseSalary,
    socialInsurance: data.socialInsurance,
    assignedTruckId: data.assignedTruckId,
  });
  res.json(updated);
}));

router.delete('/users/:id', authMiddleware, casbinAuthz('users'), asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.role === Role.ACCOUNTANT) {
    throw new ApiError(403, 'Kế toán không thể xóa người dùng');
  }
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) throw new ApiError(400, 'ID không hợp lệ');
  await userService.deleteUser(id, getUser(req).userId);
  res.json({ success: true });
}));

export default router;
