// Type-only: the library itself is loaded on demand inside downloadCSV so its
// ~1MB payload never ships with page bundles that merely link an export button.
import type ExcelJSTypes from 'exceljs';
import { BRAND as APP_BRAND } from '../brand';

export type ColumnType = 'text' | 'number' | 'km' | 'liters' | 'currency' | 'date' | 'decimal';

export interface DownloadOptions {
  /** Report title shown on the emerald title band. Defaults to filename. */
  title?: string;
  /** Subtitle shown under the title (e.g. "Tháng 06/2026 · Trạng thái: Hoàn thành"). */
  subtitle?: string;
  /** Per-column type metadata (length must match headers). */
  columnTypes?: ColumnType[];
  /** Force a totals row at the bottom for the given column indices. */
  totalsColumns?: number[];
  /** Label shown in the totals row's first cell. Defaults to "TỔNG CỘNG". */
  totalsLabel?: string;
  /** Hide the totals row entirely. Defaults to false. */
  hideTotals?: boolean;
}

/* ─── Brand tokens (mirrors --brand in styles/tokens.css) ────────────────── */

const BRAND = 'FF00B14F';
const BRAND_DARK = 'FF008B3E';
const BRAND_SOFT = 'FFE6F7EE';
const HEADER_FG = 'FFFFFFFF';
const ROW_ZEBRA = 'FFF9FBF9';
const BORDER = 'FFD1D5DB';
const TITLE_FG = 'FF111827';
const META_FG = 'FF6B7280';
const TOTALS_FG = 'FFFFFFFF';

const FONT_FAMILY = 'Segoe UI';

const BORDER_STYLE = {
  top: { style: 'thin' as const, color: { argb: BORDER } },
  left: { style: 'thin' as const, color: { argb: BORDER } },
  bottom: { style: 'thin' as const, color: { argb: BORDER } },
  right: { style: 'thin' as const, color: { argb: BORDER } },
};

/* ─── Number format strings ──────────────────────────────────────────────── */

const NF = {
  integer: '#,##0',
  decimal: '#,##0.00',
  currency: '#,##0" ₫"',
  date: 'dd/mm/yyyy',
};

/**
 * Default column-type inference used when the caller does not provide
 * `columnTypes`. Keeps the legacy behavior for the simple catalog exports.
 */
function inferColumnType(header: string, sampleValues: Array<string | number | undefined>): ColumnType {
  const h = header.toLowerCase();
  if (/(ngày|date|tg|time)/.test(h)) return 'date';
  if (/(km\b)/.test(h)) return 'km';
  if (/(lít|lit|dầu|fuel)/.test(h)) return 'liters';
  if (/(₫|đ|vnd|giá|tiền|doanh thu|chi phí|phí|nợ|có|dư|số dư|tổng)/.test(h)) return 'currency';

  // Inspect sample data — if every non-empty value parses as a number, treat as number.
  const nonEmpty = sampleValues.filter(v => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'text';
  const allNumeric = nonEmpty.every(v => {
    if (typeof v === 'number') return Number.isFinite(v);
    const s = String(v).replace(/[₫đ\s.,]/g, '');
    return /^\d+$/.test(s) || /^\d+([.,]\d+)?$/.test(s);
  });
  return allNumeric ? 'number' : 'text';
}

/**
 * Convert a raw cell value to a typed JS value (number/Date) appropriate for the
 * column type. Returns the original value if no conversion applies.
 */
function coerceCellValue(value: string | number, type: ColumnType): string | number | Date {
  if (value === '' || value == null) return value;

  if (type === 'currency' || type === 'number' || type === 'km' || type === 'liters' || type === 'decimal') {
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/[₫đ\s]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : value;
  }

  if (type === 'date') {
    // Accept ISO-ish strings (YYYY-MM-DD or full ISO). Pass through what we can't parse.
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d;
    }
    return value;
  }

  return value;
}

/**
 * Build a professional .xlsx report and trigger a browser download.
 *
 * - Backward compatible with the original `downloadCSV(filename, headers, rows)`
 *   signature; the 4th `options` argument is optional.
 * - Layout: emerald title band (3 rows), header row, data rows, optional totals row.
 * - Header row is frozen so it stays visible while scrolling.
 * - Per-column number formats honor explicit `columnTypes` when supplied, or
 *   fall back to header-based inference.
 * - Print setup is landscape with fit-to-page width so internal printouts are clean.
 */
export async function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  options: DownloadOptions = {},
): Promise<void> {
  const cleanFilename = filename.endsWith('.csv') ? filename.replace(/\.csv$/, '.xlsx') : filename;

  const colCount = headers.length;
  const today = new Date();
  const dateStr = today.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const title = options.title ?? 'BÁO CÁO';
  const subtitle = options.subtitle;

  /* ─── Resolve column types ───────────────────────────────────────────── */
  const columnTypes: ColumnType[] =
    options.columnTypes && options.columnTypes.length === colCount
      ? options.columnTypes
      : headers.map((h, i) => {
          const sample = rows.slice(0, 20).map(r => r[i]);
          return inferColumnType(h, sample);
        });

  /* ─── Workbook + sheet ──────────────────────────────────────────────── */
  // Deferred until the user actually exports — this is the only moment the
  // spreadsheet engine is needed, so the import stays off every page's
  // critical path and loads once (then from cache) on first export.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = APP_BRAND.productName;
  workbook.created = today;
  const worksheet = workbook.addWorksheet('Báo cáo', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: {
      oddFooter: `&L&"Segoe UI,Italic"&8${APP_BRAND.productName} · Xuất ngày ` + dateStr +
        '&C&"Segoe UI,Italic"&8Trang &P / &N' +
        '&R&"Segoe UI,Italic"&8Tài liệu nội bộ',
    },
  });

  /* ─── Title band (rows 1-3) ─────────────────────────────────────────── */
  worksheet.mergeCells(1, 1, 1, colCount);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = title.toUpperCase();
  titleCell.font = { name: FONT_FAMILY, size: 14, bold: true, color: { argb: TITLE_FG } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_SOFT } };
  titleCell.border = { bottom: { style: 'thin', color: { argb: BRAND } } };
  worksheet.getRow(1).height = 26;

  // Subtitle row (optional)
  worksheet.mergeCells(2, 1, 2, colCount);
  const subtitleCell = worksheet.getCell(2, 1);
  if (subtitle) {
    subtitleCell.value = subtitle;
    subtitleCell.font = { name: FONT_FAMILY, size: 10, color: { argb: META_FG }, italic: true };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  }
  worksheet.getRow(2).height = 18;

  // Export date row
  worksheet.mergeCells(3, 1, 3, colCount);
  const dateCell = worksheet.getCell(3, 1);
  dateCell.value = `Ngày xuất: ${dateStr}`;
  dateCell.font = { name: FONT_FAMILY, size: 10, color: { argb: META_FG } };
  dateCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  worksheet.getRow(3).height = 18;

  // Spacer row 4 stays blank (used as the freeze pane boundary)

  /* ─── Header row (row 5) ─────────────────────────────────────────────── */
  const headerRowIdx = 5;
  const headerRow = worksheet.getRow(headerRowIdx);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: HEADER_FG } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    cell.alignment = { vertical: 'middle', horizontal: centerAlignFor(i, columnTypes[i]), wrapText: true };
    cell.border = BORDER_STYLE;
  });
  headerRow.height = 32;

  /* ─── Data rows ──────────────────────────────────────────────────────── */
  const dataStartIdx = headerRowIdx + 1;
  rows.forEach((r, rowIdx) => {
    const excelRow = worksheet.getRow(dataStartIdx + rowIdx);
    excelRow.height = 22;
    const zebra = rowIdx % 2 === 1 ? ROW_ZEBRA : 'FFFFFFFF';
    r.forEach((raw, i) => {
      const cell = excelRow.getCell(i + 1);
      const type = columnTypes[i] ?? 'text';
      const value = coerceCellValue(raw, type);
      cell.value = value as ExcelJSTypes.CellValue;
      cell.font = { name: FONT_FAMILY, size: 10, color: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', horizontal: centerAlignFor(i, type), wrapText: false };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      cell.border = BORDER_STYLE;
      cell.numFmt = numFmtFor(type);
    });
  });

  /* ─── Totals row (optional) ─────────────────────────────────────────── */
  const totalsCols = options.totalsColumns?.filter(i => i >= 0 && i < colCount) ?? [];
  const showTotals = !options.hideTotals && totalsCols.length > 0 && rows.length > 0;
  if (showTotals) {
    const totalsRowIdx = dataStartIdx + rows.length;
    const totalsRow = worksheet.getRow(totalsRowIdx);
    totalsRow.height = 26;

    // Label cell spans the first non-totals column to the left
    const labelCell = totalsRow.getCell(1);
    labelCell.value = options.totalsLabel ?? 'TỔNG CỘNG';
    labelCell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: TOTALS_FG } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DARK } };
    labelCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    labelCell.border = BORDER_STYLE;

    // Empty cells between label and the first totals column → dark fill, white border.
    for (let c = 2; c <= colCount; c++) {
      const cell = totalsRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DARK } };
      cell.border = BORDER_STYLE;
    }

    // Totals values (sum of the data column above)
    totalsCols.forEach(colIdx => {
      const colLetter = worksheet.getColumn(colIdx + 1).letter;
      const type = columnTypes[colIdx];
      const cell = totalsRow.getCell(colIdx + 1);
      cell.value = {
        formula: `SUM(${colLetter}${dataStartIdx}:${colLetter}${dataStartIdx + rows.length - 1})`,
      };
      cell.numFmt = numFmtFor(type);
      cell.font = { name: FONT_FAMILY, size: 10, bold: true, color: { argb: TOTALS_FG } };
      cell.alignment = { vertical: 'middle', horizontal: centerAlignFor(colIdx, type) };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_DARK } };
      cell.border = BORDER_STYLE;
    });
  }

  /* ─── Column widths (outlier-aware: compact, wrap the long tail) ──────── */
  // Goal: every column is just wide enough for its longest value — UNLESS that
  // longest value is an outlier vs the median, in which case the column is sized
  // to the typical value and the long values wrap (and the row grows to fit).
  const OUTLIER_MIN = 28;     // absolute floor before wrap is even considered
  const OUTLIER_RATIO = 1.6;  // max must exceed median × this to count as an outlier
  const WRAP_FLOOR = 14;      // a wrapping column is never narrower than this
  const WRAP_CAP = 34;        // a wrapping column is never wider than this
  const WRAP_PAD = 6;         // wrap width ≈ median + this (breathing room)
  const NORMAL_PAD = 4;       // non-wrap width = maxLen + this (fits the longest value)
  const minByType: Record<ColumnType, number> = {
    text: 12, number: 12, km: 10, liters: 12, currency: 16, date: 13, decimal: 12,
  };

  const wrapCols = new Set<number>();
  worksheet.columns.forEach((col, i) => {
    const headerLen = (headers[i] ?? '').length;
    const lens: number[] = [];
    // Measure the header + data cells only: skip the title band (rows 1-4) whose
    // merged cells (e.g. a long subtitle) would otherwise skew the widths.
    worksheet.getColumn(i + 1).eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber < headerRowIdx) return;
      const v = cell.value;
      if (v == null) return;
      let len = 0;
      if (typeof v === 'number') {
        len = String(v).length + 2;
      } else if (v instanceof Date) {
        len = 12;
      } else if (typeof v === 'object') {
        // ExcelJS formula / rich-text / hyperlink values — render as a generic width.
        len = 14;
      } else {
        len = String(v).length;
      }
      lens.push(len);
    });
    const type = columnTypes[i];
    const maxLen = lens.reduce((m, l) => (l > m ? l : m), headerLen);

    // Only free-text columns wrap; numbers/dates are always single-line.
    const sorted = [...lens].sort((a, b) => a - b);
    const median = sorted.length
      ? sorted.length <= 3
        ? maxLen // tiny tables: keep it simple, never wrap
        : sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : maxLen;
    const isOutlier =
      type === 'text' && maxLen >= OUTLIER_MIN && maxLen > median * OUTLIER_RATIO;

    if (isOutlier) {
      wrapCols.add(i);
      col.width = Math.min(Math.max(Math.round(median) + WRAP_PAD, WRAP_FLOOR), WRAP_CAP);
    } else {
      col.width = Math.max(maxLen + NORMAL_PAD, minByType[type] ?? 12);
    }
  });

  /* ─── Wrap alignment + row heights (wrapped cells grow, not stretch) ──── */
  const ROW_BASE = 22;
  const LINE_HEIGHT = 14.5;
  if (wrapCols.size > 0) {
    rows.forEach((r, rowIdx) => {
      const excelRow = worksheet.getRow(dataStartIdx + rowIdx);
      let maxLines = 1;
      wrapCols.forEach(colIdx => {
        const text = r[colIdx] == null ? '' : String(r[colIdx]);
        const colWidth = worksheet.getColumn(colIdx + 1).width ?? minByType.text;
        const charsPerLine = Math.max(Math.floor(colWidth) - 1, 4);
        const lines = text
          .split('\n')
          .reduce((sum, seg) => sum + Math.max(1, Math.ceil(seg.length / charsPerLine)), 0);
        if (lines > maxLines) maxLines = lines;
        // Wrapped columns read best top-aligned and left-justified.
        excelRow.getCell(colIdx + 1).alignment = {
          vertical: 'top',
          horizontal: 'left',
          wrapText: true,
        };
      });
      if (maxLines > 1) {
        excelRow.height = Math.max(ROW_BASE, maxLines * LINE_HEIGHT);
      }
    });
  }

  /* ─── Print margins ──────────────────────────────────────────────────── */
  worksheet.pageSetup.margins = { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 };

  /* ─── Write + download ──────────────────────────────────────────────── */
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cleanFilename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function centerAlignFor(colIdx: number, type: ColumnType): 'left' | 'center' | 'right' {
  if (type === 'currency' || type === 'number' || type === 'km' || type === 'liters' || type === 'decimal') {
    return 'right';
  }
  if (type === 'date') return 'center';
  // First column (label/index) and short text columns look better left-aligned.
  return colIdx === 0 ? 'left' : 'left';
}

function numFmtFor(type: ColumnType): string {
  switch (type) {
    case 'currency': return NF.currency;
    case 'km':       return NF.integer;
    case 'liters':   return NF.decimal;
    case 'decimal':  return NF.decimal;
    case 'date':     return NF.date;
    case 'number':   return NF.integer;
    default:         return 'General';
  }
}
