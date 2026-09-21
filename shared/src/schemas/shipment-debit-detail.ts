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
  /** Card _62 — Bảng 2.3 per-container payables: Cước trả = the container's
   *  trip carrier cost (trip_carrier_info.external_freight_cost), Phí Phát
   *  sinh = the container's PHAT_SINH-categorized ops rows. Optional-nullable
   *  per the file convention so producer/template upgrades land
   *  independently; null = chưa xác định, never 0. */
  payableFreight: nullableMoney.optional(),
  phatSinhFee: nullableMoney.optional(),
  /** Card 20260919_35 — labels frozen at lock time, resolved from the
   *  snapshot; null = unlocked lot or old lock (render falls back live). */
  liftSiteLabel: z.string().nullable().optional(),
  dropSiteLabel: z.string().nullable().optional(),
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
    /** Card _2 (2b) — the SELL side of 'Phí khác', split from amount (the
     *  buy/chi hộ side) so thu-vs-trả reconciles per component. null =
     *  chưa nhập → '—', never a silent 0. */
    thuKhach: nullableMoney.optional(),
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
    /** Card _19 snapshot composition (Bảng 2.3) — key names exactly as the
     *  BE producer emits them. Optional-nullable so the template can render
     *  before the producer upgrade lands; null = chưa xác định, never 0. */
    externalFreightCost: nullableMoney.optional(),
    hqgsFee: nullableMoney.optional(),
    phatSinhFee: nullableMoney.optional(),
    /** Card _62 — container-NULL ops rows (phí chung lô) bucketed like the
     *  container rows, so the sheet conserves: Σ rows + common = lot total.
     *  Null = no chung-lô rows exist. */
    hqgsCommonFee: nullableMoney.optional(),
    phatSinhCommonFee: nullableMoney.optional(),
    unclassifiedFee: nullableMoney.optional(),
    opsExpenseTotal: nullableMoney.optional(),
    payableTotal: nullableMoney.optional(),
  }),
  thuKhachTotal: nullableMoney,
  /** Card 20260919_5 — the customs channel belongs to the LOT (declaration
   *  level): every container row renders this same value; null/absent = '—'
   *  (optional-nullable so the producer upgrade can land independently). */
  customsChannel: z.enum(['RED', 'YELLOW', 'GREEN']).nullable().optional(),
  /** Card 20260919_39 — lot-level business display keys (Số Bill / Số
   *  Booking / số tờ khai). Internal ids and id-derived codes (SHP-/GBN-)
   *  are banned from display text; null/absent = '—', never an invented
   *  identifier. */
  bookingRef: z.string().nullable().optional(),
  billNumber: z.string().nullable().optional(),
  declarationNumber: z.string().nullable().optional(),
  /** Card _2 — the zone-surcharge column of Bảng 2.3: one lot-level number
   *  from a single source ladder (dispatcher override > driver incidental
   *  actuals > port config when configured), with the display label FROM
   *  CONFIG (place names are data, never identifiers). null = chưa xác
   *  định — the column renders '—', never a fabricated 0. source says
   *  which rung fired so QA can audit the number's provenance. */
  zoneSurcharge: z.object({
    label: z.string(),
    amount: nullableMoney,
    source: z.enum(['OVERRIDE', 'INCIDENTAL', 'CONFIG']),
  }).nullable().optional(),
});

export type DebitDetailFreightRow = z.infer<typeof debitDetailFreightRowSchema>;
export type DebitDetailExpenseItem = z.infer<typeof debitDetailExpenseItemSchema>;
export type DebitDetailChiHoRow = z.infer<typeof debitDetailChiHoRowSchema>;
export type ShipmentDebitDetail = z.infer<typeof shipmentDebitDetailSchema>;
