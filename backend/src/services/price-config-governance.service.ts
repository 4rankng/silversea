import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { cacheInvalidate } from '../lib/redis';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-transition.service';
import type { Tx } from './trip-shared';

type PricingTableCreateInput = {
  customerId: number;
  routeId: number;
  price: number | string;
  effectiveDate?: string;
};

type PricingTableUpdateInput = Partial<PricingTableCreateInput>;
type PricingTableMutationPayload = {
  customerId: number;
  routeId: number;
  price: string;
  effectiveDate: string;
};
type PricingTableMutationPatch = Partial<PricingTableMutationPayload>;
type MutationKind = 'CREATE' | 'UPDATE' | 'DELETE';

type SnapshotEnvelope = {
  resource: 'pricing-tables';
  fingerprint: string | null;
  row: Record<string, unknown> | null;
};

type DeltaEnvelope = {
  resource: 'pricing-tables';
  operation: MutationKind;
};

type AfterEnvelope = {
  resource: 'pricing-tables';
  data: Record<string, unknown> | null;
};

const pricingTableMutationPayloadSchema = z.object({
  customerId: z.number().int().positive(),
  routeId: z.number().int().positive(),
  price: z.string().min(1),
  effectiveDate: z.string().min(1),
});

const pricingTableMutationPatchSchema = pricingTableMutationPayloadSchema.partial();

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    throw new ApiError(400, 'Lý do thay đổi bảng giá là bắt buộc');
  }
  return normalized;
}

function requireExpectedVersion(expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    throw new ApiError(400, 'expectedVersion không hợp lệ');
  }
}

function defaultEffectiveDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizePricingTableCreate(data: PricingTableCreateInput): PricingTableMutationPayload {
  return {
    customerId: data.customerId,
    routeId: data.routeId,
    price: `${data.price}`,
    effectiveDate: data.effectiveDate ?? defaultEffectiveDate(),
  };
}

function normalizePricingTableUpdate(data: PricingTableUpdateInput): PricingTableMutationPatch {
  const normalized: PricingTableMutationPatch = {};
  if (data.customerId !== undefined) normalized.customerId = data.customerId;
  if (data.routeId !== undefined) normalized.routeId = data.routeId;
  if (data.price !== undefined) normalized.price = `${data.price}`;
  if (data.effectiveDate !== undefined) normalized.effectiveDate = data.effectiveDate;
  return normalized;
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function fingerprint(value: unknown): string | null {
  if (value == null) return null;
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function pricingTableVersion(row: typeof s.pricingTables.$inferSelect): number {
  return Math.max(1, Math.floor(row.updatedAt.getTime() / 1000));
}

function snapshotEnvelope(row: typeof s.pricingTables.$inferSelect | null): SnapshotEnvelope {
  const plain = toPlainRecord(row);
  return {
    resource: 'pricing-tables',
    fingerprint: fingerprint(plain),
    row: plain,
  };
}

function createSubjectKey(data: PricingTableMutationPayload): string {
  return `pricing-tables:${createHash('sha1').update(JSON.stringify(data)).digest('hex')}`;
}

function parseCreatePayload(data: Record<string, unknown>): PricingTableMutationPayload {
  const parsed = pricingTableMutationPayloadSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(409, 'Yêu cầu tạo bảng giá thiếu dữ liệu hợp lệ');
  }
  return parsed.data;
}

function parseUpdatePayload(data: Record<string, unknown>): PricingTableMutationPatch {
  const parsed = pricingTableMutationPatchSchema.safeParse(data);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new ApiError(409, 'Yêu cầu cập nhật bảng giá thiếu dữ liệu áp dụng');
  }
  return parsed.data;
}

function uniqueConstraintError(err: unknown): ApiError | null {
  const error = err as { code?: string; detail?: string; cause?: { code?: string; detail?: string } };
  const code = error.code ?? error.cause?.code;
  if (code !== '23505') return null;
  return new ApiError(409, 'Bảng giá đã tồn tại cho khách hàng, tuyến và ngày hiệu lực này');
}

async function lockPricingTable(
  tx: Tx,
  pricingTableId: number,
): Promise<typeof s.pricingTables.$inferSelect> {
  const [row] = await tx.select()
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.id, pricingTableId),
      isNull(s.pricingTables.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy bảng giá');
  }
  return row;
}

function parseSnapshot(action: GovernanceActionRow): SnapshotEnvelope {
  const snapshot = action.beforeSnapshot as Partial<SnapshotEnvelope> | null;
  if (snapshot?.resource !== 'pricing-tables') {
    throw new ApiError(409, 'Yêu cầu quản trị không thuộc bảng giá');
  }
  return {
    resource: 'pricing-tables',
    fingerprint: typeof snapshot.fingerprint === 'string' ? snapshot.fingerprint : null,
    row: snapshot.row && typeof snapshot.row === 'object'
      ? snapshot.row as Record<string, unknown>
      : null,
  };
}

function parseAfter(action: GovernanceActionRow): AfterEnvelope {
  const after = action.afterSnapshot as Partial<AfterEnvelope> | null;
  if (after?.resource !== 'pricing-tables') {
    throw new ApiError(409, 'Yêu cầu quản trị không thuộc bảng giá');
  }
  return {
    resource: 'pricing-tables',
    data: after.data && typeof after.data === 'object'
      ? after.data as Record<string, unknown>
      : null,
  };
}

function parseDelta(action: GovernanceActionRow): DeltaEnvelope {
  const delta = action.deltaSnapshot as Partial<DeltaEnvelope> | null;
  if (delta?.resource !== 'pricing-tables') {
    throw new ApiError(409, 'Yêu cầu quản trị không thuộc bảng giá');
  }
  if (delta.operation !== 'CREATE' && delta.operation !== 'UPDATE' && delta.operation !== 'DELETE') {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu thao tác hợp lệ');
  }
  return {
    resource: 'pricing-tables',
    operation: delta.operation,
  };
}

async function insertGovernanceAction(
  tx: Tx,
  values: Omit<typeof s.governanceActions.$inferInsert, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>,
) {
  const [action] = await tx.insert(s.governanceActions).values(values).returning();
  return action;
}

export async function requestPricingTableCreate(input: {
  data: PricingTableCreateInput;
  reason: string;
  makerId: number;
  makerRole: string;
}) {
  assertCanMakeGovernanceAction('PRICE_CONFIG_CHANGE', input.makerRole);
  const reason = requireReason(input.reason);
  const proposed = normalizePricingTableCreate(input.data);
  return db.transaction(async (tx) => insertGovernanceAction(tx, {
    subjectType: 'PRICE_CONFIG',
    subjectId: null,
    subjectKey: createSubjectKey(proposed),
    actionKind: 'PRICE_CONFIG_CHANGE',
    reason,
    originalVersion: 0,
    beforeSnapshot: snapshotEnvelope(null),
    afterSnapshot: {
      resource: 'pricing-tables',
      data: proposed,
    },
    deltaSnapshot: {
      resource: 'pricing-tables',
      operation: 'CREATE',
    },
    makerId: input.makerId,
    makerRole: input.makerRole,
  }));
}

export async function requestPricingTableUpdate(input: {
  pricingTableId: number;
  data: PricingTableUpdateInput;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedVersion: number;
}) {
  assertCanMakeGovernanceAction('PRICE_CONFIG_CHANGE', input.makerRole);
  const reason = requireReason(input.reason);
  requireExpectedVersion(input.expectedVersion);
  const proposed = normalizePricingTableUpdate(input.data);
  if (Object.keys(proposed).length === 0) {
    throw new ApiError(400, 'Không có thay đổi để trình duyệt');
  }
  return db.transaction(async (tx) => {
    const row = await lockPricingTable(tx, input.pricingTableId);
    if (pricingTableVersion(row) !== input.expectedVersion) {
      throw new ApiError(409, 'Bảng giá đã được thay đổi. Vui lòng tải lại.');
    }
    return insertGovernanceAction(tx, {
      subjectType: 'PRICE_CONFIG',
      subjectId: row.id,
      subjectKey: null,
      actionKind: 'PRICE_CONFIG_CHANGE',
      reason,
      originalVersion: input.expectedVersion,
      beforeSnapshot: snapshotEnvelope(row),
      afterSnapshot: {
        resource: 'pricing-tables',
        data: proposed,
      },
      deltaSnapshot: {
        resource: 'pricing-tables',
        operation: 'UPDATE',
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  });
}

export async function requestPricingTableDelete(input: {
  pricingTableId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedVersion: number;
}) {
  assertCanMakeGovernanceAction('PRICE_CONFIG_CHANGE', input.makerRole);
  const reason = requireReason(input.reason);
  requireExpectedVersion(input.expectedVersion);
  return db.transaction(async (tx) => {
    const row = await lockPricingTable(tx, input.pricingTableId);
    if (pricingTableVersion(row) !== input.expectedVersion) {
      throw new ApiError(409, 'Bảng giá đã được thay đổi. Vui lòng tải lại.');
    }
    return insertGovernanceAction(tx, {
      subjectType: 'PRICE_CONFIG',
      subjectId: row.id,
      subjectKey: null,
      actionKind: 'PRICE_CONFIG_CHANGE',
      reason,
      originalVersion: input.expectedVersion,
      beforeSnapshot: snapshotEnvelope(row),
      afterSnapshot: {
        resource: 'pricing-tables',
        data: null,
      },
      deltaSnapshot: {
        resource: 'pricing-tables',
        operation: 'DELETE',
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  });
}

export async function applyPriceConfigGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (action.subjectType !== 'PRICE_CONFIG' || action.actionKind !== 'PRICE_CONFIG_CHANGE') {
    throw new ApiError(409, 'Yêu cầu quản trị không thuộc cấu hình giá');
  }

  const delta = parseDelta(action);
  const before = parseSnapshot(action);
  const after = parseAfter(action);

  if (delta.operation === 'CREATE') {
    if (!after.data) {
      throw new ApiError(409, 'Yêu cầu tạo bảng giá thiếu dữ liệu áp dụng');
    }
    const payload = parseCreatePayload(after.data);
    let created: typeof s.pricingTables.$inferSelect;
    try {
      [created] = await tx.insert(s.pricingTables).values(payload).returning();
    } catch (err) {
      const normalized = uniqueConstraintError(err);
      if (normalized) throw normalized;
      throw err;
    }
    await tx.update(s.governanceActions)
      .set({
        subjectId: created.id,
        updatedAt: new Date(),
      })
      .where(eq(s.governanceActions.id, action.id));
    await cacheInvalidate('catalogs:bootstrap');
    return {
      applicationResult: {
        resource: 'pricing-tables',
        operation: 'CREATE',
        subjectId: created.id,
        resultingVersion: pricingTableVersion(created),
      },
    };
  }

  if (action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu bảng giá gốc');
  }

  const row = await lockPricingTable(tx, action.subjectId);
  const currentSnapshot = snapshotEnvelope(row);
  if (currentSnapshot.fingerprint !== before.fingerprint || pricingTableVersion(row) !== action.originalVersion) {
    throw new ApiError(409, 'Bảng giá gốc đã thay đổi; yêu cầu này không thể áp dụng');
  }

  if (delta.operation === 'UPDATE') {
    if (!after.data || Object.keys(after.data).length === 0) {
      throw new ApiError(409, 'Yêu cầu cập nhật bảng giá thiếu dữ liệu áp dụng');
    }
    const patch = parseUpdatePayload(after.data);
    let updated: typeof s.pricingTables.$inferSelect;
    try {
      [updated] = await tx.update(s.pricingTables)
        .set({
          ...patch,
          updatedAt: new Date(),
        })
        .where(eq(s.pricingTables.id, row.id))
        .returning();
    } catch (err) {
      const normalized = uniqueConstraintError(err);
      if (normalized) throw normalized;
      throw err;
    }
    await cacheInvalidate('catalogs:bootstrap');
    return {
      applicationResult: {
        resource: 'pricing-tables',
        operation: 'UPDATE',
        subjectId: updated.id,
        resultingVersion: pricingTableVersion(updated),
      },
    };
  }

  const [deleted] = await tx.update(s.pricingTables)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(s.pricingTables.id, row.id))
    .returning();
  await cacheInvalidate('catalogs:bootstrap');
  return {
    applicationResult: {
      resource: 'pricing-tables',
      operation: 'DELETE',
      subjectId: deleted!.id,
      resultingVersion: pricingTableVersion(deleted!),
    },
  };
}
