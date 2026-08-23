import { inArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import {
  resolveSubjectLabel,
  subjectKeyCustomerIds,
  subjectKeyDriverIds,
  subjectKeySettlementIds,
  type SubjectLabelContext,
} from './governance-subject-format';

type SubjectRow = {
  subjectKey: string | null;
};

/**
 * Batch-resolve human labels for a page of governance actions. Best effort
 * per row: entities that no longer exist (or unparseable keys) leave
 * `subjectLabel` null and the client falls back to the raw subjectKey.
 */
export async function attachSubjectLabels<T extends SubjectRow>(
  rows: T[],
): Promise<Array<T & { subjectLabel: string | null }>> {
  if (rows.length === 0) return rows as Array<T & { subjectLabel: string | null }>;

  const keys = rows.map(row => row.subjectKey);
  const customerIds = subjectKeyCustomerIds(keys);
  const settlementIds = subjectKeySettlementIds(keys);
  const driverIds = subjectKeyDriverIds(keys);

  const ctx: SubjectLabelContext = {
    customerNames: new Map(),
    settlementCodes: new Map(),
    driverNames: new Map(),
  };
  const [customerRows, settlementRows, driverRows] = await Promise.all([
    customerIds.size > 0
      ? db.select({ id: s.customers.id, name: s.customers.name, shortName: s.customers.shortName })
          .from(s.customers)
          .where(inArray(s.customers.id, [...customerIds]))
      : Promise.resolve([] as Array<{ id: number; name: string; shortName: string }>),
    settlementIds.size > 0
      ? db.select({ id: s.advanceSettlements.id, code: s.advanceSettlements.code })
          .from(s.advanceSettlements)
          .where(inArray(s.advanceSettlements.id, [...settlementIds]))
      : Promise.resolve([] as Array<{ id: number; code: string }>),
    driverIds.size > 0
      ? db.select({ id: s.users.id, fullName: s.users.fullName })
          .from(s.users)
          .where(inArray(s.users.id, [...driverIds]))
      : Promise.resolve([] as Array<{ id: number; fullName: string | null }>),
  ]);
  for (const c of customerRows) ctx.customerNames.set(c.id, c.shortName?.trim() || c.name);
  for (const x of settlementRows) ctx.settlementCodes.set(x.id, x.code);
  for (const d of driverRows) ctx.driverNames.set(d.id, d.fullName?.trim() || '');

  return rows.map(row => ({ ...row, subjectLabel: resolveSubjectLabel(row.subjectKey, ctx) }));
}
