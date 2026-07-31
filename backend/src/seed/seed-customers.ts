/**
 * Seed customers and the linked supplier records from the customer's
 * THÔNG TIN NCC sheet. Long Minh is both the cargo-owning customer and the
 * debit-note recipient, so we create a partner + customer + linked supplier.
 *
 * Also seeds app_settings company identity (Silver Sea) from the DEBIT LONG
 * MINH template header, so exports carry the real issuer identity.
 *
 * Part of plans/260731-customer-audit-reseed.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema.js';
import { COMPANY_INFO_SETTING_KEYS } from '../services/company-info.service.js';
import { customers, companyIdentity } from './data/index.js';

/** Normalize a tax code for the partners.unique_normalized_tax_code index. */
function normTax(t: string): string {
  return (t || '').trim().toUpperCase().replace(/\s+/g, '');
}

export interface CustomerSeedResult {
  customerByCode: Map<string, number>; // internalCode -> customerId
}

export async function seedCustomers(): Promise<CustomerSeedResult> {
  const customerByCode = new Map<string, number>();
  if (customers.length === 0) return { customerByCode };

  for (const c of customers) {
    const normalized = normTax(c.taxCode);
    // Upsert partner on normalized_tax_code (unique index).
    const [partner] = await db.insert(s.partners).values({
      normalizedTaxCode: normalized,
      displayTaxCode: c.taxCode.trim(),
      currency: 'VND',
    }).onConflictDoUpdate({
      target: s.partners.normalizedTaxCode,
      set: { displayTaxCode: c.taxCode.trim(), updatedAt: new Date() },
    }).returning({ id: s.partners.id });

    // Supplier has no unique constraint besides PK — guard against dupes by
    // looking up (name, partnerId) first, then insert-or-update in JS.
    const existingSupplier = await db.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(sql`lower(btrim(${s.suppliers.name})) = lower(btrim(${c.name})) AND ${s.suppliers.partnerId} = ${partner!.id}`);
    const supplierRow = {
      name: c.name,
      taxCode: c.taxCode,
      partnerId: partner!.id,
      phone: c.directorPhone || null,
      note: c.email ? `Email: ${c.email}` : null,
      status: 'ACTIVE',
      updatedAt: new Date(),
    };
    let supplierId: number;
    if (existingSupplier.length > 0) {
      await db.update(s.suppliers).set(supplierRow).where(sql`${s.suppliers.id} = ${existingSupplier[0]!.id}`);
      supplierId = existingSupplier[0]!.id;
    } else {
      const [ins] = await db.insert(s.suppliers).values(supplierRow).returning({ id: s.suppliers.id });
      supplierId = ins!.id;
    }

    // Upsert customer on (name, taxCode) partial unique where deletedAt is null.
    const [customer] = await db.insert(s.customers).values({
      name: c.name,
      taxCode: c.taxCode,
      partnerId: partner!.id,
      contactPerson: c.manager || null,
      phone: c.directorPhone || null,
      contactInfo: c.email || null,
      // payment-term days drive AR aging (M5.1). Long Minh: 15 days cước.
      paymentTermDays: c.paymentTermCuocDays ?? null,
      status: 'ACTIVE',
      debitNoteMode: 'MONTHLY',
      linkedSupplierId: supplierId,
    }).onConflictDoUpdate({
      target: [s.customers.name, s.customers.taxCode],
      set: {
        partnerId: partner!.id,
        contactPerson: c.manager || null,
        phone: c.directorPhone || null,
        contactInfo: c.email || null,
        paymentTermDays: c.paymentTermCuocDays ?? null,
        linkedSupplierId: supplierId,
        updatedAt: new Date(),
      },
    }).returning({ id: s.customers.id });

    customerByCode.set(c.internalCode, customer!.id);
  }

  await seedCompanySettings();
  console.log(`✅ Customers seeded! (${customers.length})`);
  for (const c of customers) console.log(`   • ${c.internalCode} → ${c.name}`);
  return { customerByCode };
}

/**
 * Seed Silver Sea company identity into app_settings. The customer explicitly
 * wants their real data here (plan D1), so we upsert (not DoNothing) — this is
 * the source of truth for export headers.
 */
async function seedCompanySettings(): Promise<void> {
  const settings: Array<[string, string]> = [
    [COMPANY_INFO_SETTING_KEYS.name, companyIdentity.name],
    [COMPANY_INFO_SETTING_KEYS.address, companyIdentity.address],
    [COMPANY_INFO_SETTING_KEYS.taxCode, companyIdentity.taxCode],
    [COMPANY_INFO_SETTING_KEYS.phone, companyIdentity.phone],
    [COMPANY_INFO_SETTING_KEYS.email, companyIdentity.email],
    [COMPANY_INFO_SETTING_KEYS.bankAccount, companyIdentity.bankAccount],
    [COMPANY_INFO_SETTING_KEYS.bankName, companyIdentity.bankName],
    [COMPANY_INFO_SETTING_KEYS.representative, companyIdentity.representative],
  ];
  for (const [key, value] of settings) {
    if (!value) continue;
    await db.insert(s.appSettings).values({ key, value })
      .onConflictDoUpdate({ target: s.appSettings.key, set: { value } });
  }
  console.log(`✅ Company identity seeded (Silver Sea, MST ${companyIdentity.taxCode})`);
}
