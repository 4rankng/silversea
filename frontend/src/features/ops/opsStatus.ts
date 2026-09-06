/**
 * Shipment status presentation for the Ops portal. Plain colored text — no
 * badge chrome (standing UI rule).
 */
export const OPS_SHIPMENT_STATUS: Record<string, { label: string; color: string }> = {
  NEW: { label: 'Mới', color: 'var(--info, #2563eb)' },
  PENDING_DATE: { label: 'Chờ ngày giao', color: 'var(--fg-3, #6b7280)' },
  READY_FOR_DISPATCH: { label: 'Sẵn sàng phát lệnh', color: 'var(--info, #2563eb)' },
  DISPATCHED: { label: 'Đã phát lệnh', color: 'var(--warn, #d97706)' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'var(--accent, #7c3aed)' },
  COMPLETED: { label: 'Hoàn thành', color: 'var(--ok, #16a34a)' },
  CANCELED: { label: 'Đã hủy', color: 'var(--err, #dc2626)' },
};

export function shipmentStatusText(status: string | null): { label: string; color: string } {
  if (!status) return { label: '—', color: 'inherit' };
  return OPS_SHIPMENT_STATUS[status] ?? { label: status, color: 'inherit' };
}

export function localDateInputValue(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatVnd(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toLocaleString('vi-VN');
}
