

import type { Executor } from './trip-shared';
import { acquireAdvisoryLock, acquireAdvisoryLocks, lockKeys } from './advisory-lock.service';

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
  executor: Executor,
  scope: string,
  parts: readonly LockPart[],
): Promise<void> {
  await lockApplicationOwnedUniquenessSet(executor, [{ scope, parts }]);
}

export async function lockApplicationOwnedUniquenessSet(
  executor: Executor,
  locks: readonly ApplicationOwnedUniquenessLock[],
): Promise<void> {
  const keys = [...new Set(locks.map(buildLockKey))];
  await acquireAdvisoryLocks(executor, keys.map(lockKeys.text));
}
