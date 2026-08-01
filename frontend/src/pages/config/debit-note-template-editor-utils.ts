import { defaultDebitNoteColumns, defaultPaymentStatementColumns, type DebitNoteColumnVariable, type DebitNoteTemplate, type DebitNoteTemplateColumn, type DebitNoteTemplateInput } from '@tingting/shared';
import { Building2, Columns3, FileText, PenLine } from 'lucide-react';
export const VARIABLES: Array<{ value: DebitNoteColumnVariable; label: string; sample: string }> = [
  { value: 'rowIndex', label: 'STT', sample: '1' },
  { value: 'departureDate', label: 'Ngày thực hiện', sample: '15/06/2026' },
  { value: 'truckPlate', label: 'Biển số xe', sample: '15C-180.99' },
  { value: 'actionType', label: 'Đóng / Trả', sample: 'ĐÓNG' },
  { value: 'origin', label: 'Điểm đi / về', sample: 'Cảng Nam Hải' },
  { value: 'destination', label: 'Điểm đóng / trả hàng', sample: 'KCN Quế Võ' },
  { value: 'deliveryAddress', label: 'Địa chỉ giao hàng', sample: 'Lô CN1F, CCN Quất Động' },
  { value: 'container20Count', label: "Cont 20'", sample: '1' },
  { value: 'container40Count', label: "Cont 40'", sample: '' },
  { value: 'containerCount', label: 'Số lượng cont', sample: '1' },
  { value: 'containerNumbers', label: 'Số hiệu cont', sample: 'VSGU4230188' },
  { value: 'routeName', label: 'Tên tuyến', sample: 'HP - Quế Võ' },
  { value: 'description', label: 'Diễn giải', sample: 'Cước vận chuyển' },
  { value: 'lineTypeLabel', label: 'Loại dòng', sample: 'Doanh thu' },
  { value: 'unit', label: 'Đơn vị tính', sample: 'chuyến' },
  { value: 'amount', label: 'Số tiền', sample: '4.490.000' },
  { value: 'freightAmount', label: 'Cước vận chuyển', sample: '4.490.000' },
  { value: 'serviceFeeAmount', label: 'Phí chi hộ', sample: '550.000' },
  { value: 'totalAmount', label: 'Tổng tiền dòng', sample: '5.040.000' },
  { value: 'serviceFeeDescription', label: 'Diễn giải phí chi hộ', sample: 'Nâng hạ, vệ sinh cont' },
  { value: 'note', label: 'Ghi chú', sample: '-' },
  { value: 'tripCode', label: 'Mã chuyến', sample: 'TR-2606-001' },
];

export const variableMap = new Map(VARIABLES.map(item => [item.value, item]));

export type EditorSection = 'general' | 'company' | 'columns' | 'footer';
export type SelectedTarget =
  | { type: 'general'; field?: 'name' | 'titleText' | 'orientation' | 'accentColor' }
  | { type: 'company'; field?: 'issuerName' | 'issuerTaxCode' | 'issuerAddress' | 'issuerRepresentative' | 'termsText' }
  | { type: 'column'; columnId: string }
  | { type: 'footer'; field?: 'signatureLeftLabel' | 'signatureLeftName' | 'signatureRightLabel' | 'signatureRightName' | 'termsText' };

export const EDITOR_SECTIONS: Array<{ id: EditorSection; label: string; meta: string; Icon: typeof FileText }> = [
  { id: 'general', label: 'Chung', meta: 'Tên mẫu, tiêu đề, khổ giấy', Icon: FileText },
  { id: 'company', label: 'Công ty', meta: 'Thông tin phát hành', Icon: Building2 },
  { id: 'columns', label: 'Cột Excel', meta: 'Nhãn, dữ liệu, tổng', Icon: Columns3 },
  { id: 'footer', label: 'Chữ ký', meta: 'Nhóm dòng, điều khoản', Icon: PenLine },
];

export function sectionFromTarget(target: SelectedTarget): EditorSection {
  return target.type === 'column' ? 'columns' : target.type;
}

export function variableLabel(value: DebitNoteColumnVariable) {
  return variableMap.get(value)?.label ?? value;
}

export function cloneStarterColumns(documentType: DebitNoteTemplateInput['documentType'] = 'DEBIT_NOTE'): DebitNoteTemplateColumn[] {
  const source = documentType === 'PAYMENT_STATEMENT' ? defaultPaymentStatementColumns : defaultDebitNoteColumns;
  return source.map(column => ({ ...column, headerGroup: column.headerGroup ?? null }));
}

export function normalizeTemplateColumns(columns: readonly DebitNoteTemplateColumn[]): DebitNoteTemplateInput['columns'] {
  return columns.map(column => ({ ...column, headerGroup: column.headerGroup ?? null }));
}

export const DEFAULT_ACCOUNT_NUMBER = '190466529';
export const DEFAULT_BANK_NAME = 'TMCP Á Châu PGD Thái Phiên - Hải Phòng';

export function stripTermPrefix(value: string, prefixPattern: RegExp) {
  return value.normalize('NFC').replace(prefixPattern, '').trim();
}

export function getAccountTerms(termsText?: string | null) {
  const [accountLine = '', bankLine = ''] = (termsText || '').split('\n');
  return {
    accountNumber: stripTermPrefix(accountLine, /^-\s*Số\s*TK\s*/i) || DEFAULT_ACCOUNT_NUMBER,
    bankName: stripTermPrefix(bankLine, /^-\s*Tại\s+ngân\s+hàng\s*/i) || DEFAULT_BANK_NAME,
  };
}

export function buildAccountTerms(accountNumber: string, bankName: string) {
  return `- Số TK ${accountNumber.trim()}\n- Tại ngân hàng ${bankName.trim()}`;
}

export function templateDefaultsForType(documentType: DebitNoteTemplateInput['documentType']): Pick<DebitNoteTemplateInput, 'titleText' | 'orientation' | 'termsText' | 'signatureRightLabel' | 'signatureRightName' | 'columns'> {
  if (documentType === 'PAYMENT_STATEMENT') {
    return {
      titleText: 'BẢNG KÊ CƯỚC VẬN CHUYỂN',
      orientation: 'landscape',
      termsText: buildAccountTerms(DEFAULT_ACCOUNT_NUMBER, DEFAULT_BANK_NAME),
      signatureRightLabel: 'Kế toán trưởng',
      signatureRightName: null,
      columns: normalizeTemplateColumns(cloneStarterColumns('PAYMENT_STATEMENT')),
    };
  }
  return {
    titleText: 'GIẤY BÁO NỢ',
    orientation: 'portrait',
    termsText: 'Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán',
    signatureRightLabel: 'Người lập',
    signatureRightName: 'Phan Kim Phụng',
    columns: normalizeTemplateColumns(cloneStarterColumns('DEBIT_NOTE')),
  };
}

export function blankTemplate(): DebitNoteTemplateInput {
  const defaults = templateDefaultsForType('DEBIT_NOTE');
  return {
    name: 'Mẫu giấy báo nợ mới',
    isDefault: false,
    documentType: 'DEBIT_NOTE',
    titleText: defaults.titleText,
    issuerName: null,
    issuerAddress: null,
    issuerTaxCode: null,
    issuerRepresentative: null,
    accentColor: '#1F4E79',
    showContainerColumn: true,
    showUnitColumn: true,
    groupingMode: 'ROUTE',
    columns: normalizeTemplateColumns(defaults.columns),
    amountInWords: false,
    orientation: defaults.orientation,
    termsText: defaults.termsText,
    signatureLeftLabel: 'Khách hàng',
    signatureLeftName: null,
    signatureRightLabel: defaults.signatureRightLabel,
    signatureRightName: defaults.signatureRightName,
  };
}

export function toForm(template: DebitNoteTemplate): DebitNoteTemplateInput {
  return {
    name: template.name,
    isDefault: template.isDefault,
    documentType: template.documentType,
    titleText: template.titleText,
    issuerName: template.issuerName,
    issuerAddress: template.issuerAddress,
    issuerTaxCode: template.issuerTaxCode,
    issuerRepresentative: template.issuerRepresentative ?? null,
    accentColor: template.accentColor,
    showContainerColumn: template.showContainerColumn,
    showUnitColumn: template.showUnitColumn,
    groupingMode: template.groupingMode,
    columns: template.columns?.length
      ? normalizeTemplateColumns(template.columns)
      : normalizeTemplateColumns(cloneStarterColumns()),
    amountInWords: template.amountInWords,
    orientation: template.orientation,
    termsText: template.termsText,
    signatureLeftLabel: template.signatureLeftLabel,
    signatureLeftName: template.signatureLeftName,
    signatureRightLabel: template.signatureRightLabel,
    signatureRightName: template.signatureRightName,
  };
}

export function sampleCell(column: DebitNoteTemplateColumn): string {
  return variableMap.get(column.variable)?.sample ?? '';
}

export function makeColumn(index: number): DebitNoteTemplateColumn {
  return {
    id: `cot_${Date.now()}_${index}`,
    label: 'Cột mới',
    variable: 'description',
    width: 16,
    align: 'left',
    format: 'text',
    total: false,
  };
}
