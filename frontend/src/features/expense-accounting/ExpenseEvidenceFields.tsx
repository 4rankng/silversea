import { DateField, TextField, UuiSelectField } from '../../design-system';

export type ExpenseEvidenceKind = 'INVOICE' | 'RECEIPT';

export interface ExpenseEvidenceFieldsProps {
  kind: ExpenseEvidenceKind;
  onKindChange: (kind: ExpenseEvidenceKind) => void;
  invoiceNumber: string;
  onInvoiceNumber: (value: string) => void;
  invoiceDate: string;
  onInvoiceDate: (value: string) => void;
  /** Hint only ("Bắt buộc với khoản có hóa đơn" vs "Để trống nếu không có hóa đơn")
   *  — the invoice number itself stays optional to fill; the server enforces the
   *  invoiced-catalog rule. */
  required?: boolean;
  disabled?: boolean;
}

/**
 * Loại chứng từ (Hóa đơn / Phiếu thu) + số/ngày hóa đơn — one picker for every
 * cost-entry screen (driver lot costs and the accounting drawer), so the two
 * surfaces cannot drift on what a "Phiếu thu" row hides or sends.
 *
 * "Phiếu thu" (cash receipt) carries no VAT invoice: the number/date fields are
 * simply not mounted, so no leftover text can leak into the payload. "Hóa đơn"
 * shows them. Whether a photo is MANDATORY is the caller's rule (driver: yes
 * for Phiếu thu; accounting: no) — this component never owns the photo button.
 */
export function ExpenseEvidenceFields({
  kind,
  onKindChange,
  invoiceNumber,
  onInvoiceNumber,
  invoiceDate,
  onInvoiceDate,
  required = false,
  disabled = false,
}: ExpenseEvidenceFieldsProps) {
  return (
    <>
      <UuiSelectField
        label="Loại chứng từ"
        value={kind}
        disabled={disabled}
        onChange={(event) => onKindChange(event.target.value as ExpenseEvidenceKind)}
        options={[
          { value: 'INVOICE', label: 'Hóa đơn' },
          { value: 'RECEIPT', label: 'Phiếu thu' },
        ]}
      />
      {kind === 'INVOICE' && (
        <>
          <TextField
            controlSize="sm"
            label="Số hóa đơn"
            value={invoiceNumber}
            onChange={(event) => onInvoiceNumber(event.target.value)}
            maxLength={100}
            disabled={disabled}
            placeholder={required ? 'Bắt buộc với khoản có hóa đơn' : 'Để trống nếu không có hóa đơn'}
          />
          <DateField
            controlSize="sm"
            label="Ngày hóa đơn"
            value={invoiceDate}
            onChange={onInvoiceDate}
            disabled={disabled}
          />
        </>
      )}
    </>
  );
}

export default ExpenseEvidenceFields;
