import { and, eq, inArray, isNull } from 'drizzle-orm';

import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import {
  lockApplicationOwnedUniqueness,
  lockApplicationOwnedUniquenessSet,
} from './application-owned-uniqueness.service';

type RowLockMode = 'share' | 'update';

function normalizePositiveIds(ids: readonly number[]): number[] {
  return [...new Set(
    ids.filter((id): id is number => Number.isInteger(id) && id > 0),
  )].sort((left, right) => left - right);
}

async function lockSingleRowScope(tx: Tx, scope: string, id: number): Promise<void> {
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'ID liên kết không hợp lệ.');
  }
  await lockApplicationOwnedUniqueness(tx, scope, [id]);
}

async function lockRowSetScope(tx: Tx, scope: string, ids: readonly number[]): Promise<number[]> {
  const normalized = normalizePositiveIds(ids);
  if (normalized.length === 0) return normalized;
  await lockApplicationOwnedUniquenessSet(
    tx,
    normalized.map((id) => ({ scope, parts: [id] })),
  );
  return normalized;
}

export async function lockActiveCustomerIds(
  tx: Tx,
  customerIds: readonly number[],
  message = 'Khách hàng liên kết không tồn tại',
): Promise<number[]> {
  const ids = await lockRowSetScope(tx, 'relationship.customer', customerIds);
  if (ids.length === 0) return ids;
  const rows = await tx.select({ id: s.customers.id }).from(s.customers)
    .where(and(
      inArray(s.customers.id, ids),
      isNull(s.customers.deletedAt),
    ))
    .for('share');
  if (rows.length !== ids.length) {
    throw new ApiError(400, message);
  }
  return ids;
}

export async function lockActiveBusinessUnitIds(
  tx: Tx,
  businessUnitIds: readonly number[],
  message = 'Đơn vị phụ trách liên kết không tồn tại hoặc đã ngưng dùng',
): Promise<number[]> {
  const ids = await lockRowSetScope(tx, 'relationship.business-unit', businessUnitIds);
  if (ids.length === 0) return ids;
  const rows = await tx.select({ id: s.businessUnits.id }).from(s.businessUnits)
    .where(and(
      inArray(s.businessUnits.id, ids),
      eq(s.businessUnits.status, 'ACTIVE'),
    ))
    .for('share');
  if (rows.length !== ids.length) {
    throw new ApiError(400, message);
  }
  return ids;
}

export async function lockShipmentRows(
  tx: Tx,
  shipmentIds: readonly number[],
): Promise<Array<{
  id: number;
  responsibleUnitId: number | null;
  status: typeof s.shipments.$inferSelect.status;
}>> {
  const ids = await lockRowSetScope(tx, 'relationship.shipment', shipmentIds);
  if (ids.length === 0) return [];
  const rows = await tx.select({
    id: s.shipments.id,
    responsibleUnitId: s.shipments.responsibleUnitId,
    status: s.shipments.status,
  }).from(s.shipments)
    .where(and(
      inArray(s.shipments.id, ids),
      isNull(s.shipments.deletedAt),
    ))
    .for('share');
  if (rows.length !== ids.length) {
    throw new ApiError(400, 'Lô hàng liên kết không tồn tại');
  }
  return rows;
}

export async function lockUserRowForUpdate(
  tx: Tx,
  userId: number,
  notFoundMessage = 'Không tìm thấy tài khoản',
): Promise<typeof s.users.$inferSelect> {
  await lockSingleRowScope(tx, 'relationship.user', userId);
  const [row] = await tx.select().from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new ApiError(404, notFoundMessage);
  }
  return row;
}

export async function lockDriverRowForUpdate(
  tx: Tx,
  driverId: number,
  notFoundMessage = 'Không tìm thấy hồ sơ tài xế',
): Promise<typeof s.drivers.$inferSelect> {
  await lockSingleRowScope(tx, 'relationship.driver', driverId);
  const [row] = await tx.select().from(s.drivers)
    .where(eq(s.drivers.id, driverId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new ApiError(404, notFoundMessage);
  }
  return row;
}

export async function lockTruckRow(
  tx: Tx,
  truckId: number,
  options: { mode?: RowLockMode; notFoundMessage?: string } = {},
): Promise<typeof s.trucks.$inferSelect> {
  await lockSingleRowScope(tx, 'relationship.truck', truckId);
  const query = tx.select().from(s.trucks)
    .where(eq(s.trucks.id, truckId))
    .limit(1);
  const rows = options.mode === 'update'
    ? await query.for('update')
    : await query.for('share');
  const [row] = rows;
  if (!row) {
    throw new ApiError(404, options.notFoundMessage ?? 'Không tìm thấy xe đầu kéo');
  }
  return row;
}

export async function lockTrailerRow(
  tx: Tx,
  trailerId: number,
  options: { mode?: RowLockMode; notFoundMessage?: string } = {},
): Promise<typeof s.trailers.$inferSelect> {
  await lockSingleRowScope(tx, 'relationship.trailer', trailerId);
  const query = tx.select().from(s.trailers)
    .where(eq(s.trailers.id, trailerId))
    .limit(1);
  const rows = options.mode === 'update'
    ? await query.for('update')
    : await query.for('share');
  const [row] = rows;
  if (!row) {
    throw new ApiError(404, options.notFoundMessage ?? 'Không tìm thấy rơ-moóc');
  }
  return row;
}

export async function lockSupplierRow(
  tx: Tx,
  supplierId: number,
  options: { mode?: RowLockMode; notFoundMessage?: string } = {},
): Promise<typeof s.suppliers.$inferSelect> {
  await lockSingleRowScope(tx, 'relationship.supplier', supplierId);
  const query = tx.select().from(s.suppliers)
    .where(eq(s.suppliers.id, supplierId))
    .limit(1);
  const rows = options.mode === 'update'
    ? await query.for('update')
    : await query.for('share');
  const [row] = rows;
  if (!row) {
    throw new ApiError(404, options.notFoundMessage ?? 'Không tìm thấy nhà cung cấp');
  }
  return row;
}

export async function cascadeDeleteUserLinks(tx: Tx, userId: number): Promise<void> {
  await tx.delete(s.userCustomerLinks).where(eq(s.userCustomerLinks.userId, userId));
  await tx.delete(s.userBusinessUnitLinks).where(eq(s.userBusinessUnitLinks.userId, userId));
  await tx.delete(s.userShipmentLinks).where(eq(s.userShipmentLinks.userId, userId));
}
