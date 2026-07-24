import { Spinner } from './Spinner';

export function LoadingOverlay({ message = 'Đang tải dữ liệu…' }: { message?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--fg-3)' }}>
      <Spinner size={20} />
      <span style={{ fontSize: 14 }}>{message}</span>
    </div>
  );
}
