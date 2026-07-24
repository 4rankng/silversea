// Agent tools — Finance / Profit & Fuel domain.
// The two flagship analyzer backings (getPnlReport, getFuelVarianceReport).
// Casbin `financial`.
import { z } from 'zod';
import { getPnlReport, getFuelVarianceReport } from '../../pnl.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';
import { resolvePeriod } from './period';

const monthSchema = z.coerce.number().int().min(1).max(12);
const yearSchema = z.coerce.number().int().min(2000);

// month/year are optional: when the LLM omits them (e.g. it only said "tháng
// này"), the tool resolves to the CURRENT Vietnam period (./period.ts) instead
// of failing or letting the model invent a wrong year. An explicit month/year
// is honored, so historical queries ("tháng 5/2025") still work.
export const financeTools = [
  defineReadTool({
    name: 'profit.report',
    description:
      'Báo cáo lãi lỗ (P&L) theo tháng: doanh thu, chi phí, biên lợi nhuận, chi phí theo nhóm. Dùng cho câu hỏi về lợi nhuận / "tháng này lãi lỗ ra sao". Bỏ qua month/year (hoặc nói "tháng này") để lấy tháng hiện tại.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ month: monthSchema.optional(), year: yearSchema.optional() }),
    run: (args) => {
      const p = resolvePeriod(args.month, args.year);
      return getPnlReport(p.month, p.year);
    },
    label: (a) => {
      const p = resolvePeriod(a.month, a.year);
      return `P&L ${p.month}/${p.year}`;
    },
  }),

  defineReadTool({
    name: 'fuel.variance',
    description:
      'Báo cáo chênh lệch dầu thực tế vs định mức theo từng chuyến trong tháng. Dùng cho "chuyến nào tốn dầu hơn định mức". Bỏ qua month/year (hoặc nói "tháng này") để lấy tháng hiện tại.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ month: monthSchema.optional(), year: yearSchema.optional() }),
    run: (args) => {
      const p = resolvePeriod(args.month, args.year);
      return getFuelVarianceReport(p.month, p.year);
    },
    label: (a) => {
      const p = resolvePeriod(a.month, a.year);
      return `Chênh lệch dầu ${p.month}/${p.year}`;
    },
  }),
] as const;
