// Deterministic company financial-health lane — three canonical service reads,
// zero LLM calls. Broad questions such as "tình hình tài chính thế nào, làm ăn
// được hay không" have a stable answer contract and should not pay for a full
// ReAct tool-selection loop plus strict-schema regeneration.

import type { AgentResponse, AgentWidget } from '@tingting/shared';
import { getPnlReport } from '../pnl.service.js';
import { getPayablesSummary, getReceivablesSummary, CURRENT_AGING_RANGE } from '../aging.service.js';
import { currentVnPeriod, currentVnDay } from './tools/period.js';

export interface FinancialOverviewData {
  period: { month: number; year: number };
  /**
   * Day-of-month the P&L was computed for (1-31). The current-month P&L is
   * always month-to-date, so the card annotates "(tính đến DD/MM)" to keep a
   * director from reading a partial month as a full-month result. Omitted when
   * the data source doesn't resolve a day (e.g. a test fixture) — the title
   * then falls back to the plain period.
   */
  asOfDay?: number;
  revenue: number;
  totalCosts: number;
  grossProfit: number;
  netProfit: number;
  tripCount: number;
  receivables: number;
  overdueReceivables: number;
  overdueCustomers: number;
  payables: number;
  overdueSuppliers: number;
}

export interface FinancialOverviewResult {
  response: AgentResponse;
  lookupMs: number;
  toolCallCount: number;
  toolTrace: Array<{ toolName: string; ok: true; label: string }>;
}

function roundVnd(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

/** Pure card builder kept separate so wording and financial signs are testable. */
export function buildFinancialOverviewResponse(data: FinancialOverviewData): AgentResponse {
  const netMargin = data.revenue > 0 ? (data.netProfit / data.revenue) * 100 : 0;
  const verdict = data.netProfit > 0
    ? `Công ty đang có lãi ${roundVnd(data.netProfit).toLocaleString('vi-VN')} ₫ trong tháng.`
    : data.netProfit < 0
      ? `Công ty đang lỗ ${roundVnd(Math.abs(data.netProfit)).toLocaleString('vi-VN')} ₫ trong tháng.`
      : 'Công ty đang hòa vốn trong tháng.';

  const widgets: AgentWidget[] = [
    {
      type: 'kpi_grid',
      items: [
        { label: 'Doanh thu', value: roundVnd(data.revenue), format: 'vnd', provenance: { metricId: 'period_revenue', category: 'calculated' } },
        { label: 'Tổng chi phí', value: roundVnd(data.totalCosts), format: 'vnd', provenance: { category: 'calculated' } },
        { label: 'Lợi nhuận ròng', value: roundVnd(data.netProfit), format: 'vnd', provenance: { category: 'calculated', formula: 'Lợi nhuận gộp − chi phí công ty + thu nhập khác' } },
        { label: 'Biên lợi nhuận ròng', value: Number(netMargin.toFixed(1)), format: 'percent', provenance: { category: 'calculated', formula: 'Lợi nhuận ròng / doanh thu' } },
        { label: 'Phải thu', value: roundVnd(data.receivables), format: 'vnd', provenance: { metricId: 'receivables_outstanding', category: 'calculated' } },
        { label: 'Phải trả', value: roundVnd(data.payables), format: 'vnd', provenance: { metricId: 'payables_outstanding', category: 'calculated' } },
      ],
    },
  ];

  const anomalies: Array<{ label: string; detail: string; severity: 'low' | 'med' | 'high' }> = [];
  if (data.netProfit < 0) {
    anomalies.push({ label: 'Kết quả kinh doanh âm', detail: `Lỗ ròng ${roundVnd(Math.abs(data.netProfit)).toLocaleString('vi-VN')} ₫.`, severity: 'high' });
  }
  if (data.overdueReceivables > 0) {
    anomalies.push({
      label: 'Công nợ phải thu quá hạn',
      detail: `${roundVnd(data.overdueReceivables).toLocaleString('vi-VN')} ₫ từ ${data.overdueCustomers} khách hàng cần theo dõi.`,
      severity: data.overdueReceivables > Math.max(data.revenue, 1) * 0.25 ? 'high' : 'med',
    });
  }
  if (data.overdueSuppliers > 0) {
    anomalies.push({ label: 'Công nợ phải trả quá hạn', detail: `${data.overdueSuppliers} nhà cung cấp có khoản quá hạn.`, severity: 'med' });
  }
  if (anomalies.length === 0) {
    anomalies.push({ label: 'Không có cảnh báo lớn', detail: 'Chưa ghi nhận lỗ hoặc công nợ quá hạn trong dữ liệu hiện tại.', severity: 'low' });
  }
  widgets.push({ type: 'anomaly_list', items: anomalies });

  // The P&L for the current month is month-to-date until the month closes.
  // Annotate the title so a partial month isn't mistaken for a full one.
  const periodSuffix = data.asOfDay && data.asOfDay >= 1 && data.asOfDay <= 31
    ? ` (tính đến ${data.asOfDay}/${data.period.month})`
    : '';
  return {
    type: 'insight_card',
    title: `Sức khỏe tài chính tháng ${data.period.month}/${data.period.year}${periodSuffix}`,
    summary: `${verdict} Có ${data.tripCount} chuyến được ghi nhận; cần đọc cùng tình trạng công nợ bên dưới.`,
    widgets,
    actions: [
      { label: 'Xem báo cáo lãi lỗ', directive: { kind: 'navigate', routeKey: 'finance' } },
      { label: 'Xem công nợ phải thu', directive: { kind: 'navigate', routeKey: 'debt' } },
      { label: 'Xem công nợ phải trả', directive: { kind: 'navigate', routeKey: 'payables' } },
    ],
  };
}

export async function runFinancialOverview(): Promise<FinancialOverviewResult> {
  const start = performance.now();
  const period = currentVnPeriod();
  const { day } = currentVnDay();
  const [pnl, receivables, payables] = await Promise.all([
    getPnlReport(period.month, period.year),
    getReceivablesSummary(),
    getPayablesSummary(),
  ]);

  const overdueReceivables = receivables.buckets
    .filter((bucket) => bucket.range !== CURRENT_AGING_RANGE)
    .reduce((sum, bucket) => sum + bucket.amount, 0);

  const response = buildFinancialOverviewResponse({
    period,
    asOfDay: day,
    revenue: pnl.totalRevenue,
    totalCosts: pnl.totalCosts,
    grossProfit: pnl.grossProfit,
    netProfit: pnl.netProfit,
    tripCount: pnl.tripCount,
    receivables: receivables.totalOutstanding,
    overdueReceivables,
    overdueCustomers: receivables.overdueCustomers,
    payables: payables.totalOutstanding,
    overdueSuppliers: payables.overdueSuppliers,
  });

  return {
    response,
    lookupMs: performance.now() - start,
    toolCallCount: 3,
    toolTrace: [
      { toolName: 'report.run', ok: true, label: 'Báo cáo lợi nhuận kỳ hiện tại' },
      { toolName: 'report.run', ok: true, label: 'Tổng hợp công nợ phải thu' },
      { toolName: 'report.run', ok: true, label: 'Tổng hợp công nợ phải trả' },
    ],
  };
}
