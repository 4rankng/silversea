// Agent tools — Audit log domain.
// Casbin `audit_logs`: ADMIN/MANAGER/ACCOUNTANT == OFFICE_ROLES.
import { z } from 'zod';
import { queryAuditLogs } from '../../audit-query.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

export const auditTools = [
  defineReadTool({
    name: 'audit.logs',
    description:
      'Nhật ký thao tác của người dùng (ai đã làm gì, khi nào). Lọc theo danh mục + tìm kiếm, phân trang.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    run: (args, ctx) => queryAuditLogs({
      page: args.page ?? 1,
      limit: args.limit ?? 50,
      category: args.category,
      search: args.search,
      viewer: {
        userId: ctx.userId,
        role: ctx.role,
      },
    }),
    label: () => 'Nhật ký',
  }),
] as const;
