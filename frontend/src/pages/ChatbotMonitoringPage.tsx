/**
 * ADMIN-only chatbot performance dashboard ("Giám sát Chatbot").
 *
 * Five sections, all fed by the @tingting/shared chatbot-metrics API (read in
 * via useChatbotMetrics.ts hooks — see those for the 60s staleTime rationale):
 *   1. Health summary — p50 / p95 / p99, error/fallback/abort rates, turns/day
 *   2. Latency breakdown — inline-SVG bars per pipeline stage (LLM/tools/final/ack/persist)
 *   3. Slowest tools — table (calls / p95 / error rate)
 *   4. ReAct efficiency — avg iterations, fallback rate, tool calls/turn, tokens/turn
 *   5. Recent turns — table with role + errorKind mapped to Vietnamese, traceId link
 *
 * SLA bands (green/amber/red) are read from the API's `summary.sla` object —
 * never hardcoded here (the thresholds live in backend config).
 *
 * ADMIN has full access to raw turns by design; non-ADMIN roles never reach
 * this page (the `strictAdminOnly` guard in App.tsx redirects them).
 */
import { useState } from 'react';
import { Panel } from '../components/UI';
import { EmptyState } from '../components/shared';
import { useAuth } from '../hooks/useAuth';
import { useChatbotMetricsSummary, useChatbotLatencyBreakdown, useChatbotTools, useChatbotTimeseries, useChatbotRecent } from '../hooks/useChatbotMetrics';
import { BOT_OPS_ILLUSTRATION, BotHealthHero, IntentDistribution, OperationalInsights, roleLabel, SummaryKpis } from './chatbot-monitoring-summary';
import { LatencyBreakdownBars, LatencyTrendChart, ReactEfficiency, RecentTurnsTable, ToolsTable } from './chatbot-monitoring-details';
import './ChatbotMonitoringPage.css';

export default function ChatbotMonitoringPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<string>('7d');
  const [recentSort, setRecentSort] = useState<'recent' | 'slowest'>('recent');

  // ADMIN sees everything by design — the guard already enforced this. The
  // hooks each take `range` so the whole dashboard refetches together.
  const summaryQ = useChatbotMetricsSummary(range);
  const latencyQ = useChatbotLatencyBreakdown(range);
  const toolsQ = useChatbotTools(range);
  const timeseriesQ = useChatbotTimeseries(range);
  const recentQ = useChatbotRecent({ range, sort: recentSort, limit: 20 });

  const turns = summaryQ.data?.turns ?? 0;
  const isWholeEmpty = !summaryQ.isLoading && turns === 0;
  const rangeDays = range === '30d' ? 30 : 7;

  return (
    <div className="cbm-page">
      <BotHealthHero
        summary={summaryQ.data}
        breakdown={latencyQ.data}
        range={range}
        rangeDays={rangeDays}
        loading={summaryQ.isLoading}
        onRangeChange={setRange}
      />

      {isWholeEmpty ? (
        <div className="cbm-empty-card">
          <img src={BOT_OPS_ILLUSTRATION} alt="" />
          <EmptyState
            illustration="ops"
            title="Chưa có dữ liệu bot"
            description="Trong khoảng thời gian này chưa có lượt trò chuyện nào được ghi nhận."
          />
        </div>
      ) : (
        <>
          <OperationalInsights summary={summaryQ.data} breakdown={latencyQ.data} tools={toolsQ.data} />

          {/* Section 0 — Intent distribution (P0 route-before-reasoning) */}
          <section className="cbm-section">
            <Panel className="cbm-panel" title="Phân bổ theo lane thực thi" subtitle="Bao nhiêu lượt được xử lý bằng lane nhanh (FAQ/điều hướng/tra cứu) vs. lane phân tích tốn kém. Mục tiêu: đẩy volume ra khỏi 'Phân tích (ReAct)'.">
              <IntentDistribution
                buckets={summaryQ.data?.intentBuckets}
                totalTurns={turns}
                loading={summaryQ.isLoading}
              />
            </Panel>
          </section>

          {/* Section 1 — Health summary */}
          <section className="cbm-section">
            <SummaryKpis summary={summaryQ.data} rangeDays={rangeDays} loading={summaryQ.isLoading} />
          </section>

          {/* Section 2 — Latency breakdown + trend */}
          <section className="cbm-section cbm-grid-2">
            <Panel className="cbm-panel cbm-panel--latency" title="Độ trễ nằm ở đâu?" subtitle="Phân rã trung bình mỗi lượt: model, tool, trả lời cuối, ACK và ghi DB.">
              <LatencyBreakdownBars breakdown={latencyQ.data} loading={latencyQ.isLoading} />
            </Panel>
            <Panel className="cbm-panel cbm-panel--trend" title="Nhịp vận hành theo ngày" subtitle="Số lượt, trung bình và p95 để nhìn spike theo thời gian.">
              <div className="cbm-trend-wrap">
                <LatencyTrendChart days={timeseriesQ.data} loading={timeseriesQ.isLoading} />
                <div className="cbm-legend">
                  <span className="cbm-legend__item"><i className="cbm-legend__sw cbm-legend__sw--bar" /> Số lượt</span>
                  <span className="cbm-legend__item"><i className="cbm-legend__sw cbm-legend__sw--avg" /> Trung bình</span>
                  <span className="cbm-legend__item"><i className="cbm-legend__sw cbm-legend__sw--p95" /> p95</span>
                </div>
              </div>
            </Panel>
          </section>

          {/* Section 3 — Slowest tools */}
          <section className="cbm-section">
            <Panel className="cbm-panel" title="Bản đồ công cụ bot đang dùng" subtitle="Tần suất gọi và ý nghĩa vận hành của từng tool. p95 sẽ hiện khi có đo thời gian từng lượt gọi.">
              <ToolsTable tools={toolsQ.data} loading={toolsQ.isLoading} />
            </Panel>
          </section>

          {/* Section 4 — ReAct efficiency */}
          <section className="cbm-section">
            <Panel className="cbm-panel" title="Hiệu quả suy luận" subtitle="Bot mất bao nhiêu vòng, gọi bao nhiêu tool, và tiêu tốn bao nhiêu token cho một lượt.">
              <ReactEfficiency summary={summaryQ.data} loading={summaryQ.isLoading} />
            </Panel>
          </section>

          {/* Section 5 — Recent turns */}
          <section className="cbm-section">
            <Panel
              className="cbm-panel"
              title="Lượt gần đây"
              subtitle={`20 lượt mới nhất · vai trò: ${roleLabel(user?.role ?? 'ADMIN')} (toàn quyền xem)`}
            >
              <RecentTurnsTable
                turns={recentQ.data}
                loading={recentQ.isLoading}
                sort={recentSort}
                onSortChange={setRecentSort}
              />
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}
