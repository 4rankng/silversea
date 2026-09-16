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
