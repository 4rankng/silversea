// Agent tools — Customers & Receivables (debt) domain.
// Casbin `financial`: MANAGER r/w, ACCOUNTANT r/w. The aging list also has an
// inline requireRoles(ADMIN, MANAGER, ACCOUNTANT) == OFFICE_ROLES.
import { z } from 'zod';
import { getBootstrapData } from '../../config.service';
import { getStatementData } from '../../statement.service';
import {
  getReceivablesSummary,
  getTopOverdueCustomer,
  getCustomerAgingList,
} from '../../aging.service';
import { LedgerService } from '../../ledger.service';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';

export const receivablesTools = [
  defineReadTool({
    name: 'customers.list',
    description: 'Danh sách khách hàng đang hoạt động. Dùng để tra id khách theo tên.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: async () => (await getBootstrapData()).customers,
    label: () => 'Khách hàng',
  }),

  defineReadTool({
    name: 'customers.statement',
    description:
      'Sao kê tài khoản của một khách hàng (bút toán sổ cái, hóa đơn, aging) trong khoảng ngày.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      customerId: z.coerce.number().int().positive(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
    run: async (args) => {
      const data = await getStatementData(args.customerId, args.dateFrom, args.dateTo);
      if (!data) throw new ToolError('Không có dữ liệu sao kê của khách hàng đã chọn', 'not_found');
      return data;
    },
    label: () => 'Sao kê khách hàng',
  }),

  defineReadTool({
    name: 'customer.balance',
    description: 'Số dư công nợ hiện tại của một khách hàng (sổ cái).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ customerId: z.coerce.number().int().positive() }),
    run: (args) => LedgerService.getBalance('CUSTOMER', args.customerId),
    label: () => 'Công nợ khách hàng',
  }),

  defineReadTool({
    name: 'receivables.summary',
    description:
      'Tổng hợp công nợ phải thu theo nhóm tuổi nợ (0-30, 30-60, 60-90, 90+ ngày). Dùng cho "tổng nợ phải thu bao nhiêu".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ asOfDate: z.string().optional() }),
    run: (args) => getReceivablesSummary({ asOfDate: args.asOfDate }),
    label: () => 'Tổng nợ phải thu',
  }),

  defineReadTool({
    name: 'receivables.aging',
    description:
      'Danh sách công nợ phải thu theo từng khách, có thể tìm theo tên. Dùng cho "ai nợ nhiều nhất", "nợ quá hạn".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      search: z.string().optional(),
      asOfDate: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }),
    run: (args) => getCustomerAgingList(args),
    label: () => 'Công nợ theo khách',
  }),

  defineReadTool({
    name: 'receivables.top_overdue',
    description: 'Khách hàng nợ quá hạn nhiều nhất (tên, số tiền, số ngày quá hạn).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: () => getTopOverdueCustomer(),
    label: () => 'Nợ quá hạn lớn nhất',
  }),
] as const;
