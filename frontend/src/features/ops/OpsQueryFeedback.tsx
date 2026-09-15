import { Loader2 } from 'lucide-react';
import { Btn } from '../../components/UI';
import './ops-query-feedback.css';

/** A query failure must not read as an empty list or a zero financial balance. */
export function OpsQueryFeedback({ loading, error, label, onRetry }: {
  loading?: boolean;
  error?: boolean;
  label: string;
  onRetry: () => unknown;
}) {
  if (!loading && !error) return null;
  return (
    <div className={`ops-query-feedback${error ? ' ops-query-feedback--error' : ''}`} role={error ? 'alert' : 'status'}>
      {error ? <>
        <span>Không tải được {label}. Vui lòng thử lại.</span>
        <Btn size="sm" onClick={() => void onRetry()}>Thử lại</Btn>
      </> : <><Loader2 size={16} className="spin" aria-hidden /><span>Đang tải {label}…</span></>}
    </div>
  );
}
