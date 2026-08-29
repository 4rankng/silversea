/** Seed the customer-provided freight-price matrix as explicit price classes. */
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { pricing } from './data/index.js';
import type { CustomerSeedResult } from './seed-customers.js';
import type { ReferenceSeedResult } from './seed-reference.js';

const LONG_MINH_CUSTOMER_CODE = 'LONG MINH';
const EFFECTIVE_DATE = '2026-07-30';

export async function seedPricingTables(reference: ReferenceSeedResult, customers: CustomerSeedResult): Promise<void> {
  const customerId = customers.customerByCode.get(LONG_MINH_CUSTOMER_CODE);
  if (customerId == null) throw new Error('Không tìm thấy khách hàng LONG MINH để nạp bảng giá cước');

  let persisted = 0;
  let withheld = 0;
  for (const row of pricing) {
    const routeId = reference.routeByName.get(row.route.toLowerCase());
    if (routeId == null) throw new Error(`Không tìm thấy tuyến đường cho bảng giá: ${row.route}`);
    const existing = await db.select({ id: s.pricingTables.id })
      .from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, customerId),
        eq(s.pricingTables.routeId, routeId),
        eq(s.pricingTables.rateKey, row.size),
        eq(s.pricingTables.effectiveDate, EFFECTIVE_DATE),
        isNull(s.pricingTables.containerTypeId),
      ))
      .limit(1);
    if (row.basePrice == null || row.basePrice <= 0) {
      if (existing[0]) {
        await db.update(s.pricingTables).set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(eq(s.pricingTables.id, existing[0].id));
      }
      withheld += 1;
      continue;
    }

    const values = {
      customerId,
      routeId,
      price: String(row.basePrice),
      rateKey: row.size,
      effectiveDate: EFFECTIVE_DATE,
      deletedAt: null,
      updatedAt: new Date(),
    };
    if (existing[0]) {
      await db.update(s.pricingTables).set(values).where(eq(s.pricingTables.id, existing[0].id));
    } else {
      await db.insert(s.pricingTables).values(values);
    }
    persisted += 1;
  }
  console.log(`✅ Freight pricing seeded! (${persisted} active rows; ${withheld} zero/blank source rows withheld for manual pricing)`);
}
