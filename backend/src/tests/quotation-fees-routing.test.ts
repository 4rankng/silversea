// Card _64 Phase A — active-frame fee catalog endpoint contract.
// Pins (Lead-approved): frame selection = latest effectiveDate ≤ today;
// deterministic catalog order (sortOrder, id); worked-example reconciliation
// to the đồng (other-costs bucket 1.100.000 exactly, DEDICATED_* excluded,
// null defaults excluded — never 0).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { inArray } from 'drizzle-orm';
import { db, client } from '../db';
import * as s from '../db/schema';
import { listActiveQuotationFeesForCustomer } from '../services/quotation.service';

const ids: {
  customers: number[]; frames: number[]; fees: number[]; foreignFees: number[];
} = { customers: [], frames: [], fees: [], foreignFees: [] };
const key = `q64-${Date.now()}-${Math.random().toString(36).slice(2)}`;

test('active-frame fee catalog: selection rule, scoping, order, and the đồng', async () => {
  const [customerA] = await db.insert(s.customers).values({ name: `Khách A ${key}` }).returning();
  const [customerB] = await db.insert(s.customers).values({ name: `Khách B ${key}` }).returning();
  ids.customers.push(customerA.id, customerB.id);

  const insertFrame = async (customerId: number, effectiveDate: string, templateName: string) => {
    const [frame] = await db.insert(s.quotations).values({ customerId, effectiveDate, templateName }).returning();
    ids.frames.push(frame.id);
    return frame;
  };
  const insertFees = async (quotationId: number, rows: Array<{ feeName: string; subType: string | null; defaultAmount: string | null; routing: string }>) => {
    for (const [index, fee] of rows.entries()) {
      const [row] = await db.insert(s.quotationFees).values({ quotationId, ...fee, sortOrder: index }).returning();
      ids.fees.push(row.id);
    }
  };

  // Frame selection: NEW (2026-09-15) beats OLD (2026-09-01); a future frame
  // (2027-01-01) must NEVER be selected (effective ≤ today pin).
  const frameOld = await insertFrame(customerA.id, '2026-09-01', `Cũ ${key}`);
  const frameNew = await insertFrame(customerA.id, '2026-09-15', `Mới ${key}`);
  await insertFrame(customerA.id, '2027-01-01', `Tương lai ${key}`);
  await insertFees(frameOld.id, [
    { feeName: 'Phí frame cũ', subType: null, defaultAmount: '99000', routing: 'OTHER_COSTS' },
  ]);
  await insertFees(frameNew.id, [
    { feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: '500000', routing: 'OTHER_COSTS' },
    { feeName: 'Hải quan giám sát', subType: 'Luồng xanh/vàng', defaultAmount: '150000', routing: 'DEDICATED_CUSTOMS' },
    { feeName: 'Nâng/Hạ Lạch Huyện', subType: null, defaultAmount: '500000', routing: 'DEDICATED_DEPOT' },
    { feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: '500000', routing: 'OTHER_COSTS' },
    { feeName: 'Kẹp chì hải quan', subType: null, defaultAmount: '100000', routing: 'OTHER_COSTS' },
    { feeName: 'Kiểm hóa', subType: null, defaultAmount: null, routing: 'OTHER_COSTS' },
  ]);

  const items = await listActiveQuotationFeesForCustomer(customerA.id);

  // Selection: exactly the NEW frame's catalog, in (sortOrder, id) order.
  assert.deepEqual(items.map((fee) => fee.feeName), [
    'Phí mở tờ khai', 'Hải quan giám sát', 'Nâng/Hạ Lạch Huyện', 'Soi chiếu', 'Kẹp chì hải quan', 'Kiểm hóa',
  ], 'active frame = latest effective ≤ today, deterministic catalog order');
  assert.deepEqual(items.map((fee) => fee.routing), [
    'OTHER_COSTS', 'DEDICATED_CUSTOMS', 'DEDICATED_DEPOT', 'OTHER_COSTS', 'OTHER_COSTS', 'OTHER_COSTS',
  ], 'routing travels opaque');
  assert.equal(items.find((fee) => fee.feeName === 'Kiểm hóa')?.defaultAmount, null, 'ruling 9b: null default stays null (never 0)');

  // Worked example to the đồng: the chi-phí-khác bucket = OTHER_COSTS fees
  // with a non-null default, summed exactly. DEDICATED_* and null defaults
  // never enter the bucket.
  const otherCostsTotal = items
    .filter((fee) => fee.routing === 'OTHER_COSTS' && fee.defaultAmount != null)
    .reduce((sum, fee) => sum + (fee.defaultAmount ?? 0), 0);
  assert.equal(otherCostsTotal, 1100000, '500.000 + 500.000 + 100.000 = 1.100.000 exactly');

  // Scoping: another customer sees only their own frame's catalog; a
  // customer with no frame at all sees an empty list.
  const frameB = await insertFrame(customerB.id, '2026-09-10', `B ${key}`);
  await insertFees(frameB.id, [
    { feeName: 'Lưu ca xe', subType: null, defaultAmount: '1000000', routing: 'OTHER_COSTS' },
  ]);
  const itemsB = await listActiveQuotationFeesForCustomer(customerB.id);
  assert.deepEqual(itemsB.map((fee) => fee.feeName), ['Lưu ca xe'], 'per-customer scoping');
  assert.equal(itemsB.some((fee) => fee.feeName === 'Phí mở tờ khai'), false, "customer A's fees never leak to B");

  const empty = await db.insert(s.customers).values({ name: `Không frame ${key}` }).returning();
  ids.customers.push(empty[0].id);
  assert.deepEqual(await listActiveQuotationFeesForCustomer(empty[0].id), [], 'no frame → empty catalog');
});

after(async () => {
  try {
    if (ids.fees.length) await db.delete(s.quotationFees).where(inArray(s.quotationFees.id, ids.fees));
    if (ids.frames.length) await db.delete(s.quotations).where(inArray(s.quotations.id, ids.frames));
    if (ids.customers.length) await db.delete(s.customers).where(inArray(s.customers.id, ids.customers));
  } finally {
    await client.end();
  }
});
