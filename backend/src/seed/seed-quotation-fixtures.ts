/**
 * Card 20260922_64 — QA fixture quotations with the verbatim "Chi phí khác"
 * catalog (case QA-20260922-07 preconditions: LONG MINH + LOG COM frames).
 * Upsert-only: frames are created when (customer, template) is missing and
 * never overwritten (ruling 6); re-seeds converge instead of clobbering.
 * Amounts are the customer's TẠM defaults stored as DATA (ruling 9a).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { defaultFeeRouting } from '@tingting/shared';
import { upsertQuotationFees } from '../services/quotation.service';

const CATALOG: Array<{ feeName: string; subType?: string; defaultAmount?: number; note?: string }> = [
  { feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000 },
  { feeName: 'Phí mở tờ khai', subType: 'Hàng đặc thù', note: 'trao đổi với khách' },
  { feeName: 'Hải quan giám sát', defaultAmount: 150000 },
  { feeName: 'Hải quan giám sát', subType: 'Luồng xanh/vàng', defaultAmount: 150000 },
  { feeName: 'Hải quan giám sát', subType: 'Luồng đỏ', defaultAmount: 250000 },
  { feeName: 'Nâng/Hạ Lạch Huyện', defaultAmount: 500000 },
  { feeName: 'Lưu ca xe', defaultAmount: 1000000 },
  { feeName: 'Soi chiếu', subType: 'quy trình soi', defaultAmount: 500000 },
  { feeName: 'Soi chiếu', subType: 'Kéo cont đi soi', defaultAmount: 1200000 },
  { feeName: 'Kiểm hóa' },
  { feeName: 'Kẹp chì hải quan', defaultAmount: 100000 },
];

async function ensureCustomerByNameLike(namePart: string): Promise<number | null> {
  const [existing] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      isNull(s.customers.deletedAt),
      sql`lower(btrim(${s.customers.name})) like ${`%${namePart.toLowerCase()}%`}`,
    ))
    .limit(1);
  return existing?.id ?? null;
}

async function ensureCustomer(name: string, taxCode: string): Promise<number> {
  const [existing] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      isNull(s.customers.deletedAt),
      sql`lower(btrim(${s.customers.taxCode})) = ${taxCode.toLowerCase().trim()}`,
    ))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.customers)
    .values({ name, taxCode, status: 'ACTIVE' })
    .returning();
  return created.id;
}

export async function seedQuotationFixtures(): Promise<void> {
  // LONG MINH already exists from the master-data sheet run — reuse it.
  const longMinhId = await ensureCustomerByNameLike('long minh');
  if (longMinhId == null) {
    console.log('  ⚠️ Quotation fixtures skipped: LONG MINH not found (run the master-data seed first).');
    return;
  }
  const logcomId = await ensureCustomer('Công ty TNHH LOG COM Việt Nam', '9999888877');

  let createdFrames = 0;
  for (const [customerId, templateName] of [
    [longMinhId, 'Mẫu báo giá 1'],
    [logcomId, 'Mẫu LOG COM'],
  ] as const) {
    const [existing] = await db.select({ id: s.quotations.id })
      .from(s.quotations)
      .where(and(
        eq(s.quotations.customerId, customerId),
        eq(s.quotations.templateName, templateName),
        isNull(s.quotations.deletedAt),
      ))
      .limit(1);
    if (existing) continue;
    const { id } = await createQuotationFrame(customerId, templateName);
    await upsertQuotationFees(id, CATALOG.map((fee, index) => ({
      feeName: fee.feeName,
      subType: fee.subType ?? null,
      defaultAmount: fee.defaultAmount ?? null,
      note: fee.note ?? null,
      routing: defaultFeeRouting(fee.feeName),
      sortOrder: index,
    })));
    createdFrames += 1;
  }
  console.log(`  ✅ Quotation fixtures: +${createdFrames} frame(s) with the Chi-phí-khác catalog (card _64)`);
}

async function createQuotationFrame(customerId: number, templateName: string): Promise<{ id: number }> {
  const [row] = await db.insert(s.quotations).values({
    customerId,
    templateName,
    effectiveDate: '2026-09-15',
    surchargeRoundingMode: 'NONE',
  }).returning({ id: s.quotations.id });
  return row;
}
