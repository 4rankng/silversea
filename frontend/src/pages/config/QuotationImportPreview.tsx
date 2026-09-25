// Card 20260922_57 — the pre-commit mapping preview (extracted from
// QuotationConfigPage, which the structure guard pins at 440 lines).
// Contract: show what WILL be written before any write, name every unmapped
// row (TC-BG-14), surface sheet-level errors — unknown customer etc —
// verbatim with the customer's full name + MST (TC-BG-13), and offer Huỷ
// so nothing is written unless the user confirms (TC-BG-15).
import type { ImportPreviewPayload } from '../../api/quotationClient';
import { formatCurrency } from '../../lib/format';

interface QuotationImportPreviewProps {
  preview: ImportPreviewPayload;
  committing: boolean;
  onCommit: () => void;
  onCancel: () => void;
}

export function QuotationImportPreview({ preview, committing, onCommit, onCancel }: QuotationImportPreviewProps) {
  return (
    <section className="quotation-import-preview" aria-label="Xem trước nhập xlsx">
      <p className="quotation-status">
        Xem trước: {preview.totalErrors === 0
          ? 'khớp toàn bộ — bấm Ghi nhận để nhập.'
          : `${preview.totalErrors} lỗi ánh xạ — sửa file hoặc báo quản trị.`}
      </p>
      {preview.sheets.map((sheet) => (
        <div key={sheet.sheet} style={{ marginBottom: 8 }}>
          <strong>{sheet.sheet}</strong> — {sheet.customerName ?? '(không rõ khách hàng)'}
          {sheet.customerTaxCode ? ` · MST ${sheet.customerTaxCode}` : ''}
          {sheet.errors.map((error) => (
            <div key={error} style={{ color: 'var(--danger)' }}>✗ {error}</div>
          ))}
          {sheet.routes.map((route) => (
            <div key={route.factoryName} style={{ paddingLeft: 12 }}>
              {route.matchedRouteName
                ? `✓ ${route.factoryName} → ${route.matchedRouteName}`
                : `✗ ${route.errors.join(' · ') || 'không khớp tuyến'}`}
              {route.rows.map((row) => (
                <div key={row.classCode} style={{ paddingLeft: 12, color: row.error ? 'var(--danger)' : undefined }}>
                  {row.error
                    ? `✗ ${row.error}`
                    : `✓ ${row.classLabel}: ${row.liters ?? '?'} lít · ${row.giaCos != null ? formatCurrency(row.giaCos) : '? ₫'}${row.surcharge != null ? ` · Phụ phí ${formatCurrency(row.surcharge)}` : ''}`}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          disabled={committing || preview.totalErrors > 0}
          onClick={onCommit}
        >
          {committing ? 'Đang ghi…' : 'Ghi nhận nhập file'}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" disabled={committing} onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </section>
  );
}
