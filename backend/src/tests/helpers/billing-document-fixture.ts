// Minimal billing-document fixture for suites that need a REAL debit-note
// row to satisfy the live FK from shipment_accounting_locks (and other
// billing-document children) — sentinel ids (0, 900_000+id, 999_000+id) only
// ever worked while the shared dev database's accumulated rows masked them.
// Fresh clones expose them. Card _40: fixture repair only; the assertion
// semantics of every suite stay untouched.
import * as s from '../../db/schema';

/** Insert a minimal lockable DEBIT_NOTE and return the row (its id goes into FK columns). */
export async function insertLockableBillingDocument(
  executor: { insert: (typeof import('../../db'))['db']['insert'] },
  opts: { entityId: number; entityName?: string; rangeFrom?: string; rangeTo?: string },
) {
  const [doc] = await executor.insert(s.billingDocuments).values({
    type: 'DEBIT_NOTE' as const,
    entityType: 'CUSTOMER' as const,
    entityId: opts.entityId,
    entityName: opts.entityName ?? 'Isolation fixture debit note',
    rangeFrom: opts.rangeFrom ?? '2026-09-01',
    rangeTo: opts.rangeTo ?? '2026-09-30',
    totalInclVat: '0',
  }).returning();
  return doc;
}
