/**
 * Card _57 D1 — the import row validator (Giá cos / Tổng lít) is a SINGLE
 * source of truth: previewQuotationImport and commitQuotationImport both run
 * validateImportRows, so an all-✓ preview can never be refused by the commit
 * for these checks (the defect class is divergence itself). Red-first: at the
 * prep HEAD (7fbc01db) the preview never populated row.error, so the first
 * two tests fail before the backend patch applies.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { and, eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { previewQuotationImport, commitQuotationImport } from '../services/quotation-import.service';
import { updateQuotation } from '../services/quotation.service';

const suffix = `c57d1-${Date.now().toString(36)}`;
const CUSTOMER = `C57D1 customer ${suffix}`;
const TAXCODE = `8${Date.now()}`.slice(0, 11);
const FACTORY = `C57D1 route ${suffix}`;
const ADMIN = `c57d1-admin-${suffix}`;

const created = {
  userIds: [] as number[],
  customerIds: [] as number[],
  routeIds: [] as number[],
  classIds: [] as number[],
  normIds: [] as number[],
  quotationIds: [] as number[],
};

/** Minimal layout-contract workbook (the contract parseSheet implements):
 *  rows 1-2 identity/fuel, 3 factory, 4 class labels, 5 He so,
 *  6 Tong lit, 7 Gia cos. `heavyGiaCos` null = the D1 blank cell. */
async function mkWorkbook(heavyGiaCos: number | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('BÁO GIÁ 1');
  sheet.addRow(['Khách hàng', CUSTOMER, 'MST', TAXCODE]);
  sheet.addRow(['Giá dầu tham chiếu', 17842.593, 'Lag Day n', 2, 'Phụ phí làm tròn', 3]);
  sheet.addRow(['Nhà máy', FACTORY]);
  sheet.addRow(['Nội dung', 'Xe 1.25T', 'Cont20 >20t']);
  sheet.addRow(['Hệ số', 1, 1]);
  sheet.addRow(['Tổng lít dầu/chuyến', 20, 64]);
  sheet.addRow(['Giá cos', 1248000, heavyGiaCos]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

before(async () => {
  const [user] = await db.insert(s.users).values({
    username: ADMIN, passwordHash: 'x', role: 'ACCOUNTANT',
  }).returning();
  created.userIds.push(user.id);
  const [customer] = await db.insert(s.customers).values({
    name: CUSTOMER, taxCode: TAXCODE,
  }).returning();
  created.customerIds.push(customer.id);
  const [route] = await db.insert(s.routes).values({ name: FACTORY }).returning();
  created.routeIds.push(route.id);
  const [clsLight] = await db.insert(s.vehicleSizeClasses).values({
    code: '1.25T', name: 'Xe 1.25 tấn', isContainer: false,
  }).onConflictDoNothing().returning();
  if (clsLight) created.classIds.push(clsLight.id);
  const [clsHeavy] = await db.insert(s.vehicleSizeClasses).values({
    code: 'CONT20.HEAVY', name: 'Cont20 nặng', isContainer: true,
  }).onConflictDoNothing().returning();
  if (clsHeavy) created.classIds.push(clsHeavy.id);
  for (const norm of [
    { code: '1.25T', litersPerKm: '0.1000' },
    { code: 'CONT20.HEAVY', litersPerKm: '0.0500' },
  ]) {
    const [cls] = await db.select({ id: s.vehicleSizeClasses.id })
      .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, norm.code)).limit(1);
    const [inserted] = await db.insert(s.fuelConsumptionNorms).values({
      vehicleSizeClassId: cls!.id, litersPerKm: norm.litersPerKm, effectiveDate: '2026-09-09',
    }).onConflictDoNothing().returning();
    if (inserted) created.normIds.push(inserted.id);
  }
});

after(async () => {
  try {
    if (created.quotationIds.length) {
      await db.delete(s.quotationVersionSnapshots).where(inArray(s.quotationVersionSnapshots.quotationId, created.quotationIds));
      await db.delete(s.quotationCells).where(inArray(s.quotationCells.quotationId, created.quotationIds));
      await db.delete(s.quotations).where(inArray(s.quotations.id, created.quotationIds));
    }
    if (created.customerIds.length && created.routeIds.length) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.customerId, created.customerIds));
      await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.customerId, created.customerIds));
    }
    for (const id of created.normIds) await db.delete(s.fuelConsumptionNorms).where(eq(s.fuelConsumptionNorms.id, id));
    for (const id of created.classIds) await db.delete(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, id));
    for (const id of created.routeIds) await db.delete(s.routes).where(eq(s.routes.id, id));
    for (const id of created.customerIds) await db.delete(s.customers).where(eq(s.customers.id, id));
    if (created.userIds.length) await db.delete(s.users).where(inArray(s.users.id, created.userIds));
  } catch {
    // red-phase tolerance
  }
  await client.end();
});

describe('import row validation — single source of truth (card _57 D1)', () => {
  test('empty Giá cos → preview row-level error naming row + column + format', async () => {
    const preview = await previewQuotationImport(await mkWorkbook(null));
    const route = preview.sheets[0]!.routes[0]!;
    const heavy = route.rows.find((row) => row.classCode === 'CONT20.HEAVY')!;
    assert.ok(heavy.error, 'the blank row must carry a row-level error at preview time');
    assert.match(heavy.error!, /Giá cos/);
    assert.match(heavy.error!, /hàng 7/);
    assert.match(heavy.error!, /cột 3/);
    assert.match(heavy.error!, /Cont20 >20t/);
    assert.ok(!route.rows.find((row) => row.classCode === '1.25T')!.error, 'a filled row stays clean');
    assert.ok(preview.totalErrors >= 1, 'totalErrors counts the error row');
  });

  test('preview errors ≡ commit errors — the parity pin (single source of truth)', async () => {
    const buffer = await mkWorkbook(null);
    const preview = await previewQuotationImport(buffer);
    const previewMessages = preview.sheets[0]!.routes[0]!.rows
      .map((row) => row.error)
      .filter((message): message is string => message != null);
    const results = await commitQuotationImport(buffer, created.userIds[0]!);
    const result = results.find((entry) => entry.sheet === 'BÁO GIÁ 1')!;
    assert.equal(result.quotationId, null, 'an errored sheet writes nothing');
    assert.ok(result.errors.length >= 1, 'commit refuses the sheet');
    for (const message of previewMessages) {
      assert.ok(result.errors.includes(message), `commit carries the preview error verbatim: ${message}`);
    }
    for (const message of result.errors) {
      if (/Giá cos|Tổng lít/.test(message)) {
        assert.ok(previewMessages.includes(message), `preview carries the commit row error: ${message}`);
      }
    }
  });

  test('clean file → preview clean, commit creates the frame', async () => {
    const buffer = await mkWorkbook(4500000);
    const preview = await previewQuotationImport(buffer);
    assert.equal(preview.totalErrors, 0, 'an all-filled file previews clean');
    const results = await commitQuotationImport(buffer, created.userIds[0]!);
    const result = results.find((entry) => entry.sheet === 'BÁO GIÁ 1')!;
    assert.ok(result.quotationId, 'a clean commit creates the frame');
    assert.deepEqual(result.errors, []);
    created.quotationIds.push(result.quotationId!);
  });
});

describe('import-commit fee-catalog inheritance (ruling ii INHERIT)', () => {
  test('second import inherits the prior frame fee catalog verbatim; copied rows stay editable', async () => {
    const buffer = await mkWorkbook(4500000);
    const first = await commitQuotationImport(buffer, created.userIds[0]!);
    const firstFrame = first.find((entry) => entry.sheet === 'BÁO GIÁ 1')!;
    assert.ok(firstFrame.quotationId, 'first import creates the frame');
    created.quotationIds.push(firstFrame.quotationId!);
    // The operator configures the fee catalog on the first frame (config-page
    // edit path) — the second import must inherit THIS state verbatim.
    await db.insert(s.quotationFees).values([
      { quotationId: firstFrame.quotationId!, feeName: 'Hải quan giám sát', routing: 'DEDICATED_CUSTOMS', defaultAmount: '500000', sortOrder: 1 },
      { quotationId: firstFrame.quotationId!, feeName: 'Nâng/Hạ Lạch Huyện', routing: 'DEDICATED_DEPOT', defaultAmount: '750000', sortOrder: 2 },
    ]);
    const second = await commitQuotationImport(buffer, created.userIds[0]!);
    const secondFrame = second.find((entry) => entry.sheet === 'BÁO GIÁ 1')!;
    assert.ok(secondFrame.quotationId, 'second import creates its own frame');
    created.quotationIds.push(secondFrame.quotationId!);
    assert.notEqual(secondFrame.quotationId, firstFrame.quotationId, 'ruling 6: a new frame, never an overwrite');
    const inherited = await db.select()
      .from(s.quotationFees)
      .where(eq(s.quotationFees.quotationId, secondFrame.quotationId!));
    assert.equal(inherited.length, 2, 'both configured fees inherit');
    const customs = inherited.find((fee) => fee.feeName === 'Hải quan giám sát')!;
    assert.equal(customs.routing, 'DEDICATED_CUSTOMS', 'routing inherits verbatim');
    assert.equal(customs.defaultAmount, '500000', 'defaultAmount inherits verbatim');
    // Copied rows are plain rows — the config edit path applies to them.
    const [target] = inherited;
    await updateQuotation(secondFrame.quotationId!, {
      effectiveDate: '2026-09-24', templateName: `C57D1 fee edit ${suffix}`, surchargeRoundingMode: 'NONE' as const, cells: [],
      fees: [
      { feeName: target.feeName, routing: 'OTHER_COSTS', defaultAmount: 1 },
      ...inherited.slice(1).map((fee) => ({ feeName: fee.feeName, routing: fee.routing as 'DEDICATED_CUSTOMS' | 'DEDICATED_DEPOT' | 'OTHER_COSTS', defaultAmount: Number(fee.defaultAmount) })),
    ] }, db);
    const [afterEdit] = await db.select()
      .from(s.quotationFees)
      .where(and(eq(s.quotationFees.quotationId, secondFrame.quotationId!), eq(s.quotationFees.feeName, target.feeName)));
    assert.equal(afterEdit!.routing, 'OTHER_COSTS', 'inherited rows are editable through the config path');
  });

  test('first-ever import stays fee-less until configured', async () => {
    const freshCustomer = `C57D1 first-import ${suffix}`;
    const [customer] = await db.insert(s.customers).values({ name: freshCustomer, taxCode: `9${Date.now()}`.slice(0, 11) }).returning();
    created.customerIds.push(customer.id);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('BÁO GIÁ 1');
    sheet.addRow(['Khách hàng', freshCustomer, 'MST', '']);
    sheet.addRow(['Giá dầu tham chiếu', 17842.593, 'Lag Day n', 2, 'Phụ phí làm tròn', 3]);
    sheet.addRow(['Nhà máy', FACTORY]);
    sheet.addRow(['Nội dung', 'Xe 1.25T']);
    sheet.addRow(['Hệ số', 1]);
    sheet.addRow(['Tổng lít dầu/chuyến', 20]);
    sheet.addRow(['Giá cos', 1248000]);
    const out = await wb.xlsx.writeBuffer();
    const results = await commitQuotationImport(Buffer.from(out), created.userIds[0]!);
    const frame = results.find((entry) => entry.sheet === 'BÁO GIÁ 1')!;
    assert.ok(frame.quotationId, 'first import creates the frame');
    created.quotationIds.push(frame.quotationId!);
    const fees = await db.select().from(s.quotationFees).where(eq(s.quotationFees.quotationId, frame.quotationId!));
    assert.equal(fees.length, 0, 'no prior frame — the new frame is fee-less until configured');
  });
});
