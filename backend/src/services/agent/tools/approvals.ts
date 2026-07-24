// Agent tools — Approvals domain.
// getApprovalQueue is scoped to the calling user + role (the bot acts as them).
// Casbin `financial`: OFFICE_ROLES.
import { z } from 'zod';
import { getApprovalQueue } from '../../approval-queue.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

export const approvalTools = [
  defineReadTool({
    name: 'approvals.queue',
    description:
      'Danh sách các mục chờ bạn phê duyệt theo vai trò (chi phí, tạm ứng, thanh toán...). Dùng cho "có gì cần duyệt".',
    allowedRoles: OFFICE_ROLES,
    params: z.object({}),
    run: (_args, ctx) => getApprovalQueue(ctx.userId, ctx.role),
    label: () => 'Chờ duyệt',
  }),
] as const;
