// Debit-note template read models — list/get for the config router. Writes
// stay in the dedicated transactional route file (single-default invariant;
// see routes/config/debit-note-templates.routes.ts header).
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { escapeLikeTerm } from '../lib/format';

export interface DebitNoteTemplateListFilters {
  page: number;
  limit: number;
  offset: number;
  search?: string;
  documentType?: string;
}

/** Active templates, default-first then by name; unaccented name search. */
export async function listDebitNoteTemplates(filters: DebitNoteTemplateListFilters) {
  const conds = [isNull(s.debitNoteTemplates.deletedAt)];
  if (filters.documentType === 'DEBIT_NOTE' || filters.documentType === 'PAYMENT_STATEMENT') {
    conds.push(eq(s.debitNoteTemplates.documentType, filters.documentType));
  }
  if (filters.search) {
    const escaped = escapeLikeTerm(filters.search);
    conds.push(sql`unaccent(${s.debitNoteTemplates.name}) ILIKE unaccent(${"%" + escaped + "%"})`);
  }
  const where = and(...conds);
  const [items, countRow] = await Promise.all([
    db.select().from(s.debitNoteTemplates).where(where)
      .limit(filters.limit).offset(filters.offset)
      .orderBy(desc(s.debitNoteTemplates.isDefault), s.debitNoteTemplates.name),
    db.select({ count: sql<number>`count(*)` }).from(s.debitNoteTemplates).where(where),
  ]);
  return { items, total: Number(countRow[0]?.count ?? 0) };
}

/** One active template or null (404 semantics live in the route). */
export async function getDebitNoteTemplateById(id: number) {
  const [row] = await db.select().from(s.debitNoteTemplates)
    .where(and(eq(s.debitNoteTemplates.id, id), isNull(s.debitNoteTemplates.deletedAt))).limit(1);
  return row ?? null;
}
