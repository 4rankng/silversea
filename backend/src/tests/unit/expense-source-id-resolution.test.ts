// SIL-682 (id 794) — command endpoints accept EITHER source-id space. Card
// 20261005_373 keyed the tiền-đường dialog rows on expense_accounting_sources.id
// (the void route's key), so the dialog's "Tích duyệt"/save calls carry that PK
// while confirm/update/correct resolve `(sourceKind, sourceId)` against the
// NATIVE cost id — the dialog path 404'd ("Không tìm thấy chi phí thuộc lô.")
// forever (staging: sourceId 23/24 rejected, native 2/3 accepted).
//
// resolveExpenseCommandId owns the law in a db-free module (the unit-only
// ruling forbids importing the write service — its module graph reaches the
// connection module): native sources row wins → passthrough; a real native
// row PK wins → passthrough (ensureLegacyExpenseSource creates its sources row
// downstream, so a native id must never remap); then the sources PK aliases
// its own native source_id; an id resolving neither way passes through
// (existing native-space 404 kept). Branch logic runs against a scripted
// executor here; the SQL-side behavior is proven against the real API in
// qa/2026-11-06-lane-be/ (driver-sil682.mjs before/after).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Executor } from '../../services/trip-shared';
import { resolveExpenseCommandId } from '../../services/expense-command-id.service';

/** Scripted drizzle select chain: each `.limit()` consumes the next queued result. */
function scriptedExecutor(queue: Array<Record<string, unknown> | undefined>) {
  const queries: number[] = [];
  const executor = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            queries.push(queries.length + 1);
            const row = queue.shift();
            return row == null ? [] : [row];
          },
        }),
      }),
    }),
  } as unknown as Executor;
  return { executor, queryCount: () => queries.length };
}

describe('resolveExpenseCommandId — native wins, native-PK wins, sources PK aliases, misses pass through (SIL-682)', () => {
  it('a native (sourceKind, sourceId) row resolves first and skips every fallback', async () => {
    const { executor, queryCount } = scriptedExecutor([{ id: 42 }]);
    const id = await resolveExpenseCommandId(executor, 'DRIVER', 7);
    assert.equal(id, 7, 'native id passes through untouched');
    assert.equal(queryCount(), 1, 'no fallback query after a native hit');
  });

  it('a real native row PK passes through even without a sources row (legacy class)', async () => {
    // ensureLegacyExpenseSource supports source-row-less native ids; remapping
    // them by PK coincidence would redirect the command to the wrong expense.
    const { executor, queryCount } = scriptedExecutor([undefined, { id: 7 }]);
    const id = await resolveExpenseCommandId(executor, 'DRIVER', 7);
    assert.equal(id, 7, 'a native driver_incidental_costs PK is native, never aliased');
    assert.equal(queryCount(), 2, 'native sources lookup then native-table PK lookup');
  });

  it('a native miss with no native row falls back to the sources PK and remaps', async () => {
    // Staging shape: dialog sends sources PK 23; that row's native cost id is 2
    // and no driver_incidental_costs row 23 exists.
    const { executor, queryCount } = scriptedExecutor([undefined, undefined, { sourceId: 2 }]);
    const id = await resolveExpenseCommandId(executor, 'DRIVER', 23);
    assert.equal(id, 2, 'the alias PK remaps to the native cost id the command resolves');
    assert.equal(queryCount(), 3);
  });

  it('an id resolving neither way passes through (existing native-space 404 kept)', async () => {
    const { executor, queryCount } = scriptedExecutor([undefined, undefined, undefined]);
    const id = await resolveExpenseCommandId(executor, 'DRIVER', 99);
    assert.equal(id, 99, 'unresolvable id keeps native semantics');
    assert.equal(queryCount(), 3);
  });

  it('INVOICE has no native legacy row class — aliasing never applies', async () => {
    const { executor, queryCount } = scriptedExecutor([undefined]);
    const id = await resolveExpenseCommandId(executor, 'INVOICE', 5);
    assert.equal(id, 5, 'INVOICE ids pass through after the native sources lookup');
    assert.equal(queryCount(), 1, 'no native-table or alias query for INVOICE');
  });
});

const SERVICE_DIR = path.resolve(import.meta.dirname, '../../services');
const WRITE_SERVICE = readFileSync(path.join(SERVICE_DIR, 'expense-accounting-write.service.ts'), 'utf8');
const CORRECTION_SERVICE = readFileSync(path.join(SERVICE_DIR, 'expense-accounting-correction.service.ts'), 'utf8');
const ID_MODULE = readFileSync(path.join(SERVICE_DIR, 'expense-command-id.service.ts'), 'utf8');

// The shipped defect class: a command entry normalizes to nativeId but a
// downstream native-table write keeps keying on the RAW wire `id` — the dialog
// update then no-ops (or corrupts an unrelated cost whose PK numerically equals
// the sources PK) while the sources row still versions up. Scan both files for
// `eq(s.<table>.id, id)` — after normalization every such site must read
// nativeId (before.id / linkedTripExpenseId comparisons are sources-row keys
// and never match this shape).
const RAW_WIRE_NATIVE_KEY = /eq\(s\.\w+\.id, id\)/;

describe('defect-class source scan — every command entry normalizes the id space (SIL-682)', () => {
  it('the resolver lives db-free and guards the alias path', () => {
    assert.doesNotMatch(ID_MODULE, /^import \{ db \}/m, 'the module must not import the connection module (unit-only ruling)');
    assert.match(ID_MODULE, /NATIVE_TABLE/);
  });

  it('confirmAccountingExpenses normalizes its entries before dedupe/trip lookups', () => {
    const body = WRITE_SERVICE.slice(WRITE_SERVICE.indexOf('export async function confirmAccountingExpenses'));
    assert.match(body, /resolveExpenseCommandId\(tx, ref\.sourceKind, ref\.sourceId\)/);
    assert.ok(body.indexOf('normalizedEntries') < body.indexOf('const keys ='), 'normalization precedes the dedupe check');
  });

  it('updateAccountingExpense normalizes before the identity guard AND before every native write', () => {
    const body = WRITE_SERVICE.slice(WRITE_SERVICE.indexOf('export async function updateAccountingExpense'));
    assert.match(body, /resolveExpenseCommandId\(tx, kind, id\)/);
    assert.match(body, /before\.sourceId !== nativeId/);
    assert.doesNotMatch(body, RAW_WIRE_NATIVE_KEY, 'no native-table write may key on the raw wire id');
  });

  it('correctAccountingExpense normalizes before its native .for(update) reads and writes', () => {
    const body = CORRECTION_SERVICE.slice(CORRECTION_SERVICE.indexOf('export async function correctAccountingExpense'));
    assert.match(body, /resolveExpenseCommandId\(tx, kind, id\)/);
    assert.match(body, /sourceId: nativeId/);
    assert.doesNotMatch(body, RAW_WIRE_NATIVE_KEY, 'no native-table read may key on the raw wire id');
  });
});
