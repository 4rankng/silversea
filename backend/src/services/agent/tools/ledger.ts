// Agent tools — Raw ledger domain.
// Low-level financial primitives the LLM composes for ad-hoc questions.
// Casbin `financial`: OFFICE_ROLES.
import { z } from 'zod';
import { LedgerService } from '../../ledger.service';
import { defineReadTool, OFFICE_ROLES } from '../tool.types';

const entityTypeSchema = z.enum(['CUSTOMER', 'VENDOR', 'DRIVER', 'FORWARDER']);

export const ledgerTools = [
  defineReadTool({
    name: 'ledger.entries',
    description:
      'Truy vấn bút toán sổ cái, có thể lọc theo loại thực thể (CUSTOMER/VENDOR/DRIVER/FORWARDER) + id. Phân trang. Dùng cho câu hỏi tài chính chuyên sâu.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entityType: entityTypeSchema.optional(),
      entityId: z.coerce.number().int().positive().optional(),
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }),
    run: (args) => LedgerService.getEntries(args),
    label: () => 'Sổ cái',
  }),

  defineReadTool({
    name: 'ledger.balance',
    description: 'Số dư hiện tại của một thực thể (CUSTOMER/VENDOR/DRIVER/FORWARDER) theo id.',
    allowedRoles: OFFICE_ROLES,
    params: z.object({
      entityType: entityTypeSchema,
      entityId: z.coerce.number().int().positive(),
    }),
    run: (args) => LedgerService.getBalance(args.entityType, args.entityId),
    label: (a) => `Số dư ${a.entityType}`,
  }),
] as const;
