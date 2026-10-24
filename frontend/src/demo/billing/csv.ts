/**
 * Demo billing CSV export (SIL-160). Builds a real, downloadable bảng kê
 * from the currently filtered sheet — Excel-friendly: UTF-8 BOM, CRLF,
 * every field quoted, totals row appended.
 */
import type { ApSheet, ArSheet } from './aggregations';
import { formatDate } from './format';

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;

function toCsv(rows: readonly string[][]): string {
  return `${rows.map((row) => row.map(quote).join(',')).join('\r\n')}\r\n`;
}

/** AR bảng kê CSV: mirror of the on-screen columns + tổng cộng row. */
export function buildArCsv(sheet: ArSheet): string {
  const rows: string[][] = [
    ['Ngày', 'Số Booking', 'Số Bill', 'Số Container', 'Loại cont', 'Tuyến (NM–Cảng)', 'Cước (VND)'],
    ...sheet.rows.map((row) => [
      formatDate(row.date),
      row.bookingNo,
      row.billNo ?? '',
      row.contNo,
      row.kindLabel,
      row.routeText,
      String(row.freightVnd),
    ]),
    [
      `TỔNG CỘNG (${sheet.tripCount} chuyến)`,
      '',
      '',
      '',
      '',
      '',
      String(sheet.totalVnd),
    ],
  ];
  return toCsv(rows);
}

/** AP bảng kê CSV: cước, UNC chi hộ và thực trả per chuyến + tổng cộng row. */
export function buildApCsv(sheet: ApSheet): string {
  const rows: string[][] = [
    ['Ngày', 'Chuyến', 'Số Container', 'Cước phải trả (VND)', 'UNC công ty chi hộ (VND)', 'Thực trả (VND)'],
    ...sheet.rows.map((row) => [
      formatDate(row.date),
      row.code,
      row.contNo,
      String(row.freightVnd),
      String(row.uncVnd),
      String(row.netVnd),
    ]),
    [
      `TỔNG CỘNG (${sheet.tripCount} chuyến)`,
      '',
      '',
      String(sheet.totalFreightVnd),
      String(sheet.totalUncVnd),
      String(sheet.totalNetVnd),
    ],
  ];
  return toCsv(rows);
}

/**
 * Trigger a real browser download of `csv` as `filename`. BOM first so
 * Excel reads the Vietnamese headers as UTF-8.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
