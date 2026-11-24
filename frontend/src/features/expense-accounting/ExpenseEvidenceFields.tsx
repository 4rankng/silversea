import { DateField, TextField, UuiSelectField } from '../../design-system';

export type ExpenseEvidenceKind = 'INVOICE' | 'RECEIPT';

interface ExpenseEvidenceFieldsBase {
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

export type ExpenseEvidenceFieldsProps = ExpenseEvidenceFieldsBase & (
  | {
      /** Driver lot-cost surface: the "Loại chứng từ" picker gates the pair —
       *  the driver payload carries `evidenceKind` and the photo rule hangs on
       *  it ("Phiếu thu" hides the invoice fields so no leftover text leaks). */
      variant?: 'kind-picker';
      kind: ExpenseEvidenceKind;
      onKindChange: (kind: ExpenseEvidenceKind) => void;
    }
  | {
      /** FB-097 (card 141026230740) — accounting "Thêm khoản chi": gọn theo
       *  card, không có ô "Loại chứng từ" (hợp đồng lưu không ghi trường này);
       *  cặp số/ngày hóa đơn hiển thị sẵn, điền hoặc không đều được. */
      variant: 'invoice-pair';
    }
);

/**
 * Số/ngày hóa đơn cho mọi màn hình khai chi phí. Hai biến thể:
 * - `kind-picker` (mặc định, màn hình lái xe): "Loại chứng từ" (Hóa đơn / Phiếu
 *   thu) quyết định cặp số/ngày hóa đơn có hiển thị hay không.
 * - `invoice-pair` (form kế toán): chỉ cặp số/ngày hóa đơn, luôn hiển thị, tùy
 *   chọn. Component không sở hữu nút ảnh — quy tắc ảnh là của nơi gọi.
 */
export function ExpenseEvidenceFields(props: ExpenseEvidenceFieldsProps) {
  const {
    invoiceNumber,
    onInvoiceNumber,
    invoiceDate,
    onInvoiceDate,
    required = false,
    disabled = false,
  } = props;
  const showPair = props.variant === 'invoice-pair' || props.kind === 'INVOICE';
  return (
    <>
      {props.variant !== 'invoice-pair' && (
        <UuiSelectField
          label="Loại chứng từ"
          value={props.kind}
          disabled={disabled}
          onChange={(event) => props.onKindChange(event.target.value as ExpenseEvidenceKind)}
          options={[
            { value: 'INVOICE', label: 'Hóa đơn' },
            { value: 'RECEIPT', label: 'Phiếu thu' },
          ]}
        />
      )}
      {showPair && (
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
