import type { AgentResponse, AgentWidget } from '@tingting/shared';
import { getPnlReport } from '../pnl.service.js';
import { getPayablesSummary, getReceivablesSummary, CURRENT_AGING_RANGE } from '../aging.service.js';
import type { SimpleReportRequest } from './intent-router.js';
import { resolvePeriod } from './tools/period.js';

export interface DeterministicReportResult {
  response: AgentResponse;
  lookupMs: number;
  toolCallCount: number;
  toolTrace: Array<{ toolName: string; ok: true; label: string }>;
}

const vnd = (value: number): number => Math.round(Number.isFinite(value) ? value : 0);

export async function runDeterministicReport(request: SimpleReportRequest): Promise<DeterministicReportResult> {
  const start = performance.now();
  let response: AgentResponse;
  let label: string;

  if (request.report === 'profit') {
    const period = resolvePeriod(request.month, request.year);
    const report = await getPnlReport(period.month, period.year);
    const margin = report.totalRevenue > 0 ? (report.netProfit / report.totalRevenue) * 100 : 0;
    const widgets: AgentWidget[] = [{
      type: 'kpi_grid',
      items: [
        { label: 'Doanh thu', value: vnd(report.totalRevenue), format: 'vnd', provenance: { metricId: 'period_revenue', category: 'calculated' } },
        { label: 'Tổng chi phí', value: vnd(report.totalCosts), format: 'vnd', provenance: { category: 'calculated' } },
        { label: 'Lợi nhuận gộp', value: vnd(report.grossProfit), format: 'vnd', provenance: { metricId: 'period_gross_profit', category: 'calculated' } },
        { label: 'Lợi nhuận ròng', value: vnd(report.netProfit), format: 'vnd', provenance: { category: 'calculated' } },
        { label: 'Biên lợi nhuận ròng', value: Number(margin.toFixed(1)), format: 'percent', provenance: { category: 'calculated' } },
        { label: 'Số chuyến', value: report.tripCount, format: 'number', provenance: { metricId: 'trip_count', category: 'observed' } },
      ],
    }];
    response = {
      type: 'insight_card',
      title: `Kết quả kinh doanh tháng ${period.month}/${period.year}`,
      summary: report.netProfit >= 0
        ? `Công ty có lãi ròng ${vnd(report.netProfit).toLocaleString('vi-VN')} ₫.`
        : `Công ty lỗ ròng ${vnd(Math.abs(report.netProfit)).toLocaleString('vi-VN')} ₫.`,
      widgets,
      actions: [{ label: 'Xem báo cáo lãi lỗ', directive: { kind: 'navigate', routeKey: 'finance' } }],
    };
    label = 'Báo cáo lợi nhuận';
  } else if (request.report === 'receivables') {
    const report = await getReceivablesSummary();
    const overdue = report.buckets.filter((bucket) => bucket.range !== CURRENT_AGING_RANGE).reduce((sum, bucket) => sum + bucket.amount, 0);
    response = {
      type: 'insight_card',
      title: 'Công nợ phải thu hiện tại',
      summary: `${report.totalCustomers} khách hàng còn công nợ; ${report.overdueCustomers} khách hàng quá hạn.`,
      widgets: [{ type: 'kpi_grid', items: [
        { label: 'Tổng phải thu', value: vnd(report.totalOutstanding), format: 'vnd', provenance: { metricId: 'receivables_outstanding', category: 'calculated' } },
        { label: 'Quá hạn trên 30 ngày', value: vnd(overdue), format: 'vnd', provenance: { category: 'calculated' } },
        { label: 'Khách còn nợ', value: report.totalCustomers, format: 'number', provenance: { category: 'observed' } },
        { label: 'Khách quá hạn', value: report.overdueCustomers, format: 'number', provenance: { category: 'calculated' } },
      ] }],
      actions: [{ label: 'Xem công nợ phải thu', directive: { kind: 'navigate', routeKey: 'debt' } }],
    };
    label = 'Tổng hợp công nợ phải thu';
  } else {
    const report = await getPayablesSummary();
    response = {
      type: 'insight_card',
      title: 'Công nợ phải trả hiện tại',
      summary: `${report.totalSuppliers} nhà cung cấp còn công nợ; ${report.overdueSuppliers} nhà cung cấp quá hạn.`,
      widgets: [{ type: 'kpi_grid', items: [
        { label: 'Tổng phải trả', value: vnd(report.totalOutstanding), format: 'vnd', provenance: { metricId: 'payables_outstanding', category: 'calculated' } },
        { label: 'Nhà cung cấp còn nợ', value: report.totalSuppliers, format: 'number', provenance: { category: 'observed' } },
        { label: 'Nhà cung cấp quá hạn', value: report.overdueSuppliers, format: 'number', provenance: { category: 'calculated' } },
      ] }],
      actions: [{ label: 'Xem công nợ phải trả', directive: { kind: 'navigate', routeKey: 'payables' } }],
    };
    label = 'Tổng hợp công nợ phải trả';
  }

  return {
    response,
    lookupMs: performance.now() - start,
    toolCallCount: 1,
    toolTrace: [{ toolName: 'report.run', ok: true, label }],
  };
}
