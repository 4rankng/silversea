import type { ShipmentAccountingLockSummary } from '@tingting/shared';

export function AccountingLockBanner({ lock }: { lock: ShipmentAccountingLockSummary }) {
  const documentLabel = lock.billingDocumentNumber?.trim() || `#${lock.billingDocumentId}`;
  const actor = lock.activatedByName?.trim() || 'Kế toán';
  const activatedAt = lock.activatedAt ? new Date(lock.activatedAt).toLocaleString('vi-VN') : null;

  return (
    <section
      role="status"
      aria-label="Lô hàng đã khóa kế toán"
      style={{
        margin: '12px 0 16px',
        padding: '12px 14px',
        border: '1px solid rgba(185, 28, 28, 0.3)',
        borderRadius: 10,
        background: 'rgba(185, 28, 28, 0.06)',
        color: 'var(--fg-1)',
      }}
    >
      <strong style={{ display: 'block', color: 'var(--danger)', marginBottom: 4 }}>
        Đã khóa kế toán · Debit Note {documentLabel}
      </strong>
      <span style={{ display: 'block', fontSize: 'var(--text-data-size)', lineHeight: 1.5, color: 'var(--fg-2)' }}>
        {actor}{activatedAt ? ` khóa lúc ${activatedAt}` : ''}. {lock.reason}
        {' '}Mọi thao tác sửa đổi đã được vô hiệu hóa.
      </span>
    </section>
  );
}
