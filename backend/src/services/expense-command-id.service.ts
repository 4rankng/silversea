import { and, eq } from 'drizzle-orm';
import type { ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import type { Executor } from './trip-shared';

/**
 * SIL-682 (id 794) — command endpoints receive `sourceId` in EITHER id space.
 * Card 20261005_373 keyed the tiền-đường dialog rows on
 * `expense_accounting_sources.id` (the void route's key), so its "Tích duyệt" /
 * update / correct calls carry that PK, while every command resolves
 * `(sourceKind, sourceId)` against the NATIVE cost id — the dialog path 404'd
 * ("Không tìm thấy chi phí thuộc lô.") forever.
 *
 * Resolution law:
 *   1. NATIVE wins first — a sources row keyed `(sourceKind, sourceId) = id`
 *      means the caller spoke native (every pre-existing caller: OPS board,
 *      correction flows, voucher builds) and the id passes through untouched.
 *   2. The id is also a REAL native row (its kind's native table holds that
 *      PK) → native semantics, passthrough. `getExpenseForCommand` supports
 *      source-row-less native ids via `ensureLegacyExpenseSource`, so a native
 *      PK must never be remapped just because no sources row exists yet.
 *   3. Otherwise the sources PK aliases its own native `source_id` — remap.
 *   4. An id resolving neither way passes through unchanged and keeps the
 *      existing native-space 404.
 * INVOICE has no native legacy row class (ensureLegacyExpenseSource refuses
 * it), so step 2/3 never apply and the id passes through.
 *
 * The caller's `expectedVersion` already belongs to the same sources row the
 * dialog read, so optimistic locking is unaffected. Deliberately db-free
 * (drizzle + schema types only) so unit tests exercise the real branches
 * without a pool.
 */
const NATIVE_TABLE: Partial<Record<ExpenseSourceKind, typeof s.tripExpenses | typeof s.opsExpenseEntries | typeof s.driverIncidentalCosts>> = {
  OPS: s.opsExpenseEntries,
  DRIVER: s.driverIncidentalCosts,
  TRIP: s.tripExpenses,
};

export async function resolveExpenseCommandId(executor: Executor, kind: ExpenseSourceKind, id: number): Promise<number> {
  const [native] = await executor.select({ id: s.expenseAccountingSources.id }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, kind), eq(s.expenseAccountingSources.sourceId, id))).limit(1);
  if (native) return id;
  const table = NATIVE_TABLE[kind];
  if (!table) return id;
  const [nativeRow] = await executor.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (nativeRow) return id;
  const [alias] = await executor.select({ sourceId: s.expenseAccountingSources.sourceId }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, kind), eq(s.expenseAccountingSources.id, id))).limit(1);
  return alias ? alias.sourceId : id;
}
