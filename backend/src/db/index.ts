import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { config } from '../config';

export const client = postgres(config.databaseUrl, {
  // Pool bounds are env-knobbed (see config schema); seconds units per
  // postgres.js option semantics. The pool serves API + seed + import scripts
  // alike, so these are connection-level limits only — never statement or
  // total-runtime timeouts.
  max: config.dbPoolMax,
  idle_timeout: config.dbIdleTimeoutSeconds,
  connect_timeout: config.dbConnectTimeoutSeconds,
  max_lifetime: config.dbMaxLifetimeSeconds,
});
export const db = drizzle(client, { schema });
export type Database = typeof db;

/** A live drizzle transaction handle (what `db.transaction` hands its callback). */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Executor — the one database-handle seam for service functions.
 *
 * An Executor is whichever handle a query should run on: the pool (`db`) or a
 * caller's open transaction (`Tx`). "Run under one transaction" is a
 * caller-level decision — the callee only promises to use the handle it is
 * given, so the same function serves both standalone reads and transactional
 * bodies without `tx ?? db` shims or `as Tx` casts.
 *
 * Convention (new services follow this):
 * - Functions whose job is to run on a caller-supplied handle — transactional
 *   bodies, invariant guards, batch readers shared by both paths — take
 *   `executor: Executor` as their FIRST parameter, required.
 * - Optional-transaction service functions (standalone by default, join a
 *   transaction when the caller is in one) take `executor: Executor = db` as
 *   their LAST parameter, so callers can omit it. Never make callers import
 *   `db` just to pass it back in (see the route db-import baseline in
 *   src/tests/unit/arch-layering.test.ts).
 * - Inside `db.transaction((tx) => ...)`, pass `tx`; its type `Tx` is a
 *   subtype of Executor, so every Executor-taking function accepts it.
 */
export type Executor = Tx | Database;
