import { sql } from 'drizzle-orm';

import type { Tx } from './trip-shared';

type LockPart = string | number | boolean | Date | null | undefined;

export interface ApplicationOwnedUniquenessLock {
  scope: string;
  parts: readonly LockPart[];
}

function serializeLockPart(part: LockPart): string {
  if (part instanceof Date) return part.toISOString();
  if (part === null) return 'null';
  if (part === undefined) return 'undefined';
  return String(part);
}

function buildLockKey(lock: ApplicationOwnedUniquenessLock): string {
  return [lock.scope, ...lock.parts.map(serializeLockPart)].join('\u001f');
}

export async function lockApplicationOwnedUniqueness(
  tx: Tx,
  scope: string,
  parts: readonly LockPart[],
): Promise<void> {
  await lockApplicationOwnedUniquenessSet(tx, [{ scope, parts }]);
}

export async function lockApplicationOwnedUniquenessSet(
  tx: Tx,
  locks: readonly ApplicationOwnedUniquenessLock[],
): Promise<void> {
  const keys = [...new Set(locks.map(buildLockKey))].sort();
  for (const key of keys) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}
