// Card 20260922_57 — báo giá xlsx import (deterministic layout contract):
//   row1: Khách hàng | <name> | MST | <taxCode>
//   row2: Giá dầu tham chiếu | <num> | Lag Day n | <num> | Phụ phí làm tròn | <3|4>
//   then per-factory blocks: [Nhà máy | <factory>] ; [Nội dung | labels…]
//   ; Hệ số ; Tổng lít dầu/chuyến ; Giá cos ; Phụ phí (values per column).
// Ruling 6: commit creates a NEW quotation frame — never overwrites.
// Mappings (PM-verified): km = liters ÷ norm ÷ 2 ; base = Giá cos ÷ (1+share).
import ExcelJS from 'exceljs';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { getQuotation } from './quotation.service';
import { releaseQuotationVersion } from './quotation-version.service';

const GRID_LABELS = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí'];

function cellText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  const value = sheet.getCell(row, col).value;
  if (value == null) return '';
  if (typeof value === 'object' && 'text' in (value as unknown as Record<string, unknown>)) {
    return String((value as unknown as { text: unknown }).text ?? '');
  }
  return String(value);
}

function cellNumber(sheet: ExcelJS.Worksheet, row: number, col: number): number | null {
  const value = sheet.getCell(row, col).value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cellText(sheet, row, col).replace(/\./g, '').replace(/,/g, '.');
  return text ? (Number.isFinite(Number(text)) ? Number(text) : null) : null;
}
function classCodeFromLabel(label: string): string | null {
  const text = label.trim().replace(/\s+/g, ' ');
  if (/cont(ainer)?\s*20.*(>\s*20|nặng)/i.test(text)) return 'CONT20.HEAVY';
  if (/cont(ainer)?\s*20.*(<\s*20|nhẹ)/i.test(text)) return 'CONT20.LIGHT';
  if (/cont(ainer)?\s*40.*(>\s*20|nặng)/i.test(text)) return 'CONT40.HEAVY';
  if (/cont(ainer)?\s*40.*(<\s*20|nhẹ)/i.test(text)) return 'CONT40.LIGHT';
  if (/^cont(ainer)?\s*20$/i.test(text)) return 'CONT20';
  if (/^cont(ainer)?\s*40$/i.test(text)) return 'CONT40';
  const truck = text.match(/^xe\s+(.+)$/i);
  return truck ? truck[1].trim().toUpperCase() : null;
}

interface ParsedSection {
  factoryName: string;
  columns: Array<{ col: number; label: string; classCode: string | null }>;
  labelRow: Map<string, number>;
}

export interface ImportPreviewRow {
  classCode: string; classLabel: string;
  heSo: number | null; liters: number | null; giaCos: number | null;
  basePrice: number | null; billingKmOneWay: number | null; error: string | null;
  /** Source location in the uploaded sheet (Giá cos grid row / sheet column)
   *  — row-level errors name the exact cell per the D1 ruling. */
  sourceRow: number | null; sourceCol: number | null;
}

export interface ImportPreviewRoute {
  factoryName: string; routeId: number | null; matchedRouteName: string | null;
  sharePct: number | null;
  rows: ImportPreviewRow[]; errors: string[];
}

export interface ImportPreviewSheet {
  sheet: string; customerName: string | null; customerTaxCode: string | null;
  customerId: number | null;
  baseFuelPrice: number | null; fuelLagDays: number | null;
  roundingMode: 'NONE' | 'THOUSAND' | 'TEN_THOUSAND';
  routes: ImportPreviewRoute[]; errors: string[];
}

export interface ImportPreview { sheets: ImportPreviewSheet[]; totalErrors: number; }
function parseSheet(sheet: ExcelJS.Worksheet): ImportPreviewSheet {
  const preview: ImportPreviewSheet = {
    sheet: sheet.name,
    customerId: null,
    customerName: null, customerTaxCode: null, baseFuelPrice: null,
    fuelLagDays: null, roundingMode: 'NONE',
    routes: [], errors: [],
  };
  let section: ParsedSection | null = null;
  const sections: ParsedSection[] = [];
  for (let row = 1; row <= Math.min(sheet.rowCount, 200); row += 1) {
    const first = cellText(sheet, row, 1).trim();
    if (/^khách hàng$/i.test(first) && !preview.customerName) {
      preview.customerName = cellText(sheet, row, 2).trim() || null;
      if (!preview.customerTaxCode) preview.customerTaxCode = cellText(sheet, row, 4).trim() || null;
      continue;
    }
    if (/^mst$|^mã số thuế$/i.test(first) && !preview.customerTaxCode) {
      preview.customerTaxCode = cellText(sheet, row, 2).trim() || null;
      continue;
    }
    if (/giá dầu tham chiếu/i.test(first) && preview.baseFuelPrice == null) {
      preview.baseFuelPrice = cellNumber(sheet, row, 2);
      preview.fuelLagDays = cellNumber(sheet, row, 4);
      const rounding = cellText(sheet, row, 6);
      if (/4/.test(rounding)) preview.roundingMode = 'TEN_THOUSAND';
      else if (/3/.test(rounding)) preview.roundingMode = 'THOUSAND';
      continue;
    }
    if (/^nhà máy$/i.test(first) && cellText(sheet, row, 2).trim()) {
      if (section) sections.push(section);
      section = { factoryName: cellText(sheet, row, 2).trim(), columns: [], labelRow: new Map() };
      continue;
    }
    if (/^nội dung$/i.test(first) && section) {
      for (let col = 2; col <= Math.min(sheet.columnCount, 40); col += 1) {
        const label = cellText(sheet, row, col).trim();
        if (label) section.columns.push({ col, label, classCode: classCodeFromLabel(label) });
      }
      continue;
    }
    if (section && GRID_LABELS.includes(first)) section.labelRow.set(first, row);
  }
  if (section) sections.push(section);

  for (const parsed of sections) {
    const route: ImportPreviewRoute = {
      factoryName: parsed.factoryName, routeId: null, matchedRouteName: null, sharePct: null, rows: [], errors: [],
    };
    for (const column of parsed.columns) {
      if (column.classCode == null) {
        route.errors.push(`Cột "${column.label}" không nhận diện được hạng phương tiện.`);
        continue;
      }
      const heSo = parsed.labelRow.has('Hệ số')
        ? cellNumber(sheet, parsed.labelRow.get('Hệ số')!, column.col) : null;
      const liters = parsed.labelRow.has('Tổng lít dầu/chuyến')
        ? cellNumber(sheet, parsed.labelRow.get('Tổng lít dầu/chuyến')!, column.col) : null;
      const giaCos = parsed.labelRow.has('Giá cos')
        ? cellNumber(sheet, parsed.labelRow.get('Giá cos')!, column.col) : null;
      route.rows.push({
        classCode: column.classCode, classLabel: column.label,
        heSo, liters, giaCos, basePrice: null, billingKmOneWay: null, error: null,
        sourceRow: parsed.labelRow.get('Giá cos') ?? null, sourceCol: column.col,
      });
    }
    preview.routes.push(route);
  }
  return preview;
}
export async function previewQuotationImport(buffer: Buffer): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ApiError(400, 'Tệp XLSX không hợp lệ hoặc đã bị hỏng.');
  }
  const previews: ImportPreviewSheet[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount === 0 || sheet.columnCount === 0) continue;
    previews.push(await enrichPreview(parseSheet(sheet)));
  }
  const totalErrors = previews.reduce((sum, sheet) => (
    sum + sheet.errors.length
    + sheet.routes.reduce((inner, route) => inner + route.errors.length
      + route.rows.filter((row) => row.error != null).length, 0)
  ), 0);
  return { sheets: previews, totalErrors };
}
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** D1 single source of truth (card _57, Director ruling 2026-09-24): THE one
 *  row-level validator — the preview AND the commit both call it, so an
 *  all-✓ preview can never be refused by the commit for these checks (the
 *  defect class is divergence itself). A quotation engine never invents
 *  prices: missing/null/non-numeric/non-positive liters or Giá cos is a
 *  row-level error naming the factory, the class label, the source row and
 *  column in the sheet, and the expected format — never a silent zero or
 *  skip. Returns one issue per failing check; `row` lets callers attach the
 *  message to the rendered row. */
export interface ImportRowIssue {
  row: ImportPreviewRow;
  message: string;
}

export function validateImportRows(route: ImportPreviewRoute): ImportRowIssue[] {
  const issues: ImportRowIssue[] = [];
  for (const row of route.rows) {
    const where = `${route.factoryName} · ${row.classLabel}`;
    const at = row.sourceRow != null && row.sourceCol != null
      ? ` (hàng ${row.sourceRow}, cột ${row.sourceCol})`
      : '';
    if (row.liters == null || row.liters <= 0) {
      issues.push({ row, message: `${where}${at}: thiếu hoặc sai Tổng lít dầu/chuyến — điền số lít > 0 cho từng hạng.` });
    }
    if (row.giaCos == null || row.giaCos <= 0) {
      issues.push({ row, message: `${where}${at}: thiếu hoặc sai Giá cos — điền số tiền > 0 (số, VD 1234567 hoặc 1.234.567).` });
    }
  }
  return issues;
}

/** Resolve catalog rows for a parsed sheet (customer + routes + norms). */
async function enrichPreview(preview: ImportPreviewSheet): Promise<ImportPreviewSheet> {
  const customers = await db.select({ id: s.customers.id, name: s.customers.name, taxCode: s.customers.taxCode })
    .from(s.customers).where(isNull(s.customers.deletedAt));
  const routes = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes).where(isNull(s.routes.deletedAt));
  const byName = (target: string | null, pool: Array<{ id: number; name: string }>): { id: number; name: string } | null => {
    if (!target) return null;
    const wanted = normalizeName(target);
    return pool.find((entry) => normalizeName(entry.name) === wanted)
      ?? pool.find((entry) => normalizeName(entry.name).includes(wanted) && wanted.length >= 3)
      ?? null;
  };
  const customer = byName(preview.customerName, customers)
    ?? (preview.customerTaxCode
      ? customers.find((entry) => entry.taxCode === preview.customerTaxCode) ?? null
      : null);
  if (!customer) {
    preview.errors.push('Không nhận diện được khách hàng trong danh mục (theo tên đầy đủ hoặc MST).');
    return preview;
  }
  preview.customerName = customer.name;
  preview.customerId = customer.id;
  for (const route of preview.routes) {
    const match = byName(route.factoryName, routes);
    if (!match) {
      route.errors.push(`Không tìm thấy tuyến đường cho nhà máy "${route.factoryName}".`);
      continue;
    }
    route.routeId = match.id;
    route.matchedRouteName = match.name;
    const [terms] = await db
      .select({ sharePct: s.freightRateTerms.sharePct })
      .from(s.freightRateTerms)
      .where(and(
        eq(s.freightRateTerms.customerId, customer.id),
        eq(s.freightRateTerms.routeId, match.id),
        isNull(s.freightRateTerms.deletedAt),
      ))
      .orderBy(desc(s.freightRateTerms.effectiveDate))
      .limit(1);
    route.sharePct = terms ? Number(terms.sharePct) : 2;
    // D1: the preview runs the SAME row validator the commit runs — a row
    // that would be refused at commit carries its row-level error here, so
    // the preview can never promise "khớp toàn bộ" over a refused row.
    for (const issue of validateImportRows(route)) {
      if (issue.row.error == null) issue.row.error = issue.message;
    }
  }
  return preview;
}
export interface CommitSheetResult {
  sheet: string; quotationId: number | null; customerName: string; errors: string[];
}

/** Commit creates a NEW quotation frame per customer (ruling 6), upserts the
 *  terms + pricing rows, and derives km from liters ÷ norm ÷ 2. Per-sheet
 *  transactional: an errored sheet writes nothing. */
function cellWhere(factory: string, label: string): string {
  return `${factory} · ${label}`;
}

/** Derive one-way km from the liters row: km = liters ÷ norm ÷ 2.
 * Family-safe (fuel-period 500 class): the norm may live on the base class
 * row or on a weight-split sibling — resolve across the whole family.
 * Deliberately NO name matching (lead ruling 2026-09-23): a substring name
 * match silently priced one class with another class's norm — an exact-code
 * miss returns null and the route's 400 names the missing code instead. */
export async function normForBase(baseCode: string): Promise<number | null> {
  const base = baseCode.includes('.') && !/^[0-9]/.test(baseCode)
    ? baseCode.split('.')[0]
    : baseCode;
  const familyCodes = [baseCode, `${base}.LIGHT`, `${base}.HEAVY`, base]
    .filter((code, index, all) => all.indexOf(code) === index);
  const classRows = await db.select({ id: s.vehicleSizeClasses.id })
    .from(s.vehicleSizeClasses).where(inArray(s.vehicleSizeClasses.code, familyCodes));
  if (classRows.length === 0) return null;
  const [norm] = await db
    .select({ litersPerKm: s.fuelConsumptionNorms.litersPerKm })
    .from(s.fuelConsumptionNorms)
    .where(and(
      inArray(s.fuelConsumptionNorms.vehicleSizeClassId, classRows.map((row) => row.id)),
      lte(s.fuelConsumptionNorms.effectiveDate, new Date().toISOString().slice(0, 10)),
      isNull(s.fuelConsumptionNorms.deletedAt),
    ))
    .orderBy(desc(s.fuelConsumptionNorms.effectiveDate))
    .limit(1);
  return norm ? Number(norm.litersPerKm) : null;
}
/** Commit creates a NEW quotation frame per customer (ruling 6 — never
 *  overwrite), upserts freight terms + pricing rows, derives km from liters
 *  ÷ norm ÷ 2 and base prices from Giá cos ÷ (1+share). Per-sheet
 *  transactional: any error in a sheet writes NOTHING for that sheet. */
export async function commitQuotationImport(
  buffer: Buffer,
  actorId: number,
): Promise<CommitSheetResult[]> {
  const preview = await previewQuotationImport(buffer);
  const results: CommitSheetResult[] = [];
  for (const sheet of preview.sheets) {
    const enriched = await enrichPreview(sheet);
    const errors: string[] = [...enriched.errors];
    for (const route of enriched.routes) {
      errors.push(...route.errors);
      // D1 single source of truth: the commit's row checks ARE the preview's
      // row checks — same function, same messages. (The norm/catalog
      // resolution below stays a commit-side backstop: the catalog can
      // change between preview and commit.)
      errors.push(...validateImportRows(route).map((issue) => issue.message));
    }
    if (errors.length > 0 || enriched.routes.length === 0) {
      results.push({ sheet: enriched.sheet, quotationId: null, customerName: enriched.customerName ?? '(không rõ khách hàng)', errors });
      continue;
    }
    const quotationId = await db.transaction(async (tx) => {
      if (!enriched.customerId) {
        throw new ApiError(400, `Không nhận diện được khách hàng cho sheet "${enriched.sheet}".`);
      }
      const today = new Date().toISOString().slice(0, 10);
      const [frame] = await tx.insert(s.quotations).values({
        customerId: enriched.customerId,
        templateName: `${enriched.sheet} (${today})`,
        effectiveDate: today,
        surchargeRoundingMode: enriched.roundingMode === 'NONE' ? 'NONE' : enriched.roundingMode,
      }).returning({ id: s.quotations.id });
      for (const route of enriched.routes) {
        const routeId = route.routeId!;
        const preparedRows: Array<{ row: (typeof route.rows)[number]; km: number; classId: number }> = [];
        for (const row of route.rows) {
          // Pass the class code WHOLE: normForBase resolves the digit-leading
          // dotted family itself ('1.25T' → 1.25T/LIGHT/HEAVY); pre-splitting
          // here truncated '1.25T' to '1' and 400'd a resolvable row.
          const norm = await normForBase(row.classCode);
          if (norm == null || norm <= 0) {
            throw new ApiError(400, `${cellWhere(route.factoryName, row.classLabel)}: không có định mức dầu cho ${row.classCode}. Kiểm tra hạng xe "${row.classCode}" tồn tại trong danh mục và định mức có ngày hiệu lực ≤ ngày nhập.`);
          }
          const km = Math.round(row.liters! / norm / 2);
          const [cls] = await tx.select({ id: s.vehicleSizeClasses.id })
            .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.code, row.classCode)).limit(1);
          if (!cls) throw new ApiError(400, `${cellWhere(route.factoryName, row.classLabel)}: hạng ${row.classCode} chưa có trong danh mục.`);
          preparedRows.push({ row, km, classId: cls.id });
        }
        // Terms are live-view parameters (referenced, not versioned): an
        // import UPSERTS them in place. billingKmOneWay lives here (derived
        // liters ÷ norm ÷ 2), NOT on the routes table.
        await tx.insert(s.freightRateTerms).values({
          customerId: enriched.customerId, routeId,
          sharePct: String(route.sharePct ?? 2),
          billingKmOneWay: preparedRows[0]?.km ?? 1,
          billingKmMultiplier: '2',
          baseFuelPrice: String(enriched.baseFuelPrice ?? 0),
          fuelLagDays: enriched.fuelLagDays ?? 0,
          fuelLagConfirmed: true,
          surchargeThresholdMode: 'NONE',
          effectiveDate: today,
          note: `Q57 import ${enriched.sheet}`,
        }).onConflictDoUpdate({
          target: [s.freightRateTerms.customerId, s.freightRateTerms.routeId, s.freightRateTerms.effectiveDate],
          set: {
            baseFuelPrice: String(enriched.baseFuelPrice ?? 0),
            fuelLagDays: enriched.fuelLagDays ?? 0,
            billingKmOneWay: preparedRows[0]?.km ?? 1,
            sharePct: String(route.sharePct ?? 2),
            updatedAt: new Date(),
          },
        });
        for (const prepared of preparedRows) {
          await tx.insert(s.quotationCells).values({
            quotationId: frame.id, routeId, vehicleSizeClassId: prepared.classId,
            heSo: String(prepared.row.heSo ?? 1),
          });
          const share = route.sharePct ?? 2;
          const basePrice = Math.round(prepared.row.giaCos! / (1 + share / 100));
          const [existingPricing] = await tx.select({ id: s.pricingTables.id })
            .from(s.pricingTables)
            .where(and(
              eq(s.pricingTables.customerId, enriched.customerId),
              eq(s.pricingTables.routeId, routeId),
              eq(s.pricingTables.rateKey, prepared.row.classCode),
              eq(s.pricingTables.effectiveDate, today),
              isNull(s.pricingTables.deletedAt),
            ))
            .limit(1);
          if (existingPricing) {
            await tx.update(s.pricingTables).set({ price: String(basePrice), updatedAt: new Date() })
              .where(eq(s.pricingTables.id, existingPricing.id));
          } else {
            await tx.insert(s.pricingTables).values({
              customerId: enriched.customerId, routeId, rateKey: prepared.row.classCode,
              price: String(basePrice), effectiveDate: today,
            });
          }
        }
      }
      return frame.id;
    });
    // Card _62: the import commit releases the frame's birth version (v1)
    // — post-commit so the frozen payload sees the committed state.
    const view = await getQuotation(quotationId);
    await releaseQuotationVersion(view, { triggerKind: 'IMPORT', actorId });
    results.push({ sheet: enriched.sheet, quotationId, customerName: enriched.customerName ?? '(không rõ khách hàng)', errors: [] });
  }
  return results;
}
