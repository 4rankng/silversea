// Agent tools — deterministic business reports.
// Use these for money/business totals where naive SUMs can violate domain
// rules (VAT, service-fee, ledger running balances, salary deductions).
import { z } from 'zod';
import { getPnlReport, getFuelVarianceReport } from '../../pnl.service';
import { getReceivablesSummary, getCustomerAgingList, getPayablesSummary } from '../../aging.service';
import { getStatementData } from '../../statement.service';
import { computeAllDriverSalaries, computeAttendanceSummary, computeSalary } from '../../attendance.service';
import { listExpenses } from '../../expense.service';
import { db } from '../../../db';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';
import { resolvePeriod } from './period';
import { getMetric } from '../../metrics/metric-registry';
import { toProvenance } from '../../metrics/metric-types';

// P4 — report-key → metric-registry-id mapping. Each report key resolves to
// the metric(s) it computes, so the orchestrator can attach provenance to the
// final answer's widget values.
const REPORT_METRIC_MAP: Partial<Record<string, string>> = {
  profit_report: 'period_gross_profit',
  receivables_summary: 'receivables_outstanding',
  payables_summary: 'payables_outstanding',
  salary_driver: 'driver_net_salary_monthly',
  salary_all_drivers: 'driver_net_salary_monthly',
};

/** Attach provenance metadata to a report result object. */
function attachProvenance(reportKey: string, result: unknown): unknown {
  const metricId = REPORT_METRIC_MAP[reportKey];
  if (!metricId) return result;
  const metricDef = getMetric(metricId);
  if (!metricDef) return result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    (result as Record<string, unknown>)._provenance = toProvenance(metricDef);
  }
  return result;
}

const reportKeySchema = z.enum([
  'profit_report',
  'fuel_variance',
  'receivables_summary',
  'receivables_aging',
  'payables_summary',
  'customer_statement',
  'salary_driver',
  'salary_all_drivers',
  'salary_attendance',
  'expenses_list',
]);
const reportKeyInputSchema = z.preprocess(normalizeReportKeyInput, reportKeySchema);

const monthSchema = z.coerce.number().int().min(1).max(12).optional();
const yearSchema = z.coerce.number().int().min(2000).optional();

const REPORT_KEY_ALIASES: Record<string, z.infer<typeof reportKeySchema>> = {
  profit: 'profit_report',
  pnl: 'profit_report',
  profitreport: 'profit_report',
  profit_report: 'profit_report',
  'profit.report': 'profit_report',
  fuelvariance: 'fuel_variance',
  fuel_variance: 'fuel_variance',
  'fuel.variance': 'fuel_variance',
  receivablessummary: 'receivables_summary',
  receivables_summary: 'receivables_summary',
  'receivables.summary': 'receivables_summary',
  receivablesaging: 'receivables_aging',
  receivables_aging: 'receivables_aging',
  'receivables.aging': 'receivables_aging',
  payablessummary: 'payables_summary',
  payables_summary: 'payables_summary',
  'payables.summary': 'payables_summary',
  customerstatement: 'customer_statement',
  customer_statement: 'customer_statement',
  'customers.statement': 'customer_statement',
  'customer.statement': 'customer_statement',
  salarydriver: 'salary_driver',
  salary_driver: 'salary_driver',
  'salary.compute': 'salary_driver',
  salaryalldrivers: 'salary_all_drivers',
  salary_all_drivers: 'salary_all_drivers',
  'salary.all_drivers': 'salary_all_drivers',
  salaryattendance: 'salary_attendance',
  salary_attendance: 'salary_attendance',
  'salary.attendance': 'salary_attendance',
  expenseslist: 'expenses_list',
  expenses_list: 'expenses_list',
  'expenses.list': 'expenses_list',
};

function normalizeReportKeyInput(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const exact = raw as z.infer<typeof reportKeySchema>;
  if (reportKeySchema.safeParse(exact).success) return exact;
  const key = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, '')
    .toLowerCase();
  return REPORT_KEY_ALIASES[key] ?? raw;
}

export const reportTools = [
  defineReadTool({
    name: 'report.run',
    description:
      'Chạy báo cáo nghiệp vụ chuẩn bằng service hiện có. Dùng cho tổng tiền/doanh thu/lợi nhuận/công nợ/lương/dầu; KHÔNG tự cộng tiền bằng data.aggregate cho các câu hỏi tài chính.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      reportKey: reportKeyInputSchema,
      month: monthSchema,
      year: yearSchema,
      asOfDate: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      customerId: z.coerce.number().int().positive().optional(),
      driverId: z.coerce.number().int().positive().optional(),
      search: z.string().optional(),
      // `category` is the payables enum (maps to ledger TxnTypes in
      // getPayablesSummary). Expenses use a separate expense_categories table,
      // so expenses_list takes the numeric `expenseCategoryId` instead — the
      // enum does not apply there.
      category: z.enum(['fuel', 'ancillary', 'commission', 'carrier']).optional(),
      expenseCategoryId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    run: async (args) => {
      let result: unknown;
      switch (args.reportKey) {
        case 'profit_report': {
          const p = resolvePeriod(args.month, args.year);
          result = await getPnlReport(p.month, p.year);
          break;
        }
        case 'fuel_variance': {
          const p = resolvePeriod(args.month, args.year);
          result = await getFuelVarianceReport(p.month, p.year);
          break;
        }
        case 'receivables_summary':
          result = await getReceivablesSummary({ asOfDate: args.asOfDate });
          break;
        case 'receivables_aging':
          result = await getCustomerAgingList({
            search: args.search,
            asOfDate: args.asOfDate,
            page: args.page,
            limit: args.limit,
          });
          break;
        case 'payables_summary':
          result = await getPayablesSummary({ asOfDate: args.asOfDate, category: args.category });
          break;
        case 'customer_statement':
          if (!args.customerId) throw new ToolError('customerId là bắt buộc cho customer_statement', 'invalid_args');
          result = await getStatementData(args.customerId, args.dateFrom, args.dateTo);
          break;
        case 'salary_driver': {
          if (!args.driverId) throw new ToolError('driverId là bắt buộc cho salary_driver', 'invalid_args');
          const p = resolvePeriod(args.month, args.year);
          result = await computeSalary(args.driverId, p.year, p.month);
          break;
        }
        case 'salary_all_drivers': {
          const p = resolvePeriod(args.month, args.year);
          result = await computeAllDriverSalaries(p.year, p.month);
          break;
        }
        case 'salary_attendance': {
          if (!args.driverId) throw new ToolError('driverId là bắt buộc cho salary_attendance', 'invalid_args');
          const p = resolvePeriod(args.month, args.year);
          result = await computeAttendanceSummary(args.driverId, p.year, p.month);
          break;
        }
        case 'expenses_list':
          result = await listExpenses(db, {
            fromDate: args.dateFrom,
            toDate: args.dateTo,
            categoryId: args.expenseCategoryId,
            page: args.page,
            pageSize: args.limit,
          });
          break;
      }
      // P4 — attach provenance from the metric registry.
      return attachProvenance(args.reportKey, result);
    },
    label: (a) => `Báo cáo ${a.reportKey}`,
  }),
] as const;
