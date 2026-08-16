/**
 * CRUD route factory — generates standard REST endpoints for a Drizzle table.
 * Extracted from config.service.ts so route machinery lives with routes.
 *
 * Endpoints: GET / (list), POST / (create), GET /:id, PUT /:id, DELETE /:id.
 * Supports soft-delete (checks for `deletedAt` column) and optional search.
 */
import { Router } from 'express';
import { db } from '../../db';
import { asc, eq, getTableName, isNull, sql, and } from 'drizzle-orm';
import type { AnyPgTable, PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { AnyZodObject, output } from 'zod';
import type { Request, Response } from 'express';
import { Role } from '@tingting/shared';
import { cacheInvalidate } from '../../lib/redis';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireRoles } from '../../middleware/casbin';
import { parsePagination } from './pagination';
import { ApiError } from '../../errors';
import { getUser } from '../../middleware/auth';
import {
  buildCrudIdempotencyEndpoint,
  resolveIdempotencyKey,
  runIdempotent,
} from '../../services/idempotency.service';
import {
  getGovernedCrudResourceName,
  registerGovernedCrudResource,
  requestGovernedCrudCreate,
  requestGovernedCrudDelete,
  requestGovernedCrudUpdate,
} from '../../services/price-config-governance.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Helper: narrow a Drizzle table's property to a column reference.
 *
 * Drizzle's broad table type doesn't expose named columns as known keys, so
 * dynamic lookups (soft-delete, search-by-field) are narrowed here through a
 * single, explicit boundary instead of leaking `any` across the factory.
 */
function column<T extends PgTable>(table: T, key: string): PgColumn {
  return (table as unknown as Record<string, PgColumn>)[key];
}

export interface CrudRouterOptions<
  TRow = Record<string, unknown>,
  TData = Record<string, unknown>,
> {
  searchableField?: string;
  disableDelete?: boolean;
  deleteMode?: 'soft' | 'hard';
  /** Extra roles allowed to CREATE only (not update/delete). Use when a role
   * needs to add catalog rows (e.g. DISPATCHER creating fleet resources) but
   * Casbin still denies it broad config write. */
  createRoles?: Role[];
  /** Override the default list-page maxLimit (100) for catalogs that may exceed
   *  it (e.g. tires), so list endpoints don't silently truncate. */
  maxLimit?: number;
  /** Deterministic ascending order for configuration lists that have chronology. */
  orderByField?: string;
  /** Optional schema for update compatibility when persisted legacy values are
   * readable but prohibited on new creates. */
  updateSchema?: AnyZodObject;
  beforeCreate?: (data: TData, req: Request, tx: Tx) => Promise<Partial<TData>> | Partial<TData>;
  afterCreate?: (item: TRow, data: Partial<TData>, req: Request, tx: Tx) => Promise<void> | void;
  beforeUpdate?: (id: number, data: Partial<TData>, req: Request, tx: Tx) => Promise<Partial<TData>> | Partial<TData>;
  afterUpdate?: (item: TRow, data: Partial<TData>, req: Request, tx: Tx) => Promise<void> | void;
  beforeDelete?: (id: number, req: Request, tx: Tx) => Promise<void> | void;
  afterDelete?: (id: number, req: Request, tx: Tx) => Promise<void> | void;
  governance?: {
    reasonLabel: string;
    shouldGovernCreate?: (data: TData, req: Request) => boolean;
    shouldGovernUpdate?: (id: number, data: Partial<TData>, req: Request) => boolean;
    shouldGovernDelete?: (id: number, req: Request) => boolean;
  };
}

function apiErrorFromUniqueConstraint(err: unknown): ApiError | null {
  // Drizzle wraps postgres errors; the underlying code is usually on err.cause.code.
  const e = err as { code?: string; cause?: { code?: string; detail?: string }; detail?: string };
  const pgCode = e.code || e.cause?.code;
  if (pgCode !== '23505') return null;

  const detail = e.cause?.detail || e.detail || '';
  const fieldMatch = detail.match(/Key \(([^)]+)\)/);
  const field = fieldMatch ? fieldMatch[1] : 'trường';
  return new ApiError(409, `${field} đã tồn tại`);
}

function isPendingGovernanceResult(value: unknown): value is { status: string; actionKind: string } {
  return typeof value === 'object'
    && value !== null
    && 'status' in value
    && 'actionKind' in value;
}

export function createCrudRouter<
  TTable extends PgTable,
  TCreate extends AnyZodObject,
>(
  table: TTable,
  createSchema: TCreate,
  options: CrudRouterOptions<TTable['$inferSelect'], output<TCreate>> = {}
) {
  const {
    searchableField,
    disableDelete = false,
    deleteMode = 'soft',
    createRoles,
    maxLimit,
    orderByField,
    updateSchema,
    beforeCreate,
    afterCreate,
    beforeUpdate,
    afterUpdate,
    beforeDelete,
    afterDelete,
    governance,
  } = options;
  const sub = Router();
  const hasSoftDelete = 'deletedAt' in table;
  const hasUpdatedAt = 'updatedAt' in table;
  const resource = getTableName(table);
  if (!hasUpdatedAt) {
    throw new Error(`Generated configuration resource "${resource}" must expose updatedAt`);
  }
  // Within a generic function, Drizzle's query-builder conditional types
  // (e.g. TableLikeHasEmptySelection) cannot resolve against the type
  // parameter, so the concrete table is widened to Drizzle's broad table
  // type at the query boundary. This is a type-only assertion — the runtime
  // table object is unchanged.
  const tbl = table as AnyPgTable;
  const governanceResource = governance ? getGovernedCrudResourceName(tbl) : null;

  if (governance && governanceResource) {
    registerGovernedCrudResource({
      resource: governanceResource,
      actionKind: 'PRICE_CONFIG_CHANGE',
      subjectType: 'PRICE_CONFIG',
      reasonLabel: governance.reasonLabel,
      table: tbl,
      deleteMode,
      beforeCreate: beforeCreate as CrudRouterOptions['beforeCreate'],
      afterCreate: afterCreate as CrudRouterOptions['afterCreate'],
      beforeUpdate: beforeUpdate as CrudRouterOptions['beforeUpdate'],
      afterUpdate: afterUpdate as CrudRouterOptions['afterUpdate'],
      beforeDelete,
      afterDelete,
    });
  }

  function requireIdempotencyKey(req: Request): string {
    const key = resolveIdempotencyKey({
      headerValue: req.header('Idempotency-Key'),
      requestId: req.body?._requestId,
    });
    if (!key) {
      throw new ApiError(
        400,
        'Idempotency-Key là bắt buộc cho thay đổi cấu hình.',
      );
    }
    return key;
  }

  function requireExpectedUpdatedAt(req: Request): Date {
    const raw = req.header('If-Unmodified-Since')?.trim();
    if (!raw) {
      throw new ApiError(
        428,
        'Thiếu phiên bản dữ liệu. Vui lòng tải lại danh mục trước khi cập nhật.',
      );
    }
    const expected = new Date(raw);
    if (Number.isNaN(expected.getTime())) {
      throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
    }
    return expected;
  }

  async function lockCurrentVersion(tx: Tx, id: number, expected: Date) {
    const conditions = [eq(column(table, 'id'), id)];
    if (hasSoftDelete) conditions.push(isNull(column(table, 'deletedAt')));
    const [current] = await tx.select()
      .from(tbl)
      .where(and(...conditions))
      .limit(1)
      .for('update');
    if (!current) throw new ApiError(404, 'Không tìm thấy');

    const actual = (current as Record<string, unknown>).updatedAt;
    if (!(actual instanceof Date)) {
      throw new Error(`Generated configuration resource "${resource}" returned an invalid updatedAt`);
    }
    if (actual.getTime() !== expected.getTime()) {
      throw new ApiError(
        409,
        'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.',
      );
    }
    return actual;
  }

  sub.get('/', asyncHandler(async (req: Request, res: Response) => {
    const { page, limit, offset } = parsePagination(req, maxLimit ? { maxLimit } : undefined);
    const search = req.query.search as string;

    const conditions = [];
    if (hasSoftDelete) conditions.push(isNull(column(table, 'deletedAt')));
    if (search && searchableField) {
      // Escape SQL LIKE metacharacters to prevent unintended wildcard expansion
      const escaped = search.replace(/[%_]/g, '\\$&');
      conditions.push(sql`unaccent(${column(table, searchableField)}) ILIKE unaccent(${"%" + escaped + "%"})`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    let itemsQuery = db.select().from(tbl)
      .where(where)
      .$dynamic();
    if (orderByField) {
      itemsQuery = itemsQuery.orderBy(asc(column(table, orderByField)));
    }
    const items = await itemsQuery.limit(limit).offset(offset);

    const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(tbl)
      .where(where);

    res.json({ items, total: Number(countRow?.count ?? 0), page, pageSize: limit });
  }));

  if (createRoles?.length) {
    sub.post('/', requireRoles(...createRoles));
  }
  sub.post('/', asyncHandler(async (req: Request, res: Response) => {
    const idempotencyKey = requireIdempotencyKey(req);
    const actor = getUser(req);
    const { result } = await runIdempotent({
      endpoint: buildCrudIdempotencyEndpoint(resource, 'create'),
      idempotencyKey,
      payload: req.body,
      createdBy: actor.userId,
      entityType: resource,
      create: async (tx) => {
        let data = createSchema.parse(req.body);
        if (beforeCreate) {
          data = (await beforeCreate(data, req, tx)) as typeof data;
        }
        if (governance && governanceResource && (governance.shouldGovernCreate?.(data, req) ?? true)) {
          return requestGovernedCrudCreate({
            resource: governanceResource,
            data: data as Record<string, unknown>,
            reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
            makerId: actor.userId,
            makerRole: actor.role,
            transaction: tx,
          });
        }
        let item;
        try {
          [item] = await tx.insert(tbl).values(data as Record<string, unknown>).returning();
        } catch (err: unknown) {
          const uniqueError = apiErrorFromUniqueConstraint(err);
          if (uniqueError) throw uniqueError;
          throw err;
        }
        if (afterCreate) {
          await afterCreate(item, data, req, tx);
          const [refreshed] = await tx.select()
            .from(tbl)
            .where(eq(column(table, 'id'), (item as { id: number }).id))
            .limit(1);
          if (!refreshed) throw new ApiError(404, 'Không tìm thấy');
          item = refreshed;
        }
        return item;
      },
    });
    await cacheInvalidate('catalogs:bootstrap');
    res.status(201).json(result);
  }));

  sub.get('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const conditions = [eq(column(table, 'id'), id)];
    if (hasSoftDelete) conditions.push(isNull(column(table, 'deletedAt')));
    const [item] = await db.select().from(tbl).where(and(...conditions)).limit(1);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(item);
  }));

  sub.put('/:id', asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string);
    const idempotencyKey = requireIdempotencyKey(req);
    const expectedUpdatedAt = requireExpectedUpdatedAt(req);
    const actor = getUser(req);
    const { result, replayed } = await runIdempotent({
      endpoint: buildCrudIdempotencyEndpoint(resource, 'update'),
      idempotencyKey,
      payload: { id, body: req.body, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: actor.userId,
      entityType: resource,
      create: async (tx) => {
        const currentUpdatedAt = await lockCurrentVersion(tx, id, expectedUpdatedAt);
        let data = (updateSchema ?? createSchema).partial().parse(req.body) as Partial<output<TCreate>>;
        if (beforeUpdate) {
          data = (await beforeUpdate(id, data, req, tx)) as typeof data;
        }
        if (governance && governanceResource && (governance.shouldGovernUpdate?.(id, data, req) ?? true)) {
          return requestGovernedCrudUpdate({
            resource: governanceResource,
            id,
            data: data as Record<string, unknown>,
            reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
            makerId: actor.userId,
            makerRole: actor.role,
            expectedUpdatedAt: currentUpdatedAt,
            transaction: tx,
          });
        }
        const nextUpdatedAt = new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1));
        let item;
        try {
          [item] = await tx.update(tbl)
            .set({ ...data, updatedAt: nextUpdatedAt } as Record<string, unknown>)
            .where(eq(column(table, 'id'), id))
            .returning();
        } catch (err: unknown) {
          const uniqueError = apiErrorFromUniqueConstraint(err);
          if (uniqueError) throw uniqueError;
          throw err;
        }
        if (!item) throw new ApiError(404, 'Không tìm thấy');
        if (afterUpdate) {
          await afterUpdate(item, data, req, tx);
          const [refreshed] = await tx.select()
            .from(tbl)
            .where(eq(column(table, 'id'), id))
            .limit(1);
          if (!refreshed) throw new ApiError(404, 'Không tìm thấy');
          item = refreshed;
        }
        return item;
      },
    });
    await cacheInvalidate('catalogs:bootstrap');
    if (isPendingGovernanceResult(result) && result.status === 'PENDING_CHECK') {
      return res.status(replayed ? 200 : 201).json(result);
    }
    res.json(result);
  }));

  sub.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    if (disableDelete) return res.status(405).json({ error: 'Không hỗ trợ xóa' });
    const id = parseInt(req.params.id as string);
    if (deleteMode === 'soft' && !hasSoftDelete) return res.status(405).json({ error: 'Không hỗ trợ xóa' });
    const idempotencyKey = requireIdempotencyKey(req);
    const expectedUpdatedAt = requireExpectedUpdatedAt(req);
    const actor = getUser(req);
    const { result } = await runIdempotent({
      endpoint: buildCrudIdempotencyEndpoint(resource, 'delete'),
      idempotencyKey,
      payload: {
        id,
        body: req.body ?? null,
        expectedUpdatedAt: expectedUpdatedAt.toISOString(),
      },
      createdBy: actor.userId,
      entityType: resource,
      create: async (tx) => {
        const currentUpdatedAt = await lockCurrentVersion(tx, id, expectedUpdatedAt);
        if (governance && governanceResource && (governance.shouldGovernDelete?.(id, req) ?? true)) {
          return requestGovernedCrudDelete({
            resource: governanceResource,
            id,
            reason: typeof req.body?.reason === 'string' ? req.body.reason : undefined,
            makerId: actor.userId,
            makerRole: actor.role,
            expectedUpdatedAt: currentUpdatedAt,
            transaction: tx,
          });
        }
        if (beforeDelete) {
          await beforeDelete(id, req, tx);
        }
        const [item] = deleteMode === 'hard'
          ? await tx.delete(tbl)
            .where(eq(column(table, 'id'), id))
            .returning()
          : await tx.update(tbl)
            .set({
              deletedAt: new Date(),
              updatedAt: new Date(Math.max(Date.now(), currentUpdatedAt.getTime() + 1)),
            } as Record<string, unknown>)
            .where(eq(column(table, 'id'), id))
            .returning();
        if (!item) throw new ApiError(404, 'Không tìm thấy');
        if (afterDelete) {
          await afterDelete(id, req, tx);
        }
        return { ok: true as const, id };
      },
      getEntityId: (value) => value.id,
      serializeResult: () => ({ ok: true }),
      deserializeResult: () => ({ ok: true as const, id }),
    });
    await cacheInvalidate('catalogs:bootstrap');
    if ('ok' in result) {
      res.json({ ok: result.ok });
      return;
    }
    res.status(201).json(result);
  }));

  return sub;
}
