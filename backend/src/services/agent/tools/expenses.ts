// Agent tools — Company expenses domain.
// These take dbOrTx as the first arg (the service is shared with transactional
// write paths). Casbin `financial`.
import { z } from 'zod';
import { db } from '../../../db';
import { listExpenses, getExpense, getRenewalReminders } from '../../expense.service';
import { defineReadTool, OFFICE_ROLES, ToolError } from '../tool.types';

export const expenseTools = [
  defineReadTool({
    name: 'expenses.list',
    description:
      'Danh sách chi phí phát sinh của công ty, lọc theo xe/nhà cung cấp/danh mục/ngày. Dùng cho "chi phí tháng này", "chi phí xe X".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      truckId: z.coerce.number().int().positive().optional(),
      supplierId: z.coerce.number().int().positive().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      fromDate: z.string().optional(),
      toDate: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    }),
    run: (args) => listExpenses(db, args),
    label: () => 'Chi phí',
  }),

  defineReadTool({
    name: 'expenses.detail',
    description: 'Chi tiết một khoản chi phí theo id.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ id: z.coerce.number().int().positive() }),
    run: async (args) => {
      const expense = await getExpense(db, args.id);
      if (!expense) throw new ToolError('Không tìm thấy chi phí đã chọn', 'not_found');
      return expense;
    },
    label: () => 'Chi tiết chi phí',
  }),

  defineReadTool({
    name: 'expenses.renewals',
    description: 'Các chi phí sắp đến hạn gia hạn / hết hạn (bảo hiểm, đăng kiểm...).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: () => getRenewalReminders(db),
    label: () => 'Chi phí sắp hết hạn',
  }),
] as const;
