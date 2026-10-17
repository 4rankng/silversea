import type { TimesheetSalaryMode } from '@tingting/shared';

/** Tên chế độ lương đúng theo cách khách hàng gọi (card 141026230800). */
export const SALARY_MODE_LABELS: Record<TimesheetSalaryMode, string> = {
  PER_TRIP: 'Lương theo chuyến (không trốn vé)',
  FLAT_MONTHLY: 'Lương theo tháng (trốn vé)',
};

export const SALARY_MODE_OPTIONS = [
  { value: 'PER_TRIP', label: SALARY_MODE_LABELS.PER_TRIP },
  { value: 'FLAT_MONTHLY', label: SALARY_MODE_LABELS.FLAT_MONTHLY },
];

/** Nhãn hiển thị cho một giá trị chế độ lương — dữ liệu cũ/lạ hiện nguyên
 *  văn bản, rỗng hiện "—". Dùng cho cột bảng và dòng tóm tắt. */
export function salaryModeLabel(mode: string | null | undefined): string {
  if (mode === 'PER_TRIP' || mode === 'FLAT_MONTHLY') return SALARY_MODE_LABELS[mode];
  return mode?.trim() ? mode : '—';
}
