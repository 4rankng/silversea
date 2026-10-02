import type { ComponentType, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

interface SettlementSourceQuery {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

export function ForwarderSettlementSection({ step, title, icon: Icon, query, children }: {
  step: number;
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  query: SettlementSourceQuery;
  children: ReactNode;
}) {
  return (
    <div className="fset-step-panel">
      <div className="fset-step-header">
        <div className="fset-step-header__left">
          <div className="fset-step-header__badge"><Icon size={14} /></div>
          <div>
            <span className="fset-step-header__step">Bước {step}</span>
            <h3 className="fset-step-header__title">{title}</h3>
          </div>
        </div>
      </div>
      <div className="fset-step-body" aria-busy={query.isFetching}>
        {(query.isPending || query.isFetching) && <p role="status"><Loader2 size={14} className="spin" /> Đang tải {title.replace(/^Chọn /, '').toLocaleLowerCase('vi')}…</p>}
        {Boolean(query.error) && (
          <div className="fset-error-banner" role="alert">
            <span>{query.error instanceof Error ? query.error.message : `Không thể tải ${title.replace(/^Chọn /, '').toLocaleLowerCase('vi')}.`}</span>
            <button type="button" className="btn btn--secondary btn--sm" disabled={query.isFetching} onClick={() => { void query.refetch().catch(() => {}); }}>Thử lại</button>
          </div>
        )}
        {query.data !== undefined && children}
      </div>
    </div>
  );
}
