// Shared company-letterhead helpers for exported business documents
// (settlements, fuel vouchers, customer/supplier statements, receivables aging,
// debit notes). The own-company profile is configured by the admin on
// /config/company-info and read via getCompanyInfo(); these helpers stamp it
// consistently onto ExcelJS worksheets and printable HTML so every export
// carries the configured company identity (logo, name, address, MST, bank).
//
// White-label: when company info is empty (fresh install, not yet configured)
// the helpers render nothing offensive and still reserve stable row positions
// so downstream layout math does not shift.
import type * as ExcelJS from 'exceljs';
import type { CompanyInfo } from '@tingting/shared';
import { storageService } from '../storage.service';
import { escapeHtml } from '../../lib/format';

/** Read the company logo bytes from storage. Graceful skip (null) when no key
 *  is set or the file is unreadable, so a missing logo never fails an export. */
export async function loadLogoBytes(logoStorageKey?: string | null): Promise<Buffer | null> {
  if (!logoStorageKey) return null;
  try {
    return await storageService.read(logoStorageKey);
  } catch {
    return null;
  }
}

/** Company logo as a base64 `data:` URL for embedding in printable HTML (works
 *  inside an iframe / print without a separate authenticated request). Null
 *  when there is no logo. */
export async function loadLogoDataUrl(logoStorageKey?: string | null): Promise<string | null> {
  const bytes = await loadLogoBytes(logoStorageKey);
  return bytes ? `data:image/png;base64,${bytes.toString('base64')}` : null;
}

export interface CompanyHeaderXlsxOptions {
  /** Row to start the header at (1-based). Default 1. */
  startRow?: number;
  /** First column of the sheet (1-based). Default 1. */
  firstCol?: number;
  /** Last column of the sheet (1-based, inclusive) — required. */
  lastCol: number;
  /** Columns reserved on the left for the logo. Default 2. */
  logoCols?: number;
}

/**
 * Stamp a company letterhead into the top of a worksheet: logo (left, spanning
 * the header rows) + name (bold), address, "MST: …", and bank/contact lines
 * (right, merged to `lastCol`). Returns the 1-based row index immediately
 * AFTER the header block — callers continue their layout there.
 *
 * Always reserves 4 rows so downstream row math stays stable even when company
 * info is unconfigured (cells are simply left blank).
 */
export async function stampCompanyHeaderXlsx(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  company: CompanyInfo,
  opts: CompanyHeaderXlsxOptions,
): Promise<number> {
  const startRow = opts.startRow ?? 1;
  const firstCol = opts.firstCol ?? 1;
  const lastCol = opts.lastCol;
  const logoCols = opts.logoCols ?? 2;
  const textFirstCol = Math.min(firstCol + logoCols, lastCol);
  const rows = 4;

  // Logo overlaid in the leftmost `logoCols` columns, spanning all header rows.
  const logoBytes = await loadLogoBytes(company.logoStorageKey);
  if (logoBytes) {
    const imageId = wb.addImage({ base64: logoBytes.toString('base64'), extension: 'png' });
    // ExcelJS tl/ext are in 0-based column/row units and pixels respectively.
    const colWidthPx = 64; // approx per-column pixels; logo sized to logoCols columns
    ws.addImage(imageId, {
      tl: { col: firstCol - 1, row: startRow - 1 },
      ext: { width: colWidthPx * logoCols, height: 18 * rows },
    });
  }

  const setLine = (rowOff: number, value: string, font: Partial<ExcelJS.Font>): void => {
    const row = startRow + rowOff;
    if (value) {
      if (textFirstCol < lastCol) ws.mergeCells(row, textFirstCol, row, lastCol);
      const cell = ws.getCell(row, textFirstCol);
      cell.value = value;
      cell.font = font;
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
  };

  setLine(0, company.name, { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FF111827' } });
  setLine(1, company.address, { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } });
  const mst = company.taxCode ? `MST: ${company.taxCode}` : '';
  const contact = [company.phone, company.email].filter(Boolean).join(' · ');
  setLine(2, [mst, contact].filter(Boolean).join('  —  '), { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } });
  const bank = [company.bankAccount && `TK: ${company.bankAccount}`, company.bankName].filter(Boolean).join('  —  ');
  setLine(3, bank, { name: 'Segoe UI', size: 10, color: { argb: 'FF4B5563' } });

  return startRow + rows;
}

/**
 * Printable-HTML company letterhead fragment. `logoDataUrl` (from
 * loadLogoDataUrl) is embedded inline so the fragment is self-contained for
 * iframe/print. Renders nothing but a thin spacer when the company is entirely
 * unconfigured.
 */
export function companyHeaderHtml(company: CompanyInfo, logoDataUrl?: string | null): string {
  const hasAnything = company.name || company.address || company.taxCode
    || company.bankAccount || company.bankName || company.phone || company.email;
  if (!hasAnything) return '<div class="doc-company-header" style="height:8px"></div>';

  const lines: string[] = [];
  if (company.name) lines.push(`<div style="font-size:16px;font-weight:700;color:#111827">${escapeHtml(company.name)}</div>`);
  if (company.address) lines.push(`<div style="font-size:11px;color:#4B5563">${escapeHtml(company.address)}</div>`);
  const mst = company.taxCode ? `MST: ${escapeHtml(company.taxCode)}` : '';
  const contact = [company.phone, company.email].filter(Boolean).map(escapeHtml).join(' · ');
  const line3 = [mst, contact].filter(Boolean).join('  —  ');
  if (line3) lines.push(`<div style="font-size:11px;color:#4B5563">${line3}</div>`);
  const bank = [company.bankAccount && `TK: ${escapeHtml(company.bankAccount)}`, company.bankName && escapeHtml(company.bankName)]
    .filter(Boolean).join('  —  ');
  if (bank) lines.push(`<div style="font-size:11px;color:#4B5563">${bank}</div>`);

  const logo = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="" style="max-height:60px;max-width:180px;object-fit:contain" />`
    : '';

  return `<div class="doc-company-header" style="display:flex;gap:14px;align-items:center;margin-bottom:10px">${logo}<div style="display:flex;flex-direction:column">${lines.join('')}</div></div>`;
}
