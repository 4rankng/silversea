import { db } from '../db';
import * as schema from '../db/schema';
import { normalizeSeedText } from './seed-identity';

/** Card 20260921_9 AC3 — own fleet ("xe nhà") tracked as a regular customer
 *  code in chi hộ. Fill-only: the row inserts only when no normalized-name
 *  match exists; admin renames and edits are admin data, never overwritten. */
export async function seedXeNhaCustomer(): Promise<{ inserted: number }> {
  const existing = await db.select({ id: schema.customers.id, name: schema.customers.name })
    .from(schema.customers);
  const hit = existing.some((row) => normalizeSeedText(row.name) === normalizeSeedText('Xe nhà'));
  if (hit) return { inserted: 0 };
  await db.insert(schema.customers).values({ name: 'Xe nhà', shortName: 'Xe nhà' });
  return { inserted: 1 };
}
