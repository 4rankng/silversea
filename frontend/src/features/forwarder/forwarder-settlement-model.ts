import type { AdvanceRequestWithRefs } from '@tingting/shared';

/** Vietnamese fallback labels for expense type codes */
const EXPENSE_TYPE_VI: Record<string, string> = {
  LIFTING: 'Nâng container',
  LOWERING: 'Hạ container',
  CUSTOMS: 'Hải quan',
  WEIGHING: 'Cân hàng',
  INFRASTRUCTURE: 'Hạ tầng',
  INSPECTION: 'Kiểm tra',
  INSPECTION_SVC: 'Dịch vụ kiểm tra',
  PORT_STORAGE: 'Lưu bãi',
  CLEANING: 'Vệ sinh container',
  OTHER: 'Khác',
};

export function expenseLabel(code: string, options: Array<{ code: string; name: string }>): string {
  return options.find(t => t.code === code)?.name || EXPENSE_TYPE_VI[code] || code;
}

/** A recorded request alone is not cash received by OPS. */
export function isFullyFundedAdvance(request: AdvanceRequestWithRefs): boolean {
  const amount = Number(request.amount);
  return request.status === 'RECORDED'
    && Number.isFinite(amount) && amount > 0
    && request.fundedAmount != null && Number.isFinite(request.fundedAmount)
    && request.fundedAmount >= amount;
}
