// InsightCard — renders a structured agent answer (title + cause summary +
// typed widgets + action chips). Widgets are dependency-free: KPI grid reuses
// the shared money/number formatters; bar chart is CSS flex; line chart is a
// tiny inline SVG; tables/callouts/anomaly lists are plain markup. (Recharts
// is not a dependency in this repo and "Simplicity First" says keep it that
// way — these widgets cover every card the LLM emits.)
import type { ReactNode, Ref } from 'react';
import ReactMarkdown from 'react-markdown';
import { formatCurrency } from '../../lib/format';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import type {
  AgentActionChip,
  AgentDirective,
  AgentResponse,
  AgentWidget,
} from '@tingting/shared';

type TableCell = Extract<AgentWidget, { type: 'table' }>['rows'][number][number];

function formatValue(value: number, format: 'vnd' | 'percent' | 'number' | 'days'): string {
  switch (format) {
    case 'vnd':
      return formatCurrency(value);
    case 'percent':
      return `${value.toLocaleString('vi-VN')}%`;
    case 'days':
      return `${value.toLocaleString('vi-VN')} ngày`;
    case 'number':
    default:
      return value.toLocaleString('vi-VN');
  }
}

function KpiGrid({ items }: Extract<AgentWidget, { type: 'kpi_grid' }>) {
  return (
    <div className="agent-kpi-grid">
      {items.map((it, i) => (
        <div className="agent-kpi" key={i}>
          <div className="agent-kpi__label">{it.label}</div>
          <div className="agent-kpi__value">{formatValue(it.value, it.format)}</div>
          {it.delta !== undefined && (
            <div className={`agent-kpi__delta ${it.delta < 0 ? 'is-down' : 'is-up'}`}>
              {it.delta < 0 ? '▼' : '▲'} {formatValue(Math.abs(it.delta), it.format)}
            </div>
          )}
          {/* P4 — provenance chip: observed / calculated / forecast / assumption */}
          {it.provenance && (
            <span
              className={`agent-prov agent-prov--${it.provenance.category}`}
              title={it.provenance.formula || it.provenance.category}
            >
              {it.provenance.category === 'observed' ? '📏' : it.provenance.category === 'calculated' ? '🧮' : it.provenance.category === 'forecast' ? '🔮' : '💭'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BarChart({ data, format }: Extract<AgentWidget, { type: 'bar_chart' }>) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="agent-bar-list">
      {data.map((d, i) => (
        <div className="agent-bar-row" key={i}>
          <span className="agent-bar-row__name">{d.name}</span>
          <div className="agent-bar-row__track">
            <div
              className="agent-bar-row__fill"
              style={{ width: `${(Math.abs(d.value) / max) * 100}%` }}
            />
          </div>
          <span className="agent-bar-row__value">{format ? formatValue(d.value, format) : d.value.toLocaleString('vi-VN')}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ series }: Extract<AgentWidget, { type: 'line_chart' }>) {
  // Minimal inline SVG — one polyline per series, shared scale.
  const W = 320;
  const H = 120;
  const pad = 6;
  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => Number(p.x)).filter((n) => !Number.isNaN(n));
  const ys = allPoints.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - pad * 2);
  return (
    <svg className="agent-line" viewBox={`0 0 ${W} ${H}`} role="img">
      {series.map((s, i) => {
        const pts = s.points
          .map((p) => `${sx(Number(p.x))},${sy(p.y)}`)
          .join(' ');
        return <polyline key={i} points={pts} fill="none" strokeWidth={2} stroke={`var(--series-${i}, var(--accent))`} />;
      })}
    </svg>
  );
}

function displayCell(cell: TableCell | undefined): string {
  const value = cell === undefined ? '' : String(cell).trim();
  return value || '-';
}

function DataTable({ columns, rows }: Extract<AgentWidget, { type: 'table' }>) {
  if (columns.length === 2) {
    return (
      <div className="agent-field-list">
        {rows.map((row, rowIndex) => (
          <div className="agent-record-field" key={row.join('|') || rowIndex}>
            <div className="agent-record-field__label">{displayCell(row[0])}</div>
            <div className="agent-record-field__value">{displayCell(row[1])}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="agent-record-list">
      {rows.map((row, rowIndex) => (
        <div className="agent-record-card" key={row.join('|') || rowIndex}>
          {columns.map((column, columnIndex) => (
            <div className="agent-record-field" key={`${rowIndex}-${column}-${columnIndex}`}>
              <div className="agent-record-field__label">{column}</div>
              <div className="agent-record-field__value">{displayCell(row[columnIndex])}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Callout({ variant, text }: Extract<AgentWidget, { type: 'callout' }>) {
  return <div className={`agent-callout agent-callout--${variant}`}>{text}</div>;
}

function AnomalyList({ items }: Extract<AgentWidget, { type: 'anomaly_list' }>) {
  return (
    <ul className="agent-anomaly-list">
      {items.map((it, i) => (
        <li key={i} className={`agent-anomaly agent-anomaly--${it.severity}`}>
          <span className="agent-anomaly__label">{it.label}</span>
          <span className="agent-anomaly__detail">{it.detail}</span>
        </li>
      ))}
    </ul>
  );
}

type WidgetRenderer = (widget: AgentWidget) => ReactNode;

const WIDGET_RENDERERS: Record<AgentWidget['type'], WidgetRenderer> = {
  kpi_grid: (widget) => widget.type === 'kpi_grid' ? <KpiGrid {...widget} /> : null,
  bar_chart: (widget) => widget.type === 'bar_chart' ? <BarChart {...widget} /> : null,
  line_chart: (widget) => widget.type === 'line_chart' ? <LineChart {...widget} /> : null,
  table: (widget) => widget.type === 'table' ? <DataTable {...widget} /> : null,
  callout: (widget) => widget.type === 'callout' ? <Callout {...widget} /> : null,
  anomaly_list: (widget) => widget.type === 'anomaly_list' ? <AnomalyList {...widget} /> : null,
};

function WidgetFallback() {
  return (
    <div className="agent-widget-fallback" role="status">
      Không thể hiển thị phần dữ liệu này.
    </div>
  );
}

function renderWidget(w: AgentWidget): ReactNode {
  const renderer = WIDGET_RENDERERS[w.type];
  return renderer ? renderer(w) : null;
}

function widgetTitle(widget: AgentWidget): string | undefined {
  return 'title' in widget && typeof widget.title === 'string' && widget.title.trim()
    ? widget.title
    : undefined;
}

export interface InsightCardProps {
  card: Extract<AgentResponse, { type: 'insight_card' }>;
  onAction?: (d: AgentDirective) => void;
  rootRef?: Ref<HTMLDivElement>;
}

export function InsightCard({ card, onAction, rootRef }: InsightCardProps) {
  return (
    <div className="agent-card" ref={rootRef}>
      <div className="agent-card__title">{card.title}</div>
      <div className="agent-card__summary">{card.summary}</div>
      <div className="agent-card__widgets">
        {card.widgets.map((w, i) => (
          <div className="agent-card__widget" key={i}>
            {widgetTitle(w) && (
              <div className="agent-card__widget-title">{widgetTitle(w)}</div>
            )}
            <ErrorBoundary fallback={<WidgetFallback />}>
              {renderWidget(w)}
            </ErrorBoundary>
          </div>
        ))}
      </div>
      {card.details && (
        <div className="agent-card__details agent-markdown">
          <ReactMarkdown>{card.details}</ReactMarkdown>
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="agent-card__actions">
          {card.actions.map((a: AgentActionChip, i) => (
            <button
              type="button"
              className="agent-action-chip"
              key={i}
              onClick={() => onAction?.(a.directive)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
