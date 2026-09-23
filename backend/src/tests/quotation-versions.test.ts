/**
 * Card 20260922_62 — quotation version history on the release seam.
 *
 * Triggers: manual edit (route-level release), AGREED fuel update, import.
 * Payload freezes the rendered view; version numbers are monotonic per
 * quotation; list is newest-first with an optional date window.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import {
  createQuotation, decideQuotationFuelApprovals, getQuotation, updateQuotation,
} from '../services/quotation.service';
import { spawnQuotationFuelApprovals } from '../services/quotation.service';
import {
  getQuotationVersionPayload, listQuotationVersions, releaseQuotationVersion,
} from '../services/quotation-version.service';

const suffix = `q62-${Date.now().toString(36)}`;
const created = {
  customerIds: [] as number[],
  routeIds: [] as number[],
  quotationIds: [] as number[],
};

let customerId = 0;
const ACTOR = 42;

async function mkQuotation(effectiveDate = '2026-09-15'): Promise<number> {
  const { id } = await createQuotation({
    customerId,
    templateName: 'Mẫu báo giá 1',
    effectiveDate,
    fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 500000 }],
  });
  created.quotationIds.push(id);
  return id;
}

before(async () => {
  const [customer] = await db.insert(s.customers).values({ name: `Q62 customer ${suffix}` }).returning();
  customerId = customer.id;
  created.customerIds.push(customer.id);
});

after(async () => {
  for (const qid of created.quotationIds) {
    await db.delete(s.quotationVersionSnapshots).where(eq(s.quotationVersionSnapshots.quotationId, qid));
    await db.delete(s.quotationFees).where(eq(s.quotationFees.quotationId, qid));
    await db.delete(s.quotationCells).where(eq(s.quotationCells.quotationId, qid));
    await db.delete(s.quotations).where(eq(s.quotations.id, qid));
  }
  if (created.customerIds.length) await db.delete(s.customers).where(inArray(s.customers.id, created.customerIds));
  await client.end();
});

describe('quotation version history (card 20260922_62)', () => {
  test('A1 manual edit releases monotonic versions; payload freezes the view', async () => {
    const qid = await mkQuotation();
    const view1 = await getQuotation(qid);
    await releaseQuotationVersion(view1, { triggerKind: 'MANUAL_EDIT', actorId: ACTOR });
    await updateQuotation(qid, {
      templateName: 'Mẫu báo giá 1 (rev 2)',
      effectiveDate: '2026-09-15',
      surchargeRoundingMode: 'NONE',
      cells: [],
      fees: [{ feeName: 'Soi chiếu', subType: 'Thủ tục soi', defaultAmount: 600000 }],
    });
    const view2 = await getQuotation(qid);
    await releaseQuotationVersion(view2, { triggerKind: 'MANUAL_EDIT', actorId: ACTOR });

    const list = await listQuotationVersions(qid);
    assert.equal(list.total, 2);
    assert.deepEqual(list.items.map((r) => r.version), [2, 1]); // newest first
    assert.ok(list.items.every((r) => r.releasedBy === ACTOR && r.releasedAt != null));

    const v1 = await getQuotationVersionPayload(qid, 1);
    assert.equal((v1 as { templateName?: string }).templateName, 'Mẫu báo giá 1');
    const v2 = await getQuotationVersionPayload(qid, 2);
    assert.equal((v2 as { templateName?: string }).templateName, 'Mẫu báo giá 1 (rev 2)');
    const v2Fees = (v2 as { fees?: Array<{ feeName: string; defaultAmount: number | null }> }).fees ?? [];
    assert.equal(v2Fees.find((f) => f.feeName === 'Soi chiếu')?.defaultAmount, 600000);
  });

  test('A1b FUEL_APPROVED releases per quotation; DECLINED does not', async () => {
    const qid = await mkQuotation('2026-09-20');
    const [period] = await db.insert(s.fuelPricePeriods)
      .values({ unitPrice: '29940.00', effectiveFrom: '2026-10-01' }).returning();
    const pending = await spawnQuotationFuelApprovals(period.id);
    assert.ok(pending > 0);
    const rows = await db.select()
      .from(s.quotationFuelApprovals).where(eq(s.quotationFuelApprovals.fuelPricePeriodId, period.id));
    const mine = rows.filter((r) => r.quotationId === qid);
    assert.ok(mine.length >= 1);
    const decided = await decideQuotationFuelApprovals(
      ACTOR, mine.map((r) => r.id), 'AGREED',
    );
    assert.ok(decided.updated.length >= 1);
    // The ROUTE releases FUEL_APPROVED versions for the affected frames
    // after its commit — mirror that wiring exactly, then pin the result.
    for (const row of decided.updated) {
      const view = await getQuotation(row.quotationId);
      await releaseQuotationVersion(view, { triggerKind: 'FUEL_APPROVED', actorId: ACTOR });
    }
    const released = await listQuotationVersions(qid);
    assert.ok(released.items.some((r) => r.triggerKind === 'FUEL_APPROVED'));
  });

  test('DECLINED decision releases nothing', async () => {
    const qid = await mkQuotation('2026-09-25');
    const before = await listQuotationVersions(qid);
    const [period] = await db.insert(s.fuelPricePeriods)
      .values({ unitPrice: '30000.00', effectiveFrom: '2026-10-02' }).returning();
    await spawnQuotationFuelApprovals(period.id);
    const rows = await db.select()
      .from(s.quotationFuelApprovals).where(eq(s.quotationFuelApprovals.fuelPricePeriodId, period.id));
    const mine = rows.filter((r) => r.quotationId === qid);
    await decideQuotationFuelApprovals(ACTOR, mine.map((r) => r.id), 'DECLINED');
    const after = await listQuotationVersions(qid);
    assert.equal(after.total, before.total); // DECLINED never releases
    void period;
  });

  test('list date window filters releases', async () => {
    const qid = await mkQuotation();
    const view = await getQuotation(qid);
    await releaseQuotationVersion(view, { triggerKind: 'MANUAL_EDIT', actorId: ACTOR });
    const all = await listQuotationVersions(qid);
    const futureOnly = await listQuotationVersions(qid, { from: '2030-01-01' });
    assert.equal(all.total >= 1, true);
    assert.equal(futureOnly.total, 0);
  });
});