import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { BillingDocument } from '@tingting/shared';
import type { CustomerStatementData } from './statement.service';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));

function fontPath(filename: string): string {
  const candidates = [
    path.resolve(serviceDir, '../assets', filename),
    path.resolve(serviceDir, '../../../frontend/public/fonts', filename),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Không tìm thấy phông chữ PDF: ${filename}`);
  return found;
}

function money(value: number | string | null | undefined): string {
  return `${Number(value ?? 0).toLocaleString('vi-VN')} ₫`;
}

function viDate(value: string | Date): string {
  return new Date(value).toLocaleDateString('vi-VN');
}

function collectPdf(render: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Creator: 'TransTing' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Regular', fontPath('BeVietnamPro-Regular.ttf'));
    doc.registerFont('Bold', fontPath('BeVietnamPro-SemiBold.ttf'));
    render(doc);
    doc.end();
  });
}

function heading(doc: PDFKit.PDFDocument, title: string, subtitle: string): void {
  doc.font('Bold').fontSize(20).fillColor('#0b5d3b').text(title);
  doc.moveDown(0.25);
  doc.font('Regular').fontSize(10).fillColor('#52635b').text(subtitle);
  doc.moveDown(1);
}

function ensureSpace(doc: PDFKit.PDFDocument, height = 48): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

export async function exportDebitNotePdf(docData: BillingDocument): Promise<Buffer> {
  return collectPdf((doc) => {
    heading(
      doc,
      'GIẤY BÁO NỢ',
      `Kỳ ${viDate(docData.rangeFrom)} – ${viDate(docData.rangeTo)}`,
    );
    doc.font('Bold').fontSize(11).fillColor('#14251d')
      .text(`Khách hàng: ${docData.entityName ?? `#${docData.entityId}`}`);
    doc.font('Regular').fontSize(10)
      .text(`Trạng thái: ${docData.debitNoteStatus ?? 'DRAFT'}`);
    doc.moveDown(0.8);

    for (const [index, line] of docData.lines.filter((item) => !item.excluded).entries()) {
      ensureSpace(doc, 54);
      const amount = line.amountOverride ?? line.baseAmount;
      doc.font('Bold').fontSize(10).fillColor('#14251d')
        .text(`${index + 1}. ${line.typeLabel || line.description || 'Khoản phải thu'}`);
      doc.font('Regular').fontSize(9).fillColor('#52635b')
        .text(line.description || line.routeName || '—');
      doc.font('Bold').fontSize(10).fillColor('#14251d')
        .text(money(amount), { align: 'right' });
      doc.moveDown(0.5);
    }

    ensureSpace(doc, 60);
    doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y)
      .strokeColor('#b8c8c0').stroke();
    doc.moveDown(0.6);
    doc.font('Bold').fontSize(13).fillColor('#0b5d3b')
      .text(`Tổng cộng: ${money(docData.totalInclVat)}`, { align: 'right' });
    doc.moveDown(1);
    doc.font('Regular').fontSize(8).fillColor('#708078')
      .text(`Xuất ngày ${new Date().toLocaleDateString('vi-VN')}`, { align: 'right' });
  });
}

export async function exportCustomerStatementPdf(data: CustomerStatementData): Promise<Buffer> {
  return collectPdf((doc) => {
    heading(doc, 'SAO KÊ CÔNG NỢ', `Khách hàng: ${data.customer.name}`);
    doc.font('Bold').fontSize(12).fillColor('#14251d')
      .text(`Số dư: ${money(data.totalOutstanding)}`);
    doc.moveDown(0.8);

    if (data.ledgerRows.length === 0) {
      doc.font('Regular').fontSize(10).fillColor('#52635b')
        .text('Không có phát sinh trong khoảng thời gian này.');
    }

    for (const row of data.ledgerRows) {
      ensureSpace(doc, 54);
      const description = row.note || row.tripCode || row.txnType;
      doc.font('Bold').fontSize(9).fillColor('#14251d')
        .text(`${viDate(row.timestamp)} · ${description}`);
      doc.font('Regular').fontSize(8).fillColor('#52635b')
        .text(`Ghi nợ: ${money(row.debit)}   Thanh toán: ${money(row.credit)}   Số dư: ${money(row.balance)}`);
      doc.moveDown(0.5);
    }

    doc.moveDown(0.8);
    doc.font('Regular').fontSize(8).fillColor('#708078')
      .text(`Xuất ngày ${new Date().toLocaleDateString('vi-VN')}`, { align: 'right' });
  });
}
