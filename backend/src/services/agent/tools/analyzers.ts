// Agent tools — Analyzers (insight-card generators).
// Unlike the raw report tools (profit.report, fuel.variance, expenses.list),
// analyzers COMPOSE multiple sources and return data pre-shaped for an
// insight_card: a cause/explanation the LLM wraps. The LLM still writes the
// card text and picks widgets — we never hand it a pre-formatted string.
import { z } from 'zod';
import { getPnlReport, getFuelVarianceReport } from '../../pnl.service';
import { getReceivablesSummary, getCustomerAgingList } from '../../aging.service';
import { db } from '../../../db';
import { listExpenses } from '../../expense.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';
import { resolvePeriod, todayIsoVn } from './period';

const monthSchema = z.coerce.number().int().min(1).max(12);
const yearSchema = z.coerce.number().int().min(2000);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export const analyzerTools = [
  defineReadTool({
    name: 'profit.breakdown',
    description:
      'Phân tích lợi nhuận theo tháng kèm so sánh với tháng trước (doanh thu/chi phí/lợi nhuận/biên + chênh lệch). Dùng cho "tháng này vì sao lợi nhuận thấp/thay đổi thế nào". Bỏ qua month/year để lấy tháng hiện tại. Trả về { current, prior } — hãy rút nguyên nhân chính (nhóm chi phí tăng/giảm) và trình bày dạng insight_card với kpi_grid + bar_chart theo nhóm chi phí.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ month: monthSchema.optional(), year: yearSchema.optional() }),
    run: async (args) => {
      const p = resolvePeriod(args.month, args.year);
      const prev = p.month === 1
        ? { month: 12, year: p.year - 1 }
        : { month: p.month - 1, year: p.year };
      const [current, prior] = await Promise.all([
        getPnlReport(p.month, p.year),
        getPnlReport(prev.month, prev.year),
      ]);
      return { current, prior };
    },
    label: (a) => {
      const p = resolvePeriod(a.month, a.year);
      return `Phân tích LN ${p.month}/${p.year}`;
    },
  }),

  defineReadTool({
    name: 'receivables.debt_insight',
    description:
      'Phân tích công nợ phải thu: tổng nợ theo nhóm tuổi + các khách nợ nhiều nhất. Dùng cho "tình hình công nợ / ai nợ nhiều". Bỏ qua asOfDate để lấy số dư tới hiện tại. Trình bày dạng insight_card với kpi_grid (tổng nợ, quá hạn, nhóm 90+) + table các khách nợ đứng đầu.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ asOfDate: z.string().optional() }),
    run: async (args) => {
      // Default to today (Vietnam) so the model can't cap the ledger window
      // with a bogus past date and report zero debt.
      const asOfDate = args.asOfDate ?? todayIsoVn();
      const [summary, topDebtors] = await Promise.all([
        getReceivablesSummary({ asOfDate }),
        getCustomerAgingList({ asOfDate, page: 1, limit: 10 }),
      ]);
      return { summary, topDebtors };
    },
    label: () => 'Phân tích công nợ',
  }),

  defineReadTool({
    name: 'fuel.anomalies',
    description:
      'Tìm các chuyến tiêu hao dầu VƯỢT định mức trong tháng (thực tế > lý thuyết). Dùng cho "chuyến nào tốn dầu bất thường". Bỏ qua month/year để lấy tháng hiện tại. Trình bày dạng insight_card với anomaly_list + table các chuyến vượt mức (kèm chênh lệch).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ month: monthSchema.optional(), year: yearSchema.optional() }),
    run: (args) => {
      const p = resolvePeriod(args.month, args.year);
      return getFuelVarianceReport(p.month, p.year);
    },
    label: (a) => {
      const p = resolvePeriod(a.month, a.year);
      return `Bất thường dầu ${p.month}/${p.year}`;
    },
  }),

  defineReadTool({
    name: 'expense.anomalies',
    description:
      'Tìm chi phí phát sinh BẤT THƯỜNG trong tháng (cao đột biến so với cùng danh mục). Dùng cho "chi phí nào bất thường". Bỏ qua month/year để lấy tháng hiện tại. Trình bày dạng insight_card với anomaly_list các khoản nổi bật.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      month: monthSchema.optional(),
      year: yearSchema.optional(),
    }),
    run: async (args) => {
      // Default to the current Vietnam period when none given (./period.ts,
      // TZ-safe). The LLM flags outliers by comparing amounts within a category
      // (server-side statistical detection is Phase 2).
      const { month, year } = resolvePeriod(args.month, args.year);
      const fromDate = `${year}-${pad(month)}-01`;
      const toDate = month === 12
        ? `${year + 1}-01-01`
        : `${year}-${pad(month + 1)}-01`;
      return listExpenses(db, { fromDate, toDate, page: 1, pageSize: 100 });
    },
    label: () => 'Bất thường chi phí',
  }),
] as const;
