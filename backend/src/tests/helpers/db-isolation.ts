// Test isolation helpers — error-isolated delete helpers for integration
// tests against the shared Postgres.
//
// The classic teardown ladder (`if (ids.length) await db.delete(...)`) has one
// failure mode that leaks every subsequent table: a single throw (FK surprise,
// concurrent writer) skips all remaining deletes. These helpers isolate each
// delete and no-op empty sets, so one bad table cannot orphan the rest.
//
// Explicit-call by design: the owning test's `after()` decides ordering
// relative to `client.end()` / redis teardown (node:test `after` hooks run
// LIFO, so a self-registering helper here could fire after the pool closes).
import { inArray, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../../db';

export interface TestCleanup {
  /** Register a created row; removed newest-first by flush(). */
  track(table: PgTable, id: number | string): void;
  /** Run all tracked deletes (reverse registration order), each isolated. */
  flush(): Promise<void>;
  /** Isolated bulk delete: no-ops on empty ids, never throws per-table. */
  deleteAll(table: PgTable, ids: Array<number | string>): Promise<void>;
  /** Isolated delete by arbitrary predicate (non-id columns, cascades).
   * No-ops when `ids` is empty so the caller keeps the guard-free shape. */
  deleteWhere(table: PgTable, ids: Array<number | string>, predicate: (ids: Array<number | string>) => SQL): Promise<void>;
}

export function withTestCleanup(): TestCleanup {
  const tracked: Array<{ table: PgTable; id: number | string }> = [];
  return {
    track(table, id) {
      tracked.push({ table, id });
    },
    async flush() {
      for (const { table, id } of tracked.reverse()) {
        await this.deleteAll(table, [id]);
      }
    },
    async deleteAll(table, ids) {
      if (ids.length === 0) return;
      try {
        await db.delete(table).where(inArray(idColumn(table), ids));
      } catch (err) {
        // best-effort: a row already removed (cascade or another teardown)
        // must not abort the remaining cleanups — but stay observable.
        console.warn('[test-cleanup] delete failed, continuing:', (err as Error).message);
      }
    },
    async deleteWhere(table, ids, predicate) {
      if (ids.length === 0) return;
      try {
        await db.delete(table).where(predicate(ids));
      } catch (err) {
        console.warn('[test-cleanup] deleteWhere failed, continuing:', (err as Error).message);
      }
    },
  };
}

function idColumn(table: PgTable): PgColumn {
  const column = (table as unknown as Record<string, unknown>).id as PgColumn | undefined;
  if (!column) throw new Error('withTestCleanup only supports tables with an id column');
  return column;
}
