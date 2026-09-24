// Card 20260922_57 — báo giá xlsx export: round-trips the customer's
// template layout for one quotation. Giá cos renders shared-inclusive
// (base × (1+share)); liters = km × norm × 2 (norm keyed on the BASE class);
// Phụ phí comes from the live engine call per route (approval gate included).
import ExcelJS from 'exceljs';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { quotationBaseClassCode } from '@tingting/shared';
import { resolveFreightRate } from './freight-pricing-engine.service';
import { ApiError } from '../errors';
import type { QuotationView } from '@tingting/shared';
type QuotationViewShape = QuotationView;

function classLabel(code: string): string {
  if (code === 'CONT20.LIGHT') return 'Cont 20 - Trọng tải < 20 tấn';
  if (code === 'CONT20.HEAVY') return 'Cont 20 - Trọng tải > 20 tấn';
  if (code === 'CONT40.LIGHT') return 'Cont 40 nhẹ - Trọng tải < 20 tấn';
  if (code === 'CONT40.HEAVY') return 'Cont 40 nặng - Trọng tải > 20 tấn';
  if (code === 'CONT20') return 'Cont 20';
  if (code === 'CONT40') return 'Cont 40';
  return `Xe ${code}`;
}

async function latestFuel(customerId: number, routeId: number, classCode: string) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    return await resolveFreightRate({
      customerId, routeId, vehicleSizeClassCode: quotationBaseClassCode(classCode),
      transportDate: today,
    });
  } catch {
    return null;
  }
}
export async function buildQuotationExport(quotationId: number, version?: number): Promise<Buffer> {
  // Card _62: a version render comes straight from the FROZEN payload — the
  // cells carry heSo/liters/giaCos/surcharge verbatim, so no pricing queries.
  if (version != null) {
    const [snap] = await db.select({ payload: s.quotationVersionSnapshots.payload })
      .from(s.quotationVersionSnapshots)
      .where(and(
        eq(s.quotationVersionSnapshots.quotationId, quotationId),
        eq(s.quotationVersionSnapshots.version, version),
      )).limit(1);
    if (!snap) throw new ApiError(404, 'Không tìm thấy phiên bản báo giá');
    const view = snap.payload as QuotationViewShape;
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('BÁO GIÁ');
    sheet.getCell('A1').value = 'Khách hàng';
    sheet.getCell('B1').value = view.customerName ?? '';
    sheet.getCell('A2').value = 'Giá dầu tham chiếu';
    sheet.getCell('B2').value = view.cells[0]?.baseFuelPrice ?? null;
    sheet.getCell('C2').value = 'Lag Day n';
    sheet.getCell('D2').value = view.cells[0]?.fuelLagDays ?? 0;
    sheet.getCell('E2').value = 'Phụ phí làm tròn';
    sheet.getCell('F2').value = view.surchargeRoundingMode === 'TEN_THOUSAND' ? '-4'
      : view.surchargeRoundingMode === 'THOUSAND' ? '-3' : 'NONE';
    let cursor = 4;
    const routesInOrder = [...new Set(view.cells.map((cell) => cell.routeName))];
    for (const routeName of routesInOrder) {
      const routeCells = view.cells.filter((cell) => cell.routeName === routeName);
      sheet.getCell(`A${cursor}`).value = 'Nhà máy';
      sheet.getCell(`B${cursor}`).value = routeName;
      cursor += 1;
      sheet.getCell(`A${cursor}`).value = 'Nội dung';
      routeCells.forEach((cell, index) => {
        sheet.getCell(cursor, index + 2).value = classLabel(cell.vehicleSizeClassCode);
      });
      cursor += 1;
      const gridRows: Array<[string, (cell: QuotationViewShape['cells'][number]) => number | string | null]> = [
        ['Hệ số', (cell) => cell.heSo],
        // D4 (card _57/_62 finish-out): liters derive as km × norm × 2 and
        // raw floats leak tails ("33.800000000000004") into the file — cap
        // at one decimal, which is the true value's precision.
        ['Tổng lít dầu/chuyến', (cell) => (cell.liters == null ? null : Math.round(cell.liters * 10) / 10)],
        ['Giá cos', (cell) => cell.giaCos],
        ['Phụ phí', (cell) => cell.surcharge],
      ];
      for (const [label, render] of gridRows) {
        sheet.getCell(`A${cursor}`).value = label;
        routeCells.forEach((cell, index) => {
          sheet.getCell(cursor, index + 2).value = render(cell);
        });
        cursor += 1;
      }
      cursor += 1;
    }
    return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>;
  }

  const [frame] = await db.select().from(s.quotations)
    .where(and(eq(s.quotations.id, quotationId), isNull(s.quotations.deletedAt))).limit(1);
  if (!frame) throw new ApiError(404, 'Không tìm thấy báo giá');
  const [customer] = await db.select({ name: s.customers.name })
    .from(s.customers).where(eq(s.customers.id, frame.customerId)).limit(1);
  const cells = await db.select({
    routeId: s.quotationCells.routeId,
    classCode: s.vehicleSizeClasses.code,
    heSo: s.quotationCells.heSo,
  }).from(s.quotationCells)
    .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.quotationCells.vehicleSizeClassId))
    .where(eq(s.quotationCells.quotationId, quotationId));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('BÁO GIÁ');
  sheet.getCell('A1').value = 'Khách hàng';
  sheet.getCell('B1').value = customer?.name ?? '';
  sheet.getCell('C1').value = 'MST';
  const [termsRow] = await db.select({
    baseFuelPrice: s.freightRateTerms.baseFuelPrice,
    fuelLagDays: s.freightRateTerms.fuelLagDays,
    sharePct: s.freightRateTerms.sharePct,
  }).from(s.freightRateTerms)
    .where(and(
      eq(s.freightRateTerms.customerId, frame.customerId),
      isNull(s.freightRateTerms.deletedAt),
    ))
    .orderBy(desc(s.freightRateTerms.effectiveDate)).limit(1);
  const sharePct = termsRow ? Number(termsRow.sharePct) : 2;
  sheet.getCell('A2').value = 'Giá dầu tham chiếu';
  sheet.getCell('B2').value = termsRow ? Number(termsRow.baseFuelPrice) : null;
  sheet.getCell('C2').value = 'Lag Day n';
  sheet.getCell('D2').value = termsRow?.fuelLagDays ?? 0;
  sheet.getCell('E2').value = 'Phụ phí làm tròn';
  sheet.getCell('F2').value = frame.surchargeRoundingMode === 'TEN_THOUSAND' ? '-4'
    : frame.surchargeRoundingMode === 'THOUSAND' ? '-3' : 'NONE';


  const routeIds = [...new Set(cells.map((cell) => cell.routeId))];
  let cursor = 4;
  for (const routeId of routeIds) {
    const [route] = await db.select({ name: s.routes.name })
      .from(s.routes).where(eq(s.routes.id, routeId)).limit(1);
    const [terms] = await db.select({ sharePct: s.freightRateTerms.sharePct, km: s.freightRateTerms.billingKmOneWay })
      .from(s.freightRateTerms)
      .where(and(
        eq(s.freightRateTerms.customerId, frame.customerId),
        eq(s.freightRateTerms.routeId, routeId),
        isNull(s.freightRateTerms.deletedAt),
      ))
      .orderBy(desc(s.freightRateTerms.effectiveDate)).limit(1);
    const share = terms ? Number(terms.sharePct) : 2;
    const routeCells = cells.filter((cell) => cell.routeId === routeId);

    // Pre-fetch norms (per BASE class) and pricing rows (per class, with the
    // base-row fallback) so the grid renderers stay synchronous.
    const normByBase = new Map<string, number>();
    for (const cell of routeCells) {
      const base = quotationBaseClassCode(cell.classCode);
      if (normByBase.has(base)) continue;
      const [normRow] = await db.select({ litersPerKm: s.fuelConsumptionNorms.litersPerKm })
        .from(s.fuelConsumptionNorms)
        .innerJoin(s.vehicleSizeClasses, eq(s.vehicleSizeClasses.id, s.fuelConsumptionNorms.vehicleSizeClassId))
        .where(and(
          eq(s.vehicleSizeClasses.code, base),
          isNull(s.fuelConsumptionNorms.deletedAt),
        ))
        .orderBy(desc(s.fuelConsumptionNorms.effectiveDate)).limit(1);
      normByBase.set(base, normRow ? Number(normRow.litersPerKm) : 0);
    }
    const priceByCode = new Map<string, number | null>();
    for (const cell of routeCells) {
      const [row] = await db.select({ price: s.pricingTables.price })
        .from(s.pricingTables)
        .where(and(
          eq(s.pricingTables.customerId, frame.customerId),
          eq(s.pricingTables.routeId, routeId),
          eq(s.pricingTables.rateKey, cell.classCode),
          isNull(s.pricingTables.deletedAt),
        ))
        .orderBy(desc(s.pricingTables.effectiveDate)).limit(1);
      if (row) {
        priceByCode.set(cell.classCode, Number(row.price));
        continue;
      }
      const base = quotationBaseClassCode(cell.classCode);
      const [baseRow] = base !== cell.classCode ? await db.select({ price: s.pricingTables.price })
        .from(s.pricingTables)
        .where(and(
          eq(s.pricingTables.customerId, frame.customerId),
          eq(s.pricingTables.routeId, routeId),
          eq(s.pricingTables.rateKey, base),
          isNull(s.pricingTables.deletedAt),
        ))
        .orderBy(desc(s.pricingTables.effectiveDate)).limit(1) : [];
      priceByCode.set(cell.classCode, baseRow ? Number(baseRow.price) : null);
    }
    const km = terms?.km ? Number(terms.km) : 0;
    const engine = routeCells.length > 0 ? await latestFuel(frame.customerId, routeId, routeCells[0].classCode) : null;
    const surcharge = engine ? engine.surcharge : 0;

    sheet.getCell(`A${cursor}`).value = 'Nhà máy';
    sheet.getCell(`B${cursor}`).value = route?.name ?? `#${routeId}`;
    cursor += 1;
    sheet.getCell(`A${cursor}`).value = 'Nội dung';
    routeCells.forEach((cell, index) => {
      sheet.getCell(cursor, index + 2).value = classLabel(cell.classCode);
    });
    cursor += 1;
    const gridRows: Array<[string, (cell: { classCode: string; heSo: string }, index: number) => number | null]> = [
      ['Hệ số', (cell) => Number(cell.heSo)],
      ['Tổng lít dầu/chuyến', (_cell, index) => {
        const base = quotationBaseClassCode(routeCells[index].classCode);
        return Math.round(km * 2 * (normByBase.get(base) ?? 0) * 1000) / 1000;
      }],
      ['Giá cos', (cell) => {
        const basePrice = priceByCode.get(cell.classCode);
        return basePrice != null ? Math.round(basePrice * (1 + share / 100)) : null;
      }],
      ['Phụ phí', () => surcharge],
    ];
    for (const [label, render] of gridRows) {
      sheet.getCell(`A${cursor}`).value = label;
      routeCells.forEach((cell, index) => {
        const value = render(cell, index);
        sheet.getCell(cursor, index + 2).value = value;
      });
      cursor += 1;
    }
    cursor += 1;
  }
  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}
