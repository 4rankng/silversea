import { z } from 'zod';

// ─── Quotation (Mẫu báo giá 1) — card 20260922_66 ──────────────────────────
// Quotation = a live-view FRAME over the running pricing parameters
// (operator ruling 2026-09-22 Q1): it never copies prices, norms, or fuel
// terms; it stores only what the parameter tables do not already hold —
// template identity, effective date, and the per-cell Hệ số. Per-trip money
// is frozen in freight_rate_snapshots at Ngày vận chuyển, so an independent
// quotation snapshot record would be a second source of truth.

/** Weight-band container classes (card _58 catalog: 20.0t = HEAVY). */
export const QUOTATION_CONTAINER_CLASS_CODES = ['CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY'] as const;

export function isQuotationContainerClass(code: string): boolean {
  return code === 'CONT20' || code === 'CONT40' || (QUOTATION_CONTAINER_CLASS_CODES as readonly string[]).includes(code);
}

/** Base (norm-carrying) class of a container split: 'CONT20.HEAVY' → 'CONT20'. */
const QUOTATION_BASE_OF: Record<string, string> = {
  'CONT20.LIGHT': 'CONT20',
  'CONT20.HEAVY': 'CONT20',
  'CONT40.LIGHT': 'CONT40',
  'CONT40.HEAVY': 'CONT40',
};

export function quotationBaseClassCode(code: string): string {
  return QUOTATION_BASE_OF[code] ?? code;
}

/** Grid column identity: the vehicle size class code. */
export interface QuotationColumnKey {
  vehicleSizeClassCode: string;
}

// Canonical Mẫu-báo-giá-1 column layout — 6 truck classes + 4 container
// weight classes. Column order matches the customer file; container codes
// follow card _58's catalog (CONT20.LIGHT/.HEAVY, CONT40.LIGHT/.HEAVY).
export const QUOTATION_GRID_COLUMNS: readonly (QuotationColumnKey & { label: string })[] = [
  { vehicleSizeClassCode: '1.25T', label: 'Xe 1.25T' },
  { vehicleSizeClassCode: '2.5T', label: 'Xe 2.5T' },
  { vehicleSizeClassCode: '3.5T', label: 'Xe 3.5T' },
  { vehicleSizeClassCode: '5T', label: 'Xe 5T' },
  { vehicleSizeClassCode: '8T', label: 'Xe 8T' },
  { vehicleSizeClassCode: '10T', label: 'Xe 10T' },
  { vehicleSizeClassCode: 'CONT20.LIGHT', label: 'Cont20 <20t' },
  { vehicleSizeClassCode: 'CONT20.HEAVY', label: 'Cont20 >20t' },
  { vehicleSizeClassCode: 'CONT40.LIGHT', label: 'Cont40 nhẹ <20t' },
  { vehicleSizeClassCode: 'CONT40.HEAVY', label: 'Cont40 nặng >20t' },
] as const;

/** Quotation CRUD paths — root-relative under /api (config mount), shared FE+BE. */
export const QUOTATION_PATHS = {
  LIST: '/quotations',
  DETAIL: (id: number) => `/quotations/${id}`,
  /** Card 20260922_61: kế toán's "ĐỒNG Ý CẬP NHẬT BÁO GIÁ" batch list. */
  FUEL_APPROVALS: '/quotations/fuel-approvals',
  FUEL_APPROVALS_DECIDE: '/quotations/fuel-approvals/decide',
  IMPORT: '/quotations/import',
  IMPORT_COMMIT: '/quotations/import/commit',
} as const;

/**
 * Per-customer fuel-surcharge rounding rule (card 20260922_60, ruling 7):
 * Excel ROUND(x; -n) half-away-from-zero applied to the surcharge ONLY.
 * 'NONE' = unconfigured — the deterministic default (no rounding).
 * 'THOUSAND' = "3 số" (thousands), 'TEN_THOUSAND' = "4 số" (ten-thousands).
 */
export const SURCHARGE_ROUNDING_MODES = ['NONE', 'THOUSAND', 'TEN_THOUSAND'] as const;
export type SurchargeRoundingMode = (typeof SURCHARGE_ROUNDING_MODES)[number];

/**
 * Card 20260922_64: routing of a "Chi phí khác" catalog fee. The customer's
 * spec fixes two DEDICATED columns (Hải quan giám sát, Nâng/Hạ Lạch Huyện);
 * every other fee rides the other-costs column with its name noted into the
 * bảng kê. Amounts are TẠM defaults (ruling 9a) — stored as data, never
 * code constants.
 */
export const FEE_ROUTING_MODES = ['DEDICATED_CUSTOMS', 'DEDICATED_LACH_HUYEN', 'OTHER_COSTS'] as const;
export type FeeRoutingMode = (typeof FEE_ROUTING_MODES)[number];

/** Entry-time classification default — stored on the row, then editable data. */
export function defaultFeeRouting(feeName: string): FeeRoutingMode {
  const text = feeName.toLowerCase();
  if (text.includes('hải quan giám sát')) return 'DEDICATED_CUSTOMS';
  if (text.includes('lạch huyện')) return 'DEDICATED_LACH_HUYEN';
  return 'OTHER_COSTS';
}

export const quotationFeeSchema = z.object({
  feeName: z.string().trim().min(1).max(120),
  subType: z.string().trim().max(80).nullable().optional(),
  // TẠM default (ruling 9a); null = pending-empty (Kiểm hóa) or manual per lot.
  defaultAmount: z.coerce.number().int().nonnegative().max(99_999_999_999).nullable().optional(),
  routing: z.enum(FEE_ROUTING_MODES).optional(),
  note: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
}).strict();

export type QuotationFeeInput = z.input<typeof quotationFeeSchema>;

// Hệ số — per-cell multiplier of the FUEL SURCHARGE ONLY (operator ruling
// 2026-09-22, card _59: default 1; business meaning deferred to the
// customer). Stored numeric(8,4); 0 disables the surcharge line.
const heSoSchema = z.number().finite().min(0).max(999.9999);

export const quotationCellSchema = z.object({
  routeId: z.coerce.number().int().positive(),
  vehicleSizeClassCode: z.string().trim().min(1).max(20),
  heSo: heSoSchema.default(1),
}).strict();

export const quotationCreateSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  templateName: z.string().trim().min(1).max(120),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày hiệu lực phải có dạng YYYY-MM-DD'),
  surchargeRoundingMode: z.enum(SURCHARGE_ROUNDING_MODES).default('NONE'),
  note: z.string().trim().max(2000).nullable().optional(),
  cells: z.array(quotationCellSchema).max(400).default([]),
  // Card 20260922_64: the per-customer "Chi phí khác" catalog rides the frame
  // payload — the material-write envelope on POST/PUT /quotations governs it.
  fees: z.array(quotationFeeSchema).max(200).default([]),
}).strict();

export const quotationUpdateSchema = quotationCreateSchema.omit({ customerId: true }).strict();

export type QuotationCellInput = z.input<typeof quotationCellSchema>;
export type QuotationCreateInput = z.input<typeof quotationCreateSchema>;
export type QuotationUpdateInput = z.infer<typeof quotationUpdateSchema>;

// ─── Live-view grid cell (computed, never persisted except heSo) ───────────
export interface QuotationCellView {
  routeId: number;
  routeName: string;
  vehicleSizeClassCode: string;
  /** Per-cell surcharge multiplier (the only cell datum the quotation owns). */
  heSo: number;
  /** Live from pricing_tables; null = missing data (ruling 2: never light-fallback). */
  giaCos: number | null;
  /** True when the cell has no price of its own (heavy cells in Mẫu 1 today). */
  missingPrice: boolean;
  /** billingKmOneWay × multiplier × litersPerKm (derived, never stored). */
  liters: number | null;
  /** MAX(0, Δfuel) × liters × heSo — the file's Phụ phí line. */
  surcharge: number | null;
  /** giaCos + surcharge; excluded from row totals while the price is missing. */
  total: number | null;
  /** Pre-rounding surcharge (card _60) — equals surcharge when mode is NONE. */
  surchargeRaw: number | null;
  baseFuelPrice: number | null;
  fuelLagDays: number | null;
  /** Human-readable formula for the UI (engine-style). */
  formula: string | null;
}

export interface QuotationView {
  id: number;
  customerId: number;
  customerName: string;
  templateName: string;
  effectiveDate: string;
  surchargeRoundingMode: SurchargeRoundingMode;
  note: string | null;
  cells: QuotationCellView[];
  /** Card _64: the per-customer fee catalog (Chi phí khác), routing included. */
  fees: QuotationFeeView[];
}

export interface QuotationFeeView {
  id: number;
  feeName: string;
  subType: string | null;
  defaultAmount: number | null;
  routing: FeeRoutingMode;
  note: string | null;
  sortOrder: number;
}
