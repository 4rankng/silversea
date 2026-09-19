import { z } from 'zod';
import { expenseInputFields, expenseDateSchema, expenseVndSchema } from '../expense-accounting';
import { normalizeContainerNumber, validateCheckDigit, validateContainerFormat } from '../calculations/iso6346';
import {
  CustomerAccountType, FuelMode, LoadingType, Role, SupplierType,
  TrailerType, TruckStatus, TrailerStatus, DriverStatus, CustomerStatus,
  ShipmentStatus, ShipmentDocumentType,
  OperationalSiteType, FulfillmentCancellationDisposition, TripPodFileType,
  DriverProgressEventType,
  DriverIncidentalCostType,
  ExpenseTypeCategory,
  NO_INVOICE_EVIDENCE_TYPES,
  TIRE_STATUSES,
  DISPATCH_CLASSIFICATIONS,
} from '../constants';

export * from './financial-reporting-policy';

// Admin OCR settings (independent enable switch + OpenRouter/Gemini API keys).
// Used by the ADMIN-only settings route and the frontend config page.
export * from './ocr-settings';

// Event-driven mobile GPS geotagging — Zod submit schema + types consumed by
// the geotag route/service (backend) and the geotag client (frontend).
export * from './geotag';

// Reusable numeric transform helpers to prevent string concatenation bugs and parse PG numeric types
export const numericMoney = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const num = Number(val);
  if (!Number.isFinite(num)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Giá trị tiền tệ không hợp lệ' });
    return z.NEVER;
  }
  return num;
});

export const numericDecimal = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const num = Number(val);
  if (!Number.isFinite(num)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Giá trị số không hợp lệ' });
    return z.NEVER;
  }
  return num;
});

const positiveNumeric = z.union([z.number(), z.string()]).transform((val, ctx) => {
  // String inputs must be plain decimal literals — Number() alone would
  // happily coerce "0x10" to 16 and other exotic literals into money and
  // quantity fields.
  if (typeof val === 'string' && !/^\d+(\.\d+)?$/.test(val.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phải là số dương' });
    return z.NEVER;
  }
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phải là số dương' });
    return z.NEVER;
  }
  return num;
});

const nonNegNumeric = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phải là số không âm' });
    return z.NEVER;
  }
  return num;
});

function fixedScaleDecimal(label: string, integerDigits: number, scale: number) {
  return z.union([z.number().finite(), z.string()]).transform((value, ctx) => {
    const raw = String(value).trim();
    const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
    if (!match) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} phải là số không âm hợp lệ` });
      return z.NEVER;
    }
    const integerPart = match[1];
    const fractionPart = match[2] ?? '';
    if (integerPart.length > integerDigits || fractionPart.length > scale) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} vượt quá giới hạn ${integerDigits} chữ số nguyên và ${scale} chữ số thập phân`,
      });
      return z.NEVER;
    }
    return `${integerPart}.${fractionPart.padEnd(scale, '0')}`;
  });
}

const shipmentTimestamp = z.string().datetime({ offset: true }).refine((value) => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}, 'Thời gian không phải ngày hợp lệ');
const shipmentWeightKg = fixedScaleDecimal('Trọng lượng', 8, 2);
const shipmentVolumeCbm = fixedScaleDecimal('Thể tích', 7, 3);
const shipmentPackageCount = z.coerce.number()
  .int('Số kiện phải là số nguyên')
  .nonnegative('Số kiện phải là số không âm')
  .max(2_147_483_647, 'Số kiện vượt quá giới hạn');

const fullNameField = z.string().max(255).or(z.literal('')).optional();

const positiveWholeMoney = z.union([z.number(), z.string()]).transform((val, ctx) => {
  const num = Number(val);
  if (!Number.isSafeInteger(num) || !Number.isInteger(num) || num <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Phải là số nguyên dương' });
    return z.NEVER;
  }
  if (num > 999_999_999_999_999) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Vượt quá giới hạn số tiền cho phép' });
    return z.NEVER;
  }
  return num;
});

// ─── Trip ────────────────────────────────────────────────────────────────────

export const tripLegSchema = z.object({
  sequence: z.number().int().positive(),
  origin: z.string().min(1),
  destination: z.string().min(1),
  // Allow 0 so accountants can save partial drafts before final figures are entered.
  km: nonNegNumeric,
  loadingType: z.nativeEnum(LoadingType),
});

const directCreditExceptionSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do ngoại lệ là bắt buộc').max(1000),
  expiresAt: z.string().datetime(),
  scopeType: z.literal('SHIPMENT'),
  exposureCeiling: z.number().int().positive().max(999_999_999_999_999),
});

export const createTripSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  routeId: z.coerce.number().int().positive(),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  driverId: z.coerce.number().int().positive().optional().nullable(),
  cargoTypeId: z.coerce.number().int().positive(),
  departureDate: z.string().min(1),
  customerReference: z.string().optional(),
  containerCount: z.coerce.number().int().min(1).max(10).optional(),
  containerTypeId: z.coerce.number().int().positive({ message: 'Loại container là bắt buộc' }),
  pricingRateKey: z.string().trim().max(32).optional().nullable().transform(v => (v == null || v === '' ? null : v.toUpperCase())),
  // Wave 0: optional link to the shipment (lô hàng) this trip fulfills.
  // Required only when the backend feature flag SHIPMENT_FIRST_CREATE is ON;
  // the flag-conditional check lives in the route handler (the shared schema
  // is also consumed by the frontend, which does not see the server flag).
  // When provided, the trip-create flow links the new trip to the shipment
  // and snapshots the shipment's containers into the trip.
  shipmentId: z.coerce.number().int().positive().optional().nullable(),
  creditApprovalRequestId: z.coerce.number().int().positive().optional().nullable(),
  creditException: directCreditExceptionSchema.optional(),
  fuelMode: z.nativeEnum(FuelMode).optional(),
  fuelSupplierId: z.coerce.number().int().positive().optional().nullable(),
  // Per-trip actual pump price (₫/lít). Optional — when blank the trip falls
  // back to the config snapshot (see fuelPriceApplied). Lets a manager record
  // the real station price at creation instead of only on edit.
  fuelActualUnitPrice: positiveNumeric.nullable().optional(),
  vatRate: z.number().min(0).max(0.5).optional().default(0),
  carrierType: z.enum(['OWN', 'EXTERNAL']).optional().default('OWN'),
  externalCarrierId: z.number().int().positive().nullable().optional(),
  externalFreightCost: z.number().positive().nullable().optional(),
  externalPlateNumber: z.string().max(20).nullable().optional(),
  externalDriverName: z.string().max(100).nullable().optional(),
  externalDriverPhone: z.string().max(20).nullable().optional(),
}).superRefine((data, ctx) => {
  // OWN carrier trips require truckId and driverId; EXTERNAL trips require external fields
  if ((data.carrierType ?? 'OWN') === 'OWN') {
    if (!data.truckId) {
      ctx.addIssue({ code: 'custom', path: ['truckId'], message: 'Xe đầu kéo là bắt buộc cho chuyến xe nội bộ' });
    }
    if (!data.driverId) {
      ctx.addIssue({ code: 'custom', path: ['driverId'], message: 'Lái xe là bắt buộc cho chuyến xe nội bộ' });
    }
  } else {
    // EXTERNAL trips only require the carrier partner (who). The freight cost,
    // plate, driver name and phone are trip details that may be filled in later
    // after the trip is created — they are NOT required at creation time.
    if (!data.externalCarrierId) {
      ctx.addIssue({ code: 'custom', path: ['externalCarrierId'], message: 'Nhà xe ngoài là bắt buộc cho chuyến xe ngoài' });
    }
  }
});

const tripPairDraftSchema = z.object({
  plannedStartAt: z.string().trim().min(1, 'Giờ bắt đầu kế hoạch là bắt buộc'),
  plannedEndAt: z.string().trim().min(1, 'Giờ kết thúc kế hoạch là bắt buộc'),
  canonicalOrigin: z.string().trim().min(1, 'Điểm đi là bắt buộc').max(160),
  canonicalDestination: z.string().trim().min(1, 'Điểm đến là bắt buộc').max(160),
  cargoWeightKg: positiveNumeric,
  vehicleCapacityKg: positiveNumeric,
  expectedVersion: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  const start = new Date(data.plannedStartAt);
  const end = new Date(data.plannedEndAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Thời gian kế hoạch không hợp lệ',
      path: ['plannedStartAt'],
    });
    return;
  }
  if (end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Giờ kết thúc phải sau giờ bắt đầu',
      path: ['plannedEndAt'],
    });
  }
});

export const createTripPairSchema = z.object({
  firstTripId: z.coerce.number().int().positive(),
  secondTripId: z.coerce.number().int().positive(),
  // Keep in sync with TripPairKind (types) and trip_pairs.pair_kind. Default
  // KET_HOP keeps pre-spec clients (and pre-split pairs) on sequential rules.
  pairKind: z.enum(['KEP', 'KET_HOP']).default('KET_HOP'),
  firstTrip: tripPairDraftSchema,
  secondTrip: tripPairDraftSchema,
}).superRefine((data, ctx) => {
  if (data.firstTripId === data.secondTripId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Không thể ghép một chuyến với chính nó',
      path: ['secondTripId'],
    });
  }
});

// Card 20260914_40: `version` is the canonical optimistic-locking field for
// trip-figure writes. `expectedVersion` is accepted as a deliberate ALIAS
// (mapped to `version` when `version` itself is absent) so an older API
// consumer that sends the wrong field trips a real version check instead of
// the misleading "expectedVersion không hợp lệ" deep-guard 400.
export const updateTripFiguresSchema = z.preprocess(
  (raw) => {
    if (raw != null && typeof raw === 'object' && 'expectedVersion' in raw) {
      const { expectedVersion, ...rest } = raw as Record<string, unknown>;
      if (rest.version === undefined) {
        return { ...rest, version: expectedVersion };
      }
    }
    return raw;
  },
  z.object({
  legs: z.array(tripLegSchema),
  customerId: z.coerce.number().int().positive().optional(),
  departureDate: z.string().optional(),
  completedAt: z.string().optional(),
  fuelMode: z.nativeEnum(FuelMode),
  fuelLitersOverride: nonNegNumeric.nullable().optional(),
  fuelSupplementLiters: nonNegNumeric.optional(),
  fuelSupplementReason: z.string().optional(),
  fuelActualUnitPrice: positiveNumeric.nullable().optional(),
  fuelSupplierId: z.coerce.number().int().positive().nullable().optional(),
  tollsDiscount: nonNegNumeric.optional(),
  tollsAddition: nonNegNumeric.optional(),
  tollsStations: z.coerce.number().int().nonnegative().optional(),
  /** O2C "kẹp hàng" backhaul toll dedup. System-managed by the pairing flow;
   * exposed here so an independently-approved financial correction can override. */
  tollDeduction: nonNegNumeric.optional(),
  hasReturnCargo: z.boolean().optional(),
  roadAllowanceOverride: nonNegNumeric.nullable().optional(),
  driverSalary: nonNegNumeric.optional(),
  revenue: nonNegNumeric.optional(),
  revenueEmptyReturn: nonNegNumeric.optional(),
  revenueCombine: nonNegNumeric.optional(),
  customerCommission: nonNegNumeric.optional(),
  tripWageDays: z.number().int().nonnegative().optional(),
  twoPointDeliveryBonus: nonNegNumeric.optional(),
  vehicleShiftAllowance: nonNegNumeric.optional(),
  notes: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
  version: z.number().int().optional(),
  routeId: z.coerce.number().int().positive().optional(),
  vatRate: z.number().min(0).max(0.5).optional(),
  carrierType: z.enum(['OWN', 'EXTERNAL']).optional(),
  externalCarrierId: z.number().int().positive().nullable().optional(),
  externalFreightCost: z.number().positive().nullable().optional(),
  externalPlateNumber: z.string().max(20).nullable().optional(),
  externalDriverName: z.string().max(100).nullable().optional(),
  externalDriverPhone: z.string().max(20).nullable().optional(),
  truckId: z.coerce.number().int().positive().nullable().optional(),
  driverId: z.coerce.number().int().positive().nullable().optional(),
  trailerType: z.string().max(20).nullable().optional(),
}).superRefine((data, ctx) => {
  if (data.fuelSupplementLiters && data.fuelSupplementLiters > 0) {
    if (!data.fuelSupplementReason || data.fuelSupplementReason.trim() === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Lý do cấp dầu bổ sung là bắt buộc khi số lít dầu bổ sung lớn hơn 0',
        path: ['fuelSupplementReason'],
      });
    }
  }
  // Revenue override footgun: splits are authoritative when present, so sending
  // `revenue` together with a split silently discards `revenue`. Reject the
  // ambiguous mixed payload with a clear error. (Frontend sends splits only and
  // omits `revenue`, so it is unaffected.) feedback202606 A3 §9.
  if (data.revenue !== undefined &&
      (data.revenueEmptyReturn !== undefined || data.revenueCombine !== undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Gửi `revenue` HOẶC splits (revenueEmptyReturn/revenueCombine), không gửi cả hai.',
      path: ['revenue'],
    });
  }
}),
);

export const bulkUpdateTripFiguresSchema = z.object({
  updates: z.array(z.object({
    tripId: z.coerce.number().int().positive(),
    mode: z.enum(['pre-departure', 'actuals']).default('actuals'),
    governanceReason: z.string().trim().min(1).max(1000).optional(),
    // Validate each row's figures independently in the route so one malformed
    // spreadsheet row can return a row error without rejecting the whole batch.
    figures: z.unknown(),
  })).min(1).max(100),
});


// ─── Payment ─────────────────────────────────────────────────────────────────

export const createPaymentSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  receiptId: z.string().trim().min(1).max(100),
  amount: positiveWholeMoney.optional(),
  payments: z.array(z.object({
    tripId: z.coerce.number().int().positive(),
    amount: positiveWholeMoney,
  })).min(1).max(200).optional(),
}).superRefine((data, ctx) => {
  if (!data.amount && (!data.payments || data.payments.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cần cung cấp `amount` hoặc `payments`.',
      path: ['amount'],
    });
  }

  if (data.payments && data.payments.length > 0) {
    const seen = new Set<number>();
    for (const [index, payment] of data.payments.entries()) {
      if (seen.has(payment.tripId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Mỗi chuyến chỉ được xuất hiện một lần trong `payments`.',
          path: ['payments', index, 'tripId'],
        });
      }
      seen.add(payment.tripId);
    }
  }

  if (!data.payments && !data.amount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Thiếu số tiền thanh toán.',
      path: ['amount'],
    });
  }

  if (data.payments && data.amount !== undefined) {
    const instructedTotal = data.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (instructedTotal > data.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tổng `payments.amount` không được lớn hơn `amount`.',
        path: ['payments'],
      });
    }
  }
});

// ─── Penalty ─────────────────────────────────────────────────────────────────

export const createPenaltySchema = z.object({
  driverId: z.coerce.number().int().positive(),
  tripId: z.coerce.number().int().positive().optional(),
  reasonId: z.coerce.number().int().positive().optional(),
  customReason: z.string().optional(),
  amount: positiveNumeric,
  date: z.string().min(1),
});

// ─── Adjustment ──────────────────────────────────────────────────────────────

export const createAdjustmentSchema = z.object({
  tripId: z.coerce.number().int().positive(),
  expectedVersion: z.coerce.number().int().positive(),
  amount: z.union([z.number(), z.string()]).transform(Number)
    .refine((v) => Number.isFinite(v), { message: 'Số tiền không hợp lệ' }),
  note: z.string().min(1),
  signedAgreementRef: z.string().min(1),
});

export const tripReopenRequestSchema = z.object({
  reason: z.string().trim().min(1),
  expectedVersion: z.coerce.number().int().positive(),
});

// ─── Billing Documents (debit notes + payment statements) ────────────────────
// Saved billing documents. DEBIT_NOTE saves reconcile edited/source-excluded
// and ad-hoc amounts into customer AR via append-only adjustment entries;
// PAYMENT_STATEMENT remains a presentation snapshot only.

export const billingDocumentLineSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  sourceType: z.enum(['TRIP', 'EXPENSE', 'ADHOC']),
  sourceId: z.coerce.number().int().positive().nullable(),
  lineType: z.enum(['FREIGHT', 'SERVICE_FEE', 'ADHOC']),
  typeLabel: z.string().min(1),
  unit: z.string().min(1),
  description: z.string().min(1),
  routeName: z.string().nullable().optional(),
  containerNumbers: z.array(z.string()).nullable().optional(),
  renderData: z.record(z.unknown()).nullable().optional(),
  financialPostingId: z.coerce.number().int().positive().nullable().optional(),
  financialPostingVersion: z.coerce.number().int().positive().nullable().optional(),
  postingChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  baseAmount: nonNegNumeric,
  amountOverride: nonNegNumeric.nullable().optional(),
  excluded: z.boolean().optional(),
  vatTreatment: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']).optional(),
  vatRate: z.union([z.literal(0), z.literal(0.05), z.literal(0.08), z.literal(0.10)]).optional(),
  vatTreatmentVersion: z.string().min(1).optional(),
  netAmount: nonNegNumeric.optional(),
  taxAmount: nonNegNumeric.optional(),
  grossAmount: nonNegNumeric.optional(),
  sortOrder: z.coerce.number().int(),
});

export const billingDocumentSourceRefSchema = z.discriminatedUnion('sourceType', [
  z.object({
    sourceType: z.literal('TRIP'),
    sourceId: z.coerce.number().int().positive(),
    financialPostingId: z.coerce.number().int().positive(),
    financialPostingVersion: z.coerce.number().int().positive(),
    postingChecksum: z.string().regex(/^[a-f0-9]{64}$/, 'Checksum nguồn hạch toán không hợp lệ'),
  }).strict(),
  z.object({
    sourceType: z.literal('EXPENSE'),
    sourceId: z.coerce.number().int().positive(),
    sourceVersion: z.string().trim().min(1).max(160),
  }).strict(),
]);

export const generateBillingDocumentSchema = z.object({
  type: z.enum(['DEBIT_NOTE', 'PAYMENT_STATEMENT']),
  entityType: z.enum(['CUSTOMER', 'VENDOR']),
  entityId: z.coerce.number().int().positive(),
  rangeFrom: z.string().min(1),
  rangeTo: z.string().min(1),
});

const billingDocumentSaveCommonShape = {
  entityId: z.coerce.number().int().positive(),
  entityName: z.string().optional(),
  rangeFrom: z.string().min(1),
  rangeTo: z.string().min(1),
  note: z.string().nullable().optional(),
  // Resolved at save time so the chosen template is snapshotted onto the doc
  // (re-exports stay stable). Null/undefined = use resolution (customer/default).
  debitNoteTemplateId: z.coerce.number().int().positive().nullable().optional(),
};

export const saveBillingDocumentSchema = z.discriminatedUnion('type', [
  z.object({
    ...billingDocumentSaveCommonShape,
    type: z.literal('DEBIT_NOTE'),
    entityType: z.literal('CUSTOMER'),
    sourceRefs: z.array(billingDocumentSourceRefSchema).min(1),
  }).strict(),
  z.object({
    ...billingDocumentSaveCommonShape,
    type: z.literal('PAYMENT_STATEMENT'),
    entityType: z.enum(['CUSTOMER', 'VENDOR']),
    lines: z.array(billingDocumentLineSchema).min(1),
  }).strict(),
]);

export const billingDocumentAdjustmentRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(1000),
});

export const billingDocumentIssueRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Lý do là bắt buộc').max(1000),
  expectedVersion: z.coerce.number().int().positive(),
});

// ─── Billing document Excel templates ────────────────────────────────────────
// Excel-style templates built around user-defined columns. Each column binds to
// a whitelisted variable so accountants can reproduce customer statement files
// without typing fragile formulas or free-form placeholders.
export const debitNoteColumnVariableSchema = z.enum([
  'rowIndex',
  'departureDate',
  'deliveryDate',
  'truckPlate',
  'vehicleType',
  'actionType',
  'origin',
  'destination',
  'deliveryAddress',
  'factoryName',
  'tradeDirectionLabel',
  'billNumber',
  'declarationNumber',
  'quantityLabel',
  'container20Count',
  'container40Count',
  'containerCount',
  'containerNumbers',
  'cargoVolumeCbm',
  'routeName',
  'description',
  'lineTypeLabel',
  'unit',
  'amount',
  'deliveryFeeAmount',
  'freightAmount',
  'portFeeAmount',
  'otherServiceFeeAmount',
  'fuelSurchargeAmount',
  'serviceFeeAmount',
  'totalAmount',
  'serviceFeeDescription',
  'recoverableSupplierName',
  'recoverableFeeType',
  'recoverableDocumentCode',
  'recoverableAmount',
  'note',
  'tripCode',
  'documentCode',
]);

export const debitNoteColumnSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(80),
  variable: debitNoteColumnVariableSchema,
  headerGroup: z.string().min(1).max(80).nullable().optional().default(null),
  // min(0) so users can hide a column (rendered as a 0-width hairline in xlsx).
  width: z.coerce.number().min(0).max(80).default(14),
  align: z.enum(['left', 'center', 'right']).default('left'),
  format: z.enum(['text', 'date', 'number', 'currency']).default('text'),
  total: z.boolean().default(false),
});

export const defaultDebitNoteColumns: Array<z.infer<typeof debitNoteColumnSchema>> = [
  { id: 'ngay', label: 'Ngày tháng', variable: 'departureDate', headerGroup: null, width: 12, align: 'center', format: 'date', total: false },
  { id: 'chung_tu', label: 'Số\nchứng từ', variable: 'documentCode', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'dien_giai', label: 'Diễn giải', variable: 'description', headerGroup: null, width: 52, align: 'left', format: 'text', total: false },
  { id: 'dvt', label: 'ĐVT', variable: 'unit', headerGroup: null, width: 9, align: 'center', format: 'text', total: false },
  { id: 'so_luong', label: 'Số lượng', variable: 'containerCount', headerGroup: null, width: 9, align: 'center', format: 'number', total: false },
  { id: 'don_gia', label: 'Đơn giá', variable: 'amount', headerGroup: null, width: 15, align: 'right', format: 'currency', total: false },
  { id: 'thanh_tien', label: 'Thành tiền', variable: 'amount', headerGroup: null, width: 16, align: 'right', format: 'currency', total: true },
];

export const defaultPaymentStatementColumns: Array<z.infer<typeof debitNoteColumnSchema>> = [
  { id: 'stt', label: 'Stt', variable: 'rowIndex', headerGroup: null, width: 4.56, align: 'center', format: 'number', total: false },
  { id: 'ngay', label: 'Ngày\nthực hiện', variable: 'departureDate', headerGroup: null, width: 11.28, align: 'center', format: 'date', total: false },
  { id: 'bien_so', label: 'Biển số xe', variable: 'truckPlate', headerGroup: null, width: 11.7, align: 'center', format: 'text', total: false },
  { id: 'dong_tra', label: 'Đóng/ Trả', variable: 'actionType', headerGroup: null, width: 8.14, align: 'center', format: 'text', total: false },
  { id: 'diem_di', label: 'Điểm đi/ về', variable: 'origin', headerGroup: null, width: 18.99, align: 'left', format: 'text', total: false },
  { id: 'diem_hang', label: 'Điểm đóng/ trả hàng', variable: 'destination', headerGroup: null, width: 40.84, align: 'left', format: 'text', total: false },
  { id: 'dia_chi_hang', label: 'Điểm đóng/ trả hàng', variable: 'deliveryAddress', headerGroup: null, width: 45.13, align: 'left', format: 'text', total: false },
  { id: 'sl20', label: "20'", variable: 'container20Count', headerGroup: null, width: 5.41, align: 'center', format: 'number', total: true },
  { id: 'sl40', label: "40'", variable: 'container40Count', headerGroup: null, width: 6.28, align: 'center', format: 'number', total: true },
  { id: 'so_cont', label: 'Số hiệu cont', variable: 'containerNumbers', headerGroup: null, width: 15.7, align: 'left', format: 'text', total: false },
  { id: 'gia_vc', label: 'Giá VC \n (Chưa VAT)', variable: 'amount', headerGroup: null, width: 13.85, align: 'right', format: 'currency', total: true },
  { id: 'phi_chi_ho', label: 'Phí chi hộ', variable: 'serviceFeeAmount', headerGroup: null, width: 13.85, align: 'right', format: 'currency', total: true },
  { id: 'ghi_chu', label: 'Ghi chú', variable: 'note', headerGroup: null, width: 8.7, align: 'left', format: 'text', total: false },
];

export const debitNoteTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  isDefault: z.boolean().default(false),
  documentType: z.enum(['DEBIT_NOTE', 'PAYMENT_STATEMENT']).default('DEBIT_NOTE'),
  titleText: z.string().min(1).max(100).default('GIẤY BÁO NỢ'),
  issuerName: z.string().max(200).nullable().default(null),
  issuerAddress: z.string().max(300).nullable().default(null),
  issuerTaxCode: z.string().max(50).nullable().default(null),
  issuerRepresentative: z.string().max(100).nullable().default(null),
  accentColor: z.string().min(1).max(20).default('#1F4E79'),
  showContainerColumn: z.boolean().default(true),
  showUnitColumn: z.boolean().default(true),
  groupingMode: z.enum(['ROUTE', 'LINE_TYPE', 'NONE']).default('ROUTE'),
  columns: z.array(debitNoteColumnSchema).min(1).max(24).default(defaultDebitNoteColumns),
  // Phase 2: rendered read-only in UI; reserved for a future vndToWords() helper.
  amountInWords: z.boolean().default(false),
  orientation: z.enum(['landscape', 'portrait']).default('portrait'),
  termsText: z.string().nullable().default('Vui lòng ghi số tham chiếu giấy báo nợ này trong chứng từ thanh toán'),
  signatureLeftLabel: z.string().max(100).nullable().default('Khách hàng'),
  signatureLeftName: z.string().max(100).nullable().default(null),
  signatureRightLabel: z.string().max(100).nullable().default('Người lập'),
  signatureRightName: z.string().max(100).nullable().default('Phan Kim Phụng'),
});

export type DebitNoteTemplateInput = z.infer<typeof debitNoteTemplateSchema>;
export type DebitNoteColumnInput = z.infer<typeof debitNoteColumnSchema>;
export type DebitNoteColumnVariableInput = z.infer<typeof debitNoteColumnVariableSchema>;

// ─── Commission (manual posting) ────────────────────────────────────────────
// Records a commission payable owed to a supplier (VENDOR ledger, COMMISSION
// txnType). Not trip-scoped — `tripId` is optional context only.

export const commissionSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  amount: z.union([z.number(), z.string()]).transform(Number)
    // > 0 + upper-bound backstop (≤ 1 billion VND) against catastrophic typos
    // (e.g. extra zeros / VND-vs-thousands confusion) on a manual money entry
    // with no approval workflow. A formatted-amount confirm step in the UI is
    // the recommended further guard. (Architect CRITICAL #2.)
    .refine((v) => Number.isFinite(v) && v > 0 && v <= 1_000_000_000, { message: 'Số tiền hoa hồng không hợp lệ (phải > 0 và ≤ 1 tỷ VND)' }),
  tripId: z.coerce.number().int().positive().optional(),
  note: z.string().trim().max(500).optional(),
});

export type CommissionInput = z.infer<typeof commissionSchema>;

// ─── Driver payout (B1 — feedback202606 GAP 4) ───────────────────────────────
// Records a salary/cash payout to a driver. Posts a DRIVER_PAYOUT debit on the
// DRIVER ledger, reducing the company's payable balance for that driver.

export const driverPayoutSchema = z.object({
  amount: z.union([z.number(), z.string()]).transform(Number)
    .refine((v) => Number.isFinite(v) && v > 0 && v <= 1_000_000_000, { message: 'Số tiền thanh toán không hợp lệ (phải > 0 và ≤ 1 tỷ VND)' }),
  method: z.enum(['CASH', 'BANK']),
  payoutDate: z.string().min(1, 'Ngày thanh toán là bắt buộc'),
  note: z.string().trim().max(500).optional(),
  receiptId: z.string().trim().max(100).optional(),
});

export type DriverPayoutInput = z.infer<typeof driverPayoutSchema>;

// ─── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export const createUserSchema = z.object({
  username: z.string().min(2).optional(),
  email: z.string().email().optional(),
  fullName: fullNameField,
  employeeCode: z.string().max(20).optional(),
  phone: z.string().min(6).optional(),
  password: z.string().min(6),
  role: z.nativeEnum(Role),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  // Driver-profile fields — only meaningful when role === DRIVER. The user
  // service uses these to create the linked `drivers` row on the same transaction.
  baseSalary: nonNegNumeric.optional(),
  socialInsurance: nonNegNumeric.optional(),
  customerId: z.number().int().positive().nullable().optional(),
  customerIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 khách hàng liên kết').optional(),
  customerAccountType: z.nativeEnum(CustomerAccountType).optional().default(CustomerAccountType.SINGLE_ENTITY),
  businessUnitIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 đơn vị phụ trách').optional(),
  shipmentIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 lô hàng liên kết').optional(),
}).refine(data => data.username || data.email || data.phone, {
  message: 'Phải cung cấp ít nhất một trong: username, email, hoặc số điện thoại',
});

export const updateUserSchema = z.object({
  role: z.nativeEnum(Role).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  password: z.string().min(6).optional(),
  username: z.string().min(1).max(100).optional(),
  fullName: fullNameField,
  employeeCode: z.string().max(20).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().min(6).or(z.literal('')).optional(),
  // Driver-profile fields — upserted onto the linked `drivers` row when the
  // resulting role is DRIVER. Optional so non-driver payloads validate unchanged.
  baseSalary: nonNegNumeric.optional(),
  socialInsurance: nonNegNumeric.optional(),
  customerId: z.number().int().positive().nullable().optional(),
  customerIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 khách hàng liên kết').optional(),
  customerAccountType: z.nativeEnum(CustomerAccountType).optional(),
  businessUnitIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 đơn vị phụ trách').optional(),
  shipmentIds: z.array(z.number().int().positive()).max(100, 'Tối đa 100 lô hàng liên kết').optional(),
});

export const updateProfileSchema = z.object({
  username: z.string().min(1, 'Tên đăng nhập không được để trống').max(100).optional(),
  fullName: fullNameField,
  email: z.string().email('Email không hợp lệ').or(z.literal('')).optional(),
  phone: z.string().min(6, 'Số điện thoại quá ngắn').or(z.literal('')).optional(),
}).refine(data => data.username || data.fullName !== undefined || data.email || data.phone, {
  message: 'Phải cung cấp ít nhất một trong: username, họ tên, email, hoặc số điện thoại',
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
  newPassword: z.string().min(6, 'Mật khẩu mới phải có ít nhất 6 ký tự').max(128, 'Mật khẩu quá dài'),
});

  // ─── CRUD ────────────────────────────────────────────────────────────────────

export const paymentDatePolicySchema = z.enum(['NEXT_BUSINESS_DAY', 'CALENDAR_DAY']);

export const isoDateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Ngày không tồn tại');

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Tên đầy đủ là bắt buộc').max(255),
  // Blank (not absent) is a deliberate clear: displays fall back to `name`
  // everywhere via `shortName || name`, so '' is the representable "unset".
  shortName: z.string().trim().max(255).optional(),
  code: z.string().trim().max(80).optional(),
  taxCode: z.string().trim().max(20, 'Mã số thuế tối đa 20 ký tự').optional(),
  address: z.string().trim().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  contactInfo: z.string().optional(),
  accountantName: z.string().optional(),
  accountantPhone: z.string().optional(),
  creditLimit: nonNegNumeric.optional(),
  creditWarningThreshold: z.number().min(0.01).max(0.99).optional().nullable(),
  paymentTermDays: z.number().int().min(0).max(3650).optional().nullable(),
  fuelSurchargeSharePct: z.number().min(0).max(100).optional().nullable(),
  paymentDatePolicy: paymentDatePolicySchema.optional().default('NEXT_BUSINESS_DAY'),
  status: z.nativeEnum(CustomerStatus).optional().default(CustomerStatus.ACTIVE),
  isCarrier: z.boolean().optional().default(false),
  // New writes may use monthly by default or weekly by explicit contract.
  // PER_BATCH remains a persisted/read compatibility value only.
  debitNoteMode: z.enum(['MONTHLY', 'WEEKLY']).optional().default('MONTHLY'),
  debitNoteTemplateId: z.number().int().positive().optional().nullable(),
  linkedSupplierId: z.number().int().positive().optional().nullable(),
});

export const customerUpdateSchema = customerSchema.extend({
  // Allows a legacy row to be saved without silently converting its existing
  // value. The backend update hook rejects every transition into PER_BATCH.
  debitNoteMode: z.enum(['MONTHLY', 'WEEKLY', 'PER_BATCH']).optional(),
});

export const businessCalendarDaySchema = z.object({
  calendarDate: isoDateOnlySchema,
  name: z.string().trim().min(1, 'Tên ngày nghỉ/làm bù không được để trống').max(255),
  isWorkingDay: z.boolean().optional().default(false),
});

export const truckSchema = z.object({
  licensePlate: z.string().min(1),
  trailerPlateNumber: z.string().optional().nullable(),
  trailerType: z.nativeEnum(TrailerType).optional().nullable(),
  currentTrailerId: z.number().optional().nullable(),
  // Owning nhà xe (carrier customer). Null = own fleet; undefined on update
  // keeps the current assignment. Validated at the catalog write path.
  carrierId: z.coerce.number().int().positive().nullable().optional(),
  status: z.nativeEnum(TruckStatus).optional().default(TruckStatus.ACTIVE),
  // N5 / A12 + B4: ISO 'YYYY-MM-DD' or null/empty. Accepted on create + update.
  nextInspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  insuranceExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lastOilServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // Spec-sheet fields from the tractor master-data sheet. TruckFormModal sends
  // all of these; without them here zod strips the edit and the save silently
  // reverts (numbers arrive as null when cleared, strings as undefined).
  vehicleClass: z.string().trim().max(100).optional().nullable(),
  brand: z.string().trim().max(100).optional().nullable(),
  towCapacityTons: nonNegNumeric.optional().nullable(),
  fuelLPer100kmLoaded: nonNegNumeric.optional().nullable(),
  fuelLPer100kmEmpty: nonNegNumeric.optional().nullable(),
  note: z.string().optional().nullable(),
});

export const trailerSchema = z.object({
  licensePlate: z.string().min(1),
  // Nullable by design — fleet sheets ship blank Loại Moóc; the FE renders
  // those as the explicit "Chưa rõ loại" bucket.
  type: z.nativeEnum(TrailerType).nullable(),
  status: z.nativeEnum(TrailerStatus).optional().default(TrailerStatus.ACTIVE),
});

// ─── N1 — Tires ───────────────────────────────────────────────────────────
// `serial` is the immutable identity; the rest is optional lifecycle metadata.
// cost is coerced (form inputs send strings) into a number for storage.
export const tireSchema = z.object({
  serial: z.string().trim().min(1, 'Số serial lốp không được để trống').max(64),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  // A tire mounts on EITHER a truck (đầu kéo) or a trailer (rơ-moóc); both are
  // nullable so a spare in stock has neither set.
  trailerId: z.coerce.number().int().positive().optional().nullable(),
  position: z.string().trim().min(1).max(64).optional().nullable(),
  size: z.string().max(32).optional().nullable(),
  installedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  removedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  cost: numericMoney.optional().default(0),
  // Ngày mua lốp (replaces the old warranty-expiry field). Drives "tuổi lốp".
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  disposalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  disposalReason: z.string().trim().max(120).optional().nullable(),
  status: z.enum(TIRE_STATUSES).optional().default('IN_STOCK'),
});

// Install accepts either a truck or a trailer target (exactly one required).
export const installTireSchema = z.object({
  truckId: z.coerce.number().int().positive().optional().nullable(),
  trailerId: z.coerce.number().int().positive().optional().nullable(),
  position: z.string().trim().min(1).max(64).optional().nullable(),
}).refine((d) => d.truckId || d.trailerId, {
  message: 'Phải chọn xe đầu kéo hoặc rơ-moóc để lắp lốp',
  path: ['truckId'],
});

// Transfer a mounted tire to another vehicle (exactly one target required).
// Mirrors installTireSchema; kept separate so messages + future divergence stay clear.
export const transferTireSchema = z.object({
  truckId: z.coerce.number().int().positive().optional().nullable(),
  trailerId: z.coerce.number().int().positive().optional().nullable(),
  position: z.string().trim().min(1).max(64).optional().nullable(),
}).refine((d) => d.truckId || d.trailerId, {
  message: 'Phải chọn xe đầu kéo hoặc rơ-moóc để chuyển lốp',
  path: ['truckId'],
});

export const disposeTireSchema = z.object({
  reason: z.string().trim().min(1, 'Chọn lý do thanh lý').max(120),
});

export const tirePositionSchema = z.object({
  name: z.string().trim().min(1, 'Tên vị trí lốp không được để trống').max(64),
  sortOrder: z.coerce.number().int().min(0).optional().default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

export const routeSchema = z.object({
  name: z.string().trim().min(1, 'Tên đầy đủ là bắt buộc').max(255),
  shortName: z.string().trim().min(1, 'Tên ngắn là bắt buộc').max(255).optional(),
  // Stored as nullable PostgreSQL integer kilometres. A deliberate clear is
  // null; omission keeps the previous value on a partial update.
  distanceKm: positiveNumeric.refine(
    (value) => Number.isInteger(value) && value <= 2147483647,
    'Khoảng cách phải là số km nguyên lớn hơn 0, tối đa 2.147.483.647.',
  ).nullable().optional(),
  isMountain: z.boolean().optional().default(false),
  fixedFuelAllowance: nonNegNumeric.nullable().optional(),
  tollsStations: nonNegNumeric.nullable().optional(),
  driverSalary: nonNegNumeric.nullable().optional(),
  // RouteFormModal edits these alongside the names (the config table renders
  // MÃ TUYẾN / ĐIỂM ĐÓNG/TRẢ / GHI CHÚ columns); sent as null when cleared.
  code: z.string().trim().max(80).optional().nullable(),
  loadPoint: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  defaultLegs: z.array(z.object({
    origin: z.string(),
    destination: z.string(),
    km: z.coerce.number().nonnegative(),
    loadingType: z.enum([LoadingType.HANG, LoadingType.VO]),
  })).optional().nullable(),
});

export const cargoTypeSchema = z.object({
  name: z.string().min(1),
  requiresPhotos: z.boolean().optional().default(false),
});

export const pricingTableSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  routeId: z.coerce.number().int().positive(),
  price: positiveNumeric,
  containerTypeId: z.coerce.number().int().positive().optional().nullable(),
  rateKey: z.string().trim().max(32).optional().nullable().transform(v => (v == null || v === '' ? null : v.toUpperCase())),
  effectiveDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
});

export const roadAllowanceSchema = z.object({
  routeId: z.coerce.number().int().positive(),
  trailerType: z.nativeEnum(TrailerType),
  baseAmount: positiveNumeric,
});

export const fuelConfigSchema = z.object({
  loadedNorm: positiveNumeric,
  emptyNorm: positiveNumeric,
  supplement: nonNegNumeric.optional().default(3),
  unitPrice: positiveNumeric,
  baseUnitPrice: positiveNumeric.optional().nullable(),
  warningThreshold: nonNegNumeric.optional().default(37),
  criticalThreshold: nonNegNumeric.optional().default(40),
});

export const fuelPriceHistorySchema = z.object({
  unitPrice: positiveNumeric,
  effectiveDate: z.string().min(1),
  note: z.string().optional(),
});

// ─── Wave 1: Pricing & Fuel catalog schemas ─────────────────────────────────

export const fuelNormSchema = z.object({
  routeId: z.coerce.number().int().positive().optional().nullable(),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  loadedLitersPer100Km: positiveNumeric,
  emptyLitersPer100Km: positiveNumeric,
  supplementLiters: nonNegNumeric.optional().default(0),
  flatRateLiters: nonNegNumeric.optional().nullable(),
  effectiveDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().optional().nullable(),
});

export const weightPricingTierSchema = z.object({
  routeId: z.coerce.number().int().positive(),
  cargoTypeId: z.coerce.number().int().positive(),
  minKg: nonNegNumeric,
  maxKg: positiveNumeric,
  pricePerKg: positiveNumeric,
  effectiveDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().optional().nullable(),
});

export const liftPricingSchema = z.object({
  portId: z.coerce.number().int().positive(),
  containerTypeId: z.coerce.number().int().positive(),
  direction: z.enum(['LIFT_UP', 'LIFT_DOWN']),
  loadState: z.enum(['LOADED', 'EMPTY']).default('LOADED'),
  unitPrice: positiveNumeric,
  effectiveDate: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().optional().nullable(),
});

// ─── Auto freight pricing engine schemas (Phương án tính cước tự động) ──────

// Fuel price periods — one global DO-grade diesel price per period
// (`fuel_price_periods`). Adding a row = a new period; `effectiveFrom` is the
// unique business key (docx §2-A/§5-1). unitPrice is pre-VAT (12,2).
export const fuelPricePeriodSchema = z.object({
  unitPrice: positiveNumeric,
  effectiveFrom: isoDateOnlySchema,
  sourceNote: z.string().max(500).optional().nullable(),
});

// Freight rate terms — contract block per customer × route
// (`freight_rate_terms`, docx §2-B). Threshold mode is exclusive: at most ONE
// of percentage / absolute may be configured (enforced by the config route's
// beforeCreate/beforeUpdate hooks — the crud factory cannot take a refined
// schema).
export const freightRateTermSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng không hợp lệ'),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ'),
  sharePct: nonNegNumeric.default(0),
  billingKmOneWay: z.coerce.number().int().positive('Km tính cước (một chiều) phải là số nguyên dương'),
  billingKmMultiplier: nonNegNumeric.default(2),
  baseFuelPrice: positiveNumeric,
  // An unknown contractual lag is not a same-day agreement. Require an
  // explicit value, accepting the numeric strings sent by existing forms.
  fuelLagDays: z.union([z.number(), z.string().trim().min(1, 'Nhập độ trễ giá dầu đã thỏa thuận')])
    .pipe(z.coerce.number().int().min(0)),
  // Three-state threshold confirmation (20260917_11): 'UNSET' = customer has
  // not confirmed yet (never invent "always adjust"), 'NONE' = customer
  // confirmed no threshold, 'PCT'/'ABS' = confirmed threshold form.
  surchargeThresholdMode: z.enum(['UNSET', 'NONE', 'PCT', 'ABS']).default('UNSET'),
  fuelLagConfirmed: z.boolean().default(false),
  surchargeThresholdPct: positiveNumeric.optional().nullable(),
  surchargeThresholdAbs: positiveNumeric.optional().nullable(),
  effectiveDate: isoDateOnlySchema.default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().max(500).optional().nullable(),
});

// Revenue-side fuel consumption norms per vehicle size class
// (`fuel_consumption_norms`, docx §2-C). litersPerKm carries scale 4.
export const fuelConsumptionNormSchema = z.object({
  vehicleSizeClassId: z.coerce.number().int().positive('Loại xe không hợp lệ'),
  litersPerKm: positiveNumeric,
  effectiveDate: isoDateOnlySchema.default(() => new Date().toISOString().slice(0, 10)),
  note: z.string().max(500).optional().nullable(),
});

// Vehicle size class catalog (`vehicle_size_classes`) — replaces free-text
// pricing rate keys with a FK-able taxonomy (1.25T…15T, CONT20, CONT40).
export const vehicleSizeClassSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,20}$/, 'Mã loại xe chỉ gồm A-Z, 0-9, dấu chấm'),
  name: z.string().trim().min(1).max(50),
  isContainer: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

// Debit-note freight override (docx §4): the accountant may replace the frozen
// system freight with a negotiated final value. A reason is required whenever
// final != system (enforced server-side against the snapshot row).
export const freightRateOverrideSchema = z.object({
  finalDebitFreight: z.coerce.number().int().min(0).optional().nullable(),
  overrideReason: z.string().trim().max(500).optional().nullable(),
});

export const ancillaryRevenueSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  shipmentId: z.coerce.number().int().positive().optional().nullable(),
  tripId: z.coerce.number().int().positive().optional().nullable(),
  type: z.enum(['LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER']),
  amount: numericMoney,
  tax: numericMoney.optional().default(0),
  date: z.string().min(1).default(() => new Date().toISOString().slice(0, 10)),
  documentRef: z.string().max(100).optional().nullable(),
  note: z.string().optional().nullable(),
});

export const companyInfoSchema = z.object({
  name: z.string().trim().min(1, 'Tên công ty là bắt buộc'),
  shortName: z.string().trim().min(1, 'Tên ngắn là bắt buộc').max(255).optional(),
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc'),
  taxCode: z.string().trim().min(1, 'Mã số thuế là bắt buộc'),
  representative: z.string().trim().min(1, 'Người đại diện là bắt buộc'),
  // Chức vụ is optional: a sole-proprietor or one-person company may not have
  // a separate representative title, and the seed `company.representative`
  // row is intentionally created without a title. The dashboard banner
  // should not nag the admin to fill a field the schema does not require.
  representativeTitle: z.string().trim().default(''),
  bankAccount: z.string().trim().min(1, 'Số tài khoản là bắt buộc'),
  bankName: z.string().trim().min(1, 'Ngân hàng là bắt buộc'),
  phone: z.string().trim().default(''),
  // Empty string stays legal — company info is optional-per-field and a
  // blank email must not disable company setup (z.email() alone rejects '').
  email: z.string().trim().email('Email không hợp lệ').or(z.literal('')).default(''),
  logoStorageKey: z.string().nullable().optional(),
});

export const penaltyReasonSchema = z.object({
  reasonText: z.string().min(1),
  defaultAmount: nonNegNumeric,
  severity: z.enum(['low', 'mid', 'high']).default('mid'),
});

export const driverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  baseSalary: nonNegNumeric.optional(),
  salaryEffectiveDate: isoDateOnlySchema.optional().nullable(),
  socialInsurance: nonNegNumeric.optional(),
  status: z.nativeEnum(DriverStatus).optional().default(DriverStatus.ACTIVE),
  // Identity + payroll-routing fields from DriverFormModal (drivers table
  // columns since the fleet sheet import). licenseExpiryDate is ISO
  // 'YYYY-MM-DD' or null when cleared; strings arrive as undefined when blank.
  code: z.string().trim().max(50).optional().nullable(),
  idNumber: z.string().trim().max(20).optional().nullable(),
  licenseNumber: z.string().trim().max(20).optional().nullable(),
  licenseExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  bankName: z.string().trim().max(160).optional().nullable(),
  bankAccount: z.string().trim().max(80).optional().nullable(),
  salaryType: z.string().trim().max(50).optional().nullable(),
});

export const managementFeeSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000),
  amount: nonNegNumeric,
});

// Cap-table snapshot. The application drives ownership through `percentage`
// (0–100); `contributionAmount` is optional book-keeping kept here so the
// schema matches the underlying table without forcing every CRUD payload
// to supply it.
export const capTableSchema = z.object({
  partnerName: z.string().min(1),
  percentage: z.union([z.number(), z.string()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (v >= 0 && v <= 100), { message: 'Tỷ lệ phải trong khoảng 0–100' }),
  contributionAmount: z.union([z.number(), z.string()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || v >= 0, { message: 'Số tiền góp vốn không hợp lệ' }),
  effectiveDate: z.string().min(1),
});

// F3 — per-vehicle cap-table write. `truckId` scopes the entry to a truck;
// `percentage` is the explicit owner share (0–100) of that truck's profit.
// B2 — `role` labels the partner (INVESTOR capital partner [default] or
// DRIVER driver-contributor). The split math is owner-agnostic; role only
// labels the row for UI display.
export const truckCapSchema = z.object({
  truckId: z.union([z.number(), z.string()]).transform(v => Number(v))
    .refine(v => Number.isInteger(v) && v > 0, { message: 'truckId không hợp lệ' }),
  partnerName: z.string().min(1),
  percentage: z.union([z.number(), z.string()]).transform(v => Number(v))
    .refine(v => v >= 0 && v <= 100, { message: 'Tỷ lệ phải trong khoảng 0–100' }),
  role: z.enum(['INVESTOR', 'DRIVER']).default('INVESTOR'),
  effectiveDate: z.string().min(1),
});

// ─── Salary Period ──────────────────────────────────────────────────────────────

/** Per-month salary period override */
export const salaryPeriodSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  label: z.string().optional(),
});

/** Global default salary period configuration */
export const salaryPeriodDefaultSchema = z.object({
  defaultStartDay: z.number().int().min(1).max(28),
  defaultEndDay: z.number().int().min(1).max(31),
});

// ─── Supplier & Expense ────────────────────────────────────────────────────────

const supplierTypeSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
  z.nativeEnum(SupplierType),
);

export const supplierSchema = z.object({
  name: z.string().min(1),
  // Short operational label (mã nội bộ / tên ngắn). Optional input: blank or
  // missing falls back to `name` at the write boundary; operational surfaces
  // display it while legal/report projections keep the full name.
  shortName: z.string().trim().min(1, 'Tên ngắn là bắt buộc').max(255).optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  taxCode: z.string().trim().max(20, 'Mã số thuế tối đa 20 ký tự').optional(),
  note: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  linkedCustomerId: z.number().int().positive().optional().nullable(),
  isFuelSupplier: z.boolean().optional().default(false),
  // Accept case-insensitive canonical values, but reject unknown categories at
  // the public boundary so a typo cannot silently remove a requested type.
  types: z.array(supplierTypeSchema).optional().nullable(),
  primaryType: supplierTypeSchema.optional().nullable(),
  // O2C rev1 §B0: dual payment terms. Chi-hộ disbursements vs freight/cước.
  // 0–365 days, nullable (NULL = unset → ledger paymentTermDaysApplied null).
  chiHoDueDays: z.number().int().min(0).max(365).optional().nullable(),
  cuocDueDays: z.number().int().min(0).max(365).optional().nullable(),
});

export const expenseCategorySchema = z.object({
  name: z.string().min(1),
  isRenewable: z.boolean().optional().default(false),
  reminderLeadDays: z.number().int().positive().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

// Clear optional dates with "" → null. Nonempty values must be real calendar
// dates so invalid input is rejected before reaching a Postgres date column.
const optionalIsoDate = z
  .union([z.literal('').transform(() => null), isoDateOnlySchema])
  .optional()
  .nullable();

export const expenseSchema = z.object({
  expenseDate: isoDateOnlySchema,
  supplierId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  vehicleComponent: z.enum(['TRUCK', 'TRAILER']).optional().default('TRUCK'),
  amount: positiveNumeric,
  paymentStatus: z.enum(['PAID', 'UNPAID']),
  validFrom: optionalIsoDate,
  validTo: optionalIsoDate,
  receiptId: z.string().optional(),
  note: z.string().optional(),
});

export const vendorPaymentSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  receiptId: z.string().min(1),
  amount: positiveNumeric,
  date: z.string().min(1),
  confirmOverpay: z.boolean().optional(),
  /** KP-075: explicit per-expense allocations with amounts. Each allocation
   *  records how much of this payment is applied to a specific expense.
   *  An expense flips PAID only when its total allocations cover its amount. */
  allocations: z.array(z.object({
    expenseId: z.coerce.number().int().positive(),
    amount: positiveNumeric,
  })).max(200).optional(),
});

// ─── Forwarder catalogs ──────────────────────────────────────────────────────

export const containerTypeSchema = z.object({
  code: z.string().min(1, 'Mã loại container không được để trống').max(20),
  name: z.string().min(1, 'Tên loại container không được để trống').max(50),
  notes: z.string().optional().nullable(),
});

export const sealTypeSchema = z.object({
  name: z.string().min(1, 'Tên loại seal không được để trống').max(50),
  notes: z.string().optional().nullable(),
});

/** Dispatch-zone taxonomy row (dispatch_zones). Codes are stable identifiers
 *  referenced by ports.dispatch_zone and stored client-side — immutable after
 *  create; only label/sortOrder/isActive are editable. */
export const dispatchZoneSchema = z.object({
  code: z.string().trim()
    .regex(/^[A-Z][A-Z0-9_]{1,31}$/, 'Mã khu vực phải là chữ hoa/snake (VD: LACH_HUYEN)'),
  label: z.string().trim().min(1, 'Tên khu vực không được để trống').max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

/** Update payload: `code` is stripped (immutable after create — the route
 *  400s on an explicit differing code instead of silently ignoring it). */
export const dispatchZoneUpdateSchema = dispatchZoneSchema.omit({ code: true });

export const portSchema = z.object({
  // Zone codes are DB-owned (dispatch_zones) — shape-check only here; the
  // route validates the value against the live taxonomy.
  dispatchZone: z.string().max(32).optional().nullable(),
  name: z.string().min(1, 'Tên cảng/bãi không được để trống').max(255),
  shortName: z.string().max(255).optional().nullable(),
  code: z.string().max(20).optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** Carrier facet key for the master plan: own fleet, one external carrier,
 *  or fulfillments with no planned carrier yet. */
export const dispatchCarrierKeySchema = z.string().regex(
  /^(OWN|UNASSIGNED|EXTERNAL:[1-9]\d*)$/,
  'Giá trị lọc nhà xe không hợp lệ',
);

/** Fulfillment classification, derived from the shared vocabulary. */
export const dispatchClassificationSchema = z.enum(DISPATCH_CLASSIFICATIONS);

/** One atomic detailed-plan save: carrier, vehicle, estimates and
 *  classification change together or not at all. Both versions are
 *  required so omitted stale values cannot erase concurrent work. */
export const atomicDispatchPlanEditSchema = z.object({
  expectedFulfillmentVersion: z.number().int().positive(),
  expectedShipmentVersion: z.number().int().positive(),
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  externalCarrierId: z.number().int().positive().nullish(),
  truckId: z.number().int().positive().nullish(),
  externalCarrierVehicleId: z.number().int().positive().nullish(),
  plateNumber: z.string().trim().min(1).max(20).nullish(),
  clearVehicle: z.boolean().optional(),
  plannedRevenue: z.number().int().nonnegative().nullable(),
  plannedCarrierCost: z.number().int().nonnegative().nullable(),
  /** Per-row Phân loại (Đơn/Kẹp/Kết hợp/Lẻ). The dispatcher's call for cont
   *  rows (Đơn/Kẹp/Kết hợp) since 2026-09-08; CUS sets it at intake and LCL
   *  rows keep Lẻ. Undefined = unchanged. */
  classification: dispatchClassificationSchema.optional(),
  /** Lot-level `shipments.is_combined`. Owned by the CUS create/quick-edit
   *  surface, not by this per-container dispatch editor: one container's
   *  dispatcher must not silently rewrite a flag that spans the whole lot.
   *  Optional and omitted by the editor — the stored value is left untouched.
   *  The dispatch route strips it even when a caller sends it explicitly. */
  isCombined: z.boolean().optional(),
  /** Driver-facing note (shipments.operational_notes). Optional: an editor
   *  save that touches only plan fields omits it and the stored note stays
   *  untouched. '' clears the note; null ≡ '' for change detection. */
  operationalNotes: z.string().max(4000).nullish(),
}).strict().superRefine((value, ctx) => {
  if (value.carrierType === 'OWN' && value.externalCarrierId != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalCarrierId'], message: 'Xe nội bộ không dùng mã nhà xe ngoài.' });
  }
  if (value.carrierType === 'EXTERNAL' && value.externalCarrierId == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['externalCarrierId'], message: 'Nhà xe ngoài là bắt buộc.' });
  }
  const vehicleFields = [value.truckId, value.externalCarrierVehicleId, value.plateNumber]
    .filter((field) => field != null && field !== '');
  if (value.clearVehicle === true && vehicleFields.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clearVehicle'], message: 'Không vừa xóa xe vừa chọn xe mới.' });
  }
  if (vehicleFields.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['plateNumber'], message: 'Chỉ chọn một nguồn biển số.' });
  }
  if (value.carrierType === 'OWN' && (value.externalCarrierVehicleId != null || value.plateNumber != null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['truckId'], message: 'Nhà xe nội bộ không dùng biển số tự do hoặc xe nhà thầu.' });
  }
  if (value.carrierType === 'EXTERNAL' && value.truckId != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['truckId'], message: 'Nhà xe ngoài không dùng xe nội bộ.' });
  }
});

// ─── Forwarder ──────────────────────────────────────────────────────────────

export const tripContainerSchema = z.object({
  tripId: z.coerce.number().int().positive(),
  containerTypeId: z.coerce.number().int().positive().optional().nullable(),
  containerNumber: z.string().max(50, 'Số container không được quá 50 ký tự').optional().nullable().transform(v => (v === '' ? null : v)),
  sealNumber: z.string().max(20, 'Số seal không được quá 20 ký tự').optional().nullable(),
  cargoWeightKg: nonNegNumeric.optional().nullable(),
  notes: z.string().optional().nullable(),
  // Phase 2: optional initial seals list (customs seal, carrier seal, …).
  // When present, each entry becomes a row in trip_container_seals.
  seals: z.lazy(() => z.array(tripContainerSealSchema)).optional(),
});

// ISO 6346 gate for container-number writes: every surface that can put a
// container number into the database (add-to-trip routes, the driver patch
// path, and the batch trip-edit PUT) validates format + check digit on the
// NORMALIZED number so a malformed identifier ('ABC') can never persist as a
// container or become a cost-allocation group. The FE advisory stays as UX,
// but the persistence boundary is strong on all routes. A bad check digit
// REJECTS — correction is an explicit user action (the FE offers a one-tap
// suggestion), never a silent auto-correct.


/** Add-container payload with the shared ISO 6346 gate — the number is
 *  REQUIRED and must pass format + check digit on the normalized form. */
export const validatedTripContainerSchema = tripContainerSchema
  .refine(
    (container) => Boolean(container.containerNumber?.trim()),
    { path: ['containerNumber'], message: 'Số container không được để trống' },
  )
  .refine(
    (container) => validateContainerFormat(container.containerNumber ?? ''),
    { path: ['containerNumber'], message: 'Số container sai định dạng (4 chữ cái + 7 số).' },
  )
  .refine(
    (container) => {
      const normalized = normalizeContainerNumber(container.containerNumber ?? '');
      return !normalized || validateCheckDigit(normalized);
    },
    { path: ['containerNumber'], message: 'Số container sai chữ số kiểm tra — kiểm tra lại.' },
  );

// ─── Multi-seal (Phase 2) ───────────────────────────────────────────────
// A container can have multiple seals (customs seal, carrier seal, etc.).
// sealType is a free-form string ("Customs", "Carrier", …) — no enum, since
// drivers may write whatever label fits. Each seal is its own row in
// trip_container_seals and may carry its own photo (via trip_photos.trip_container_id).
export const tripContainerSealSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  sealNumber: z.string().min(1, 'Số seal không được để trống').max(50),
  sealType: z.string().max(30).optional().nullable().transform(v => (v === '' ? null : v)),
  notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
});

// Patch payload used by the driver when correcting an existing container
// (Sửa / change number / re-photo). All fields optional; only the fields the
// driver actually sends will be updated on the row.
export const tripContainerPatchSchema = z.object({
  containerTypeId: z.coerce.number().int().positive().optional().nullable(),
  containerNumber: z.string().max(50, 'Số container không được quá 50 ký tự').optional().nullable().transform(v => (v === '' ? null : v)),
  sealNumber: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  cargoWeightKg: nonNegNumeric.optional().nullable(),
  notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  // New seals to add. Driver one-at-a-time flow sends a single-element list;
  // office flow may send many. Existing seals are reconciled via the
  // dedicated PUT /seals endpoint, not this patch.
  addSeals: z.array(tripContainerSealSchema).optional(),
});

/** Optional-number ISO 6346 gate shared by every surface that may legally
 *  omit or clear the container number (driver patch, batch trip-edit PUT):
 *  blank/null stays legal, but any value present must pass format + check
 *  digit on the normalized form. Refines see the POST-transform value — the
 *  '' → null property transform runs first, so an empty string reads as a
 *  clear, not a malformed value.
 *
 *  Generic stays ZodTypeAny with NO explicit return type: a narrower
 *  constraint or a declared ZodEffects<...> return clamps the chained
 *  refinement inference and breaks downstream consumers that read sibling
 *  fields (containerTypeId/seals/…) off the parsed output. */
function withOptionalContainerNumberGate<S extends z.ZodTypeAny>(schema: S) {
  return schema
    .refine(
      (container) => container.containerNumber == null || Boolean(container.containerNumber.trim()),
      { path: ['containerNumber'], message: 'Số container không được để trống' },
    )
    .refine(
      (container) => {
        const value = container.containerNumber;
        if (value == null || !value.trim()) return true;
        return validateContainerFormat(value);
      },
      { path: ['containerNumber'], message: 'Số container sai định dạng (4 chữ cái + 7 số).' },
    )
    .refine(
      (container) => {
        const value = container.containerNumber;
        if (value == null || !value.trim()) return true;
        return validateCheckDigit(normalizeContainerNumber(value));
      },
      { path: ['containerNumber'], message: 'Số container sai chữ số kiểm tra — kiểm tra lại.' },
    );
}

/** Patch-container payload with the same gate — number optional, but any
 *  value present must pass (clearing to null stays legal). */
export const validatedTripContainerPatchSchema = withOptionalContainerNumberGate(tripContainerPatchSchema);


// Batch upsert payload used by the trip-edit form: the client sends the full
// desired list of container instances for a trip, and the backend reconciles
// (insert new, update existing by id, delete the rest). Each container may
// carry a full seals[] list, reconciled the same way by id. sealNumber
// (scalar) is kept for back-compat — when seals[] is absent, backend writes
// the scalar value as the container's first seal row. The number is optional
// (type-only rows are legal) but gated with the SAME shared refines as the
// driver patch path — the batch endpoint is the admin/dispatch persistence
// boundary and can no longer persist a malformed identifier that the
// driver/forwarder surfaces would reject.
const tripContainerBatchElementSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  containerTypeId: z.coerce.number().int().positive().optional().nullable(),
  containerNumber: z.string().max(50, 'Số container không được quá 50 ký tự').optional().nullable().transform(v => (v === '' ? null : v)),
  sealNumber: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  cargoWeightKg: nonNegNumeric.optional().nullable(),
  notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  seals: z.array(tripContainerSealSchema).optional(),
});

export const tripContainerBatchSchema = z.object({
  expectedVersion: z.coerce.number().int().positive().optional(),
  containers: z.array(withOptionalContainerNumberGate(tripContainerBatchElementSchema)),
});

// Full reconcile payload for one container's seals. PUT /containers/:id/seals
// accepts this — incoming seals[] becomes the desired full list (matched by
// id; the rest are inserted; missing existing ids are deleted).
export const tripContainerSealBatchSchema = z.object({
  seals: z.array(tripContainerSealSchema),
});

export const ANCILLARY_EXPENSE_TYPES = [
  'LIFTING', 'LOWERING', 'WEIGHING', 'CUSTOMS',
  'INFRASTRUCTURE', 'INSPECTION', 'INSPECTION_SVC', 'OTHER',
] as const;

export type AncillaryExpenseType = typeof ANCILLARY_EXPENSE_TYPES[number];

export const noInvoiceEvidenceTypeSchema = z.enum(NO_INVOICE_EVIDENCE_TYPES);
export const noInvoiceEvidenceTypesSchema = z.array(noInvoiceEvidenceTypeSchema)
  .max(NO_INVOICE_EVIDENCE_TYPES.length)
  .transform((values) => Array.from(new Set(values)));

export const baseTripExpenseSchema = z.object({
  tripId: z.coerce.number().int().positive(),
  // Shape only — semantic validity (active catalog code ∪ seeded legacy
  // codes) is asserted at the route against forwarder_expense_types; the
  // old fixed enum rejected configured categories at save time.
  expenseType: z.string().trim().min(1).max(50),
  buyAmount: z.number().positive(),
  sellAmount: z.number().min(0).optional().default(0),
  settlementMethod: z.enum(['COMPANY_DIRECT', 'OPS_ADVANCE']).default('OPS_ADVANCE'),
  supplierId: z.number().int().positive().optional(),
  forwarderId: z.number().int().positive().optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày chi không hợp lệ').optional(),
  payeeName: z.string().trim().max(200).optional(),
  invoiceNumber: z.string().max(50).optional(),
  invoiceDate: z.string().optional(),
  declarationNumber: z.string().max(50).optional(),
  containerNumber: z.string().max(20).optional(),
  /** B5: authoritative container FK (id of a trip_containers row on this trip).
   *  When present the server mirrors `containerNumber` from it so the label
   *  can never drift from a real container. */
  tripContainerId: z.number().int().positive().nullish(),
  /** Tariff selectors for lift/lower expenses. The server derives direction
   *  from expenseType and verifies containerTypeId against tripContainerId. */
  portId: z.number().int().positive().optional(),
  containerTypeId: z.number().int().positive().optional(),
  loadState: z.enum(['LOADED', 'EMPTY']).optional(),
  note: z.string().optional(),
  noInvoiceEvidenceTypes: noInvoiceEvidenceTypesSchema.optional(),
});

export const tripExpenseSchema = baseTripExpenseSchema.superRefine((data, ctx) => {
  if (data.settlementMethod === 'OPS_ADVANCE' && !data.forwarderId) {
    ctx.addIssue({
      code: 'custom',
      path: ['forwarderId'],
      message: 'Cần chọn nhân viên giao nhận cho khoản chi hộ tạm ứng',
    });
  }
  if (data.expenseType === 'CUSTOMS' && !data.declarationNumber) {
    ctx.addIssue({
      code: 'custom',
      path: ['declarationNumber'],
      message: 'Số tờ khai là bắt buộc cho phí hải quan',
    });
  }
  if (!data.invoiceNumber?.trim()) {
    const requiredNoInvoiceFields = [
      ['expenseDate', data.expenseDate, 'Ngày chi là bắt buộc khi không có hóa đơn'],
      ['payeeName', data.payeeName?.trim(), 'Người nhận là bắt buộc khi không có hóa đơn'],
      ['note', data.note?.trim(), 'Lý do chi là bắt buộc khi không có hóa đơn'],
    ] as const;
    for (const [path, value, message] of requiredNoInvoiceFields) {
      if (!value) ctx.addIssue({ code: 'custom', path: [path], message });
    }
    if (!data.noInvoiceEvidenceTypes?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['noInvoiceEvidenceTypes'],
        message: 'Cần chọn ít nhất một loại chứng cứ thay thế khi không có hóa đơn',
      });
    }
  }
});

export const forwarderExpenseTypeSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1, 'Tên loại chi phí không được để trống').max(100),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  // Card 20260919_3: explicit settlement category — the classification READS
  // this column (never name matching, which breaks retroactively on rename).
  // null = chưa phân loại → renders in the on-screen catch-all bucket.
  category: z.nativeEnum(ExpenseTypeCategory).nullable().optional(),
  requiresInvoice: z.boolean().optional(),
  substituteEvidenceAllowed: z.boolean().optional(),
  noInvoiceEvidenceTypes: noInvoiceEvidenceTypesSchema.optional(),
  noInvoicePerItemLimit: z.union([z.string(), z.number()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (Number.isFinite(v) && v >= 0), {
      message: 'Ngưỡng mỗi khoản phải là số không âm',
    }),
  noInvoicePerDayLimit: z.union([z.string(), z.number()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (Number.isFinite(v) && v >= 0), {
      message: 'Ngưỡng mỗi ngày phải là số không âm',
    }),
  defaultMarkup: z.boolean().optional(),
  billingLabel: z.string().max(120).nullable().optional(),
  vatRate: z.union([z.string(), z.number()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (Number.isFinite(v) && v >= 0 && v <= 1), {
      message: 'Tỷ lệ VAT phải từ 0 đến 1 (VD: 0.08 cho 8%)',
    }),
});

export const debtOffsetSchema = z.object({
  customerId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  offsetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ'),
  currency: z.literal('VND').optional().default('VND'),
  note: z.string().trim().min(1, 'Lý do đối trừ không được để trống'),
  minutesReference: z.string().trim().min(1, 'Biên bản đối trừ là bắt buộc'),
  minutesDocumentHash: z.string().trim().optional().nullable(),
  // NOTE: no `amount` field — server computes min(arBalance, apBalance)
});

export const createAdvanceRequestSchema = z.object({
  amount: positiveNumeric,
  reason: z.string().min(1, 'Lý do tạm ứng không được để trống'),
});

export const advanceMutationVersionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

const positiveIds = z.array(z.coerce.number().int().positive());
const uniquePositiveIds = positiveIds
  .refine(ids => new Set(ids).size === ids.length, 'Danh sách không được chứa mục trùng lặp');
const uniquePositiveIdsMinOne = positiveIds
  .min(1, 'Phải chọn ít nhất 1 yêu cầu tạm ứng')
  .refine(ids => new Set(ids).size === ids.length, 'Danh sách không được chứa mục trùng lặp');

export const createAdvanceSettlementSchema = z.object({
  totalExpenseAmount: nonNegNumeric.optional(),
  refundAmount: nonNegNumeric.optional().default(0),
  note: z.string().optional().nullable(),
  tripExpenseIds: uniquePositiveIds.optional(),
  advanceRequestIds: uniquePositiveIdsMinOne,
});

export const updateAdvanceSettlementSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  refundAmount: nonNegNumeric,
  note: z.string().trim().max(2000).optional().nullable(),
  tripExpenseIds: uniquePositiveIds,
  advanceRequestIds: uniquePositiveIdsMinOne,
});

// ─── Trip instructions (N2 / B1.3) ─────────────────────────────────────────
// Upsert payload for PUT /api/trips/:id/instructions. All fields optional —
// omitted fields clear to null so managers can wipe guidance.
export const upsertTripInstructionsSchema = z.object({
  expectedVersion: z.coerce.number().int().positive().optional(),
  contactName: z.string().max(100).nullish(),
  // Phone renders as a tel: href on the driver page — constrain to plausible
  // dial characters to keep the href well-formed.
  contactPhone: z.string().max(20).regex(/^[0-9+()\-\s]*$/).nullish(),
  // Capped to avoid unbounded text payloads on an unbounded `text` column.
  notes: z.string().max(2000).nullish(),
});

// ─── Shipments (Wave 0 — lô hàng) ────────────────────────────────────────────
//
// Zod schemas for `/api/shipments/*`. These mirror the input shapes already
// accepted by `shipment.service.ts` so the route handler is a thin validation
// + forwarding layer. Shared here so the Wave 2 frontend can reuse the exact
// same schemas for client-side validation.

function validateShipmentDocumentReferences(
  data: { blNumber?: string | null; bookingRef?: string | null; tradeDirection?: 'IMPORT' | 'EXPORT' | null },
  ctx: z.RefinementCtx,
) {
  const hasBill = Boolean(data.blNumber?.trim());
  const hasBooking = Boolean(data.bookingRef?.trim());
  const message = 'Một lô hàng chỉ có Số Bill (hàng Nhập) hoặc Số Booking (hàng Xuất).';
  if (hasBill && hasBooking) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['blNumber'] });
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['bookingRef'] });
  } else if (data.tradeDirection === 'IMPORT' && hasBooking) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hàng Nhập dùng Số Bill, không dùng Số Booking.', path: ['bookingRef'] });
  } else if (data.tradeDirection === 'EXPORT' && hasBill) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Hàng Xuất dùng Số Booking, không dùng Số Bill.', path: ['blNumber'] });
  }
}

// Create draft shipment. `customerId` is optional for ad-hoc orders (Lệnh
// chạy ngoài — MasterDataNhaMay §4): a walk-in cuốc carries rawCustomerName
// instead. Catalog orders behave exactly as before.
const createShipmentBaseSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng không hợp lệ').optional().nullable(),
  // ── Lệnh chạy ngoài (hybrid storage, Case 2) ───────────────────────────
  isAdHoc: z.boolean().optional().default(false),
  rawCustomerName: z.string().max(255).optional().nullable(),
  rawRouteName: z.string().max(255).optional().nullable(),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
  cargoTypeId: z.coerce.number().int().positive('Loại hàng không hợp lệ').optional().nullable(),
  responsibleUnitId: z.coerce.number().int().positive().optional().nullable(),
  bookingRef: z.string().trim().max(100).optional().nullable(),
  blNumber: z.string().trim().max(100).optional().nullable(),
  tradeDirection: z.enum(['IMPORT', 'EXPORT']).optional().nullable(),
  cargoMode: z.enum(['FCL', 'LCL']).optional().nullable(),
  operationalSiteId: z.coerce.number().int().positive().optional().nullable(),
  pickupWarehouseSiteId: z.coerce.number().int().positive().optional().nullable(),
  factoryName: z.string().max(255).optional().nullable(),
  isCombined: z.boolean().optional().default(false),
  shippingLineName: z.string().max(255).optional().nullable(),
  expectedDeliveryDate: isoDateOnlySchema.optional().nullable(),
  customsCutoffAt: shipmentTimestamp.optional().nullable(),
  closingAt: shipmentTimestamp.optional().nullable(),
  plannedReturnAt: shipmentTimestamp.optional().nullable(),
  cargoWeightKg: shipmentWeightKg.optional().nullable(),
  cargoVolumeCbm: shipmentVolumeCbm.optional().nullable(),
  packageCount: shipmentPackageCount.optional().nullable(),
  packageType: z.string().max(100).optional().nullable(),
  driverNotes: z.string().max(4000).optional().nullable(),
  /** @deprecated Use driverNotes for shipment write requests. */
  operationalNotes: z.string().max(4000).optional().nullable(),
  customerNotes: z.string().max(4000).optional().nullable(),
  pickupLocation: z.string().max(255).optional().nullable(),
  deliveryLocation: z.string().max(255).optional().nullable(),
  contactName: z.string().max(100).optional().nullable(),
  contactPhone: z.string().max(20).optional().nullable(),
});

function validateShipmentAdHocIdentity(
  data: { customerId?: number | null; isAdHoc?: boolean; rawCustomerName?: string | null },
  ctx: z.RefinementCtx,
) {
  // Catalog orders keep the historical hard requirement; ad-hoc orders
  // (Lệnh chạy ngoài) substitute a free-text customer name (Case 2).
  if (data.customerId == null) {
    if (!data.isAdHoc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Khách hàng là bắt buộc.', path: ['customerId'] });
    } else if (!data.rawCustomerName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Lệnh chạy ngoài cần tên khách hàng (text tự do).', path: ['rawCustomerName'] });
    }
  }
}

export const createShipmentSchema = createShipmentBaseSchema.superRefine((data, ctx) => {
  validateShipmentDocumentReferences(data, ctx);
  validateShipmentAdHocIdentity(data, ctx);
});

// Quick create — M10.1 clerk mobile entry point. Minimum data set is just
// `customerId` (the only NOT NULL column); every other field is optional
// and typically filled later from the M10.2 doc-entry page. Optional
// `_requestId` mirrors the `Idempotency-Key` header so a request generated
// by the offline-queue client lib can carry its dedupe token in the body
// when headers are not convenient (e.g. multipart). The header wins when
// both are present; see `routes/shipments.ts` POST /quick.
export const shipmentContainerItemSchema = z.object({
    id: z.coerce.number().int().positive().optional(),
    // DEF-20260804-003: containerTypeId is required (not nullable) for any
    // shipment container reconciliation. Carrier-allocation downstream needs
    // the size bucket (20/40/45) — null causes "20' 0/0, 40' 0/0" mismatch
    // even when containerNumber + ISO check digit are valid.
    containerTypeId: z.coerce.number().int().positive('Loại container là bắt buộc'),
    containerNumber: z.string().max(50, 'Số container không được quá 50 ký tự').optional().nullable()
      .transform(v => (v === '' ? null : v)),
    sealNumber: z.string().max(50).optional().nullable().transform(v => (v === '' ? null : v)),
    cargoWeightKg: shipmentWeightKg.optional().nullable(),
    cargoVolumeCbm: shipmentVolumeCbm.optional().nullable(),
    shippingLineName: z.string().trim().max(255).optional().nullable()
      .transform(v => (v === '' ? null : v)),
    // FCL route authority belongs to this container, not the shipment.
    routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
    pickupPortId: z.coerce.number().int().positive().optional().nullable(),
    dropoffPortId: z.coerce.number().int().positive().optional().nullable(),
    // Ad-hoc orders (Lệnh chạy ngoài): free-text cảng nâng/hạ when no catalog
    // port was picked — XOR with the ids above, normalized server-side.
    rawPickupPortName: z.string().max(255).optional().nullable().transform(v => (v === '' ? null : v)),
    rawDropoffPortName: z.string().max(255).optional().nullable().transform(v => (v === '' ? null : v)),
    // Ad-hoc row-tier factory/route (§4.2): free text when no catalog
    // factory/route was picked on this container — XOR with operationalSiteId
    // and routeId above, normalized server-side the same way.
    rawFactoryName: z.string().max(255).optional().nullable().transform(v => (v === '' ? null : v)),
    rawRouteName: z.string().max(255).optional().nullable().transform(v => (v === '' ? null : v)),
    // Per-container factory authority (SILVER L1): nullable, application-
    // validated at the persistence choke point — no DB FK by repo convention.
    operationalSiteId: z.coerce.number().int().positive().optional().nullable(),
    // Ngày đóng/trả container (doc: Create Shipment Block 2, per-container date).
    customerAppointmentAt: shipmentTimestamp.optional().nullable(),
    notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  });

// Create-workspace combined contract: root + containers in ONE idempotent
// call - a containers failure rolls back the whole create.
export const quickCreateShipmentSchema = createShipmentBaseSchema.extend({
  declarationNumber: z.string().trim().max(50).optional().nullable(),
  _requestId: z.string().min(1).max(100).optional(),
  // Create-workspace combined save: containers ride the idempotent create
  // call so a containers failure rolls back the root with it (no 0-cont
  // orphan lots).
  containers: z.array(shipmentContainerItemSchema).optional(),
}).superRefine((data, ctx) => {
  validateShipmentDocumentReferences(data, ctx);
  validateShipmentAdHocIdentity(data, ctx);
});

// Update shipment. `expectedVersion` is the canonical optimistic-lock field;
// legacy callers may still send `version` and are normalized onto
// `expectedVersion` here. All other fields are optional and use the
// `!== undefined` convention so callers can patch a subset.
export const updateShipmentSchema = z.object({
  expectedVersion: z.number().int().nonnegative('expectedVersion là bắt buộc để kiểm soát đồng thời').optional(),
  version: z.number().int().nonnegative('version là bắt buộc để kiểm soát đồng thời').optional(),
  customerId: z.coerce.number().int().positive().optional(),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
  cargoTypeId: z.coerce.number().int().positive('Loại hàng không hợp lệ').optional().nullable(),
  responsibleUnitId: z.coerce.number().int().positive().optional().nullable(),
  bookingRef: z.string().trim().max(100).nullish(),
  blNumber: z.string().trim().max(100).nullish(),
  tradeDirection: z.enum(['IMPORT', 'EXPORT']).nullish(),
  cargoMode: z.enum(['FCL', 'LCL']).nullish(),
  operationalSiteId: z.coerce.number().int().positive().nullish(),
  pickupWarehouseSiteId: z.coerce.number().int().positive().nullish(),
  factoryName: z.string().max(255).nullish(),
  isCombined: z.boolean().optional(),
  shippingLineName: z.string().max(255).nullish(),
  expectedDeliveryDate: isoDateOnlySchema.nullish(),
  customsCutoffAt: shipmentTimestamp.nullish(),
  closingAt: shipmentTimestamp.nullish(),
  plannedReturnAt: shipmentTimestamp.nullish(),
  cargoWeightKg: shipmentWeightKg.optional().nullable(),
  cargoVolumeCbm: shipmentVolumeCbm.optional().nullable(),
  packageCount: shipmentPackageCount.optional().nullable(),
  packageType: z.string().max(100).nullish(),
  driverNotes: z.string().max(4000).nullish(),
  /** @deprecated Use driverNotes for shipment write requests. */
  operationalNotes: z.string().max(4000).nullish(),
  customerNotes: z.string().max(4000).nullish(),
  pickupLocation: z.string().max(255).nullish(),
  deliveryLocation: z.string().max(255).nullish(),
  contactName: z.string().max(100).nullish(),
  contactPhone: z.string().max(20).nullish(),
}).superRefine((data, ctx) => {
  if (data.expectedVersion == null && data.version == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expectedVersion là bắt buộc để kiểm soát đồng thời',
      path: ['expectedVersion'],
    });
  }
  validateShipmentDocumentReferences(data, ctx);
}).transform(({ expectedVersion, version, ...rest }) => ({
  ...rest,
  expectedVersion: expectedVersion ?? version ?? 0,
}));

// Status transition. The service is the source of truth for legal edges; the
// schema only validates the shape and the enum value.
export const transitionShipmentStatusSchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  reason: z.string().max(500).optional().nullable(),
});

// Shipment document upload. The file itself goes through `/api/upload`; this
// endpoint records the metadata row referencing the storage key. Multipart
// upload is a Wave 2 portal concern.
export const attachShipmentDocumentSchema = z.object({
  type: z.nativeEnum(ShipmentDocumentType),
  storageKey: z.string().min(1, 'storageKey là bắt buộc').max(255),
});

// Full reconcile of shipment containers — same shape contract as
// `tripContainerBatchSchema`: incoming `containers[]` becomes the desired full
// list (insert new, update by id, delete the rest).
export const shipmentContainerBatchSchema = z.object({
  expectedVersion: z.number().int().nonnegative('expectedVersion là bắt buộc để kiểm soát đồng thời').optional(),
  version: z.number().int().nonnegative('version là bắt buộc để kiểm soát đồng thời').optional(),
  containers: z.array(shipmentContainerItemSchema),
}).superRefine((data, ctx) => {
  if (data.expectedVersion == null && data.version == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'expectedVersion là bắt buộc để kiểm soát đồng thời',
      path: ['expectedVersion'],
    });
  }
}).transform(({ expectedVersion, version, containers }) => ({
  expectedVersion: expectedVersion ?? version ?? 0,
  containers,
}));

// Dispatch a shipment → create a linked trip. Fulfillment-time fields
// (route/cargo/container-type/truck/driver) are NOT on the shipment per the
// phase-01 architecture; they are provided at dispatch. `createTripCommand`
// requires customerId + routeId + cargoTypeId + containerTypeId; the rest are
// optional. truckId/driverId may be null for external carriers.
export const dispatchShipmentSchema = z.object({
  routeId: z.coerce.number().int().positive('Tuyến đường là bắt buộc khi điều vận'),
  cargoTypeId: z.coerce.number().int().positive('Loại hàng là bắt buộc khi điều vận'),
  containerTypeId: z.coerce.number().int().positive('Loại container là bắt buộc khi điều vận'),
  pricingRateKey: z.string().trim().max(32).optional().nullable().transform(v => (v == null || v === '' ? null : v.toUpperCase())),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  driverId: z.coerce.number().int().positive().optional().nullable(),
  departureDate: z.string().min(1, 'Ngày khởi hành là bắt buộc'),
  customerReference: z.string().optional(),
  containerCount: z.coerce.number().int().min(1).max(10).optional(),
  creditApprovalRequestId: z.coerce.number().int().positive().optional().nullable(),
  creditException: directCreditExceptionSchema.optional(),
  fuelMode: z.nativeEnum(FuelMode).optional(),
});

export const operationalSiteSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng là bắt buộc'),
  code: z.string().trim().min(1, 'Mã điểm vận hành là bắt buộc').max(80),
  name: z.string().trim().min(1, 'Tên điểm vận hành là bắt buộc').max(255),
  shortName: z.string().trim().min(1, 'Tên ngắn là bắt buộc').max(255).optional(),
  siteType: z.nativeEnum(OperationalSiteType),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc').max(2000),
  googleMapsUrl: z.string().url('Liên kết Google Maps không hợp lệ').max(2000).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  liftFeeInvoiceName: z.string().trim().max(255).optional().nullable(),
  liftFeeInvoiceAddress: z.string().trim().max(2000).optional().nullable(),
  liftFeeTaxCode: z.string().trim().max(40).optional().nullable(),
  strictRules: z.string().trim().max(8000).optional().nullable(),
  isActive: z.boolean().optional(),
}).superRefine((input, ctx) => {
  if (input.siteType === OperationalSiteType.FACTORY && input.routeId == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Nhà máy cần được liên kết với một tuyến đường.',
      path: ['routeId'],
    });
  }
  if (input.siteType === OperationalSiteType.WAREHOUSE && input.routeId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Kho lấy hàng không dùng tuyến đường của nhà máy.',
      path: ['routeId'],
    });
  }
});

// Admin master-data maintenance of a customer-owned factory/warehouse.
// Partial by design: only present fields update; identity (customerId, code,
// siteType) is immutable here — re-owning or re-typing a site is a governance
// decision outside this surface. The FACTORY↔route invariant is re-checked
// against the merged row in the service (zod cannot see the stored row).
export const operationalSiteUpdateSchema = z.object({
  expectedVersion: z.coerce.number().int().positive('Phiên bản không hợp lệ'),
  name: z.string().trim().min(1, 'Tên điểm vận hành là bắt buộc').max(255).optional(),
  shortName: z.string().trim().min(1).max(255).optional(),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc').max(2000).optional(),
  googleMapsUrl: z.string().url('Liên kết Google Maps không hợp lệ').max(2000).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  liftFeeInvoiceName: z.string().trim().max(255).optional().nullable(),
  liftFeeInvoiceAddress: z.string().trim().max(2000).optional().nullable(),
  liftFeeTaxCode: z.string().trim().max(40).optional().nullable(),
  strictRules: z.string().trim().max(8000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export type OperationalSiteUpdateInput = z.infer<typeof operationalSiteUpdateSchema>;

export const decomposeShipmentFulfillmentsSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

export const shipmentCarrierAllocationSchema = z.object({
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  externalCarrierId: z.coerce.number().int().positive().optional().nullable(),
  count20: z.coerce.number().int().min(0).max(200).default(0),
  count40: z.coerce.number().int().min(0).max(200).default(0),
  appointmentDate: z.string().nullable().optional(),
}).superRefine((row, ctx) => {
  if (row.count20 + row.count40 < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mỗi nhà xe phải được gán ít nhất một container' });
  }
  if (row.carrierType === 'OWN' && row.externalCarrierId != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Xe SilverSea không dùng mã nhà xe ngoài', path: ['externalCarrierId'] });
  }
  if (row.carrierType === 'EXTERNAL' && row.externalCarrierId == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nhà xe ngoài là bắt buộc', path: ['externalCarrierId'] });
  }
});

function rejectDuplicateCarrierAllocations(
  input: { carrierAllocations: Array<z.infer<typeof shipmentCarrierAllocationSchema>> },
  ctx: z.RefinementCtx,
) {
  const hasDates = input.carrierAllocations.some((row) => Boolean(row.appointmentDate));
  const keys = input.carrierAllocations.map((row) => {
    const carrier = row.carrierType === 'OWN' ? 'OWN' : `EXTERNAL:${row.externalCarrierId}`;
    return hasDates ? `${row.appointmentDate ?? ''}:${carrier}` : carrier;
  });
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: hasDates
        ? 'Mỗi nhà xe chỉ được xuất hiện một lần trong cùng một ngày'
        : 'Mỗi nhà xe chỉ được xuất hiện một lần',
      path: ['carrierAllocations'],
    });
  }
}

export const assignShipmentCarriersSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  carrierAllocations: z.array(shipmentCarrierAllocationSchema).max(50),
}).superRefine(rejectDuplicateCarrierAllocations);

export const submitShipmentForDispatchSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  priority: z.enum(['NORMAL', 'URGENT']).optional(),
  vehicleNeededBy: shipmentTimestamp.optional().nullable(),
  operationalNote: z.string().trim().max(2000).optional().nullable(),
  carrierAllocations: z.array(shipmentCarrierAllocationSchema).max(50).optional().default([]),
}).superRefine(rejectDuplicateCarrierAllocations);

export const carrierFleetVehicleSchema = z.object({
  carrierId: z.coerce.number().int().positive('Nhà xe là bắt buộc'),
  licensePlate: z.string().trim().min(1, 'Biển số xe là bắt buộc').max(20),
  isActive: z.boolean().optional().default(true),
});

export const shipmentAccountingLockSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  billingDocumentId: z.coerce.number().int().positive('Debit Note là bắt buộc'),
  reason: z.string().trim().min(1, 'Lý do khóa lô là bắt buộc').max(2000),
});

export const cancelShipmentFulfillmentSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(1, 'Lý do hủy là bắt buộc').max(2000),
  disposition: z.nativeEnum(FulfillmentCancellationDisposition),
});

export const tripPodFileMetadataSchema = z.object({
  fileType: z.nativeEnum(TripPodFileType),
  storageKey: z.string().trim().min(1).max(255),
  originalFileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Mã kiểm tra tệp không hợp lệ'),
});

// ─── Inferred types ──────────────────────────────────────────────────────────

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type CreateTripPairInput = z.infer<typeof createTripPairSchema>;
export type UpdateTripFiguresInput = z.infer<typeof updateTripFiguresSchema>;
export type BulkUpdateTripFiguresInput = z.infer<typeof bulkUpdateTripFiguresSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreatePenaltyInput = z.infer<typeof createPenaltySchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type QuickCreateShipmentInput = z.infer<typeof quickCreateShipmentSchema>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
export type TransitionShipmentStatusInput = z.infer<typeof transitionShipmentStatusSchema>;
export type AttachShipmentDocumentInput = z.infer<typeof attachShipmentDocumentSchema>;
export type ShipmentContainerBatchInput = z.infer<typeof shipmentContainerBatchSchema>;
export type DispatchShipmentInput = z.infer<typeof dispatchShipmentSchema>;
export type OperationalSiteInput = z.infer<typeof operationalSiteSchema>;
export type DecomposeShipmentFulfillmentsInput = z.infer<typeof decomposeShipmentFulfillmentsSchema>;
export type SubmitShipmentForDispatchInput = z.infer<typeof submitShipmentForDispatchSchema>;
export type AssignShipmentCarriersInput = z.infer<typeof assignShipmentCarriersSchema>;
export type CarrierFleetVehicleInput = z.infer<typeof carrierFleetVehicleSchema>;
export type ShipmentAccountingLockInput = z.infer<typeof shipmentAccountingLockSchema>;
export type CancelShipmentFulfillmentInput = z.infer<typeof cancelShipmentFulfillmentSchema>;
export type TripPodFileMetadataInput = z.infer<typeof tripPodFileMetadataSchema>;

// M8.4 — driver progress event. The driver records what actually happened on
// the road (departure/arrival/fuel/incident/note) with a client-supplied
// event time + optional note. The create endpoint is server-side idempotent
// (PRD M08-04-03 offline-safe replay).
export const driverProgressSchema = z.object({
  eventType: z.nativeEnum(DriverProgressEventType),
  // ISO 8601 timestamp of when the event occurred (driver-reported; may be
  // backdated to the actual event time). The server records `createdAt`
  // separately for record-time audit.
  occurredAt: z.string().min(1, 'Thời điểm xảy ra là bắt buộc'),
  note: z.string().max(1000).optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
});

export type DriverProgressInput = z.infer<typeof driverProgressSchema>;

// M8.4 slice 3 — driver incidental cost. The driver records an out-of-pocket
// expense (per-diem, lift fee, parking, toll, fuel, other) against a trip.
// Server-side idempotent (PRD M08-04-03 offline-safe replay).
export const driverIncidentalCostSchema = z.object({
  payerKind: z.enum(['USER', 'COMPANY']).optional(),
  ...expenseInputFields,
  costType: z.nativeEnum(DriverIncidentalCostType),
  amount: expenseVndSchema.refine(v => v > 0, 'Số tiền phải lớn hơn 0'),
  occurredAt: expenseDateSchema,
  note: z.string().max(1000).optional(),
  receiptStorageKey: z.string().max(255).optional(),
});

export type DriverIncidentalCostInput = z.infer<typeof driverIncidentalCostSchema>;

// 27.8 cost-section Ghi chú (driver-written note for accounting re-check).
// Distinct from `driverIncidentalCostSchema.note` (per-line) and from
// `shipments.operationalNotes` (cus→driver rule copy).
export const driverCostSubmissionNoteSchema = z.object({
  note: z.string().max(2000).nullable(),
});

export type DriverCostSubmissionNoteInput = z.infer<typeof driverCostSubmissionNoteSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type TruckInput = z.infer<typeof truckSchema>;
export type TrailerInput = z.infer<typeof trailerSchema>;
export type TireInput = z.infer<typeof tireSchema>;
export type InstallTireInput = z.infer<typeof installTireSchema>;
export type DisposeTireInput = z.infer<typeof disposeTireSchema>;
export type TirePositionInput = z.infer<typeof tirePositionSchema>;
export type RouteInput = z.infer<typeof routeSchema>;
export type CargoTypeInput = z.infer<typeof cargoTypeSchema>;
export type PricingTableInput = z.infer<typeof pricingTableSchema>;
export type RoadAllowanceInput = z.infer<typeof roadAllowanceSchema>;
export type FuelConfigInput = z.infer<typeof fuelConfigSchema>;
export type CompanyInfoInput = z.infer<typeof companyInfoSchema>;
export type PenaltyReasonInput = z.infer<typeof penaltyReasonSchema>;
export type DriverInput = z.infer<typeof driverSchema>;
export type ManagementFeeInput = z.infer<typeof managementFeeSchema>;
export type CapTableInput = z.infer<typeof capTableSchema>;
export type TruckCapInput = z.infer<typeof truckCapSchema>;
export type SalaryPeriodInput = z.infer<typeof salaryPeriodSchema>;
export type SalaryPeriodDefaultInput = z.infer<typeof salaryPeriodDefaultSchema>;
export type SupplierInput = z.infer<typeof supplierSchema>;
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type VendorPaymentInput = z.infer<typeof vendorPaymentSchema>;
export type TripContainerInput = z.infer<typeof tripContainerSchema>;
export type TripExpenseInput = z.infer<typeof tripExpenseSchema>;

/**
 * Partial update schema for trip expenses.
 * Nullable database fields accept an explicit null so PATCH/PUT callers can
 * clear an existing value; undefined continues to mean "leave unchanged".
 */
export const tripExpensePatchSchema = baseTripExpenseSchema
  .omit({ tripId: true })
  .partial()
  .extend({
    supplierId: z.number().int().positive().nullable().optional(),
    expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày chi không hợp lệ').nullable().optional(),
    payeeName: z.string().trim().max(200).nullable().optional(),
    invoiceNumber: z.string().max(50).nullable().optional(),
    invoiceDate: z.string().nullable().optional(),
    declarationNumber: z.string().max(50).nullable().optional(),
    containerNumber: z.string().max(20).nullable().optional(),
    tripContainerId: z.number().int().positive().nullable().optional(),
    note: z.string().nullable().optional(),
    noInvoiceEvidenceTypes: noInvoiceEvidenceTypesSchema.nullable().optional(),
  });

export const tripExpenseCompletionSchema = z.object({
  tripContainerId: z.number().int().positive().nullable(),
  completed: z.boolean(),
});

export const accountantSettlementExpensePatchSchema = tripExpensePatchSchema
  .omit({ settlementMethod: true, forwarderId: true })
  .extend({
    expectedVersion: z.coerce.number().int().positive(),
    adjustmentReason: z.string().trim().min(1, 'Cần nhập lý do điều chỉnh').max(500),
  });
export type DebtOffsetInput = z.infer<typeof debtOffsetSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateAdvanceRequestInput = z.infer<typeof createAdvanceRequestSchema>;
export type CreateAdvanceSettlementInput = z.infer<typeof createAdvanceSettlementSchema>;
export type UpdateAdvanceSettlementInput = z.infer<typeof updateAdvanceSettlementSchema>;
export type ContainerTypeInput = z.infer<typeof containerTypeSchema>;
export type SealTypeInput = z.infer<typeof sealTypeSchema>;
export type PortInput = z.infer<typeof portSchema>;
export type DispatchZoneInput = z.infer<typeof dispatchZoneSchema>;
export type GenerateBillingDocumentInput = z.infer<typeof generateBillingDocumentSchema>;
export type ParsedSaveBillingDocumentInput = z.infer<typeof saveBillingDocumentSchema>;
export type SaveBillingDocumentInput = {
  type: 'DEBIT_NOTE' | 'PAYMENT_STATEMENT';
  entityType: 'CUSTOMER' | 'VENDOR';
  entityId: number;
  entityName?: string;
  rangeFrom: string;
  rangeTo: string;
  note?: string | null;
  debitNoteTemplateId?: number | null;
  sourceRefs?: z.infer<typeof billingDocumentSourceRefSchema>[];
  /** Internal adapter for pre-contract service callers; HTTP parsing rejects it for DEBIT_NOTE. */
  lines?: z.infer<typeof billingDocumentLineSchema>[];
};
export type BillingDocumentAdjustmentRequestInput = z.infer<typeof billingDocumentAdjustmentRequestSchema>;
export type BillingDocumentIssueRequestInput = z.infer<typeof billingDocumentIssueRequestSchema>;

export type BillingDocumentLineInput = z.infer<typeof billingDocumentLineSchema>;

export * from './governance-action';
export * from './customer-service-finance';
export * from './work-inbox';
