import { inArray } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

/**
 * Display-name rule for an expense line, shared by every wallet surface
 * (Lịch sử chi phí "Loại phí", Sổ quỹ "Diễn giải"). Card 071026141580:
 * "khai chi hộ" trip rows carry no custom fee name, and the raw machine code
 * ("OTHER") must never reach a Vietnamese money table — the catalog holds the
 * label ("Phí chi hộ khác").
 *
 * Precedence: a REAL custom name → the catalog label → the code (last resort,
 * only for codes the catalog does not know).
 */
export function pickExpenseDisplayName(
  feeName: string | null | undefined,
  expenseTypeCode: string,
  catalogName: string | null | undefined,
): string {
  const custom = feeName?.trim();
  // A fee_name equal to the machine code is not a name — rows written before
  // the write-path fix stored the code there. Same rule as `listOpsExpenses`.
  if (custom && custom !== expenseTypeCode) return custom;
  return catalogName?.trim() || expenseTypeCode;
}

/** Batch catalog lookup so list mappings resolve names in one query. */
export async function loadExpenseTypeNames(codes: ReadonlyArray<string>): Promise<Map<string, string>> {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ code: s.forwarderExpenseTypes.code, name: s.forwarderExpenseTypes.name })
    .from(s.forwarderExpenseTypes)
    .where(inArray(s.forwarderExpenseTypes.code, unique));
  return new Map(rows.map((row) => [row.code, row.name]));
}
