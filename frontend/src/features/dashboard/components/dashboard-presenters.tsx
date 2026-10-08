import type { DashboardDecisionKind, DashboardDecisionSeverity } from '@tingting/shared';
import type { AssetIconName } from '../../../components/AssetIcon';
import { Money } from '../../../components/shared/Money';
import { formatNumber } from '../../../lib/format';
import type { MonthlyChange } from '../utils';

export const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
};

export const runningSum = (values: number[]): number[] => {
  let total = 0;
  return values.map((value) => (total += value));
};

export function DeltaPill({ change, favorableDirection = 'up' }: { change: MonthlyChange; favorableDirection?: 'up' | 'down' }) {
  const tone = change.direction === 'flat' ? 'flat' : change.direction === favorableDirection ? 'up' : 'down';
  const badgeClass = tone === 'up' ? 'd-badge-success' : tone === 'down' ? 'd-badge-error' : 'd-badge-ghost';
  const symbol = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '·';
  return <span className={`d-badge d-badge-soft d-badge-sm ${badgeClass} delta ${tone}`}>{symbol} {change.label.replace(/^[+-]/, '')}</span>;
}

const DECISION_ICONS: Record<DashboardDecisionKind, AssetIconName> = {
  receivables: 'receivables', dispatch: 'dispatch', renewal: 'schedule', fuel: 'fuel',
  'trip-lock': 'checklist', 'trip-data': 'document', 'profit-close': 'profit', 'all-clear': 'paid',
};

export function decisionIcon(kind: DashboardDecisionKind): AssetIconName {
  return DECISION_ICONS[kind] ?? 'alert';
}

export function severityLabel(severity: DashboardDecisionSeverity): string {
  if (severity === 'critical') return 'Gấp';
  if (severity === 'warning') return 'Cần xử lý';
  if (severity === 'success') return 'Ổn';
  return 'Theo dõi';
}

export interface CostBreakdownItem {
  name: string;
  value: number | null;
  pct: number | null;
  color: string;
}

export function CostBreakdown({ items, total, complete = true }: {
  items: CostBreakdownItem[]; total: number | null; complete?: boolean;
}) {
  const distribution = complete && total !== null && total > 0
    && items.every(item => item.value !== null && item.value >= 0 && item.pct !== null);
  const summary = items.map(item => `${item.name} ${item.pct}%`).join(', ');
  const notice = total === null ? 'Chưa có báo cáo chi phí trong kỳ.'
    : !complete ? 'Chưa đủ dữ liệu để phân loại toàn bộ chi phí.'
      : items.length === 0 ? 'Không có chi phí đã ghi nhận trong kỳ.'
        : !distribution ? 'Có điều chỉnh có dấu; các khoản được trình bày theo giá trị.' : null;

  return (
    <div className="wf-cost-breakdown">
      <div className="wf-cost-summary">
        <span className="wf-cost-summary__label">Tổng chi phí đã ghi nhận</span>
        <strong className="wf-cost-summary__value">{total === null ? '—' : <Money value={total} />}</strong>
        <span className="wf-cost-summary__meta">{items.length} nhóm chi phí{distribution ? ' · 100%' : ''}</span>
      </div>
      {notice && <p>{notice}</p>}
      {distribution && <div className="wf-cost-stack" role="img" aria-label={`Cơ cấu chi phí: ${summary}`}>
        {items.map(item => <span key={item.name} className="wf-cost-stack__segment" style={{ background: item.color, flexGrow: item.pct! }} />)}
      </div>}
      <div className="wf-cost-list" role="list">
        {items.map(item => <div key={item.name} className="wf-cost-row" role="listitem"
          aria-label={item.value === null ? `${item.name}: chưa có dữ liệu` : `${item.name}: ${formatNumber(item.value)} đồng${distribution ? `, ${item.pct}%` : ''}`}>
          <div className="wf-cost-row__heading">
            <span className="wf-cost-row__name"><span className="wf-cost-row__swatch" style={{ background: item.color }} />{item.name}</span>
            <span className="wf-cost-row__amount">{item.value === null ? '—' : <Money value={item.value} />}</span>
            <span className="wf-cost-row__pct">{distribution ? `${item.pct}%` : '—'}</span>
          </div>
          {distribution && <div className="wf-cost-row__track" aria-hidden="true">
            <span style={{ background: item.color, width: `${item.pct}%` }} />
          </div>}
        </div>)}
      </div>
    </div>
  );
}
