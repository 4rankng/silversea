import { z } from 'zod';

// Chi phí - Quyết toán (Debit CUS) Lớp 2 — the ONE debit-detail contract.
// Shared by the FE template and the BE producer (card _7 contract swap):
// the template never re-declares the wire, the producer is compared for
// real via schema.parse(actual service output).
//
// Money is number|null; null = "chưa xác định" — the UI must never render
// an unknown as 0 (O2C §7). Target names are structural: no place-named
// fields exist in this contract (port names are data, not identifiers —
// the absence-pin test enforces it).

const nullableMoney = z.number().nullable();

export const debitDetailFreightRowSchema = z.object({
  containerNumber: z.string().nullable(),
  containerTypeLabel: z.string().nullable(),
  tripId: z.number().int().nullable(),
  rateKey: z.string().nullable(),
  freightCharge: nullableMoney,
  fuelSurcharge: nullableMoney,
  customsFee: nullableMoney,
  /** BE snapshot freight+surcharge total. Distinct from any FE-derived row
   *  sum — two quantities share the bare word "total", so the wire names
   *  the snapshot quantity explicitly. */
  contractFreightTotal: nullableMoney,
  psActual: nullableMoney,
  psActualNote: z.string().nullable(),
});

export const debitDetailExpenseItemSchema = z.object({
  id: z.number().int().positive(),
  expenseType: z.string(),
  feeName: z.string().nullable(),
  amount: nullableMoney,
  thuKhach: nullableMoney,
  note: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
});

export const debitDetailChiHoRowSchema = z.object({
  tripId: z.number().int().nullable(),
  containerNumber: z.string().nullable(),
  containerTypeLabel: z.string().nullable(),
  items: z.array(debitDetailExpenseItemSchema),
  otherFees: z.array(z.object({
    id: z.number().int().positive(),
    name: z.string(),
    amount: nullableMoney,
  })),
  carrierDetention: nullableMoney,
  repairAdvance: nullableMoney,
  opsDocsStatus: z.enum(['READY', 'PENDING']),
});

export const shipmentDebitDetailSchema = z.object({
  freightRows: z.array(debitDetailFreightRowSchema),
  chiHoRows: z.array(debitDetailChiHoRowSchema),
  payables: z.object({
    chiHoTotal: nullableMoney,
  }),
  thuKhachTotal: nullableMoney,
  /** Card 20260919_5 — the customs channel belongs to the LOT (declaration
   *  level): every container row renders this same value; null/absent = '—'
   *  (optional-nullable so the producer upgrade can land independently). */
  customsChannel: z.enum(['RED', 'YELLOW', 'GREEN']).nullable().optional(),
});

export type DebitDetailFreightRow = z.infer<typeof debitDetailFreightRowSchema>;
export type DebitDetailExpenseItem = z.infer<typeof debitDetailExpenseItemSchema>;
export type DebitDetailChiHoRow = z.infer<typeof debitDetailChiHoRowSchema>;
export type ShipmentDebitDetail = z.infer<typeof shipmentDebitDetailSchema>;
