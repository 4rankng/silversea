// Agent tools — Advances & settlements domain.
// Casbin `financial`.
import { z } from 'zod';
import {
  listAdvanceRequests,
  listAdvanceSettlements,
  getOutstandingAdvanceBalances,
} from '../../advance.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

export const advanceTools = [
  defineReadTool({
    name: 'advances.requests',
    description: 'Danh sách yêu cầu tạm ứng, có thể lọc theo người yêu cầu / trạng thái.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      requesterId: z.coerce.number().int().positive().optional(),
      status: z.string().optional(),
    }),
    run: (args) => listAdvanceRequests(args),
    label: () => 'Yêu cầu tạm ứng',
  }),

  defineReadTool({
    name: 'advances.settlements',
    description: 'Danh sách phiếu thanh toán (hoàn ứng), có thể lọc theo giao nhận / trạng thái.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      forwarderId: z.coerce.number().int().positive().optional(),
      status: z.string().optional(),
    }),
    run: (args) => listAdvanceSettlements(args),
    label: () => 'Phiếu thanh toán',
  }),

  defineReadTool({
    name: 'advances.outstanding',
    description: 'Tổng tạm ứng chưa hoàn theo từng giao nhận. Dùng cho "ai còn nợ tạm ứng".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: () => getOutstandingAdvanceBalances(),
    label: () => 'Tạm ứng chưa hoàn',
  }),
] as const;
