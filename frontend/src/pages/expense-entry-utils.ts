export type FormState = {
  expenseDate: string;
  supplierId: number | '';
  categoryId: number | '';
  truckId: number | '';
  vehicleComponent: 'TRUCK' | 'TRAILER';
  amount: string;
  paymentStatus: 'PAID' | 'UNPAID';
  validFrom: string;
  validTo: string;
  receiptId: string;
  note: string;
};

export const initialForm: FormState = {
  expenseDate: new Date().toISOString().slice(0, 10),
  supplierId: '',
  categoryId: '',
  truckId: '',
  vehicleComponent: 'TRUCK' as const,
  amount: '',
  paymentStatus: 'UNPAID',
  validFrom: '',
  validTo: '',
  receiptId: '',
  note: '',
};

export { EXPENSE_PHOTO_MAX_BYTES, convertHeicToJpeg } from '../features/expenses/expense-photo-utils';

export function expenseSubmissionMessage(
  isEdit: boolean,
  response: Record<string, unknown>,
): string {
  if (!isEdit) {
    return 'Đã ghi nhận chi phí và công nợ nhà cung cấp.';
  }
  const deltaSnapshot = response.deltaSnapshot as Record<string, unknown> | undefined;
  if (
    response.actionKind === 'COMPANY_EXPENSE'
    && deltaSnapshot?.applicationMode === 'FINALIZED_REPLACEMENT'
  ) {
    return 'Đã lưu bản điều chỉnh chi phí. Phiếu gốc và lịch sử thanh toán được giữ nguyên.';
  }
  return response.actionKind === 'COMPANY_EXPENSE'
    ? 'Đã cập nhật chi phí và công nợ liên quan.'
    : 'Đã cập nhật thông tin không ảnh hưởng công nợ.';
}
