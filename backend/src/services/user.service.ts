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
import {
  users,
  drivers,
  customers,
  shipments,
  businessUnits,
  userCustomerLinks,
  userBusinessUnitLinks,
  userShipmentLinks,
} from '../db/schema';
import { eq, isNull, sql, or, and, ne, inArray } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { ApiError } from '../errors';
import { getEnforcer } from '../casbin/enforcer';

export const USER_FIELDS = {
  id: users.id, username: users.username, email: users.email, phone: users.phone,
  role: users.role, status: users.status, fullName: users.fullName, createdAt: users.createdAt,
  customerId: users.customerId,
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

type CustomerLinkInput = {
  customerId?: number | null;
  customerIds?: number[] | null;
  businessUnitIds?: number[] | null;
  shipmentIds?: number[] | null;
  assignmentAdminOnly?: boolean;
};

function normalizeCustomerIds(input: CustomerLinkInput): number[] {
  const rawIds = input.customerIds != null
    ? input.customerIds
    : input.customerId != null
      ? [input.customerId]
      : [];
  return [...new Set(rawIds.filter((id): id is number => id != null && Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
}

function hasExplicitCustomerScopeInput(data: CustomerLinkInput): boolean {
  return data.customerIds !== undefined || data.customerId !== undefined;
}

function hasActiveClerkScope(
  businessUnitIds: number[],
  customerIds: number[],
  shipmentIds: number[],
): boolean {
  return businessUnitIds.length > 0 && (customerIds.length > 0 || shipmentIds.length > 0);
}

function assertActiveClerkScope(
  businessUnitIds: number[],
  customerIds: number[],
  shipmentIds: number[],
): void {
  if (!hasActiveClerkScope(businessUnitIds, customerIds, shipmentIds)) {
    throw new ApiError(
      400,
      'Nhân viên chứng từ ACTIVE phải có ít nhất một đơn vị phụ trách và ít nhất một khách hàng hoặc lô hàng được giao',
    );
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

async function loadCustomerIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  primaryCustomerId: number | null,
): Promise<number[]> {
  const rows = await q.select({ customerId: customers.id })
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

async function loadUsersCustomerIdsMap(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userIds: number[],
): Promise<Map<number, number[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await q.select({
    userId: userCustomerLinks.userId,
    customerId: userCustomerLinks.customerId,
  }).from(userCustomerLinks)
    .innerJoin(customers, eq(userCustomerLinks.customerId, customers.id))
    .where(and(
      inArray(userCustomerLinks.userId, userIds),
      isNull(customers.deletedAt),
    ))
    .orderBy(userCustomerLinks.userId, userCustomerLinks.customerId);
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const current = map.get(row.userId) ?? [];
    current.push(row.customerId);
    map.set(row.userId, current);
  }
  return map;
}

async function loadBusinessUnitIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
): Promise<number[]> {
  const rows = await q.select({ businessUnitId: userBusinessUnitLinks.businessUnitId })
    .from(userBusinessUnitLinks)
    .innerJoin(businessUnits, eq(userBusinessUnitLinks.businessUnitId, businessUnits.id))
    .where(and(
      eq(userBusinessUnitLinks.userId, userId),
      eq(businessUnits.status, 'ACTIVE'),
    ))
    .orderBy(userBusinessUnitLinks.businessUnitId);
  return rows.map((row) => row.businessUnitId);
}

async function loadUsersBusinessUnitIdsMap(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userIds: number[],
): Promise<Map<number, number[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await q.select({
    userId: userBusinessUnitLinks.userId,
    businessUnitId: userBusinessUnitLinks.businessUnitId,
  }).from(userBusinessUnitLinks)
    .innerJoin(businessUnits, eq(userBusinessUnitLinks.businessUnitId, businessUnits.id))
    .where(and(
      inArray(userBusinessUnitLinks.userId, userIds),
      eq(businessUnits.status, 'ACTIVE'),
    ))
    .orderBy(userBusinessUnitLinks.userId, userBusinessUnitLinks.businessUnitId);
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const current = map.get(row.userId) ?? [];
    current.push(row.businessUnitId);
    map.set(row.userId, current);
  }
  return map;
}

async function loadShipmentIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
): Promise<number[]> {
  const rows = await q.select({ shipmentId: userShipmentLinks.shipmentId })
    .from(userShipmentLinks)
    .innerJoin(shipments, eq(userShipmentLinks.shipmentId, shipments.id))
    .where(and(
      eq(userShipmentLinks.userId, userId),
      isNull(shipments.deletedAt),
    ))
    .orderBy(userShipmentLinks.shipmentId);
  return rows.map((row) => row.shipmentId);
}

async function loadUsersShipmentIdsMap(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  userIds: number[],
): Promise<Map<number, number[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await q.select({
    userId: userShipmentLinks.userId,
    shipmentId: userShipmentLinks.shipmentId,
  }).from(userShipmentLinks)
    .innerJoin(shipments, eq(userShipmentLinks.shipmentId, shipments.id))
    .where(and(
      inArray(userShipmentLinks.userId, userIds),
      isNull(shipments.deletedAt),
    ))
    .orderBy(userShipmentLinks.userId, userShipmentLinks.shipmentId);
  const map = new Map<number, number[]>();
  for (const row of rows) {
    const current = map.get(row.userId) ?? [];
    current.push(row.shipmentId);
    map.set(row.userId, current);
  }
  return map;
}

async function validateCustomerIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  customerIds: number[],
) {
  if (customerIds.length === 0) return;
  const rows = await q.select({ id: customers.id }).from(customers)
    .where(and(inArray(customers.id, customerIds), isNull(customers.deletedAt)));
  if (rows.length !== customerIds.length) {
    throw new ApiError(400, 'Khách hàng liên kết không tồn tại');
  }
}

async function validateBusinessUnitIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  businessUnitIds: number[],
) {
  if (businessUnitIds.length === 0) return;
  const rows = await q.select({ id: businessUnits.id }).from(businessUnits)
    .where(and(inArray(businessUnits.id, businessUnitIds), eq(businessUnits.status, 'ACTIVE')))
    .for('share');
  if (rows.length !== businessUnitIds.length) {
    throw new ApiError(400, 'Đơn vị phụ trách liên kết không tồn tại hoặc đã ngưng dùng');
  }
}

async function validateShipmentIds(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  shipmentIds: number[],
  businessUnitIds: number[],
) {
  if (shipmentIds.length === 0) return;
  const rows = await q.select({
    id: shipments.id,
    responsibleUnitId: shipments.responsibleUnitId,
  }).from(shipments)
    .where(and(inArray(shipments.id, shipmentIds), isNull(shipments.deletedAt)));
  if (rows.length !== shipmentIds.length) {
    throw new ApiError(400, 'Lô hàng liên kết không tồn tại');
  }
  const invalid = rows.find((row) =>
    row.responsibleUnitId == null || !businessUnitIds.includes(row.responsibleUnitId),
  );
  if (invalid) {
    throw new ApiError(400, 'Lô hàng liên kết phải thuộc một đơn vị phụ trách đã gán cho nhân viên chứng từ');
  }
}

async function syncCustomerLinks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  customerIds: number[],
) {
  await tx.delete(userCustomerLinks).where(eq(userCustomerLinks.userId, userId));
  if (customerIds.length === 0) return;
  await tx.insert(userCustomerLinks).values(customerIds.map((customerId) => ({
    userId,
    customerId,
  })));
}

async function syncBusinessUnitLinks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  businessUnitIds: number[],
) {
  await tx.delete(userBusinessUnitLinks).where(eq(userBusinessUnitLinks.userId, userId));
  if (businessUnitIds.length === 0) return;
  await tx.insert(userBusinessUnitLinks).values(businessUnitIds.map((businessUnitId) => ({
    userId,
    businessUnitId,
  })));
}

async function syncShipmentLinks(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: number,
  shipmentIds: number[],
) {
  await tx.delete(userShipmentLinks).where(eq(userShipmentLinks.userId, userId));
  if (shipmentIds.length === 0) return;
  await tx.insert(userShipmentLinks).values(shipmentIds.map((shipmentId) => ({
    userId,
    shipmentId,
  })));
}

function addScopeIds<T extends { customerId: number | null }>(
  row: T,
  customerIds: number[],
  businessUnitIds: number[],
  shipmentIds: number[],
) {
  return {
    ...row,
    customerIds,
    businessUnitIds,
    shipmentIds,
    customerId: row.customerId != null && customerIds.includes(row.customerId)
      ? row.customerId
      : customerIds[0] ?? null,
  };
}

async function attachCustomerIdsToUsers<T extends { id: number; customerId: number | null }>(
  q: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
  rows: T[],
) {
  const userIds = rows.map((row) => row.id);
  const [customerMap, businessUnitMap, shipmentMap] = await Promise.all([
    loadUsersCustomerIdsMap(q, userIds),
    loadUsersBusinessUnitIdsMap(q, userIds),
    loadUsersShipmentIdsMap(q, userIds),
  ]);
  return rows.map((row) => addScopeIds(
    row,
    customerMap.get(row.id) ?? [],
    businessUnitMap.get(row.id) ?? [],
    shipmentMap.get(row.id) ?? [],
  ));
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
  const customerIds = await loadCustomerIds(db, user.id, user.customerId);
  const businessUnitIds = await loadBusinessUnitIds(db, user.id);
  const shipmentIds = await loadShipmentIds(db, user.id);
  return addScopeIds(userPublic, customerIds, businessUnitIds, shipmentIds);
}

/** List all active users, each joined with its optional driver profile. Non-ADMIN requesters cannot see ADMIN accounts. */
export async function listUsers(requesterRole?: string) {
  const where = requesterRole !== Role.ADMIN
    ? and(isNull(users.deletedAt), ne(users.role, Role.ADMIN))
    : isNull(users.deletedAt);
  const items = await selectUserWithDriver(db, where);
  const includeAssignmentMetadata = requesterRole === Role.ADMIN || requesterRole === Role.MANAGER;
  const withLinks = includeAssignmentMetadata
    ? await attachCustomerIdsToUsers(db, items)
    : items.map((row) => ({
      ...row,
      customerIds: [],
      businessUnitIds: [],
      shipmentIds: [],
    }));
  const units = await listBusinessUnits();
  return { items: withLinks, total: withLinks.length, businessUnits: units };
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
  customerId?: number | null;
  customerIds?: number[] | null;
  businessUnitIds?: number[] | null;
  shipmentIds?: number[] | null;
  assignmentAdminOnly?: boolean;
}) {
  const passwordHash = await bcrypt.hash(data.password, 10);
  return db.transaction(async (tx) => {
    const customerIds = normalizeCustomerIds(data);
    const businessUnitIds = [...new Set((data.businessUnitIds ?? []).filter((id): id is number => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    const shipmentIds = [...new Set((data.shipmentIds ?? []).filter((id): id is number => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
    if (data.role !== Role.CUSTOMER && customerIds.length > 0) {
      if (data.role !== Role.CLERK && data.role !== Role.ACCOUNTANT) {
        throw new ApiError(400, 'Chỉ tài khoản khách hàng, nhân viên chứng từ hoặc kế toán mới được liên kết khách hàng');
      }
    }
    if (data.role === Role.CUSTOMER) {
      const effectiveStatus = data.status ?? 'ACTIVE';
      if (effectiveStatus !== 'INACTIVE' && customerIds.length === 0) {
        throw new ApiError(400, 'Tài khoản khách hàng ACTIVE phải có ít nhất một khách hàng liên kết');
      }
      await validateCustomerIds(tx, customerIds);
    } else if (data.role === Role.CLERK) {
      if (data.assignmentAdminOnly && (customerIds.length > 0 || businessUnitIds.length > 0 || shipmentIds.length > 0)) {
        throw new ApiError(403, 'Chỉ quản trị viên mới có thể quản lý phạm vi nhân viên chứng từ');
      }
      await validateCustomerIds(tx, customerIds);
      await validateBusinessUnitIds(tx, businessUnitIds);
      await validateShipmentIds(tx, shipmentIds, businessUnitIds);
      if ((data.status ?? 'ACTIVE') !== 'INACTIVE') {
        assertActiveClerkScope(businessUnitIds, customerIds, shipmentIds);
      }
    } else if (data.role === Role.ACCOUNTANT) {
      if (data.assignmentAdminOnly && customerIds.length > 0) {
        throw new ApiError(403, 'Chỉ quản trị viên mới có thể quản lý phạm vi khách hàng của kế toán');
      }
      await validateCustomerIds(tx, customerIds);
      if (businessUnitIds.length > 0 || shipmentIds.length > 0) {
        throw new ApiError(400, 'Kế toán chỉ được liên kết phạm vi khách hàng');
      }
    } else if (businessUnitIds.length > 0 || shipmentIds.length > 0) {
      throw new ApiError(400, 'Chỉ nhân viên chứng từ mới được liên kết đơn vị phụ trách hoặc lô hàng');
    }
    const [created] = await tx.insert(users).values({
      username: data.username || null,
      email: data.email || null,
      phone: data.phone || null,
      fullName: data.fullName || null,
      passwordHash,
      role: data.role as (typeof users.role.enumValues)[number],
      status: data.status ?? 'ACTIVE',
      customerId: data.role === Role.CUSTOMER || data.role === Role.CLERK ? customerIds[0] ?? null : null,
    }).returning(USER_FIELDS);

    await syncCustomerLinks(
      tx,
      created.id,
      data.role === Role.CUSTOMER || data.role === Role.CLERK || data.role === Role.ACCOUNTANT
        ? customerIds
        : [],
    );
    await syncBusinessUnitLinks(tx, created.id, data.role === Role.CLERK ? businessUnitIds : []);
    await syncShipmentLinks(tx, created.id, data.role === Role.CLERK ? shipmentIds : []);

    if (data.role === Role.DRIVER) {
      await tx.insert(drivers).values(buildDriverValues(created.id, {
        fullName: data.fullName, username: data.username, phone: data.phone,
        baseSalary: data.baseSalary, socialInsurance: data.socialInsurance,
        assignedTruckId: data.assignedTruckId, status: data.status,
      }));
    }
    // Return the full row including driver profile for a complete API response.
    const [withDriver] = await selectUserWithDriver(tx, eq(users.id, created.id)).limit(1);
    const customerIdsAfterSave = await loadCustomerIds(tx, created.id, created.customerId);
    const businessUnitIdsAfterSave = await loadBusinessUnitIds(tx, created.id);
    const shipmentIdsAfterSave = await loadShipmentIds(tx, created.id);
    return addScopeIds(withDriver, customerIdsAfterSave, businessUnitIdsAfterSave, shipmentIdsAfterSave);
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
  customerId?: number | null;
  customerIds?: number[] | null;
  businessUnitIds?: number[] | null;
  shipmentIds?: number[] | null;
  /** If true, throws 403 when target user is not DRIVER — used for accountant scoping. */
  requireDriverTarget?: boolean;
  assignmentAdminOnly?: boolean;
}) {
  // Hash password outside transaction — CPU-intensive work should not hold a DB connection.
  const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ role: users.role, customerId: users.customerId, status: users.status }).from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt))).limit(1).for('update');
    if (!existing) throw new ApiError(404, 'Không tìm thấy người dùng');

    // Driver-target check inside the transaction to avoid TOCTOU race.
    if (data.requireDriverTarget && existing.role !== Role.DRIVER) {
      throw new ApiError(403, 'Kế toán chỉ có thể chỉnh sửa lái xe');
    }

    const effectiveRole = data.role ?? existing.role;
    const effectiveStatus = data.status ?? existing.status;
    const explicitCustomerLinkUpdate = hasExplicitCustomerScopeInput(data);
    const existingCustomerIds = await loadCustomerIds(tx, id, existing.customerId);
    const explicitBusinessUnitUpdate = data.businessUnitIds !== undefined;
    const explicitShipmentUpdate = data.shipmentIds !== undefined;
    const existingBusinessUnitIds = await loadBusinessUnitIds(tx, id);
    const existingShipmentIds = await loadShipmentIds(tx, id);
    let nextCustomerIds = existingCustomerIds;
    let nextBusinessUnitIds = existingBusinessUnitIds;
    let nextShipmentIds = existingShipmentIds;

    if (
      effectiveRole !== Role.CUSTOMER
      && effectiveRole !== Role.CLERK
      && effectiveRole !== Role.ACCOUNTANT
    ) {
      if (explicitCustomerLinkUpdate && normalizeCustomerIds(data).length > 0) {
        throw new ApiError(400, 'Chỉ tài khoản khách hàng, nhân viên chứng từ hoặc kế toán mới được liên kết khách hàng');
      }
      if (explicitBusinessUnitUpdate && (data.businessUnitIds ?? []).length > 0) {
        throw new ApiError(400, 'Chỉ nhân viên chứng từ mới được liên kết đơn vị phụ trách');
      }
      if (explicitShipmentUpdate && (data.shipmentIds ?? []).length > 0) {
        throw new ApiError(400, 'Chỉ nhân viên chứng từ mới được liên kết lô hàng');
      }
      nextCustomerIds = [];
      nextBusinessUnitIds = [];
      nextShipmentIds = [];
    } else if (effectiveRole === Role.CUSTOMER) {
      nextBusinessUnitIds = [];
      nextShipmentIds = [];
      if (explicitCustomerLinkUpdate) {
        nextCustomerIds = normalizeCustomerIds(data);
        if (effectiveStatus !== 'INACTIVE' && nextCustomerIds.length === 0) {
          throw new ApiError(400, 'Tài khoản khách hàng ACTIVE phải có ít nhất một khách hàng liên kết');
        }
        await validateCustomerIds(tx, nextCustomerIds);
      } else if (effectiveStatus !== 'INACTIVE' && nextCustomerIds.length === 0) {
        throw new ApiError(400, 'Tài khoản khách hàng ACTIVE phải có ít nhất một khách hàng liên kết');
      }
    } else if (effectiveRole === Role.ACCOUNTANT) {
      nextBusinessUnitIds = [];
      nextShipmentIds = [];
      if (explicitBusinessUnitUpdate && (data.businessUnitIds ?? []).length > 0) {
        throw new ApiError(400, 'Kế toán chỉ được liên kết phạm vi khách hàng');
      }
      if (explicitShipmentUpdate && (data.shipmentIds ?? []).length > 0) {
        throw new ApiError(400, 'Kế toán chỉ được liên kết phạm vi khách hàng');
      }
      if (data.assignmentAdminOnly && explicitCustomerLinkUpdate) {
        throw new ApiError(403, 'Chỉ quản trị viên mới có thể quản lý phạm vi khách hàng của kế toán');
      }
      if (explicitCustomerLinkUpdate) {
        nextCustomerIds = normalizeCustomerIds(data);
        await validateCustomerIds(tx, nextCustomerIds);
      }
    } else {
      if (data.assignmentAdminOnly && (explicitCustomerLinkUpdate || explicitBusinessUnitUpdate || explicitShipmentUpdate)) {
        throw new ApiError(403, 'Chỉ quản trị viên mới có thể quản lý phạm vi nhân viên chứng từ');
      }
      if (explicitCustomerLinkUpdate) {
        nextCustomerIds = normalizeCustomerIds(data);
        await validateCustomerIds(tx, nextCustomerIds);
      }
      if (explicitBusinessUnitUpdate) {
        nextBusinessUnitIds = [...new Set((data.businessUnitIds ?? []).filter((value): value is number => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
        await validateBusinessUnitIds(tx, nextBusinessUnitIds);
      }
      if (explicitShipmentUpdate) {
        nextShipmentIds = [...new Set((data.shipmentIds ?? []).filter((value): value is number => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
      }
      await validateShipmentIds(tx, nextShipmentIds, nextBusinessUnitIds);
      const existingActiveLegacyClerk = existing.role === Role.CLERK
        && existing.status !== 'INACTIVE'
        && !hasActiveClerkScope(existingBusinessUnitIds, existingCustomerIds, existingShipmentIds);
      const scopeOrRoleTouched = explicitCustomerLinkUpdate
        || explicitBusinessUnitUpdate
        || explicitShipmentUpdate
        || data.role !== undefined
        || data.status !== undefined;
      if (effectiveStatus !== 'INACTIVE' && (!existingActiveLegacyClerk || scopeOrRoleTouched)) {
        // Share-lock the active units before committing an ACTIVE clerk state.
        // Business-unit deactivation takes a row update lock, so concurrent
        // assignment/activation cannot validate against a unit being retired.
        await validateBusinessUnitIds(tx, nextBusinessUnitIds);
        assertActiveClerkScope(nextBusinessUnitIds, nextCustomerIds, nextShipmentIds);
      }
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (data.role !== undefined) updates.role = data.role as (typeof users.role.enumValues)[number];
    if (data.status !== undefined) updates.status = data.status;
    if (passwordHash) updates.passwordHash = passwordHash;
    if (data.username !== undefined) updates.username = data.username;
    if (data.fullName !== undefined) updates.fullName = data.fullName || null;
    if (data.email !== undefined) updates.email = data.email || null;
    if (data.phone !== undefined) updates.phone = data.phone || null;
    updates.customerId = effectiveRole === Role.CUSTOMER || effectiveRole === Role.CLERK ? nextCustomerIds[0] ?? null : null;

    const [updated] = await tx.update(users).set(updates)
      .where(eq(users.id, id)).returning(USER_FIELDS);
    await syncCustomerLinks(tx, id, nextCustomerIds);
    await syncBusinessUnitLinks(tx, id, effectiveRole === Role.CLERK ? nextBusinessUnitIds : []);
    await syncShipmentLinks(tx, id, effectiveRole === Role.CLERK ? nextShipmentIds : []);

    // Upsert the linked driver profile when the resulting role is DRIVER.
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
    const customerIdsAfterSave = await loadCustomerIds(tx, id, withDriver.customerId);
    const businessUnitIdsAfterSave = await loadBusinessUnitIds(tx, id);
    const shipmentIdsAfterSave = await loadShipmentIds(tx, id);
    return addScopeIds(withDriver, customerIdsAfterSave, businessUnitIdsAfterSave, shipmentIdsAfterSave);
  });
}

/** Soft-delete a user and its linked driver profile (if any). */
export async function deleteUser(id: number, currentUserId: number) {
  if (id === currentUserId) throw new ApiError(400, 'Không thể xóa tài khoản đang đăng nhập');
  await db.transaction(async (tx) => {
    await tx.update(users).set({ deletedAt: sql`now()`, status: 'INACTIVE' }).where(eq(users.id, id));
    await tx.update(drivers).set({ deletedAt: sql`now()`, status: 'INACTIVE' })
      .where(and(eq(drivers.userId, id), isNull(drivers.deletedAt)));
    await tx.delete(userBusinessUnitLinks).where(eq(userBusinessUnitLinks.userId, id));
    await tx.delete(userShipmentLinks).where(eq(userShipmentLinks.userId, id));
  });
}

/** Get current user profile (including driver profile if DRIVER role). */
export async function getUserProfile(userId: number) {
  const [user] = await db.select(USER_FIELDS).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new ApiError(404, 'Không tìm thấy người dùng');
  const customerIds = await loadCustomerIds(db, userId, user.customerId);
  const businessUnitIds = await loadBusinessUnitIds(db, userId);
  const shipmentIds = await loadShipmentIds(db, userId);
  const userWithLinks = addScopeIds(user, customerIds, businessUnitIds, shipmentIds);

  if (user.role === 'DRIVER') {
    const [driver] = await db.select().from(drivers)
      .where(and(eq(drivers.userId, user.id), isNull(drivers.deletedAt))).limit(1);
    return { ...userWithLinks, driver: driver || null };
  }
  return userWithLinks;
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

export async function listBusinessUnits() {
  return db.select({
    id: businessUnits.id,
    code: businessUnits.code,
    name: businessUnits.name,
    status: businessUnits.status,
    createdAt: businessUnits.createdAt,
    updatedAt: businessUnits.updatedAt,
  }).from(businessUnits)
    .orderBy(businessUnits.name);
}

export async function createBusinessUnit(data: { code?: string | null; name: string; status?: string }) {
  try {
    const [created] = await db.insert(businessUnits).values({
      code: data.code?.trim() || null,
      name: data.name.trim(),
      status: data.status ?? 'ACTIVE',
    }).returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'Mã hoặc tên đơn vị phụ trách đã tồn tại');
    }
    throw err;
  }
}

export async function updateBusinessUnit(
  id: number,
  data: { code?: string | null; name?: string; status?: string },
) {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select()
        .from(businessUnits)
        .where(eq(businessUnits.id, id))
        .for('update')
        .limit(1);
      if (!existing) throw new ApiError(404, 'Không tìm thấy đơn vị phụ trách');

      if (data.status === 'INACTIVE' && existing.status !== 'INACTIVE') {
        const affectedClerks = await tx.select({ userId: users.id })
          .from(userBusinessUnitLinks)
          .innerJoin(users, eq(userBusinessUnitLinks.userId, users.id))
          .where(and(
            eq(userBusinessUnitLinks.businessUnitId, id),
            eq(users.role, Role.CLERK),
            eq(users.status, 'ACTIVE'),
            isNull(users.deletedAt),
          ));
        const affectedUserIds = [...new Set(affectedClerks.map((row) => row.userId))];
        if (affectedUserIds.length > 0) {
          // Different unit rows do not contend with each other. Serialize the
          // invariant by affected clerk so two concurrent deactivations cannot
          // each count the other's unit as the remaining ACTIVE assignment.
          for (const userId of affectedUserIds.sort((left, right) => left - right)) {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(6120, ${userId})`);
          }
          const alternativeRows = await tx.select({ userId: userBusinessUnitLinks.userId })
            .from(userBusinessUnitLinks)
            .innerJoin(businessUnits, eq(userBusinessUnitLinks.businessUnitId, businessUnits.id))
            .where(and(
              inArray(userBusinessUnitLinks.userId, affectedUserIds),
              ne(userBusinessUnitLinks.businessUnitId, id),
              eq(businessUnits.status, 'ACTIVE'),
            ));
          const usersWithAlternative = new Set(alternativeRows.map((row) => row.userId));
          if (affectedUserIds.some((userId) => !usersWithAlternative.has(userId))) {
            throw new ApiError(
              409,
              'Không thể ngưng đơn vị đang là đơn vị hoạt động duy nhất của nhân viên chứng từ ACTIVE',
            );
          }
        }
      }

      const updates: Record<string, unknown> = { updatedAt: sql`now()` };
      if (data.code !== undefined) updates.code = data.code?.trim() || null;
      if (data.name !== undefined) updates.name = data.name.trim();
      if (data.status !== undefined) updates.status = data.status;
      const [updated] = await tx.update(businessUnits).set(updates)
        .where(eq(businessUnits.id, id))
        .returning();
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, 'Mã hoặc tên đơn vị phụ trách đã tồn tại');
    }
    throw err;
  }
}
