/**
 * Seed customer AR through domain services:
 *   1. e-POD chain on every completed trip (submission → required files →
 *      submit → CUS acceptance sets podRecovered + completion recompute)
 *   2. DEBIT_NOTE draft → save (ISSUE via governance) for one customer
 *   3. payment receipt with per-trip allocations → PAYMENT_RECEIVED ledger
 *
 * The e-POD chain must run BEFORE billing: debit-note candidate trips require
 * an ACCEPTED submission.
 *
 * Part of plans/260817-2148-seed-full-coverage.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { generateDraft, saveDocument } from '../services/billingDocument.service';
import { recordPaymentReceipt } from '../services/payment-allocation.service';
import type { AuthUser } from '../middleware/auth';

/** Minimal valid PDF (header + one empty page + trailer). */
function minimalPdf(label: string): { buffer: Buffer; mimetype: string; originalname: string; size: number } {
  const content = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R>>endobj
4 0 obj<</Length ${label.length}>>stream
${label}
endstream endobj
trailer<</Root 1 0 R>>
%%EOF`;
  const buffer = Buffer.from(content, 'utf8');
  return { buffer, mimetype: 'application/pdf', originalname: `${label}.pdf`, size: buffer.length };
}

export async function seedCustomerAr(actors: {
  cus: AuthUser;
  accountant: AuthUser;
  manager: AuthUser;
}): Promise<void> {
  // Accepted e-PODs are produced by the trip seed chain (seed-trips.ts) —
  // the debit-note candidates depend on them.
  await seedDebitNote(actors);
  await seedPaymentReceipt(actors);
}

async function seedDebitNote(actors: { cus: AuthUser; manager: AuthUser }) {
  // One debit note for the first customer with billing-eligible trips.
  const [customer] = await db.select({ id: s.customers.id, name: s.customers.name })
    .from(s.customers)
    .where(and(isNull(s.customers.deletedAt), eq(s.customers.isCarrier, false)))
    .orderBy(s.customers.id)
    .limit(1);
  if (!customer) {
    console.warn('  ⚠️ Debit note seed: no customer');
    return;
  }

  const existing = await db.select({ id: s.billingDocuments.id })
    .from(s.billingDocuments)
    .where(eq(s.billingDocuments.entityId, customer.id))
    .limit(1);
  if (existing.length > 0) {
    console.log('✅ Debit note already seeded.');
    return;
  }

  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: '2026-07-01',
    rangeTo: '2026-08-16',
  });
  if (draft.lines.length === 0) {
    console.warn('  ⚠️ Debit note seed: no eligible lines (trips lack revenue?)');
    return;
  }
  const saved = await saveDocument({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customer.id,
    rangeFrom: draft.rangeFrom ?? '2026-07-01',
    rangeTo: draft.rangeTo ?? '2026-08-16',
    note: 'Giấy báo nợ kỳ 16/07 - 16/08 (seed)',
  }, actors.manager.userId);
  console.log(`✅ Debit note saved! (#${saved.id}, ${draft.lines.length} lines, total ${saved.totalInclVat})`);
}

async function seedPaymentReceipt(actors: { cus: AuthUser; manager: AuthUser }) {
  const RECEIPT_ID = 'SEED-PT-2608-001';
  const [existing] = await db.select({ id: s.paymentReceipts.id })
    .from(s.paymentReceipts).where(eq(s.paymentReceipts.receiptId, RECEIPT_ID)).limit(1);
  if (existing) {
    console.log('✅ Payment receipt already seeded.');
    return;
  }

  const [customer] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(isNull(s.customers.deletedAt), eq(s.customers.isCarrier, false)))
    .orderBy(s.customers.id)
    .limit(1);
  if (!customer) return;

  await recordPaymentReceipt({
    customerId: customer.id,
    receiptId: RECEIPT_ID,
    amount: 25000000,
    allocatedBy: actors.manager.userId,
  });
  console.log('✅ Payment receipt seeded!');
}
