import { Spinner } from './Spinner';

export function LoadingOverlay({ message = 'Đang tải dữ liệu…' }: { message?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', padding: '24px 12px', gap: 10, color: 'var(--fg-3)' }}>
      <Spinner size={20} />
      <span style={{ fontSize: 'var(--text-body-size)' }}>{message}</span>
    </div>
  );
}
