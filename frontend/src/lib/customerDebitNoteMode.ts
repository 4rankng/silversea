import type { Customer } from '@tingting/shared';

export type EditableCustomerDebitNoteMode = Extract<Customer['debitNoteMode'], 'MONTHLY' | 'WEEKLY'>;
export type CustomerDebitNoteMode = Customer['debitNoteMode'];

export interface CustomerDebitNoteModeOption {
  value: CustomerDebitNoteMode;
  label: string;
  disabled?: boolean;
}

export function buildCustomerDebitNoteModeOptions(
  currentMode?: CustomerDebitNoteMode | null,
): CustomerDebitNoteModeOption[] {
  const options: CustomerDebitNoteModeOption[] = [
    { value: 'MONTHLY', label: 'Theo tháng' },
    { value: 'WEEKLY', label: 'Theo tuần theo hợp đồng' },
  ];
  if (currentMode === 'PER_BATCH') {
    options.push({
      value: 'PER_BATCH',
      label: 'Theo lô (chế độ cũ — không tự động chuyển)',
      disabled: true,
    });
  }
  return options;
}

export function describeCustomerDebitNoteMode(mode?: CustomerDebitNoteMode | null): string | null {
  if (mode === 'WEEKLY') {
    return 'Khóa theo tuần thanh toán đã thỏa thuận trong hợp đồng khách hàng.';
  }
  if (mode === 'PER_BATCH') {
    return 'Khách hàng đang dùng chu kỳ ghi chú nợ theo lô. Chu kỳ này không tự động chuyển sang Theo tuần theo hợp đồng.';
  }
  return null;
}

