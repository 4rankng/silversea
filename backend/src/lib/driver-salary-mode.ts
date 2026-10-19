import type { TimesheetSalaryMode } from '@tingting/shared';

/**
 * FB-103 (ticket 171026215600) — dẫn xuất chế độ lương enum từ text tự do
 * "Hình thức lương" của bảng lương/tài xế khách hàng. Đây là bản TS của ánh
 * xạ backfill trong migration 20261017220000_driver_salary_mode: mọi writer
 * ghi salary_type (seed-prod + master-data-import) phải ghi kèm
 * salary_mode dẫn xuất cùng lúc, nếu không môi trường mới (make setup chạy
 * migrate trước seed) sẽ phân loại sai lái xe LƯƠNG CỨNG thành PER_TRIP mà
 * UI không còn hiển thị salary_type để thấy lệch.
 *
 * Chuẩn hóa NFC trước khi so — Excel/macOS có thể xuất tiếng Việt NFD.
 * Không khớp → PER_TRIP (đúng mặc định hành vi cũ, không hồi tố).
 */
export function salaryModeFromSalaryType(salaryType: string | null | undefined): TimesheetSalaryMode {
  const text = (salaryType ?? '').normalize('NFC').trim().toLowerCase();
  // "lương chuyến/chuyen" (không trốn vé) — 'chuy' khớp cả dạng có/không dấu.
  if (text.includes('chuy')) return 'PER_TRIP';
  // "lương cứng/cung/cưng" (trốn vé). Escape codepoint để tránh nhầm ứ/ử/ư
  // khi gõ trực tiếp (lỗi thật: class thiếu \u1ee9 làm sai FLAT_MONTHLY).
  if (/c[\u01b0\u1ee9\u1eefu]ng/.test(text)) return 'FLAT_MONTHLY';
  return 'PER_TRIP';
}
