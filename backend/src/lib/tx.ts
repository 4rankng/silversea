// Optional-transaction runner (T4b).
//
// Replaces the repeated shape:
//
//   const execute = async (tx: Tx) => { ... };
//   return transaction ? execute(transaction) : db.transaction(execute);
//
// with:
//
//   return runInTx(transaction, execute);
//
// `runInTx` reuses the caller's transaction when provided (joining the
// caller's atomicity boundary) and otherwise opens a top-level transaction.
// The callback must not commit/rollback the passed tx — db.transaction owns
// the lifecycle in the top-level case.

import { db } from '../db';
import type { Tx } from '../services/trip-shared';

export function runInTx<T>(
  transaction: Tx | undefined,
  execute: (tx: Tx) => Promise<T>,
): Promise<T> {
  return transaction ? execute(transaction) : db.transaction(execute);
}
