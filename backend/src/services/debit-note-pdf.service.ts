// Debit-Note PDF Export Service — Wave 2.
//
// Generates a printable HTML representation of a billing document (debit note)
// that can be opened in the browser and printed to PDF via the browser's
// native print-to-PDF. This matches the existing pattern used by
// statement.service.ts's `exportStatementHtml` (the ledger routes return
// HTML when format=pdf and let the browser handle the PDF conversion).
//
// A native PDF library (pdfkit/pdf-lib/puppeteer) is deliberately NOT added
// — the browser's print engine produces better Vietnamese font rendering and
// is the pattern this codebase already uses. A future slice can add server-
// side PDF if email attachments need binary PDF.

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';

export interface DebitNotePdfData {
  documentId: number;
  entityName: string;
  rangeFrom: string;
  rangeTo: string;
  totalInclVat: string;
  lines: Array<{
    lineType: string;
    typeLabel: string;
    description: string;
    baseAmount: string;
    routeName: string | null;
  }>;
  status: string | null;
}

/**
 * Fetch the debit-note data + lines for HTML/PDF export.
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
    entityName: doc.entityName ?? `#${doc.entityId}`,
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
    totalInclVat: doc.totalInclVat,
    status: doc.debitNoteStatus,
    lines: lines
      .filter(l => !l.excluded)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(l => ({
        lineType: l.lineType,
        typeLabel: l.typeLabel,
        description: l.description,
        baseAmount: l.amountOverride ?? l.baseAmount,
        routeName: l.routeName,
      })),
  };
}

/**
 * Generate the HTML for a debit note. The browser's print dialog converts
 * this to PDF. Matches the visual pattern of `buildStatementHtml`.
 */
export function exportDebitNoteHtml(data: DebitNotePdfData, dateStr: string): string {
  const rows = data.lines.map(l => `
    <tr>
      <td>${escapeHtml(l.typeLabel)}</td>
      <td>${escapeHtml(l.description)}</td>
      <td style="text-align: right;">${Number(l.baseAmount).toLocaleString('vi-VN')} ₫</td>
    </tr>
  `).join('');

  const total = Number(data.totalInclVat).toLocaleString('vi-VN');

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
    <strong>Trạng thái:</strong> ${data.status ?? 'DRAFT'}<br>
    <strong>Ngày xuất:</strong> ${dateStr}
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
    Giấy báo nợ #${data.documentId} — TingTing Logistics — Xuất ngày ${dateStr}
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
