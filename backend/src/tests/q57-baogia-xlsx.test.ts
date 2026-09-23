// Card 20260922_57: báo giá xlsx round-trip — build the customer-layout
// workbook, preview, commit, export, and compare layout + figures. Also pins
// no-partial-write (ruling: per-sheet transaction) and new-version (ruling 6).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { eq, inArray } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { previewQuotationImport, commitQuotationImport } from '../services/quotation-import.service';
import { buildQuotationExport } from '../services/quotation-export.service';
import { disconnectRedis } from '../lib/redis';

const suffix = `${Date.now()}-q57`;
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdNormIds: number[] = [];
const createdQuotationIds: number[] = [];

async function ensureClass(code: string): Promise<number> {
  const [existing] = await db.select({ id: s.vehicleSizeClasses.id })
    .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, code)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(s.vehicleSizeClasses).values({ code, name: `Q57 ${code}` }).returning();
  return created.id;
}

async function ensureNorm(classCode: string, litersPerKm: string): Promise<void> {
  const classId = await ensureClass(classCode);
  const [existing] = await db.select({ id: s.fuelConsumptionNorms.id })
    .from(s.fuelConsumptionNorms)
    .where(eq(s.fuelConsumptionNorms.vehicleSizeClassId, classId)).limit(1);
  if (existing) return;
  const [created] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: classId, litersPerKm, effectiveDate: '2026-01-01',
  }).returning();
  createdNormIds.push(created.id);
}

/** The customer-layout workbook (deterministic contract from the service). */
async function buildWorkbook(customerName: string, routeName: string, giaCosLight: number, giaCosHeavy: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('BÁO GIÁ 1');
  sheet.getCell('A1').value = 'Khách hàng';
  sheet.getCell('B1').value = customerName;
  sheet.getCell('C1').value = 'MST';
  sheet.getCell('D1').value = '1234567890';
  sheet.getCell('A2').value = 'Giá dầu tham chiếu';
  sheet.getCell('B2').value = 17842.5926;
  sheet.getCell('C2').value = 'Lag Day n';
  sheet.getCell('D2').value = 2;
  sheet.getCell('E2').value = 'Phụ phí làm tròn';
  sheet.getCell('F2').value = '-3';
  sheet.getCell('A3').value = 'Nhà máy';
  sheet.getCell('B3').value = routeName;
  sheet.getCell('A4').value = 'Nội dung';
  sheet.getCell('B4').value = 'Cont 20 - Trọng tải < 20 tấn';
  sheet.getCell('C4').value = 'Cont 20 - Trọng tải > 20 tấn';
  sheet.getCell('A5').value = 'Hệ số';
  sheet.getCell('B5').value = 1;
  sheet.getCell('C5').value = 1;
  sheet.getCell('A6').value = 'Tổng lít dầu/chuyến';
  sheet.getCell('B6').value = 64;
  sheet.getCell('C6').value = 64;
  sheet.getCell('A7').value = 'Giá cos';
  sheet.getCell('B7').value = giaCosLight;
  sheet.getCell('C7').value = giaCosHeavy;
  sheet.getCell('A8').value = 'Phụ phí';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

after(async () => {
  try {
    const quotationIds = createdQuotationIds;
    if (quotationIds.length > 0) {
      await db.delete(s.quotationCells).where(inArray(s.quotationCells.quotationId, quotationIds));
      await db.delete(s.quotations).where(inArray(s.quotations.id, quotationIds));
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(s.pricingTables).where(inArray(s.pricingTables.customerId, createdCustomerIds));
      await db.delete(s.freightRateTerms).where(inArray(s.freightRateTerms.customerId, createdCustomerIds));
    }
    await db.delete(s.routes).where(inArray(s.routes.id, createdRouteIds));
    await db.delete(s.customers).where(inArray(s.customers.id, createdCustomerIds));
    await db.delete(s.fuelConsumptionNorms).where(inArray(s.fuelConsumptionNorms.id, createdNormIds));
  } catch { /* best-effort */ }
  await client.end();
  await disconnectRedis();
});

describe('báo giá xlsx import/export round-trip (card 20260922_57)', () => {
  test('preview maps labels and matches catalog + route', async () => {
    await ensureNorm('CONT20', '0.32');
    const [customer] = await db.insert(s.customers).values({ name: `Q57 khách ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes).values({ name: `Q57 nhà máy ${suffix}` }).returning();
    createdRouteIds.push(route.id);
    const buffer = await buildWorkbook(customer.name, route.name, 3978000, 4284000);
    const preview = await previewQuotationImport(Buffer.from(buffer));
    assert.equal(preview.sheets.length, 1);
    const sheet = preview.sheets[0];
    assert.equal(sheet.customerName, customer.name);
    assert.equal(sheet.baseFuelPrice, 17842.5926);
    assert.equal(sheet.roundingMode, 'THOUSAND');
    assert.equal(sheet.routes.length, 1);
    assert.equal(sheet.routes[0].routeId, route.id);
    assert.equal(sheet.routes[0].rows.length, 2);
    assert.equal(sheet.routes[0].rows[0].classCode, 'CONT20.LIGHT');
    assert.equal(sheet.routes[0].rows[0].liters, 64);
    assert.equal(preview.totalErrors, 0);
  });

  test('commit creates a NEW quotation with derived km + converted base prices', async () => {
    const customer = await (async () => {
      const [row] = await db.select().from(s.customers).where(eq(s.customers.name, `Q57 khách ${suffix}`)).limit(1);
      return row;
    })();
    const route = await (async () => {
      const [row] = await db.select().from(s.routes).where(eq(s.routes.name, `Q57 nhà máy ${suffix}`)).limit(1);
      return row;
    })();
    const buffer = await buildWorkbook(customer.name, route.name, 3978000, 4284000);
    const results = await commitQuotationImport(Buffer.from(buffer), 1);
    assert.equal(results.length, 1);
    assert.equal(results[0].errors.length, 0, results[0].errors.join('; '));
    assert.ok(results[0].quotationId);
    createdQuotationIds.push(results[0].quotationId!);
    // billingKmOneWay lives on the TERMS (derived), not the routes table.
    const [termsAfter] = await db.select({ km: s.freightRateTerms.billingKmOneWay })
      .from(s.freightRateTerms).where(eq(s.freightRateTerms.customerId, customer.id)).limit(1);
    assert.equal(Number(termsAfter.km), 100, 'km = 64 ÷ 0.32 ÷ 2 = 100');
    const cells = await db.select({ code: s.vehicleSizeClasses.code, heSo: s.quotationCells.heSo })
      .from(s.quotationCells)
      .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.quotationCells.vehicleSizeClassId))
      .where(eq(s.quotationCells.quotationId, results[0].quotationId!));
    assert.equal(cells.length, 2);
    assert.ok(cells.every((cell) => Number(cell.heSo) === 1));
    const [lightPricing] = await db.select({ price: s.pricingTables.price }).from(s.pricingTables)
      .where(eq(s.pricingTables.rateKey, 'CONT20.LIGHT'));
    assert.equal(Number(lightPricing.price), 3900000, 'base = Giá cos ÷ 1.02');
  });

  test('re-upload creates a second frame — never overwrites (ruling 6)', async () => {
    const [customer] = await db.select().from(s.customers).where(eq(s.customers.name, `Q57 khách ${suffix}`)).limit(1);
    const [route] = await db.select().from(s.routes).where(eq(s.routes.name, `Q57 nhà máy ${suffix}`)).limit(1);
    const buffer = await buildWorkbook(customer.name, route.name, 3978000, 4284000);
    const results = await commitQuotationImport(Buffer.from(buffer), 1);
    assert.ok(results[0].quotationId);
    createdQuotationIds.push(results[0].quotationId!);
    assert.notEqual(results[0].quotationId, createdQuotationIds[0], 'a new frame each commit');
  });

  test('export round-trips the layout and figures', async () => {
    const quotationId = createdQuotationIds[0];
    const buffer = await buildQuotationExport(quotationId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0];
    assert.equal(sheet.getCell('A1').value, 'Khách hàng');
    assert.equal(sheet.getCell('A2').value, 'Giá dầu tham chiếu');
    let giaCosLight: number | null = null;
    let litersRow: number | null = null;
    sheet.eachRow((row, rowNumber) => {
      const first = String(sheet.getCell(rowNumber, 1).value ?? '');
      if (first === 'Giá cos') giaCosLight = Number(sheet.getCell(rowNumber, 2).value);
      if (first === 'Tổng lít dầu/chuyến') litersRow = Number(sheet.getCell(rowNumber, 2).value);
    });
    assert.equal(litersRow, 64);
    assert.equal(giaCosLight, 3978000, 'Giá cos renders shared-inclusive');
  });

  test('unmatched factory aborts the sheet — no partial write', async () => {
    const buffer = await buildWorkbook(`Q57 khách ${suffix}`, 'Nhà máy không tồn tại XYZ', 3978000, 4284000);
    const before = await db.select({ id: s.quotations.id }).from(s.quotations);
    const results = await commitQuotationImport(Buffer.from(buffer), 1);
    assert.equal(results[0].quotationId, null);
    assert.ok(results[0].errors.some((message) => message.includes('Không tìm thấy tuyến đường')));
    const after = await db.select({ id: s.quotations.id }).from(s.quotations);
    assert.equal(after.length, before.length, 'nothing written');
  });

  test('commit keeps digit-leading dotted codes whole — no pre-split before normForBase (D2)', async () => {
    await ensureNorm('1.25T', '0.10');
    const [customer] = await db.insert(s.customers).values({ name: `Q57 khách D2 ${suffix}` }).returning();
    createdCustomerIds.push(customer.id);
    const [route] = await db.insert(s.routes).values({ name: `Q57 nhà máy D2 ${suffix}` }).returning();
    createdRouteIds.push(route.id);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('BÁO GIÁ 1');
    sheet.getCell('A1').value = 'Khách hàng';
    sheet.getCell('B1').value = customer.name;
    sheet.getCell('C1').value = 'MST';
    sheet.getCell('D1').value = '1234567890';
    sheet.getCell('A2').value = 'Giá dầu tham chiếu';
    sheet.getCell('B2').value = 17842.5926;
    sheet.getCell('C2').value = 'Lag Day n';
    sheet.getCell('D2').value = 2;
    sheet.getCell('E2').value = 'Phụ phí làm tròn';
    sheet.getCell('F2').value = '-3';
    sheet.getCell('A3').value = 'Nhà máy';
    sheet.getCell('B3').value = route.name;
    sheet.getCell('A4').value = 'Nội dung';
    sheet.getCell('B4').value = 'Xe 1.25T';
    sheet.getCell('A5').value = 'Hệ số';
    sheet.getCell('B5').value = 1;
    sheet.getCell('A6').value = 'Tổng lít dầu/chuyến';
    sheet.getCell('B6').value = 64;
    sheet.getCell('A7').value = 'Giá cos';
    sheet.getCell('B7').value = 3978000;
    sheet.getCell('A8').value = 'Phụ phí';
    const results = await commitQuotationImport(Buffer.from(await wb.xlsx.writeBuffer()), 1);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].errors, [], results[0].errors.join('; '));
    assert.ok(results[0].quotationId);
    createdQuotationIds.push(results[0].quotationId!);
    const [terms] = await db.select({ km: s.freightRateTerms.billingKmOneWay })
      .from(s.freightRateTerms).where(eq(s.freightRateTerms.customerId, customer.id)).limit(1);
    assert.equal(Number(terms.km), 320, 'km = 64 ÷ 0.10 ÷ 2 = 320 — resolved from the WHOLE code 1.25T');
  });
});
