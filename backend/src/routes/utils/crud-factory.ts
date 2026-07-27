/**
 * CRUD route factory — generates standard REST endpoints for a Drizzle table.
 * Extracted from config.service.ts so route machinery lives with routes.
 *
 * Endpoints: GET / (list), POST / (create), GET /:id, PUT /:id, DELETE /:id.
 * Supports soft-delete (checks for `deletedAt` column) and optional search.
 */
import { Router } from 'express';
import { db } from '../../db';
import { asc, eq, isNull, sql, and } from 'drizzle-orm';
import type { AnyPgTable, PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { AnyZodObject, output } from 'zod';
import type { Request, Response } from 'express';
import { cacheInvalidate } from '../../lib/redis';
import { asyncHandler } from '../../middleware/asyncHandler';
import { parsePagination } from './pagination';
import { ApiError } from '../../errors';

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
  /** Override the default list-page maxLimit (100) for catalogs that may exceed
   *  it (e.g. tires), so list endpoints don't silently truncate. */
  maxLimit?: number;
  /** Deterministic ascending order for configuration lists that have chronology. */
  orderByField?: string;
  beforeCreate?: (data: TData, req: Request) => Promise<Partial<TData>> | Partial<TData>;
  afterCreate?: (item: TRow, data: Partial<TData>, req: Request) => Promise<void> | void;
  beforeUpdate?: (id: number, data: Partial<TData>, req: Request) => Promise<Partial<TData>> | Partial<TData>;
  afterUpdate?: (item: TRow, data: Partial<TData>, req: Request) => Promise<void> | void;
  beforeDelete?: (id: number, req: Request) => Promise<void> | void;
  afterDelete?: (id: number, req: Request) => Promise<void> | void;
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
    maxLimit,
    orderByField,
    beforeCreate,
    afterCreate,
    beforeUpdate,
    afterUpdate,
    beforeDelete,
    afterDelete,
  } = options;
  const sub = Router();
  const hasSoftDelete = 'deletedAt' in table;
  // Within a generic function, Drizzle's query-builder conditional types
  // (e.g. TableLikeHasEmptySelection) cannot resolve against the type
  // parameter, so the concrete table is widened to Drizzle's broad table
  // type at the query boundary. This is a type-only assertion — the runtime
  // table object is unchanged.
  const tbl = table as AnyPgTable;

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

  sub.post('/', asyncHandler(async (req: Request, res: Response) => {
    let data = createSchema.parse(req.body);
    if (beforeCreate) {
      data = (await beforeCreate(data, req)) as typeof data;
    }
    let item;
    try {
      [item] = await db.insert(tbl).values(data as Record<string, unknown>).returning();
    } catch (err: unknown) {
      const uniqueError = apiErrorFromUniqueConstraint(err);
      if (uniqueError) {
        throw uniqueError;
      }
      throw err;
    }
    if (afterCreate) {
      await afterCreate(item, data, req);
    }
    await cacheInvalidate('catalogs:bootstrap');
    res.status(201).json(item);
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
    let data = createSchema.partial().parse(req.body) as Partial<output<TCreate>>;
    if (beforeUpdate) {
      data = (await beforeUpdate(id, data, req)) as typeof data;
    }
    let item;
    try {
      [item] = await db.update(tbl).set({ ...data, updatedAt: new Date() } as Record<string, unknown>).where(eq(column(table, 'id'), id)).returning();
    } catch (err: unknown) {
      const uniqueError = apiErrorFromUniqueConstraint(err);
      if (uniqueError) {
        throw uniqueError;
      }
      throw err;
    }
    if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
    if (afterUpdate) {
      await afterUpdate(item, data, req);
    }
    await cacheInvalidate('catalogs:bootstrap');
    res.json(item);
  }));

  sub.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    if (disableDelete) return res.status(405).json({ error: 'Không hỗ trợ xóa' });
    const id = parseInt(req.params.id as string);
    if (deleteMode === 'soft' && !hasSoftDelete) return res.status(405).json({ error: 'Không hỗ trợ xóa' });
    if (beforeDelete) {
      await beforeDelete(id, req);
    }
    const [item] = deleteMode === 'hard'
      ? await db.delete(tbl).where(eq(column(table, 'id'), id)).returning()
      : await db.update(tbl).set({ deletedAt: new Date(), updatedAt: new Date() } as Record<string, unknown>).where(eq(column(table, 'id'), id)).returning();
    if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
    if (afterDelete) {
      await afterDelete(id, req);
    }
    await cacheInvalidate('catalogs:bootstrap');
    res.json({ ok: true });
  }));

  return sub;
}
