import { eq } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import {
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_POLICY_DEFAULTS,
  OPS_EXPENSE_TYPE_DEFAULTS,
} from '@tingting/shared';
import { expenseTypeSeedPolicy } from '../expense-type-seed-policy';
import { normalizeSeedText } from './seed-identity';

/** Card 20260922_1 — the fill-only forwarder expense-type catalog seed,
 *  extracted verbatim from the demo seed so a CUT can run it (the make-demo
 *  seed step) without demo data. FILLS, never overwrites: a missing code
 *  inserts with the policy defaults; an existing row whose category is NULL
 *  gets exactly that column backfilled; rows already carrying a category —
 *  and every admin-editable field (name, invoice policy, markup, label, VAT)
 *  — are never written; soft-deleted rows stay deleted (an admin's deletion
 *  is admin data). QA's hand-seeded staging rows are recognized as existing
 *  by the normalized-code match. */
export async function seedForwarderExpenseTypes(): Promise<{ inserted: number; backfilled: number }> {
  let inserted = 0;
  let backfilled = 0;
  const existing = await db.select({
    id: schema.forwarderExpenseTypes.id,
    code: schema.forwarderExpenseTypes.code,
    category: schema.forwarderExpenseTypes.category,
    deletedAt: schema.forwarderExpenseTypes.deletedAt,
  }).from(schema.forwarderExpenseTypes);
  const byCode = new Map(
    existing
      .filter((row) => row.code)
      .map((row) => [normalizeSeedText(row.code), row] as const),
  );
  for (const [code, meta] of Object.entries(OPS_EXPENSE_TYPE_DEFAULTS)) {
    const policy = expenseTypeSeedPolicy(code);
    const values = {
      code,
      name: meta.name,
      requiresInvoice: policy.requiresInvoice,
      substituteEvidenceAllowed: policy.substituteEvidenceAllowed,
      noInvoiceEvidenceTypes: policy.substituteEvidenceAllowed ? [...DEFAULT_NO_INVOICE_EVIDENCE_TYPES] : [],
      noInvoicePerItemLimit: String(NO_INVOICE_POLICY_DEFAULTS.perItemLimit),
      noInvoicePerDayLimit: String(NO_INVOICE_POLICY_DEFAULTS.perDayLimit),
      defaultMarkup: meta.defaultMarkup,
      billingLabel: meta.billingLabel,
      vatRate: '0.080',
      category: meta.category ?? null,
    } as const;
    const hit = byCode.get(normalizeSeedText(code));
    if (hit == null) {
      await db.insert(schema.forwarderExpenseTypes).values(values);
      inserted += 1;
    } else if (hit.deletedAt == null && hit.category == null && meta.category != null) {
      backfilled += 1;
      await db.update(schema.forwarderExpenseTypes)
        .set({ category: meta.category, updatedAt: new Date() })
        .where(eq(schema.forwarderExpenseTypes.id, hit.id));
    }
  }
  return { inserted, backfilled };
}
