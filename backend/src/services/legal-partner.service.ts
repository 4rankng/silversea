import { eq } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';

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
  const displayCode = displayTaxCode(taxCode);

  return db.transaction(async (tx) => {
    await lockApplicationOwnedUniqueness(tx, 'partner-normalized-tax-code', [normalizedTaxCode]);

    const [existing] = await tx.select({
      id: s.partners.id,
      displayTaxCode: s.partners.displayTaxCode,
    }).from(s.partners)
      .where(eq(s.partners.normalizedTaxCode, normalizedTaxCode))
      .limit(1);

    if (existing) {
      if (existing.displayTaxCode !== displayCode) {
        await tx.update(s.partners)
          .set({
            displayTaxCode: displayCode,
            updatedAt: new Date(),
          })
          .where(eq(s.partners.id, existing.id));
      }
      return existing.id;
    }

    const [partner] = await tx.insert(s.partners)
      .values({
        normalizedTaxCode,
        displayTaxCode: displayCode,
        currency: DEFAULT_PARTNER_CURRENCY,
      })
      .returning({ id: s.partners.id });

    return partner.id;
  });
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
