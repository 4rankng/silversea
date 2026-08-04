/**
 * Seed customer-owned operational sites (factories + pickup warehouses).
 *
 * The shipment intake form requires a factory ("Nhà máy") for FCL shipments
 * and a warehouse ("Kho lấy hàng") for LCL shipments. Without seeded sites
 * the dropdowns render empty and the form cannot be submitted, which is
 * exactly the customer-facing bug this seeder closes. Sites are linked to
 * customers by their stable tax code so re-runs are idempotent regardless
 * of how the customer row was first created (sample seed vs. customer-data
 * reseed).
 *
 * Part of plans/260804-factory-dropdown-fix.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { OperationalSiteType } from '@tingting/shared';
import { db } from '../db/index.js';
import * as s from '../db/schema.js';

interface SiteSeed {
  customerTaxCode: string;
  code: string;
  name: string;
  siteType: OperationalSiteType;
  address: string;
  googleMapsUrl?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
}

// Real-ish Vietnamese factory/warehouse addresses tied to the seeded
// customers' operating regions. Codes are unique per customer (enforced by
// the operational_sites_customer_code_uniq_idx partial index).
const SITES: SiteSeed[] = [
  {
    customerTaxCode: '0101234567', // Công ty CP Vận tải Biển Bạc
    code: 'BB-KHO-LONG-BIEN',
    name: 'Kho Biển Bạc - Long Biên',
    siteType: OperationalSiteType.FACTORY,
    address: 'KCN Đài Linh, Phường Long Biên, Quận Long Biên, Hà Nội',
    contactName: 'Phạm Thị Biển',
    contactPhone: '02253555555',
  },
  {
    customerTaxCode: '0101234567', // Công ty CP Vận tải Biển Bạc
    code: 'BB-KHO-DA-NANG',
    name: 'Kho Biển Bạc - Đà Nẵng',
    siteType: OperationalSiteType.WAREHOUSE,
    address: 'KCN Hòa Khánh, Quận Liên Chiểu, Đà Nẵng',
    contactName: 'Phạm Thị Biển',
    contactPhone: '02253555555',
  },
  {
    customerTaxCode: '0107654321', // Công ty TNHH XNK Hà Nội
    code: 'XNK-ICD-HA-NOI',
    name: 'ICD Hà Nội',
    siteType: OperationalSiteType.WAREHOUSE,
    address: 'ICD Hà Nội, Km 9+500 Đại lộ Thăng Long, Hà Nội',
    contactName: 'Trịnh Văn Hà',
    contactPhone: '02438888888',
  },
  {
    customerTaxCode: '0107654321', // Công ty TNHH XNK Hà Nội
    code: 'XNK-NHA-MAY-BAC-SON',
    name: 'Nhà máy Bắc Sơn',
    siteType: OperationalSiteType.FACTORY,
    address: 'KCN Bắc Sơn, Xã Tân Dân, Sóc Sơn, Hà Nội',
    contactName: 'Trịnh Văn Hà',
    contactPhone: '02438888888',
  },
  {
    customerTaxCode: '2300540419', // CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH
    code: 'LM-NHA-MAY-VO-CUONG',
    name: 'Nhà máy Long Minh - Võ Cường',
    siteType: OperationalSiteType.FACTORY,
    address: 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
    contactName: 'Ms. Vân',
    contactPhone: null,
  },
];

function normTax(t: string): string {
  return (t || '').trim().toLowerCase().replace(/\s+/g, '');
}

export async function seedOperationalSites(): Promise<void> {
  if (SITES.length === 0) return;

  // Resolve customer once per tax code so the seeder is stable across
  // customer reseed paths (sample seed vs. customer-data extractor).
  const byTax = new Map<string, number>();
  for (const seed of SITES) {
    const key = normTax(seed.customerTaxCode);
    if (byTax.has(key)) continue;
    const [customer] = await db.select({ id: s.customers.id }).from(s.customers)
      .where(and(
        eq(sql`lower(btrim(${s.customers.taxCode}))`, key),
        isNull(s.customers.deletedAt),
      ))
      .limit(1);
    if (!customer) continue; // Customer not seeded yet; skip silently.
    byTax.set(key, customer.id);
  }

  let created = 0;
  let updated = 0;
  for (const seed of SITES) {
    const customerId = byTax.get(normTax(seed.customerTaxCode));
    if (!customerId) continue;

    const [existing] = await db.select().from(s.operationalSites).where(and(
      eq(s.operationalSites.customerId, customerId),
      eq(s.operationalSites.code, seed.code),
      isNull(s.operationalSites.deletedAt),
    )).limit(1);

    const values = {
      customerId,
      code: seed.code,
      name: seed.name,
      siteType: seed.siteType,
      address: seed.address,
      googleMapsUrl: seed.googleMapsUrl ?? null,
      contactName: seed.contactName ?? null,
      contactPhone: seed.contactPhone ?? null,
      updatedAt: new Date(),
    } as const;

    if (existing) {
      await db.update(s.operationalSites)
        .set({ ...values, version: sql`${s.operationalSites.version} + 1` })
        .where(eq(s.operationalSites.id, existing.id));
      updated += 1;
    } else {
      await db.insert(s.operationalSites).values({ ...values, isActive: true });
      created += 1;
    }
  }

  console.log(`✅ Operational sites seeded! (${created} new, ${updated} updated)`);
  for (const seed of SITES) {
    console.log(`   • [${seed.siteType}] ${seed.code} → ${seed.name}`);
  }
}
