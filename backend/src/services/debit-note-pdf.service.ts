// Debit-Note PDF Export Service — Wave 2 + Wave 3 M5.8.
//
// Generates a printable HTML representation of a billing document (debit note)
// that visually MIRRORS the on-screen template preview
// (`frontend/src/pages/config/debit-note-template-preview.tsx`):
//   - Title (titleText)
//   - Party A (customer) header — name + tax code from the doc
//   - Party B (issuer) header — issuerName / issuerAddress / issuerTaxCode /
//     issuerRepresentative from the template snapshot
//   - Dynamic columns from `snapshot.columns`, each cell resolved via the
//     shared `renderColumnValue` (same function the XLSX renderer uses, so
//     screen ↔ XLSX ↔ PDF all agree)
//   - Totals row when any column has `total: true`
//   - Signature blocks (left + right) with label + name
//   - accentColor applied to title + total row
//
// The HTML opens in the browser; the browser's print dialog converts to PDF
// (the codebase's established pattern — statement export does the same). A
// native PDF library is deliberately NOT added: the browser's print engine
// produces better Vietnamese font rendering and avoids binary deps.

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import { resolveDebitNoteTemplateForDoc } from './billing-document.service';
import {
  resolveBillingDocumentIdentity,
  renderColumnValue,
} from './billing-export.service';
import type {
  BillingDocument,
  BillingDocumentLine,
  DebitNoteTemplateSnapshot,
  DebitNoteTemplateColumn,
} from '@tingting/shared';

// ─── Legacy data shape (kept for backward-compat tests / callers) ───────────

export interface DebitNotePdfData {
  documentId: number;
  entityName: string;
  rangeFrom: string;
  rangeTo: string;
  originalDueDate?: string | null;
  processingDueDate?: string | null;
  totalInclVat: string;
  totalNet?: string;
  totalTax?: string;
  totalGross?: string;
  vatTreatmentVersion?: string;
  lines: Array<{
    lineType: string;
    typeLabel: string;
    description: string;
    baseAmount: string;
    netAmount?: string;
    taxAmount?: string;
    grossAmount?: string;
    routeName: string | null;
  }>;
  status: string | null;
}

/**
 * Fetch the debit-note data + lines for the legacy (template-less) renderer.
 *
 * Kept for backward compatibility with the Wave-2 test surface. New callers
 * should use `getDebitNoteForRender` which returns the full BillingDocument
 * plus the resolved template snapshot.
 */
export async function getDebitNoteData(documentId: number): Promise<DebitNotePdfData> {
  const [doc] = await db.select().from(s.billingDocuments)
    .where(eq(s.billingDocuments.id, documentId))
    .limit(1);
  if (!doc) throw new ApiError(404, 'Không tìm thấy giấy báo nợ');

  const lines = await db.select()
    .from(s.billingDocumentLines)
    .where(eq(s.billingDocumentLines.documentId, documentId));

  return {
    documentId: doc.id,
    entityName: doc.entityName ?? 'Khách hàng chưa xác định',
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
    originalDueDate: doc.originalDueDate,
    processingDueDate: doc.processingDueDate,
    totalInclVat: doc.totalInclVat,
    totalNet: doc.totalNet,
    totalTax: doc.totalTax,
    totalGross: doc.totalGross,
    vatTreatmentVersion: doc.vatTreatmentVersion,
    status: doc.debitNoteStatus,
    lines: lines
      .filter(l => !l.excluded)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(l => ({
        lineType: l.lineType,
        typeLabel: l.typeLabel,
        description: l.description,
        baseAmount: l.amountOverride ?? l.baseAmount,
        netAmount: l.netAmount,
        taxAmount: l.taxAmount,
        grossAmount: l.grossAmount,
        routeName: l.routeName,
      })),
  };
}

// ─── Template-aware render path (M5.8) ──────────────────────────────────────

export interface DebitNoteRenderInput {
  doc: BillingDocument;
  snapshot: DebitNoteTemplateSnapshot;
  customerTaxCode?: string | null;
}

/**
 * Load everything the template-aware HTML renderer needs:
 *   - the full billing document (with hydrated lines)
 *   - the resolved template snapshot (doc snapshot → customer default →
 *     system default — same order as the XLSX path)
 *   - customer tax code for the Party A header
 *
 * Optional `templateIdOverride` re-renders once with a different template
 * (matches the XLSX route's override semantics) without persisting.
 */
export async function getDebitNoteForRender(
  documentId: number,
  opts: { templateIdOverride?: number | null } = {},
): Promise<DebitNoteRenderInput> {
  // Reuse the canonical hydration path so screen ↔ export always see the
  // same line data (including canonicalFreightDescription normalization).
  const { getDocument } = await import('./billing-document.service');
  const doc = await getDocument(documentId);
  // resolveDebitNoteTemplateForDoc always falls back to a system default
  // (never null in practice), but its declared return type is nullable.
  // Coalesce to a hard non-null so callers don't have to branch.
  const snapshot = (await resolveDebitNoteTemplateForDoc(doc, opts))!;
  const identity = await resolveBillingDocumentIdentity(doc, snapshot);
  const customerTaxCode = identity?.counterparty.taxCode || null;

  return { doc, snapshot, customerTaxCode };
}

/**
 * Validate a hex color string. Accepts `#rgb` or `#rrggbb`. Returns the
 * canonical `#rrggbb` form, or the default accent if invalid. Prevents CSS
 * injection via the user-editable accentColor field.
 */
export function safeAccentColor(input: string | null | undefined): string {
  const fallback = '#1F4E79';
  if (!input) return fallback;
  const trimmed = input.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    // Expand #rgb → #rrggbb so CSS interpolation is consistent.
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return fallback;
}

/**
 * Render one cell for a column + line as a printable string. Mirrors the
 * XLSX renderer's value resolution so the two outputs match cell-for-cell.
 */
function cellText(line: BillingDocumentLine, col: DebitNoteTemplateColumn, rowIndex: number): string {
  const value = renderColumnValue(line, col, rowIndex);
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // dd/MM/yyyy — Vietnamese convention.
    const d = value.getUTCDate().toString().padStart(2, '0');
    const m = (value.getUTCMonth() + 1).toString().padStart(2, '0');
    const y = value.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  if (typeof value === 'number') {
    if (col.format === 'currency') return `${value.toLocaleString('vi-VN')} ₫`;
    if (col.format === 'number') return value.toLocaleString('vi-VN');
    return String(value);
  }
  return escapeHtml(String(value));
}

/**
 * Template-aware HTML export. Mirrors the on-screen TemplatePreview:
 * title, party A/B headers, dynamic columns, totals row, signatures,
 * accent color.
 *
 * Backward-compat: when `snapshot` is omitted (or null), falls back to a
 * minimal legacy layout so existing 2-arg callers still render.
 */
export function exportDebitNoteHtml(
  data: DebitNotePdfData,
  dateStrOrSnapshot: string | DebitNoteTemplateSnapshot | null | undefined,
  maybeDateStr?: string,
): string {
  // Two calling conventions:
  //   exportDebitNoteHtml(data, '26/07/2026')                      — legacy
  //   exportDebitNoteHtml(data, snapshot, '26/07/2026')            — M5.8
  if (typeof dateStrOrSnapshot === 'string') {
    return exportLegacyHtml(data, dateStrOrSnapshot);
  }
  const snapshot = dateStrOrSnapshot ?? null;
  const dateStr = maybeDateStr ?? new Date().toISOString().slice(0, 10);
  if (!snapshot) return exportLegacyHtml(data, dateStr);

  const accent = safeAccentColor(snapshot.accentColor);
  const visibleColumns = (snapshot.columns ?? []).filter(c => c.width > 0);

  // Build the rich line payload from the legacy data shape. The legacy
  // shape lacks renderData, so variable bindings that depend on it
  // (truckPlate, containerCounts, freightAmount, etc.) fall through to
  // null — the caller should prefer getDebitNoteForRender() for full
  // fidelity. This branch is exercised by the existing Wave-2 test.
  const richLines: BillingDocumentLine[] = data.lines.map(l => ({
    sourceType: 'ADHOC',
    sourceId: null,
    lineType: 'ADHOC',
    typeLabel: l.typeLabel,
    unit: 'lần',
    description: l.description,
    routeName: l.routeName,
    containerNumbers: null,
    renderData: null,
    baseAmount: Number(l.baseAmount),
    amountOverride: null,
    excluded: false,
    sortOrder: 0,
  }));

  const headerCells = visibleColumns.map(c =>
    `            <th style="text-align: ${c.align}; width: ${Math.max(c.width, 5) * 12}px;">${escapeHtml(c.label)}</th>`
  ).join('\n');

  const bodyRows = richLines.map((line, i) => {
    const cells = visibleColumns.map(c => {
      const text = cellText(line, c, i + 1);
      return `            <td style="text-align: ${c.align};">${text}</td>`;
    }).join('\n');
    return `          <tr>\n${cells}\n          </tr>`;
  }).join('\n');

  const totalNet = Number(data.totalNet ?? data.totalInclVat);
  const totalTax = Number(data.totalTax ?? 0);
  const totalGross = Number(data.totalGross ?? data.totalInclVat);
  const totalRow = `          <tr class="total-row" style="background: ${accent}1A; border-top: 2px solid ${accent};">
            <td colspan="${visibleColumns.length}" style="text-align: right;">
              TỔNG CỘNG · TRƯỚC VAT: ${totalNet.toLocaleString('vi-VN')} ₫ · VAT: ${totalTax.toLocaleString('vi-VN')} ₫ · TỔNG THANH TOÁN: ${totalGross.toLocaleString('vi-VN')} ₫
            </td>
          </tr>`;

  const officialIdentity = (snapshot as DebitNoteTemplateSnapshot & {
    officialIdentity?: {
      issuer?: { name?: string | null; address?: string | null; taxCode?: string | null; representative?: string | null };
      counterparty?: { name?: string | null; address?: string | null; taxCode?: string | null; representative?: string | null };
      signatures?: { leftLabel?: string | null; leftName?: string | null; rightLabel?: string | null; rightName?: string | null };
    } | null;
  }).officialIdentity ?? null;
  const title = escapeHtml(snapshot.titleText || 'GIẤY BÁO NỢ');
  const issuerName = escapeHtml(officialIdentity?.issuer?.name ?? snapshot.issuerName ?? '');
  const issuerAddress = escapeHtml(officialIdentity?.issuer?.address ?? snapshot.issuerAddress ?? '');
  const issuerTaxCode = escapeHtml(officialIdentity?.issuer?.taxCode ?? snapshot.issuerTaxCode ?? '');
  const issuerRepresentative = escapeHtml(officialIdentity?.issuer?.representative ?? snapshot.issuerRepresentative ?? '');
  const partyAName = escapeHtml(officialIdentity?.counterparty?.name ?? data.entityName);
  const partyAAddress = escapeHtml(officialIdentity?.counterparty?.address ?? '');
  const partyATaxCode = escapeHtml(officialIdentity?.counterparty?.taxCode ?? '');
  const partyARepresentative = escapeHtml(officialIdentity?.counterparty?.representative ?? '');
  const termsLines = (snapshot.termsText ?? '').split('\n').filter(l => l.trim()).map(l => `      <p>${escapeHtml(l)}</p>`).join('\n');
  const signatureLeft = escapeHtml(officialIdentity?.signatures?.leftLabel ?? snapshot.signatureLeftLabel ?? 'Khách hàng');
  const signatureLeftName = escapeHtml(officialIdentity?.signatures?.leftName ?? snapshot.signatureLeftName ?? '');
  const signatureRight = escapeHtml(officialIdentity?.signatures?.rightLabel ?? snapshot.signatureRightLabel ?? 'Kế toán trưởng');
  const signatureRightName = escapeHtml(officialIdentity?.signatures?.rightName ?? snapshot.signatureRightName ?? '');
  const dueDateLine = data.originalDueDate
    ? `· Hạn hợp đồng: ${escapeHtml(data.originalDueDate)}
    · Ngày xử lý: ${escapeHtml(data.processingDueDate ?? data.originalDueDate)}`
    : '· Hạn thanh toán: Chưa có dữ liệu lịch sử';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${title} — ${partyAName} — ${data.rangeFrom} → ${data.rangeTo}</title>
  <style>
    * { font-family: 'Segoe UI', Arial, sans-serif; box-sizing: border-box; }
    body { margin: 24px; color: #1a1a1a; }
    h1 { font-size: 22px; margin: 0 0 4px 0; color: ${accent}; }
    .subheader { font-size: 12px; color: #666; margin-bottom: 16px; }
    .parties { display: flex; gap: 32px; margin-bottom: 16px; font-size: 13px; }
    .parties > div { flex: 1; }
    .parties strong { display: block; margin-bottom: 4px; }
    .parties p { margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { font-size: 11px; color: #555; border-bottom: 2px solid ${accent}; padding: 6px 8px; text-transform: uppercase; vertical-align: top; }
    td { font-size: 12px; border-bottom: 1px solid #eee; padding: 6px 8px; vertical-align: top; }
    .total-row td { font-weight: 700; font-size: 13px; padding: 10px 8px; }
    .signatures { display: flex; justify-content: space-between; margin-top: 40px; font-size: 13px; }
    .signatures > div { text-align: center; width: 45%; }
    .signatures .sig-label { font-weight: 600; margin-bottom: 56px; }
    .signatures .sig-name { font-style: italic; }
    .footer { margin-top: 32px; font-size: 11px; color: #999; text-align: center; }
    @media print { body { margin: 12mm; } .parties, .signatures { gap: 16px; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="subheader">
    Kỳ: ${data.rangeFrom} → ${data.rangeTo}
    ${dueDateLine}
    · Trạng thái: ${escapeHtml(data.status ?? 'DRAFT')}
    · Ngày xuất: ${escapeHtml(dateStr)}
  </div>

  <div class="parties">
    <div>
      <strong>BÊN A (BÊN THUÊ DỊCH VỤ)</strong>
      <p>${partyAName}</p>
      ${partyAAddress ? `<p>Địa chỉ: ${partyAAddress}</p>` : ''}
      ${partyATaxCode ? `<p>Mã số thuế: ${partyATaxCode}</p>` : ''}
      ${partyARepresentative ? `<p>Đại diện: ${partyARepresentative}</p>` : ''}
    </div>
    <div>
      <strong>BÊN B (BÊN CUNG CẤP DỊCH VỤ)</strong>
      <p>${issuerName || '—'}</p>
      ${issuerAddress ? `<p>Địa chỉ: ${issuerAddress}</p>` : ''}
      ${issuerTaxCode ? `<p>Mã số thuế: ${issuerTaxCode}</p>` : ''}
      ${issuerRepresentative ? `<p>Đại diện: ${issuerRepresentative}</p>` : ''}
    </div>
  </div>

  ${termsLines ? `<div class="terms">${termsLines}</div>` : ''}

  <table>
    <thead>
      <tr>
${headerCells}
      </tr>
    </thead>
    <tbody>
${bodyRows}
${totalRow}
    </tbody>
  </table>

  <div class="signatures">
    <div>
      <div class="sig-label">${signatureLeft}</div>
      <div class="sig-name">${signatureLeftName}</div>
    </div>
    <div>
      <div class="sig-label">${signatureRight}</div>
      <div class="sig-name">${signatureRightName}</div>
    </div>
  </div>

  <div class="footer">
    Giấy báo nợ kỳ ${escapeHtml(data.rangeFrom)} – ${escapeHtml(data.rangeTo)} · ${escapeHtml(partyAName)} · Xuất ngày ${escapeHtml(dateStr)}
  </div>
</body>
</html>`;
}

/**
 * Legacy minimal renderer (Wave 2). Used when no template snapshot is
 * supplied — renders a plain typeLabel / description / amount table.
 */
function exportLegacyHtml(data: DebitNotePdfData, dateStr: string): string {
  const rows = data.lines.map(l => `
    <tr>
      <td>${escapeHtml(l.typeLabel)}</td>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align: right;">${Number(l.baseAmount).toLocaleString('vi-VN')} ₫</td>
    </tr>
  `).join('');

  const total = Number(data.totalInclVat).toLocaleString('vi-VN');
  const dueDateHtml = data.originalDueDate
    ? `<strong>Hạn hợp đồng:</strong> ${escapeHtml(data.originalDueDate)}<br>
    <strong>Ngày xử lý:</strong> ${escapeHtml(data.processingDueDate ?? data.originalDueDate)}<br>`
    : '<strong>Hạn thanh toán:</strong> Chưa có dữ liệu lịch sử<br>';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Giấy báo nợ — ${escapeHtml(data.entityName)} — ${data.rangeFrom} → ${data.rangeTo}</title>
  <style>
    * { font-family: 'Segoe UI', Arial, sans-serif; }
    body { margin: 32px; color: #1a1a1a; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #555; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { text-align: left; font-size: 12px; color: #666; border-bottom: 2px solid #ddd; padding: 8px; text-transform: uppercase; }
    td { font-size: 13px; border-bottom: 1px solid #eee; padding: 8px; }
    .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #333; border-bottom: none; padding-top: 12px; }
    .footer { margin-top: 32px; font-size: 12px; color: #999; }
    @media print { body { margin: 12mm; } }
  </style>
</head>
<body>
  <h1>Giấy báo nợ</h1>
  <div class="meta">
    <strong>Khách hàng:</strong> ${escapeHtml(data.entityName)}<br>
    <strong>Kỳ:</strong> ${data.rangeFrom} → ${data.rangeTo}<br>
    ${dueDateHtml}
    <strong>Trạng thái:</strong> ${escapeHtml(data.status ?? 'DRAFT')}<br>
    <strong>Ngày xuất:</strong> ${escapeHtml(dateStr)}
  </div>
  <table>
    <thead>
      <tr>
        <th>Loại</th>
        <th>Mô tả</th>
        <th style="text-align: right;">Số tiền (₫)</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="2">Tổng cộng (bao gồm VAT)</td>
        <td style="text-align: right;">${total} ₫</td>
      </tr>
    </tbody>
  </table>
  <div class="footer">
    Giấy báo nợ kỳ ${escapeHtml(data.rangeFrom)} – ${escapeHtml(data.rangeTo)} — TingTing Logistics — Xuất ngày ${escapeHtml(dateStr)}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
