/**
 * Shared audit log helpers — used by AuditLogPage and AuditLogWidget.
 * Single source of truth for action labels, category resolution, and relative time.
 */

// ─── Action label map ──────────────────────────────────────────────────────────

export const ACTION_LABELS: Record<string, string> = {
  // Trip lifecycle
  TRIP_CREATED: 'Tạo chuyến',
  TRIP_DISPATCHED: 'Xuất phát',
  TRIP_UPDATED_PRE_DEPARTURE: 'Cập nhật trước KH',
  TRIP_UPDATED_ACTUALS: 'Cập nhật thực tế',
  TRIP_COMPLETED: 'Hoàn thành',
  TRIP_LOCKED: 'Khóa chuyến',
  TRIP_CANCELED: 'Hủy chuyến',
  // Financial
  PAYMENT_RECEIVED: 'Thanh toán',
  ADJUSTMENT_CREATED: 'Điều chỉnh',
  PENALTY_CREATED: 'Kỷ luật',
  PENALTY_CANCELED: 'Hủy kỷ luật',
  DRIVER_SALARY_RECORDED: 'Ghi lương',
  PROFIT_DISTRIBUTED: 'Chia lợi nhuận',
  // Generic CRUD
  ENTITY_CREATED: 'Tạo mới',
  ENTITY_UPDATED: 'Cập nhật',
  ENTITY_DELETED: 'Xóa',
  // Auth
  USER_LOGIN: 'Đăng nhập',
  USER_LOGOUT: 'Đăng xuất',
  LOGIN_FAILED: 'Đăng nhập thất bại',
  ACCESS_DENIED: 'Bị từ chối quyền',
};

// ─── Category resolution ───────────────────────────────────────────────────────

export type AuditCategory = 'trip' | 'config' | 'finance' | 'auth' | 'penalty';

export function resolveCategory(action: string): AuditCategory {
  if (action.startsWith('TRIP_')) return 'trip';
  if (['PAYMENT_RECEIVED', 'ADJUSTMENT_CREATED', 'PROFIT_DISTRIBUTED'].includes(action)) return 'finance';
  if (action === 'PENALTY_CREATED' || action === 'PENALTY_CANCELED') return 'penalty';
  if (['USER_LOGIN', 'USER_LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED'].includes(action)) return 'auth';
  return 'config';
}

// ─── Relative time formatting ──────────────────────────────────────────────────

/** "Vừa xong", "12 phút trước", "3 giờ trước", "02/06 14:32" */
export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - d.getTime());
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} giờ trước`;
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
