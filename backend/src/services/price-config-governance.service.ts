import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { and, eq, getTableName, inArray, isNull, ne, type SQL } from 'drizzle-orm';
import type { AnyPgTable, PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Role } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-transition.service';
import {
  DURABLE_EFFECT_KIND,
  type DurableEffectInput,
} from './durable-effect.service';
import type { Tx } from './trip-shared';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

type MutationKind = 'CREATE' | 'UPDATE' | 'DELETE';
type CrudRow = Record<string, unknown> & { id?: number; updatedAt?: Date | null; deletedAt?: Date | null };
type CrudData = Record<string, unknown>;

type SnapshotEnvelope = {
  resource: string;
  fingerprint: string | null;
  row: Record<string, unknown> | null;
};

type DeltaEnvelope = {
  resource: string;
  operation: MutationKind;
};

type AfterEnvelope = {
  resource: string;
  data: Record<string, unknown> | null;
};

type GovernedResourceBase = {
  resource: string;
  actionKind: 'PRICE_CONFIG_CHANGE';
  subjectType: 'PRICE_CONFIG';
  reasonLabel: string;
};

type GovernedCrudDefinition = GovernedResourceBase & {
  kind: 'crud';
  table: AnyPgTable;
  deleteMode: 'soft' | 'hard';
  beforeCreate?: (data: CrudData, req: Request, tx: Tx) => Promise<CrudData> | CrudData;
  afterCreate?: (item: CrudRow, data: CrudData, req: Request, tx: Tx) => Promise<void> | void;
  beforeUpdate?: (id: number, data: CrudData, req: Request, tx: Tx) => Promise<CrudData> | CrudData;
  afterUpdate?: (item: CrudRow, data: CrudData, req: Request, tx: Tx) => Promise<void> | void;
  beforeDelete?: (id: number, req: Request, tx: Tx) => Promise<void> | void;
  afterDelete?: (id: number, req: Request, tx: Tx) => Promise<void> | void;
};

type GovernedCustomDefinition = GovernedResourceBase & {
  kind: 'custom';
  apply: (
    tx: Tx,
    action: GovernanceActionRow,
    before: SnapshotEnvelope,
    after: AfterEnvelope,
    delta: DeltaEnvelope,
  ) => Promise<GovernanceApplyResult>;
};

type GovernedDefinition = GovernedCrudDefinition | GovernedCustomDefinition;

const governedDefinitions = new Map<string, GovernedDefinition>();

function cacheInvalidateEffect(actionId: number, key: string): DurableEffectInput {
  return {
    kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
    payloadVersion: 1,
    dedupeKey: `cache-invalidate:${key}:governance-action:${actionId}`,
    payload: { key },
  };
}

function column<T extends PgTable>(table: T, key: string): PgColumn {
  return (table as unknown as Record<string, PgColumn>)[key];
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function fingerprint(value: unknown): string | null {
  if (value == null) return null;
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function configVersionFromUpdatedAt(updatedAt: Date): number {
  return Math.max(1, Math.floor(updatedAt.getTime() / 1000));
}

export function governedConfigVersionFromUpdatedAt(updatedAt: Date): number {
  return configVersionFromUpdatedAt(updatedAt);
}

function snapshotEnvelope(resource: string, row: CrudRow | null): SnapshotEnvelope {
  const plain = toPlainRecord(row);
  return {
    resource,
    fingerprint: fingerprint(plain),
    row: plain,
  };
}

export function buildGovernedConfigSnapshot(resource: string, row: CrudRow | null): SnapshotEnvelope {
  return snapshotEnvelope(resource, row);
}

function createSubjectKey(resource: string, data: CrudData): string {
  return `${resource}:${createHash('sha1').update(JSON.stringify(data)).digest('hex')}`;
}

function requireReasonLabel(label: string): string {
  const normalized = label.trim();
  if (!normalized) {
    throw new Error('Governed config resource is missing reasonLabel');
  }
  return normalized;
}

function buildDefaultReason(definition: GovernedResourceBase, operation: MutationKind): string {
  const label = requireReasonLabel(definition.reasonLabel);
  if (operation === 'CREATE') return `Đề nghị tạo ${label}`;
  if (operation === 'UPDATE') return `Đề nghị cập nhật ${label}`;
  return `Đề nghị ngừng áp dụng ${label}`;
}

function resolveReason(
  definition: GovernedResourceBase,
  operation: MutationKind,
  reason: string | undefined,
): string {
  const normalized = reason?.trim() ?? '';
  return normalized || buildDefaultReason(definition, operation);
}

function getDefinition(resource: string): GovernedDefinition {
  const definition = governedDefinitions.get(resource);
  if (!definition) {
    throw new Error(`Governed config resource "${resource}" is not registered`);
  }
  return definition;
}

function getCrudDefinition(resource: string): GovernedCrudDefinition {
  const definition = governedDefinitions.get(resource);
  if (!definition) {
    throw new Error(`Governed config resource "${resource}" is not registered`);
  }
  if (definition.kind !== 'crud') {
    throw new Error(`Governed config resource "${resource}" is not a CRUD resource`);
  }
  return definition;
}

function assertGovernedUpdatedAt(row: CrudRow, resource: string): Date {
  if (!(row.updatedAt instanceof Date)) {
    throw new Error(`Governed config resource "${resource}" returned an invalid updatedAt`);
  }
  return row.updatedAt;
}

async function lockResourceRow(
  tx: Tx,
  definition: GovernedCrudDefinition,
  id: number,
): Promise<CrudRow> {
  const conditions = [eq(column(definition.table, 'id'), id)];
  if ('deletedAt' in definition.table && definition.deleteMode === 'soft') {
    conditions.push(isNull(column(definition.table, 'deletedAt')));
  }
  const [row] = await tx.select()
    .from(definition.table)
    .where(and(...conditions))
    .limit(1)
    .for('update');
  if (!row) {
    throw new ApiError(404, 'Không tìm thấy cấu hình');
  }
  return row as CrudRow;
}

function parseSnapshot(action: GovernanceActionRow): SnapshotEnvelope {
  const snapshot = action.beforeSnapshot as Partial<SnapshotEnvelope> | null;
  if (!snapshot || typeof snapshot.resource !== 'string') {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu cấu hình nguồn');
  }
  return {
    resource: snapshot.resource,
    fingerprint: typeof snapshot.fingerprint === 'string' ? snapshot.fingerprint : null,
    row: snapshot.row && typeof snapshot.row === 'object'
      ? snapshot.row as Record<string, unknown>
      : null,
  };
}

function parseAfter(action: GovernanceActionRow): AfterEnvelope {
  const after = action.afterSnapshot as Partial<AfterEnvelope> | null;
  if (!after || typeof after.resource !== 'string') {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu cấu hình áp dụng');
  }
  return {
    resource: after.resource,
    data: after.data && typeof after.data === 'object'
      ? after.data as Record<string, unknown>
      : null,
  };
}

function parseDelta(action: GovernanceActionRow): DeltaEnvelope {
  const delta = action.deltaSnapshot as Partial<DeltaEnvelope> | null;
  if (!delta || typeof delta.resource !== 'string') {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu thao tác cấu hình');
  }
  if (delta.operation !== 'CREATE' && delta.operation !== 'UPDATE' && delta.operation !== 'DELETE') {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu thao tác hợp lệ');
  }
  return {
    resource: delta.resource,
    operation: delta.operation,
  };
}

function syntheticApprovalRequest(action: GovernanceActionRow): Request {
  return {
    body: {},
    headers: {},
    params: {},
    query: {},
    user: action.approverId == null || action.approverRole == null
      ? undefined
      : {
          userId: action.approverId,
          username: `governance-approver-${action.approverId}`,
          email: null,
          fullName: null,
          role: action.approverRole as Role,
        },
  } as Request;
}

async function insertGovernanceAction(
  tx: Tx,
  values: Omit<typeof s.governanceActions.$inferInsert, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>,
) {
  const identity = values.subjectKey ?? values.subjectId;
  if (identity != null) {
    await lockApplicationOwnedUniqueness(
      tx,
      'active-governance-action',
      [values.subjectType, values.actionKind, values.originalVersion, identity],
    );
    const identityCondition = values.subjectKey != null
      ? eq(s.governanceActions.subjectKey, values.subjectKey)
      : eq(s.governanceActions.subjectId, values.subjectId as number);
    const [existing] = await tx.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, values.subjectType),
        eq(s.governanceActions.actionKind, values.actionKind),
        eq(s.governanceActions.originalVersion, values.originalVersion),
        identityCondition,
        inArray(s.governanceActions.status, [
          'PENDING_CHECK',
          'PENDING_APPROVAL',
          'RETURNED_FOR_EVIDENCE',
        ]),
      ))
      .limit(1);
    if (existing) {
      throw new ApiError(409, 'Đã có yêu cầu quản trị đang xử lý cho cấu hình này');
    }
  }
  const [action] = await tx.insert(s.governanceActions).values(values).returning();
  return action;
}

function canonicalPayloadConditions(
  definition: GovernedCrudDefinition,
  payload: CrudData,
): SQL[] {
  const tableColumns = definition.table as unknown as Record<string, PgColumn>;
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt' || key === 'deletedAt') {
      continue;
    }
    const targetColumn = tableColumns[key];
    if (!targetColumn || value === undefined || (typeof value === 'object' && value !== null && !(value instanceof Date))) {
      continue;
    }
    conditions.push(value === null ? isNull(targetColumn) : eq(targetColumn, value));
  }
  if ('deletedAt' in definition.table && definition.deleteMode === 'soft') {
    conditions.push(isNull(column(definition.table, 'deletedAt')));
  }
  return conditions;
}

async function assertCanonicalConfigAvailable(
  tx: Tx,
  definition: GovernedCrudDefinition,
  payload: CrudData,
  excludeId?: number,
): Promise<void> {
  const conditions = canonicalPayloadConditions(definition, payload);
  if (excludeId != null) {
    conditions.push(ne(column(definition.table, 'id'), excludeId));
  }
  if (conditions.length === 0) return;
  const [existing] = await tx.select({ id: column(definition.table, 'id') })
    .from(definition.table)
    .where(and(...conditions))
    .limit(1);
  if (existing) {
    throw new ApiError(409, 'Cấu hình đã tồn tại');
  }
}

export function registerGovernedCrudResource(
  definition: Omit<GovernedCrudDefinition, 'kind'>,
): void {
  governedDefinitions.set(definition.resource, {
    ...definition,
    kind: 'crud',
  });
}

export function registerGovernedCustomResource(
  definition: Omit<GovernedCustomDefinition, 'kind' | 'actionKind' | 'subjectType'>,
): void {
  governedDefinitions.set(definition.resource, {
    ...definition,
    kind: 'custom',
    actionKind: 'PRICE_CONFIG_CHANGE',
    subjectType: 'PRICE_CONFIG',
  });
}

export async function requestGovernedConfigAction(input: {
  resource: string;
  operation: MutationKind;
  subjectId: number | null;
  subjectKey: string | null;
  originalVersion: number;
  beforeRow: CrudRow | null;
  afterData: CrudData | null;
  reason?: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}) {
  const definition = getDefinition(input.resource);
  assertCanMakeGovernanceAction(definition.actionKind, input.makerRole);
  const reason = resolveReason(definition, input.operation, input.reason);
  const execute = async (tx: Tx) => insertGovernanceAction(tx, {
    subjectType: definition.subjectType,
    subjectId: input.subjectId,
    subjectKey: input.subjectKey,
    actionKind: definition.actionKind,
    reason,
    originalVersion: input.originalVersion,
    beforeSnapshot: snapshotEnvelope(definition.resource, input.beforeRow),
    afterSnapshot: {
      resource: definition.resource,
      data: input.afterData,
    },
    deltaSnapshot: {
      resource: definition.resource,
      operation: input.operation,
    },
    makerId: input.makerId,
    makerRole: input.makerRole,
  });
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function requestGovernedCrudCreate(input: {
  resource: string;
  data: CrudData;
  reason?: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}) {
  return requestGovernedConfigAction({
    resource: input.resource,
    operation: 'CREATE',
    subjectId: null,
    subjectKey: createSubjectKey(input.resource, input.data),
    originalVersion: 0,
    beforeRow: null,
    afterData: input.data,
    reason: input.reason,
    makerId: input.makerId,
    makerRole: input.makerRole,
    transaction: input.transaction,
  });
}

export async function requestGovernedCrudUpdate(input: {
  resource: string;
  id: number;
  data: CrudData;
  reason?: string;
  makerId: number;
  makerRole: string;
  expectedUpdatedAt: Date;
  transaction?: Tx;
}) {
  const definition = getCrudDefinition(input.resource);
  assertCanMakeGovernanceAction(definition.actionKind, input.makerRole);
  const reason = resolveReason(definition, 'UPDATE', input.reason);
  const execute = async (tx: Tx) => {
    const row = await lockResourceRow(tx, definition, input.id);
    const updatedAt = assertGovernedUpdatedAt(row, definition.resource);
    if (updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
    }
    return requestGovernedConfigAction({
      resource: definition.resource,
      operation: 'UPDATE',
      subjectId: Number(row.id),
      subjectKey: null,
      originalVersion: configVersionFromUpdatedAt(updatedAt),
      beforeRow: row,
      afterData: input.data,
      reason,
      makerId: input.makerId,
      makerRole: input.makerRole,
      transaction: tx,
    });
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function requestGovernedCrudDelete(input: {
  resource: string;
  id: number;
  reason?: string;
  makerId: number;
  makerRole: string;
  expectedUpdatedAt: Date;
  transaction?: Tx;
}) {
  const definition = getCrudDefinition(input.resource);
  assertCanMakeGovernanceAction(definition.actionKind, input.makerRole);
  const reason = resolveReason(definition, 'DELETE', input.reason);
  const execute = async (tx: Tx) => {
    const row = await lockResourceRow(tx, definition, input.id);
    const updatedAt = assertGovernedUpdatedAt(row, definition.resource);
    if (updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
      throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
    }
    return requestGovernedConfigAction({
      resource: definition.resource,
      operation: 'DELETE',
      subjectId: Number(row.id),
      subjectKey: null,
      originalVersion: configVersionFromUpdatedAt(updatedAt),
      beforeRow: row,
      afterData: null,
      reason,
      makerId: input.makerId,
      makerRole: input.makerRole,
      transaction: tx,
    });
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

async function lockPricingTableByVersion(
  tx: Tx,
  pricingTableId: number,
  expectedVersion: number,
): Promise<{ id: number; updatedAt: Date }> {
  const [row] = await tx.select({
    id: s.pricingTables.id,
    updatedAt: s.pricingTables.updatedAt,
  })
    .from(s.pricingTables)
    .where(and(
      eq(s.pricingTables.id, pricingTableId),
      isNull(s.pricingTables.deletedAt),
    ))
    .limit(1)
    .for('update');
  if (!row) throw new ApiError(404, 'Không tìm thấy bảng giá');
  if (configVersionFromUpdatedAt(row.updatedAt) !== expectedVersion) {
    throw new ApiError(409, 'Bảng giá đã được thay đổi. Vui lòng tải lại.');
  }
  return row;
}

export async function requestPricingTableCreate(input: {
  data: CrudData;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}) {
  return requestGovernedCrudCreate({
    resource: 'pricing_tables',
    data: input.data,
    reason: input.reason,
    makerId: input.makerId,
    makerRole: input.makerRole,
    transaction: input.transaction,
  });
}

export async function requestPricingTableUpdate(input: {
  pricingTableId: number;
  data: CrudData;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const row = await lockPricingTableByVersion(tx, input.pricingTableId, input.expectedVersion);
    return requestGovernedCrudUpdate({
      resource: 'pricing_tables',
      id: row.id,
      data: input.data,
      reason: input.reason,
      makerId: input.makerId,
      makerRole: input.makerRole,
      expectedUpdatedAt: row.updatedAt,
      transaction: tx,
    });
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

export async function requestPricingTableDelete(input: {
  pricingTableId: number;
  reason: string;
  makerId: number;
  makerRole: string;
  expectedVersion: number;
  transaction?: Tx;
}) {
  const execute = async (tx: Tx) => {
    const row = await lockPricingTableByVersion(tx, input.pricingTableId, input.expectedVersion);
    return requestGovernedCrudDelete({
      resource: 'pricing_tables',
      id: row.id,
      reason: input.reason,
      makerId: input.makerId,
      makerRole: input.makerRole,
      expectedUpdatedAt: row.updatedAt,
      transaction: tx,
    });
  };
  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

async function applyGovernedCreate(
  tx: Tx,
  definition: GovernedCrudDefinition,
  action: GovernanceActionRow,
  after: AfterEnvelope,
): Promise<GovernanceApplyResult> {
  if (definition.kind !== 'crud') {
    throw new ApiError(409, 'Tài nguyên cấu hình không hỗ trợ CRUD áp dụng mặc định');
  }
  if (!after.data) {
    throw new ApiError(409, 'Yêu cầu tạo cấu hình thiếu dữ liệu áp dụng');
  }
  await lockApplicationOwnedUniqueness(tx, 'governed-config-resource', [definition.resource]);
  const req = syntheticApprovalRequest(action);
  const payload = definition.beforeCreate
    ? await definition.beforeCreate(after.data, req, tx)
    : after.data;
  await assertCanonicalConfigAvailable(tx, definition, payload);
  let created: CrudRow;
  [created] = await tx.insert(definition.table)
    .values(payload)
    .returning();
  if (!created || typeof created.id !== 'number') {
    throw new ApiError(409, 'Không thể tạo cấu hình');
  }
  if (definition.afterCreate) {
    await definition.afterCreate(created, payload, req, tx);
    const [refreshed] = await tx.select()
      .from(definition.table)
      .where(eq(column(definition.table, 'id'), created.id))
      .limit(1);
    if (!refreshed) throw new ApiError(404, 'Không tìm thấy cấu hình vừa tạo');
    created = refreshed as CrudRow;
  }
  await tx.update(s.governanceActions)
    .set({
      subjectId: created.id,
      updatedAt: new Date(),
    })
    .where(eq(s.governanceActions.id, action.id));
  return {
    applicationResult: {
      resource: definition.resource,
      operation: 'CREATE',
      subjectId: created.id,
      resultingVersion: configVersionFromUpdatedAt(assertGovernedUpdatedAt(created, definition.resource)),
    },
    durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
  };
}

async function applyGovernedUpdate(
  tx: Tx,
  definition: GovernedCrudDefinition,
  action: GovernanceActionRow,
  before: SnapshotEnvelope,
  after: AfterEnvelope,
): Promise<GovernanceApplyResult> {
  if (definition.kind !== 'crud') {
    throw new ApiError(409, 'Tài nguyên cấu hình không hỗ trợ CRUD áp dụng mặc định');
  }
  if (action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu cấu hình gốc');
  }
  if (!after.data || Object.keys(after.data).length === 0) {
    throw new ApiError(409, 'Yêu cầu cập nhật cấu hình thiếu dữ liệu áp dụng');
  }
  await lockApplicationOwnedUniqueness(tx, 'governed-config-resource', [definition.resource]);
  const row = await lockResourceRow(tx, definition, action.subjectId);
  const currentSnapshot = snapshotEnvelope(definition.resource, row);
  const currentUpdatedAt = assertGovernedUpdatedAt(row, definition.resource);
  if (
    currentSnapshot.fingerprint !== before.fingerprint
    || configVersionFromUpdatedAt(currentUpdatedAt) !== action.originalVersion
  ) {
    throw new ApiError(409, 'Cấu hình gốc đã thay đổi; vui lòng lập yêu cầu mới');
  }

  const req = syntheticApprovalRequest(action);
  const patch = definition.beforeUpdate
    ? await definition.beforeUpdate(action.subjectId, after.data, req, tx)
    : after.data;
  if (Object.keys(patch).length === 0) {
    throw new ApiError(409, 'Yêu cầu cập nhật cấu hình thiếu dữ liệu áp dụng');
  }
  const nextUpdatedAt = new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1));
  await assertCanonicalConfigAvailable(tx, definition, {
    ...row,
    ...patch,
  }, action.subjectId);
  let updated: CrudRow;
  [updated] = await tx.update(definition.table)
    .set({
      ...patch,
      updatedAt: nextUpdatedAt,
    })
    .where(eq(column(definition.table, 'id'), action.subjectId))
    .returning();
  if (!updated) throw new ApiError(404, 'Không tìm thấy cấu hình');
  if (definition.afterUpdate) {
    await definition.afterUpdate(updated, patch, req, tx);
    const [refreshed] = await tx.select()
      .from(definition.table)
      .where(eq(column(definition.table, 'id'), action.subjectId))
      .limit(1);
    if (!refreshed) throw new ApiError(404, 'Không tìm thấy cấu hình');
    updated = refreshed as CrudRow;
  }
  return {
    applicationResult: {
      resource: definition.resource,
      operation: 'UPDATE',
      subjectId: action.subjectId,
      resultingVersion: configVersionFromUpdatedAt(assertGovernedUpdatedAt(updated, definition.resource)),
    },
    durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
  };
}

async function applyGovernedDelete(
  tx: Tx,
  definition: GovernedCrudDefinition,
  action: GovernanceActionRow,
  before: SnapshotEnvelope,
): Promise<GovernanceApplyResult> {
  if (definition.kind !== 'crud') {
    throw new ApiError(409, 'Tài nguyên cấu hình không hỗ trợ CRUD áp dụng mặc định');
  }
  if (action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu quản trị thiếu cấu hình gốc');
  }
  const row = await lockResourceRow(tx, definition, action.subjectId);
  const currentSnapshot = snapshotEnvelope(definition.resource, row);
  const currentUpdatedAt = assertGovernedUpdatedAt(row, definition.resource);
  if (
    currentSnapshot.fingerprint !== before.fingerprint
    || configVersionFromUpdatedAt(currentUpdatedAt) !== action.originalVersion
  ) {
    throw new ApiError(409, 'Cấu hình gốc đã thay đổi; vui lòng lập yêu cầu mới');
  }

  const req = syntheticApprovalRequest(action);
  if (definition.beforeDelete) {
    await definition.beforeDelete(action.subjectId, req, tx);
  }

  const [deleted] = definition.deleteMode === 'hard'
    ? await tx.delete(definition.table)
      .where(eq(column(definition.table, 'id'), action.subjectId))
      .returning()
    : await tx.update(definition.table)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1)),
      })
      .where(eq(column(definition.table, 'id'), action.subjectId))
      .returning();

  if (!deleted) throw new ApiError(404, 'Không tìm thấy cấu hình');
  if (definition.afterDelete) {
    await definition.afterDelete(action.subjectId, req, tx);
  }
  return {
    applicationResult: {
      resource: definition.resource,
      operation: 'DELETE',
      subjectId: action.subjectId,
      resultingVersion: configVersionFromUpdatedAt(assertGovernedUpdatedAt(deleted as CrudRow, definition.resource)),
    },
    durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
  };
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
  if (before.resource !== delta.resource || after.resource !== delta.resource) {
    throw new ApiError(409, 'Yêu cầu quản trị cấu hình bị lệch tài nguyên');
  }

  const definition = getDefinition(delta.resource);
  if (definition.actionKind !== action.actionKind || definition.subjectType !== action.subjectType) {
    throw new ApiError(409, 'Tài nguyên cấu hình không khớp chính sách quản trị');
  }

  if (definition.kind === 'custom') {
    return definition.apply(tx, action, before, after, delta);
  }

  if (delta.operation === 'CREATE') {
    return applyGovernedCreate(tx, definition, action, after);
  }
  if (delta.operation === 'UPDATE') {
    return applyGovernedUpdate(tx, definition, action, before, after);
  }
  return applyGovernedDelete(tx, definition, action, before);
}

export function getGovernedCrudResource(resource: string): GovernedCrudDefinition | null {
  const definition = governedDefinitions.get(resource);
  return definition?.kind === 'crud' ? definition : null;
}

export function getGovernedCrudResourceName(table: AnyPgTable): string {
  return getTableName(table);
}
