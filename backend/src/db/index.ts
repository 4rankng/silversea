import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { config } from '../config';

export const client = postgres(config.databaseUrl);
export const db = drizzle(client, { schema });
export type Database = typeof db;
