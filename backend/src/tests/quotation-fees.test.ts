/**
 * Card 20260922_64 — per-customer "Chi phí khác" fee catalog.
 *
 * Contract: catalog rows ride the quotation frame (verbatim names + sub-
 * classifications + TẠM default amounts, Kiểm hóa pending-null); routing is
 * data (DEDICATED_CUSTOMS / DEDICATED_DEPOT / OTHER_COSTS) classified
 * at entry by defaultFeeRouting; edits are per-customer isolated; the _57
 * importer upserts through upsertQuotationFees.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { defaultFeeRouting } from '@tingting/shared';
import {
  createQuotation, getQuotation, updateQuotation, upsertQuotationFees,
} from '../services/quotation.service';

const suffix = `q64-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  routeIds: [] as number[],
  quotationIds: [] as number[],
};

let longMinhId = 0;
let logcomId = 0;

async function mkCustomer(name: string): Promise<number> {
  const [c] = await db.insert(s.customers).values({ name }).returning();
  created.customerIds.push(c.id);
  return c.id;
}

const CATALOG = [
  { feeName: 'Phí mở tờ khai', subType: 'Hàng thông thường', defaultAmount: 500000 },
  { feeName: 'Phí mở tờ khai', subType: 'Hàng đặc thù' },
  { feeName: 'Hải quan giám sát', defaultAmount: 150000 },
  { feeName: 'Hải quan giám sát', subType: 'Luồng xanh/vàng', defaultAmount: 150000 },
  { feeName: 'Hải quan giám sát', subType: 'Luồng đỏ', defaultAmount: 250000 },
  { feeName: 'Nâng/Hạ Lạch Huyện', defaultAmount: 500000 },
  { feeName: 'Lưu ca xe', defaultAmount: 1000000 },
  { feeName: 'Soi chiếu', subType: 'Kéo cont đi soi', defaultAmount: 1200000 },
  { feeName: 'Kiểm hóa' },
  { feeName: 'Kẹp chì hải quan', defaultAmount: 100000 },
];

before(async () => {
  longMinhId = await mkCustomer(`Q64 LONG MINH ${suffix}`);
  logcomId = await mkCustomer(`Q64 LOG COM ${suffix}`);
});

after(async () => {
  for (const qid of created.quotationIds) {
    await db.delete(s.quotationFees).where(eq(s.quotationFees.quotationId, qid));
    await db.delete(s.quotations).where(eq(s.quotations.id, qid));
  }
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});

describe('quotation fee catalog (card 20260922_64)', () => {
  test('A1 verbatim catalog roundtrip incl. sub-types and pending-null Kiểm hóa', async () => {
    const { id } = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu báo giá 1',
      effectiveDate: '2026-09-15',
      fees: CATALOG,
    });
    created.quotationIds.push(id);
    const view = await getQuotation(id);
    assert.equal(view.fees.length, CATALOG.length);
    assert.equal(view.fees[0].feeName, 'Phí mở tờ khai');
    assert.equal(view.fees[0].subType, 'Hàng thông thường');
    assert.equal(view.fees[0].defaultAmount, 500000);
    const kiemHoa = view.fees.find((f) => f.feeName === 'Kiểm hóa');
    assert.ok(kiemHoa);
    assert.equal(kiemHoa.defaultAmount, null); // ruling 9b: pending-empty
    const customs = view.fees.filter((f) => f.feeName === 'Hải quan giám sát');
    assert.equal(customs.length, 3); // base + xanh/vàng + đỏ sub-classifications
    assert.ok(customs.every((f) => f.routing === 'DEDICATED_CUSTOMS'));
  });

  test('A2 routing defaults classify the two dedicated fees, others ride other-costs', () => {
    assert.equal(defaultFeeRouting('Hải quan giám sát'), 'DEDICATED_CUSTOMS');
    assert.equal(defaultFeeRouting('Nâng/Hạ Lạch Huyện'), 'DEDICATED_DEPOT');
    assert.equal(defaultFeeRouting('Lưu ca xe'), 'OTHER_COSTS');
    assert.equal(defaultFeeRouting('Phí mở tờ khai'), 'OTHER_COSTS');
  });

  test('A5 isolation: LONG MINH edit leaves LOG COM untouched', async () => {
    const a = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu A',
      effectiveDate: '2026-09-15',
      fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 500000 }],
    });
    created.quotationIds.push(a.id);
    const b = await createQuotation({
      customerId: logcomId,
      templateName: 'Mẫu B',
      effectiveDate: '2026-09-15',
      cells: [],
      fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 500000 },
        { feeName: 'Lưu ca xe', defaultAmount: 1000000 }],
    });
    created.quotationIds.push(b.id);

    await updateQuotation(a.id, {
      templateName: 'Mẫu A',
      effectiveDate: '2026-09-15',
      surchargeRoundingMode: 'NONE',
      cells: [],
      fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 600000 }],
    });
    const viewA = await getQuotation(a.id);
    assert.equal(viewA.fees.find((f) => f.feeName === 'Soi chiếu')?.defaultAmount, 600000);
    const viewB = await getQuotation(b.id);
    assert.equal(viewB.fees.find((f) => f.feeName === 'Soi chiếu')?.defaultAmount, 500000);
    assert.equal(viewB.fees.find((f) => f.feeName === 'Lưu ca xe')?.defaultAmount, 1000000);
  });

  test('A7 importer seam: upsertQuotationFees replaces rows on the frame', async () => {
    const a = await createQuotation({
      customerId: longMinhId,
      templateName: 'Mẫu A',
      effectiveDate: '2026-09-15',
      fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 500000 }],
    });
    created.quotationIds.push(a.id);
    await upsertQuotationFees(a.id, [
      { feeName: 'Lưu ca xe', defaultAmount: 1000000 },
      { feeName: 'Kiểm hóa' },
    ]);
    const view = await getQuotation(a.id);
    assert.equal(view.fees.length, 2);
    assert.equal(view.fees.every((f) => f.routing === 'OTHER_COSTS'), true);
  });
});
