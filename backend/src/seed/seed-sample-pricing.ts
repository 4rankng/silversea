/**
 * Seed freight pricing for the demo sample customers across the three seeded
 * routes so trip creation resolves a non-zero TABLE price (revenue), which
 * the debit-note/AR chain derives from. LONG MINH pricing already comes from
 * the customer-audit seeder — this covers the remaining demo customers.
 *
 * Idempotent: keyed on (customer, route, container_type, effective_date).
 * Part of plans/260817-2148-seed-full-coverage.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';

const EFFECTIVE_DATE = '2026-07-01';

export async function seedSamplePricing(): Promise<void> {
  const routes = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes).where(isNull(s.routes.deletedAt));
  const containerTypes = await db.select({ id: s.containerTypes.id, code: s.containerTypes.code })
    .from(s.containerTypes)
    .where(and(isNull(s.containerTypes.deletedAt), inArray(s.containerTypes.code, ['40DC', '40HC'])));
  const customers = await db.select({ id: s.customers.id, name: s.customers.name, isCarrier: s.customers.isCarrier })
    .from(s.customers).where(isNull(s.customers.deletedAt));

  // Realistic per-km pricing bands by route (VND per one-way container trip).
  const routeBase: Record<string, number> = {
    'Hải Phòng-NEWEB': 3200000,
    'ASKEY': 3050000,
    'SUNRISE+  SJ': 3450000,
  };

  let created = 0;
  for (const customer of customers) {
    if (customer.isCarrier) continue; // carriers are not billed freight
    for (const route of routes) {
      const base = routeBase[route.name];
      if (base == null) continue;
      for (const ct of containerTypes) {
        const price = ct.code === '40HC' ? base + 150000 : base;
        const [existing] = await db.select({ id: s.pricingTables.id })
          .from(s.pricingTables)
          .where(and(
            eq(s.pricingTables.customerId, customer.id),
            eq(s.pricingTables.routeId, route.id),
            eq(s.pricingTables.containerTypeId, ct.id),
            eq(s.pricingTables.effectiveDate, EFFECTIVE_DATE),
            isNull(s.pricingTables.deletedAt),
          )).limit(1);
        if (existing) continue;
        await db.insert(s.pricingTables).values({
          customerId: customer.id,
          routeId: route.id,
          containerTypeId: ct.id,
          price: String(price),
          effectiveDate: EFFECTIVE_DATE,
        });
        created++;
      }
    }
  }
  console.log(`✅ Sample customer pricing seeded! (${created} new rows)`);
}
