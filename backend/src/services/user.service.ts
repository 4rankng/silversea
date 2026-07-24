/**
 * User service — CRUD operations for user management.
 * Extracted from routes/auth.ts to separate user lifecycle from auth flow.
 *
 * Driver profiles (`drivers` table) are managed alongside their linked user:
 * creating/updating/deleting a DRIVER-role user creates/upserts/soft-deletes
 * the linked `drivers` row in the same transaction. `listUsers` LEFT-JOINs the
 * driver profile so the /users page can render salary/truck inline.
 */
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users, drivers } from '../db/schema';
import { eq, isNull, sql, or, and, ne } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import { getEnforcer } from '../casbin/enforcer';

export const USER_FIELDS = {
  id: users.id, username: users.username, email: users.email, phone: users.phone,
  role: users.role, status: users.status, fullName: users.fullName, createdAt: users.createdAt,
};

/** User fields + the linked driver profile (LEFT JOIN). Driver-* are null when no profile row. */
export const USER_WITH_DRIVER_FIELDS = {
  ...USER_FIELDS,
  driverId: drivers.id,
  driverName: drivers.name,
  driverPhone: drivers.phone,
  assignedTruckId: drivers.assignedTruckId,
  baseSalary: drivers.baseSalary,
  socialInsurance: drivers.socialInsurance,
  driverStatus: drivers.status,
};

/** Shared LEFT JOIN condition for linking a driver profile to a user. */
const driverJoin = () => and(eq(drivers.userId, users.id), isNull(drivers.deletedAt));

/** Select a user row with its optional driver profile, scoped by an optional extra where clause. */
function selectUserWithDriver(q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], extraWhere?: ReturnType<typeof eq> | ReturnType<typeof and>) {
  return q.select(USER_WITH_DRIVER_FIELDS)
    .from(users)
    .leftJoin(drivers, driverJoin())
    .where(extraWhere);
}

/** Verify a user's current password. Throws on failure. */
export async function verifyPassword(userId: number, password: string): Promise<void> {
  const [user] = await db.select({ passwordHash: users.passwordHash })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError(404, 'Không tìm thấy người dùng');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new ApiError(401, 'Mật khẩu hiện tại không đúng');
}

/**
 * Authenticate a user by identifier (username, email, or phone) and password.
 * Returns the full user row (without passwordHash) on success, or throws ApiError(401) on failure.
 */
export async function authenticate(identifier: string, password: string) {
  const [user] = await db.select().from(users).where(
    or(eq(users.username, identifier), eq(users.email, identifier), eq(users.phone, identifier))
  ).limit(1);

  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    throw new ApiError(401, 'Thông tin đăng nhập không hợp lệ');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new ApiError(401, 'Thông tin đăng nhập không hợp lệ');
  }

  const { passwordHash, deletedAt, ...userPublic } = user;
  void passwordHash; void deletedAt;
  return userPublic;
}

/** List all active users, each joined with its optional driver profile. Non-ADMIN requesters cannot see ADMIN accounts. */
export async function listUsers(requesterRole?: string) {
  const where = requesterRole !== Role.ADMIN
    ? and(isNull(users.deletedAt), ne(users.role, Role.ADMIN))
    : isNull(users.deletedAt);
  const items = await selectUserWithDriver(db, where);
  return { items, total: items.length };
}

/** Create a new user with hashed password. DRIVER-role users also get a linked drivers row. */
export async function createUser(data: {
  username?: string;
  email?: string;
  phone?: string;
  fullName?: string;
  password: string;
  role: string;
  status?: string;
  baseSalary?: number;
  socialInsurance?: number;
  assignedTruckId?: number | null;
}) {
  const passwordHash = await bcrypt.hash(data.password, 10);
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(users).values({
      username: data.username || null,
      email: data.email || null,
      phone: data.phone || null,
      fullName: data.fullName || null,
      passwordHash,
      role: data.role as (typeof users.role.enumValues)[number],
      status: data.status ?? 'ACTIVE',
    }).returning(USER_FIELDS);

    if (data.role === Role.DRIVER) {
      await tx.insert(drivers).values(buildDriverValues(created.id, {
        fullName: data.fullName, username: data.username, phone: data.phone,
        baseSalary: data.baseSalary, socialInsurance: data.socialInsurance,
        assignedTruckId: data.assignedTruckId, status: data.status,
      }));
    }
    // Return the full row including driver profile for a complete API response.
    const [withDriver] = await selectUserWithDriver(tx, eq(users.id, created.id)).limit(1);
    return withDriver;
  });
}

/** Build a driver-profile SET record from partial data. Returns empty object when no fields changed. */
function buildDriverUpdateSet(data: {
  fullName?: string; phone?: string;
  baseSalary?: number; socialInsurance?: number;
  assignedTruckId?: number | null; status?: string;
}): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  if (data.fullName) set.name = data.fullName;
  if (data.phone !== undefined) set.phone = data.phone || null;
  if (data.baseSalary !== undefined) set.baseSalary = String(data.baseSalary);
  if (data.socialInsurance !== undefined) set.socialInsurance = String(data.socialInsurance);
  if (data.assignedTruckId !== undefined) set.assignedTruckId = data.assignedTruckId ?? null;
  if (data.status !== undefined) set.status = data.status;
  return Object.keys(set).length > 1 ? set : {};
}

/** Build driver-row values shared between createUser and updateUser create-if-missing paths. */
function buildDriverValues(userId: number, opts: {
  fullName?: string | null; username?: string | null; phone?: string | null;
  baseSalary?: number; socialInsurance?: number; assignedTruckId?: number | null;
  status?: string;
}) {
  return {
    userId,
    name: opts.fullName || opts.username || opts.phone || 'Lái xe',
    phone: opts.phone || null,
    baseSalary: opts.baseSalary != null ? String(opts.baseSalary) : null,
    socialInsurance: opts.socialInsurance != null ? String(opts.socialInsurance) : null,
    assignedTruckId: opts.assignedTruckId ?? null,
    status: (opts.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
  };
}

/** Update user fields. When the resulting role is DRIVER, upsert the linked drivers row. */
export async function updateUser(id: number, data: {
  role?: string;
  status?: string;
  password?: string;
  username?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  baseSalary?: number;
  socialInsurance?: number;
  assignedTruckId?: number | null;
  /** If true, throws 403 when target user is not DRIVER — used for accountant scoping. */
  requireDriverTarget?: boolean;
}) {
  // Hash password outside transaction — CPU-intensive work should not hold a DB connection.
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ role: users.role }).from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1);
    if (!existing) throw new ApiError(404, 'Không tìm thấy người dùng');

    // Driver-target check inside the transaction to avoid TOCTOU race.
    if (data.requireDriverTarget && existing.role !== Role.DRIVER) {
      throw new ApiError(403, 'Kế toán chỉ có thể chỉnh sửa lái xe');
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (data.role !== undefined) updates.role = data.role as (typeof users.role.enumValues)[number];
    if (data.status !== undefined) updates.status = data.status;
    if (passwordHash) updates.passwordHash = passwordHash;
    if (data.username !== undefined) updates.username = data.username;
    if (data.fullName !== undefined) updates.fullName = data.fullName || null;
    if (data.email !== undefined) updates.email = data.email || null;
    if (data.phone !== undefined) updates.phone = data.phone || null;

    const [updated] = await tx.update(users).set(updates)
      .where(eq(users.id, id)).returning(USER_FIELDS);

    // Upsert the linked driver profile when the resulting role is DRIVER.
    const effectiveRole = data.role ?? existing.role;
    if (effectiveRole === Role.DRIVER) {
      const [existingDriver] = await tx.select({ id: drivers.id })
        .from(drivers).where(and(eq(drivers.userId, id), isNull(drivers.deletedAt))).limit(1);

      if (existingDriver) {
        const driverSet = buildDriverUpdateSet(data);
        if (Object.keys(driverSet).length > 0) {
          await tx.update(drivers).set(driverSet).where(eq(drivers.id, existingDriver.id));
        }
      } else {
        // Create-if-missing: legacy user without a profile, or role just changed to DRIVER.
        await tx.insert(drivers).values(buildDriverValues(id, {
          fullName: updated.fullName, username: updated.username, phone: updated.phone,
          baseSalary: data.baseSalary, socialInsurance: data.socialInsurance,
          assignedTruckId: data.assignedTruckId, status: updated.status,
        }));
      }
    } else if (data.role !== undefined && data.role !== existing.role) {
      // Role changed AWAY from DRIVER: soft-delete the orphaned driver row so it
      // no longer appears in dropdowns/catalogs. Salary history is preserved via
      // trip records and attendance tables which reference driverId directly.
      await tx.update(drivers).set({ deletedAt: sql`now()`, status: 'INACTIVE' })
        .where(and(eq(drivers.userId, id), isNull(drivers.deletedAt)));
    }

    // Return the full row including driver profile for a complete API response.
    const [withDriver] = await selectUserWithDriver(tx, eq(users.id, id)).limit(1);
    return withDriver;
  });
}

/** Soft-delete a user and its linked driver profile (if any). */
export async function deleteUser(id: number, currentUserId: number) {
  if (id === currentUserId) throw new ApiError(400, 'Không thể xóa tài khoản đang đăng nhập');
  await db.transaction(async (tx) => {
    await tx.update(users).set({ deletedAt: sql`now()`, status: 'INACTIVE' }).where(eq(users.id, id));
    await tx.update(drivers).set({ deletedAt: sql`now()`, status: 'INACTIVE' })
      .where(and(eq(drivers.userId, id), isNull(drivers.deletedAt)));
  });
}

/** Get current user profile (including driver profile if DRIVER role). */
export async function getUserProfile(userId: number) {
  const [user] = await db.select(USER_FIELDS).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError(404, 'Không tìm thấy người dùng');

  if (user.role === 'DRIVER') {
    const [driver] = await db.select().from(drivers)
      .where(and(eq(drivers.userId, user.id), isNull(drivers.deletedAt))).limit(1);
    return { ...user, driver: driver || null };
  }
  return user;
}

/** Update current user's profile (username, fullName, email, phone). Syncs name/phone to linked driver. */
export async function updateProfile(
  userId: number,
  data: { username?: string; fullName?: string; email?: string; phone?: string },
) {
  const updates: Record<string, unknown> = { updatedAt: sql`now()` };

  if (data.username !== undefined) updates.username = data.username;

  if (data.fullName !== undefined) updates.fullName = data.fullName || null;
  if (data.email !== undefined) updates.email = data.email || null;
  if (data.phone !== undefined) updates.phone = data.phone || null;

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(users).set(updates)
      .where(eq(users.id, userId))
      .returning(USER_FIELDS);

    if (!updated) throw new ApiError(404, 'Không tìm thấy người dùng');

    // Sync fullName/phone to linked driver profile so names stay consistent.
    const driverSet = buildDriverUpdateSet({ fullName: data.fullName, phone: data.phone });
    if (Object.keys(driverSet).length > 0) {
      await tx.update(drivers).set(driverSet)
        .where(and(eq(drivers.userId, userId), isNull(drivers.deletedAt)));
    }

    return updated;
  });
}

/** Change password for current user. */
export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  await verifyPassword(userId, currentPassword);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(users).set({ passwordHash, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
}

/** Resolve display name for a user (prefers driver name for DRIVER role). */
export async function resolveDisplayName(user: { id: number; role: string; fullName: string | null; username: string | null }): Promise<string> {
  let displayName = user.fullName;
  if (user.role === 'DRIVER') {
    const [d] = await db.select({ name: drivers.name }).from(drivers).where(eq(drivers.userId, user.id)).limit(1);
    if (d?.name) displayName = d.name;
  }
  return displayName || user.username || 'Người dùng';
}

export async function getCapabilities(role: string): Promise<string[]> {
  const enforcer = getEnforcer();
  const capabilities: string[] = [];
  // 'manage_users' = full user management (ADMIN/MANAGER only). Accountants gain
  // limited users access (driver-only edits) via casbin, but must NOT receive the
  // manage_users capability — the frontend gates full management UI on it.
  if (role !== Role.ACCOUNTANT && await enforcer.enforce(role, 'users', 'write')) {
    capabilities.push('manage_users');
  }
  return capabilities;
}
