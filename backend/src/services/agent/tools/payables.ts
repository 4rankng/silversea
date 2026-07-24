// Agent tools — Suppliers & Payables domain.
// Suppliers post to the VENDOR ledger entity. Casbin `financial`.
import { z } from 'zod';
import { getBootstrapData } from '../../config.service';
import { getSupplierStatement } from '../../statement.service';
import { getPayablesSummary } from '../../aging.service';
import { LedgerService } from '../../ledger.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

export const payablesTools = [
  defineReadTool({
    name: 'suppliers.list',
    description: 'Danh sách nhà cung cấp đang hoạt động (bao gồm nhà xe, trạm xăng). Dùng để tra id theo tên.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: async () => (await getBootstrapData()).suppliers,
    label: () => 'Nhà cung cấp',
  }),

  defineReadTool({
    name: 'payables.summary',
    description:
      'Tổng hợp công nợ phải trả theo nhóm tuổi, có thể lọc theo nhóm (fuel/ancillary/commission/carrier). Dùng cho "tổng nợ phải trả".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      asOfDate: z.string().optional(),
      category: z.enum(['fuel', 'ancillary', 'commission', 'carrier']).optional(),
    }),
    run: (args) => getPayablesSummary({ asOfDate: args.asOfDate, category: args.category }),
    label: () => 'Tổng nợ phải trả',
  }),

  defineReadTool({
    name: 'supplier.statement',
    description: 'Sao kê tài khoản của một nhà cung cấp trong khoảng ngày.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      supplierId: z.coerce.number().int().positive(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
    run: (args) => getSupplierStatement(args.supplierId, args.dateFrom, args.dateTo),
    label: (a) => `Sao kê NCC #${a.supplierId}`,
  }),

  defineReadTool({
    name: 'supplier.balance',
    description: 'Số dư công nợ hiện tại của một nhà cung cấp (sổ cái VENDOR).',
    allowedRoles: OFFICE_ROLES,
    params: z.object({ supplierId: z.coerce.number().int().positive() }),
    run: (args) => LedgerService.getBalance('VENDOR', args.supplierId),
    label: (a) => `Nợ NCC #${a.supplierId}`,
  }),
] as const;
