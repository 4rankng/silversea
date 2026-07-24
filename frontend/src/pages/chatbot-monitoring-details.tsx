import { EmptyState } from '../components/shared';
import { SkeletonKPIs, SkeletonLine, SkeletonTable } from '../components/shared/Skeleton';
import { formatDateTimeVN } from '../lib/format';
import type { ChatbotMetricSummary, ChatbotLatencyBreakdown, ChatbotToolStat, ChatbotMetricDay, ChatbotRecentTurn } from '@tingting/shared';
import './ChatbotMonitoringPage.css';

import { errorKindLabel, fmtAvg, fmtMs, fmtNum, fmtRate, roleLabel, toolLabel } from './chatbot-monitoring-summary';

export function LatencyBreakdownBars({
  breakdown,
  loading,
}: {
  breakdown: ChatbotLatencyBreakdown | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonLine key={i} width="100%" />
        ))}
      </div>
    );
  }
  if (!breakdown) return null;

  const stages: { key: keyof ChatbotLatencyBreakdown; label: string }[] = [
    { key: 'firstTokenMs', label: 'Token đầu (TTFT)' },
    { key: 'llmMs', label: 'LLM' },
    { key: 'toolsMs', label: 'Công cụ' },
    { key: 'finalMs', label: 'Trả lời cuối' },
    { key: 'ackMs', label: 'ACK chờ' },
    { key: 'persistMs', label: 'Ghi DB' },
  ];

  const values = stages.map((s) => breakdown[s.key] ?? 0);
  const max = Math.max(...values, 1);

  return (
    <div className="cbm-bars">
      {stages.map((s) => {
        const v = breakdown[s.key];
        const ratio = v == null ? 0 : Math.max(0.02, (v / max)); // min 2% so a 0/null bar is still visible as a sliver
        const widthPct = v == null ? 0 : ratio * 100;
        return (
          <div className="cbm-bar" key={s.key}>
            <span className="cbm-bar__label">{s.label}</span>
            <svg
              className="cbm-bar__track"
              viewBox="0 0 100 14"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${s.label}: ${v == null ? 'không có dữ liệu' : `${Math.round(v)} ms`}`}
            >
              <rect x="0" y="4" width="100" height="6" rx="3" className="cbm-bar__bg" />
              <rect
                x="0"
                y="4"
                width={widthPct}
                height="6"
                rx="3"
                className={`cbm-bar__fill${v == null ? ' cbm-bar__fill--none' : ''}`}
              />
            </svg>
            <span className="cbm-bar__value">{fmtMs(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * Section 2b — Latency trend + volume (inline-SVG, hand-rolled, no Recharts)
 * ========================================================================== */

export function LatencyTrendChart({ days, loading }: { days: ChatbotMetricDay[] | undefined; loading: boolean }) {
  if (loading) {
    return <SkeletonLine width="100%" />;
  }
  const data = days ?? [];
  if (data.length === 0) return null;

  const W = 760;
  const H = 200;
  const mL = 44;
  const mR = 16;
  const mT = 12;
  const mB = 28;
  const pW = W - mL - mR;
  const pH = H - mT - mB;

  const p95Vals = data.map((d) => d.p95Ms ?? 0);
  const avgVals = data.map((d) => d.avgMs ?? 0);
  const peak = Math.max(...p95Vals, ...avgVals, 1);
  // nice round top so the gridlines are readable
  const niceSteps = [100, 250, 500, 1000, 2000, 5000, 10000, 20000, 30000];
  const yMax = niceSteps.find((s) => s >= peak) ?? Math.ceil(peak / 1000) * 1000;

  const X = (i: number) => mL + pW * (i / Math.max(1, data.length - 1));
  const Y = (v: number) => mT + pH * (1 - v / yMax);

  const linePath = (arr: number[]) =>
    arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');

  const gridVals = [0, yMax / 2, yMax];
  const maxTurns = Math.max(...data.map((d) => d.turns), 1);
  const barW = data.length > 1 ? Math.min(18, (pW / data.length) * 0.5) : 18;

  // Short day-of-month label for the x-axis
  const labelFor = (iso: string) => {
    const parts = iso.split('-');
    const day = parts[2];
    return `${day}/${parts[1]}`;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cbm-trend" role="img" aria-label="Xu hướng độ trễ và số lượt theo ngày">
      {/* gridlines + y labels */}
      {gridVals.map((v, i) => (
        <g key={i}>
          <line x1={mL} y1={Y(v)} x2={W - mR} y2={Y(v)} stroke="var(--line)" strokeWidth="1" />
          <text x={mL - 8} y={Y(v) + 3.5} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="var(--ink-3)">
            {Math.round(v)}
          </text>
        </g>
      ))}

      {/* volume bars (turns/day) on a secondary implied scale */}
      {data.map((d, i) => {
        const h = (d.turns / maxTurns) * (pH * 0.45);
        return (
          <rect
            key={`bar-${i}`}
            x={X(i) - barW / 2}
            y={mT + pH - h}
            width={barW}
            height={h}
            rx="2"
            className="cbm-trend__bar"
          />
        );
      })}

      {/* avg line */}
      <path d={linePath(avgVals)} fill="none" stroke="var(--ink-3)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* p95 line (primary) */}
      <path d={linePath(p95Vals)} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />

      {/* x labels */}
      {data.map((d, i) => (
        <text
          key={`x-${i}`}
          x={X(i)}
          y={H - 8}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="var(--ink-3)"
        >
          {labelFor(d.date)}
        </text>
      ))}
    </svg>
  );
}

/* ============================================================================
 * Section 3 — Slowest tools table
 * ========================================================================== */

export function ToolsTable({ tools, loading }: { tools: ChatbotToolStat[] | undefined; loading: boolean }) {
  if (loading) {
    return <SkeletonTable rows={4} cols={4} />;
  }
  const rows = (tools ?? []).slice().sort((a, b) => {
    // p95 desc, null p95 last (honest "—" until per-call instrumentation lands)
    if (a.p95Ms == null && b.p95Ms == null) return b.calls - a.calls;
    if (a.p95Ms == null) return 1;
    if (b.p95Ms == null) return -1;
    return b.p95Ms - a.p95Ms;
  });

  if (rows.length === 0) {
    return <EmptyState illustration="ops" title="Chưa có dữ liệu công cụ" description="Chưa có lượt gọi công cụ nào trong khoảng thời gian này." />;
  }
  const totalCalls = Math.max(1, rows.reduce((sum, t) => sum + t.calls, 0));

  return (
    <div className="cbm-table-wrap">
      <table className="cbm-table">
        <thead>
          <tr>
            <th>Tên công cụ</th>
            <th>Ý nghĩa</th>
            <th className="cbm-num">Tần suất</th>
            <th className="cbm-num">p95</th>
            <th className="cbm-num">Tỷ lệ lỗi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const share = t.calls / totalCalls;
            return (
              <tr key={t.name}>
                <td className="cbm-cell-name">
                  <strong>{toolLabel(t.name)}</strong>
                  <span>{t.name}</span>
                </td>
                <td>{toolMeaning(t.name)}</td>
                <td className="cbm-num cbm-share-cell">
                  <span>{fmtNum(t.calls)} lượt</span>
                  <span className="cbm-share-meter" aria-hidden="true"><i style={{ width: `${Math.max(5, share * 100)}%` }} /></span>
                </td>
                <td className="cbm-num">{t.p95Ms == null ? '—' : fmtMs(t.p95Ms)}</td>
                <td className="cbm-num">{fmtRate(t.errorRate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function toolMeaning(name: string): string {
  const meanings: Record<string, string> = {
    'ui.navigate': 'Đưa người dùng tới màn hình cần thao tác.',
    'ui.search_pages': 'Tìm route phù hợp khi người dùng nói bằng ngôn ngữ tự nhiên.',
    'approvals.queue': 'Đọc hàng chờ phê duyệt để trả lời câu hỏi vận hành.',
    'fleet.catalog': 'Đọc danh mục xe, rơ-moóc và tài xế.',
    'customers.list': 'Tra cứu khách hàng, công nợ hoặc hồ sơ liên quan.',
  };
  return meanings[name] ?? 'Công cụ dữ liệu nội bộ được bot gọi trong lượt trả lời.';
}

/** P0b — map a `final_*` fallback-reason bucket to a short Vietnamese label for
 *  the dashboard. Unknown prefixes render verbatim (minus the `final_` stem) so
 *  new buckets the backend emits later stay visible without a frontend change. */
export function fallbackReasonLabel(reason: string): string {
  switch (reason) {
    case 'final_timeout': return 'Hết giờ gọi model';
    case 'final_schema': return 'Sai cấu trúc JSON';
    case 'final_parse': return 'Lỗi parse JSON';
    case 'final_http': return 'Lỗi HTTP model';
    case 'final_no_key': return 'Thiếu API key';
    case 'final_prose_failed': return 'Cả 2 nhánh lỗi';
    default: return reason.replace(/^final_/, '');
  }
}

/* ============================================================================
 * Section 4 — ReAct efficiency
 * ========================================================================== */

export function ReactEfficiency({
  summary,
  loading,
}: {
  summary: ChatbotMetricSummary | undefined;
  loading: boolean;
}) {
  if (loading || !summary) {
    return <SkeletonKPIs count={4} />;
  }
  const turns = Math.max(1, summary.turns);
  const tokensPerTurn = (summary.tokensIn + summary.tokensOut) / turns;

  const cards: { label: string; value: string }[] = [
    { label: 'Số vòng TB / lượt', value: fmtAvg(summary.avgIterations) },
    { label: 'Tỷ lệ fallback', value: fmtRate(summary.fallbackRate) },
    {
      label: 'Lượt ReAct không cần định dạng lại',
      value: summary.finalAvoidanceRate === null ? '—' : fmtRate(summary.finalAvoidanceRate),
    },
    { label: 'Lượt gọi công cụ / lượt', value: fmtAvg(summary.avgToolCallsPerTurn) },
    { label: 'Token / lượt', value: fmtAvg(tokensPerTurn) },
  ];

  return (
    <>
      <div className="cbm-kpi-grid cbm-kpi-grid--tight">
        {cards.map((c) => (
          <div className="cbm-kpi cbm-kpi--flat" key={c.label}>
            <span className="cbm-kpi__label">{c.label}</span>
            <span className="cbm-kpi__value">{c.value}</span>
          </div>
        ))}
      </div>
      {/* P0b — WHY turns fall back (final_* buckets). Only renders when the bot
          has actually degraded in range; empty otherwise. Powers the 50%→<10%
          target's root-cause readout (timeout vs schema vs parse vs http). */}
      {summary.fallbackReasons.length > 0 && (
        <div className="cbm-kpi-grid cbm-kpi-grid--tight" style={{ marginTop: '0.5rem' }}>
          {summary.fallbackReasons.map((r) => (
            <div className="cbm-kpi cbm-kpi--flat" key={r.reason} title={r.reason}>
              <span className="cbm-kpi__label">{fallbackReasonLabel(r.reason)}</span>
              <span className="cbm-kpi__value">{fmtRate(r.count / turns)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ============================================================================
 * Section 5 — Recent turns table
 * ========================================================================== */

export function RecentTurnsTable({
  turns,
  loading,
  sort,
  onSortChange,
}: {
  turns: ChatbotRecentTurn[] | undefined;
  loading: boolean;
  sort: string;
  onSortChange: (s: 'recent' | 'slowest') => void;
}) {
  if (loading) {
    return <SkeletonTable rows={6} cols={6} />;
  }
  const rows = turns ?? [];

  if (rows.length === 0) {
    return <EmptyState illustration="ops" title="Chưa có lượt trò chuyện" description="Chưa ghi nhận lượt bot nào trong khoảng thời gian này." />;
  }

  return (
    <div className="cbm-table-wrap">
      <div className="cbm-table-toolbar">
        <div className="cbm-seg" role="tablist" aria-label="Sắp xếp lượt gần đây">
          <button
            type="button"
            role="tab"
            aria-selected={sort === 'recent'}
            className={`cbm-seg__btn${sort === 'recent' ? ' is-active' : ''}`}
            onClick={() => onSortChange('recent')}
          >
            Gần nhất
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sort === 'slowest'}
            className={`cbm-seg__btn${sort === 'slowest' ? ' is-active' : ''}`}
            onClick={() => onSortChange('slowest')}
          >
            Chậm nhất
          </button>
        </div>
      </div>
      <table className="cbm-table">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Người dùng</th>
            <th>Vai trò</th>
            <th className="cbm-num">Thời gian chờ</th>
            <th>Trạng thái</th>
            <th>Mô hình</th>
            <th>Trace</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const hasErr = t.errorKind != null && t.errorKind !== '';
            return (
              <tr key={t.messageId}>
                <td className="cbm-cell-time">{formatDateTimeVN(t.createdAt)}</td>
                <td className="cbm-cell-user">
                  <span className="cbm-cell-user__q" title={t.userContent}>{t.userContent || '—'}</span>
                </td>
                <td>{roleLabel(t.role)}</td>
                <td className="cbm-num">{fmtMs(t.latencyUserPerceivedMs)}</td>
                <td>
                  <span className={`cbm-pill${hasErr ? ' cbm-pill--err' : t.fallbackUsed ? ' cbm-pill--warn' : ' cbm-pill--ok'}`}>
                    {errorKindLabel(t.errorKind)}
                    {t.fallbackUsed && !hasErr ? ' · fallback' : ''}
                  </span>
                </td>
                <td className="cbm-cell-model">{t.model || '—'}</td>
                <td className="cbm-cell-trace">
                  {t.traceId ? (
                    <span className="cbm-trace" title={t.traceId}>{t.traceId}</span>
                  ) : (
                    <span className="cbm-trace cbm-trace--none" title="Không có trace backend">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
