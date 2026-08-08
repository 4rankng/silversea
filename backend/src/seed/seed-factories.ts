/**
 * Seed operational sites (factories/warehouses) from customer Excel data
 * Extracted from "29.7 - DATA PM.xlsx" - NHÀ MÁY sheet
 */
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema.js';
import { factories } from './data/index.js';
import { normalizedTextEquals } from './seed-identity.js';

/**
 * Seed factories/warehouses as operational sites
 * These are used in shipment intake forms for "Điểm lấy hàng"
 */
export async function seedFactories(): Promise<void> {
  if (factories.length === 0) {
    console.log('✅ No factories to seed (empty data)');
    return;
  }

  // Get LONG MINH customer ID
  const [longMinhCustomer] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      normalizedTextEquals(s.customers.name, 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH'),
      sql`LOWER(${s.customers.taxCode}) = LOWER('2300540419')`
    ))
    .limit(1);

  if (!longMinhCustomer) {
    console.log('⚠️  LONG MINH customer not found, skipping factory seed');
    return;
  }

  let createdCount = 0;
  let updatedCount = 0;

  for (const factory of factories) {
    // Generate code from factory name (uppercase, no spaces)
    const code = factory.name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .substring(0, 80);

    // Check if factory already exists by name and customer
    const [existing] = await db.select({ id: s.operationalSites.id })
      .from(s.operationalSites)
      .where(and(
        eq(s.operationalSites.customerId, longMinhCustomer.id),
        normalizedTextEquals(s.operationalSites.name, factory.name)
      ))
      .limit(1);

    const values = {
      customerId: longMinhCustomer.id,
      code,
      name: factory.name,
      siteType: 'WAREHOUSE' as const,
      address: factory.address || 'Địa chỉ theo file Excel',
      googleMapsUrl: factory.locationUrl || null,
      strictRules: factory.note || null,
    };

    if (existing) {
      await db.update(s.operationalSites)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.operationalSites.id, existing.id));
      updatedCount++;
    } else {
      await db.insert(s.operationalSites).values(values);
      createdCount++;
    }
  }

  console.log(`✅ Factories seeded! (${createdCount} new, ${updatedCount} updated)`);
  for (const f of factories) {
    console.log(`   • ${f.name}`);
  }
}
