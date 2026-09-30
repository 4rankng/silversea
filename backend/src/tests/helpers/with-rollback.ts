// Rollback-per-test isolation (card 20260930_225).
//
// The classic fixture pattern (seed rows with db, track ids, delete them in
// `after()`) leaks on the first crashed run: one aborted suite leaves rows
// behind and the next run collides with its own unique keys. Running each
// test's writes inside a transaction that is ALWAYS rolled back removes the
// leak class entirely — nothing ever commits, so there is nothing to clean up.
//
// Postgres DDL is transactional too, so fixture tables created inside the body
// disappear with it. The service under test must run its queries on the passed
// handle (the Executor seam) — a service reading via the bare `db` pool cannot
// see the body's uncommitted fixtures.
//
// `tx.rollback()` in drizzle-orm 0.45 throws TransactionRollbackError out of
// `db.transaction()` after rolling back; that error is the expected exit
// signal here and is swallowed. Any other error (assertion failures included)
// still propagates to node:test after the rollback.
import { TransactionRollbackError } from 'drizzle-orm';
import { db, type Tx } from '../../db';

export async function withRollback<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  let completed = false;
  try {
    await db.transaction(async (tx) => {
      result = await body(tx);
      completed = true;
      tx.rollback();
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError && completed) {
      return result as T;
    }
    throw error;
  }
  // db.transaction resolving without our rollback signal would mean drizzle
  // committed the body — fail loudly instead of silently breaking isolation.
  throw new Error('withRollback: body completed but the rollback signal never fired');
}
