import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';

const DEFAULT_PARTNER_CURRENCY = 'VND' as const;

export function normalizeTaxCode(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function displayTaxCode(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '');
}

export async function upsertPartnerFromTaxCode(
  taxCode: string | null | undefined,
): Promise<number | null> {
  const normalizedTaxCode = normalizeTaxCode(taxCode);
  if (!normalizedTaxCode) return null;

  const [partner] = await db.insert(s.partners)
    .values({
      normalizedTaxCode,
      displayTaxCode: displayTaxCode(taxCode),
      currency: DEFAULT_PARTNER_CURRENCY,
    })
    .onConflictDoUpdate({
      target: s.partners.normalizedTaxCode,
      set: {
        displayTaxCode: displayTaxCode(taxCode),
        updatedAt: new Date(),
      },
    })
    .returning({ id: s.partners.id });

  return partner.id;
}

export async function syncCustomerPartner(customer: {
  id: number;
  taxCode: string | null;
}) {
  const partnerId = await upsertPartnerFromTaxCode(customer.taxCode);
  await db.update(s.customers)
    .set({
      partnerId,
      updatedAt: new Date(),
    })
    .where(eq(s.customers.id, customer.id));
}

export async function syncSupplierPartner(supplier: {
  id: number;
  taxCode: string | null;
}) {
  const partnerId = await upsertPartnerFromTaxCode(supplier.taxCode);
  await db.update(s.suppliers)
    .set({
      partnerId,
      updatedAt: new Date(),
    })
    .where(eq(s.suppliers.id, supplier.id));
}

export const PARTNER_DEFAULT_CURRENCY = DEFAULT_PARTNER_CURRENCY;
