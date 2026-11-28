import { and, eq, isNull, ne } from 'drizzle-orm';
import { Role } from '@tingting/shared';


import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { AuthUser } from '../middleware/auth';
import {
  lockDriverRowForUpdate,
  lockUserRowForUpdate,
} from './application-relationship.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';
import { runIdempotent } from './idempotency.service';

export const DRIVER_USER_BIND_ENDPOINT = 'config.driver-user-bindings.bind';
export const DRIVER_USER_UNBIND_ENDPOINT = 'config.driver-user-bindings.unbind';

export interface DriverUserBindingDto {
  driverId: number;
  userId: number;
  version: number;
  updatedAt: string;
}

/** Hủy liên kết result — `userId` is always null (the link is gone). */
export interface DriverUserUnbindingDto {
  driverId: number;
  userId: null;
  version: number;
  updatedAt: string;
}

export function driverUserBindingVersion(updatedAt: Date): number {
  return Math.max(1, updatedAt.getTime());
}

function requireAdmin(actor: Pick<AuthUser, 'role'>): void {
  if (actor.role !== Role.ADMIN) throw new ApiError(403, 'Chỉ Quản trị viên được liên kết tài khoản tài xế.');
}

function validatePositiveInteger(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ApiError(400, `${label} không hợp lệ.`);
  }
}

/**
 * Pure bind guards — the QA 28/11 "five orders undeliverable" cluster's
 * link/unlink service path, testable without a db (tsx --test unit-only
 * ruling): the transaction bodies call these and unit tests pin every
 * refusal shape + message. Message precedence is contractual (the earlier
 * broken setup wins) — keep the order when extending.
 */
export function assertDriverBindable(
  driver: { status: string | null; deletedAt: Date | null; updatedAt: Date },
  user: { status: string; role: string; deletedAt: Date | null },
  expectedVersion: number,
  otherBindingName?: string | null,
): void {
  if (driver.deletedAt != null) {
    throw new ApiError(404, 'Không tìm thấy hồ sơ tài xế đang sử dụng.');
  }
  if (driver.status !== 'ACTIVE') {
    throw new ApiError(409, 'Hồ sơ tài xế đang ngưng hoạt động; hãy kích hoạt lại trước khi liên kết.');
  }
  if (driverUserBindingVersion(driver.updatedAt) !== expectedVersion) {
    throw new ApiError(409, 'Hồ sơ tài xế đã thay đổi. Vui lòng tải lại trước khi liên kết.');
  }
  if (user.deletedAt != null) {
    throw new ApiError(404, 'Không tìm thấy tài khoản đang sử dụng.');
  }
  if (user.status !== 'ACTIVE') {
    throw new ApiError(409, 'Tài khoản đang ngưng hoạt động; hãy kích hoạt lại trước khi liên kết.');
  }
  if (user.role !== Role.DRIVER) {
    throw new ApiError(409, 'Tài khoản phải có đúng vai trò Tài xế (DRIVER).');
  }
  if (otherBindingName != null) {
    throw new ApiError(409, `Tài khoản đã được liên kết với tài xế "${otherBindingName}"; hãy chọn tài khoản DRIVER chưa được liên kết.`);
  }
}

/** Unbind accepts a deactivated profile (clearing a stale link is maintenance);
 *  it refuses only deleted rows and stale versions. */
export function assertDriverUnbindable(
  driver: { deletedAt: Date | null; updatedAt: Date },
  expectedVersion: number,
): void {
  if (driver.deletedAt != null) {
    throw new ApiError(404, 'Không tìm thấy hồ sơ tài xế đang sử dụng.');
  }
  if (driverUserBindingVersion(driver.updatedAt) !== expectedVersion) {
    throw new ApiError(409, 'Hồ sơ tài xế đã thay đổi. Vui lòng tải lại trước khi hủy liên kết.');
  }
}

function bindingDto(row: Pick<typeof s.drivers.$inferSelect, 'id' | 'userId' | 'updatedAt'>): DriverUserBindingDto {
  if (row.userId == null) throw new Error('Driver-user binding result is missing userId');
  return {
    driverId: row.id,
    userId: row.userId,
    version: driverUserBindingVersion(row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function bindDriverUser(input: {
  driverId: number;
  userId: number;
  expectedVersion: number;
  idempotencyKey: string | undefined;
  actor: Pick<AuthUser, 'userId' | 'role'>;
}): Promise<{ result: DriverUserBindingDto; replayed: boolean; statusCode: number }> {
  requireAdmin(input.actor);
  validatePositiveInteger(input.driverId, 'ID tài xế', 2_147_483_647);
  validatePositiveInteger(input.userId, 'ID tài khoản', 2_147_483_647);
  validatePositiveInteger(input.expectedVersion, 'expectedVersion');

  return runIdempotent<DriverUserBindingDto>({
    endpoint: DRIVER_USER_BIND_ENDPOINT,
    idempotencyKey: input.idempotencyKey,
    payload: {
      driverId: input.driverId,
      userId: input.userId,
      expectedVersion: input.expectedVersion,
    },
    createdBy: input.actor.userId,
    entityType: 'driver',
    getEntityId: (result) => result.driverId,
    create: async (tx) => {
      await lockApplicationOwnedUniquenessSet(tx, [
        { scope: 'driver-user-binding.driver', parts: [input.driverId] },
        { scope: 'driver-user-binding.user', parts: [input.userId] },
      ]);

      const driver = await lockDriverRowForUpdate(tx, input.driverId, 'Không tìm thấy hồ sơ tài xế đang sử dụng.');
      const user = await lockUserRowForUpdate(tx, input.userId, 'Không tìm thấy tài khoản đang sử dụng.');

      const [otherBinding] = await tx.select({
        id: s.drivers.id,
        name: s.drivers.name,
      }).from(s.drivers).where(and(
        eq(s.drivers.userId, input.userId),
        ne(s.drivers.id, input.driverId),
        isNull(s.drivers.deletedAt),
      )).limit(1);

      assertDriverBindable(driver, user, input.expectedVersion, otherBinding?.name ?? null);

      if (driver.userId === input.userId) return bindingDto(driver);

      const nextUpdatedAt = new Date(Math.max(
        Date.now(),
        driver.updatedAt.getTime() + 1,
      ));
      const [updated] = await tx.update(s.drivers).set({
        userId: input.userId,
        updatedAt: nextUpdatedAt,
      }).where(eq(s.drivers.id, driver.id)).returning({
        id: s.drivers.id,
        userId: s.drivers.userId,
        updatedAt: s.drivers.updatedAt,
      });
      if (!updated) {
        throw new ApiError(409, 'Hồ sơ tài xế đã thay đổi. Vui lòng tải lại trước khi liên kết.');
      }
      return bindingDto(updated);
    },
  });
}

function unbindingDto(row: Pick<typeof s.drivers.$inferSelect, 'id' | 'updatedAt'>): DriverUserUnbindingDto {
  return {
    driverId: row.id,
    userId: null,
    version: driverUserBindingVersion(row.updatedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Hủy liên kết — clears drivers.userId (QA 28/11: the Users editor must be
 * able to undo a wrong link, not only create one). Same admin-only,
 * version-gated, idempotent contract as bind; an already-unlinked profile
 * replays its current state instead of erroring, so a retried click never
 * surfaces a fake failure.
 */
export async function unbindDriverUser(input: {
  driverId: number;
  expectedVersion: number;
  idempotencyKey: string | undefined;
  actor: Pick<AuthUser, 'userId' | 'role'>;
}): Promise<{ result: DriverUserUnbindingDto; replayed: boolean; statusCode: number }> {
  requireAdmin(input.actor);
  validatePositiveInteger(input.driverId, 'ID tài xế', 2_147_483_647);
  validatePositiveInteger(input.expectedVersion, 'expectedVersion');

  return runIdempotent<DriverUserUnbindingDto>({
    endpoint: DRIVER_USER_UNBIND_ENDPOINT,
    idempotencyKey: input.idempotencyKey,
    payload: {
      driverId: input.driverId,
      expectedVersion: input.expectedVersion,
    },
    createdBy: input.actor.userId,
    entityType: 'driver',
    getEntityId: (result) => result.driverId,
    create: async (tx) => {
      await lockApplicationOwnedUniquenessSet(tx, [
        { scope: 'driver-user-binding.driver', parts: [input.driverId] },
      ]);

      const driver = await lockDriverRowForUpdate(tx, input.driverId, 'Không tìm thấy hồ sơ tài xế đang sử dụng.');
      assertDriverUnbindable(driver, input.expectedVersion);
      if (driver.userId == null) return unbindingDto(driver);

      const nextUpdatedAt = new Date(Math.max(
        Date.now(),
        driver.updatedAt.getTime() + 1,
      ));
      const [updated] = await tx.update(s.drivers).set({
        userId: null,
        updatedAt: nextUpdatedAt,
      }).where(eq(s.drivers.id, driver.id)).returning({
        id: s.drivers.id,
        updatedAt: s.drivers.updatedAt,
      });
      if (!updated) {
        throw new ApiError(409, 'Hồ sơ tài xế đã thay đổi. Vui lòng tải lại trước khi hủy liên kết.');
      }
      return unbindingDto(updated);
    },
  });
}
