import { z } from 'zod';

/**
 * PUT /api/shipments/:id/debit-edits payload — the delta shape. Every
 * editable debit cell maps to an existing expense line: core rows carry the
 * CUS-editable thu khách (sell) and note with the Ops amount read-only;
 * "Phí khác" rows are OTHER-type lines managed as adds/removals. Strict on
 * unknown keys so no other cell can ever be written through this route.
 */
export const shipmentDebitEditPayloadSchema = z.strictObject({
  edits: z.array(z.object({
    expenseId: z.number().int(),
    buyAmount: z.number().optional(),
    sellAmount: z.number().nullable().optional(),
    note: z.string().optional(),
  })).optional(),
  addOtherFees: z.array(z.object({
    tripId: z.number().int(),
    name: z.string().min(1),
    amount: z.number(),
  })).optional(),
  removeExpenseIds: z.array(z.number().int()).optional(),
});

export type ShipmentDebitEditPayload = z.infer<typeof shipmentDebitEditPayloadSchema>;
