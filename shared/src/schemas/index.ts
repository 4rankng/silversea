import { z } from 'zod';
import {
  CustomerAccountType, FuelMode, LoadingType, Role, SupplierType,
  TrailerType, TruckStatus, TrailerStatus, DriverStatus, CustomerStatus,
  ShipmentStatus, ShipmentDocumentType,
  OperationalSiteType, FulfillmentCancellationDisposition, TripPodFileType,
  DriverProgressEventType,
  DriverIncidentalCostType,
  NO_INVOICE_APPROVAL_TITLES,
  NO_INVOICE_EVIDENCE_TYPES,
  TIRE_STATUSES,
} from '../constants';

// Agent (command-and-insight assistant) wire contract — directive / widget /
// response / message / live-event schemas. Self-contained module kept separate
// from the entity-CRUD schemas below. See ./agent.ts for the design notes.
export * from './agent';
export * from './financial-reporting-policy';

// Admin LLM provider settings (MiniMax / OpenRouter selection + API keys).
// Zod update schema + response interface; used by the ADMIN-only settings route
// and the frontend config page.
export * from './llm-settings';

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

export const updateTripFiguresSchema = z.object({
  legs: z.array(tripLegSchema).min(1),
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
});

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
  phone: z.string().min(6).optional(),
  password: z.string().min(6),
  role: z.nativeEnum(Role),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
  // Driver-profile fields — only meaningful when role === DRIVER. The user
  // service uses these to create the linked `drivers` row on the same transaction.
  baseSalary: nonNegNumeric.optional(),
  socialInsurance: nonNegNumeric.optional(),
  assignedTruckId: z.number().int().positive().nullable().optional(),
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
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().min(6).or(z.literal('')).optional(),
  // Driver-profile fields — upserted onto the linked `drivers` row when the
  // resulting role is DRIVER. Optional so non-driver payloads validate unchanged.
  baseSalary: nonNegNumeric.optional(),
  socialInsurance: nonNegNumeric.optional(),
  assignedTruckId: z.number().int().positive().nullable().optional(),
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
  name: z.string().min(1),
  taxCode: z.string().optional(),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  contactInfo: z.string().optional(),
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
  status: z.nativeEnum(TruckStatus).optional().default(TruckStatus.ACTIVE),
  // N5 / A12 + B4: ISO 'YYYY-MM-DD' or null/empty. Accepted on create + update.
  nextInspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  insuranceExpiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  lastOilServiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export const trailerSchema = z.object({
  licensePlate: z.string().min(1),
  type: z.nativeEnum(TrailerType),
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
  name: z.string().min(1),
  distanceKm: positiveNumeric.optional(),
  isMountain: z.boolean().optional().default(false),
  fixedFuelAllowance: nonNegNumeric.nullable().optional(),
  tollsStations: nonNegNumeric.nullable().optional(),
  driverSalary: nonNegNumeric.nullable().optional(),
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
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc'),
  taxCode: z.string().trim().min(1, 'Mã số thuế là bắt buộc'),
  representative: z.string().trim().min(1, 'Người đại diện là bắt buộc'),
  representativeTitle: z.string().trim().min(1, 'Chức vụ là bắt buộc'),
  bankAccount: z.string().trim().min(1, 'Số tài khoản là bắt buộc'),
  bankName: z.string().trim().min(1, 'Ngân hàng là bắt buộc'),
  phone: z.string().trim().default(''),
  email: z.string().trim().default(''),
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
  assignedTruckId: z.number().int().positive().nullable().optional(),
  baseSalary: nonNegNumeric.optional(),
  socialInsurance: nonNegNumeric.optional(),
  status: z.nativeEnum(DriverStatus).optional().default(DriverStatus.ACTIVE),
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
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  taxCode: z.string().optional(),
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

// Date columns reject the empty string — normalise "" → null so the form can submit
// blank optional dates without forcing the client to strip them.
const optionalDate = z.string().optional().nullable().transform((v) => (v === '' ? null : v));

export const expenseSchema = z.object({
  expenseDate: z.string().min(1),
  supplierId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive(),
  truckId: z.coerce.number().int().positive().optional().nullable(),
  vehicleComponent: z.enum(['TRUCK', 'TRAILER']).optional().default('TRUCK'),
  amount: positiveNumeric,
  paymentStatus: z.enum(['PAID', 'UNPAID']),
  validFrom: optionalDate,
  validTo: optionalDate,
  receiptId: z.string().optional(),
  note: z.string().optional(),
});

export const vendorPaymentSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  receiptId: z.string().min(1),
  amount: positiveNumeric,
  date: z.string().min(1),
  confirmOverpay: z.boolean().optional(),
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

export const portSchema = z.object({
  name: z.string().min(1, 'Tên cảng/bãi không được để trống').max(255),
  code: z.string().max(20).optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
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

// Batch upsert payload used by the trip-edit form: the client sends the full
// desired list of container instances for a trip, and the backend reconciles
// (insert new, update existing by id, delete the rest). Each container may
// carry a full seals[] list, reconciled the same way by id. sealNumber
// (scalar) is kept for back-compat — when seals[] is absent, backend writes
// the scalar value as the container's first seal row.
export const tripContainerBatchSchema = z.object({
  expectedVersion: z.coerce.number().int().positive().optional(),
  containers: z.array(z.object({
    id: z.coerce.number().int().positive().optional(),
    containerTypeId: z.coerce.number().int().positive().optional().nullable(),
    containerNumber: z.string().max(50, 'Số container không được quá 50 ký tự').optional().nullable().transform(v => (v === '' ? null : v)),
    sealNumber: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
    cargoWeightKg: nonNegNumeric.optional().nullable(),
    notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
    seals: z.array(tripContainerSealSchema).optional(),
  })),
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
  expenseType: z.enum(ANCILLARY_EXPENSE_TYPES),
  buyAmount: z.number().positive(),
  sellAmount: z.number().min(0).optional().default(0),
  settlementMethod: z.enum(['COMPANY_DIRECT', 'FORWARDER_ADVANCE']).default('FORWARDER_ADVANCE'),
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
  if (data.settlementMethod === 'FORWARDER_ADVANCE' && !data.forwarderId) {
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
  noInvoiceFinanceLeadItemApprovalLimit: z.union([z.string(), z.number()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (Number.isFinite(v) && v >= 0), {
      message: 'Ngưỡng duyệt của tài chính phải là số không âm',
    }),
  noInvoiceDirectorDayApprovalLimit: z.union([z.string(), z.number()]).optional()
    .transform(v => v == null ? undefined : Number(v))
    .refine(v => v == null || (Number.isFinite(v) && v >= 0), {
      message: 'Ngưỡng ngày của giám đốc phải là số không âm',
    }),
  noInvoiceFinanceLeadApprovalTitle: z.enum(NO_INVOICE_APPROVAL_TITLES).optional(),
  noInvoiceDirectorApprovalTitle: z.enum(NO_INVOICE_APPROVAL_TITLES).optional(),
  noInvoicePolicyVersion: z.number().int().positive().optional(),
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

// Create draft shipment. Only `customerId` is required — everything else is
// optional booking metadata that may be filled in before dispatch.
export const createShipmentSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng là bắt buộc'),
  routeId: z.coerce.number().int().positive('Tuyến đường không hợp lệ').optional().nullable(),
  cargoTypeId: z.coerce.number().int().positive('Loại hàng không hợp lệ').optional().nullable(),
  responsibleUnitId: z.coerce.number().int().positive().optional().nullable(),
  bookingRef: z.string().max(100).optional().nullable(),
  blNumber: z.string().max(100).optional().nullable(),
  tradeDirection: z.enum(['IMPORT', 'EXPORT']).optional().nullable(),
  cargoMode: z.enum(['FCL', 'LCL']).optional().nullable(),
  operationalSiteId: z.coerce.number().int().positive().optional().nullable(),
  pickupWarehouseSiteId: z.coerce.number().int().positive().optional().nullable(),
  factoryName: z.string().max(255).optional().nullable(),
  shippingLineName: z.string().max(255).optional().nullable(),
  expectedDeliveryDate: isoDateOnlySchema.optional().nullable(),
  customsCutoffAt: shipmentTimestamp.optional().nullable(),
  closingAt: shipmentTimestamp.optional().nullable(),
  plannedReturnAt: shipmentTimestamp.optional().nullable(),
  cargoWeightKg: shipmentWeightKg.optional().nullable(),
  cargoVolumeCbm: shipmentVolumeCbm.optional().nullable(),
  packageCount: shipmentPackageCount.optional().nullable(),
  packageType: z.string().max(100).optional().nullable(),
  operationalNotes: z.string().max(4000).optional().nullable(),
  pickupLocation: z.string().max(255).optional().nullable(),
  deliveryLocation: z.string().max(255).optional().nullable(),
  contactName: z.string().max(100).optional().nullable(),
  contactPhone: z.string().max(20).optional().nullable(),
});

// Quick create — M10.1 clerk mobile entry point. Minimum data set is just
// `customerId` (the only NOT NULL column); every other field is optional
// and typically filled later from the M10.2 doc-entry page. Optional
// `_requestId` mirrors the `Idempotency-Key` header so a request generated
// by the offline-queue client lib can carry its dedupe token in the body
// when headers are not convenient (e.g. multipart). The header wins when
// both are present; see `routes/shipments.ts` POST /quick.
export const quickCreateShipmentSchema = createShipmentSchema.extend({
  _requestId: z.string().min(1).max(100).optional(),
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
  bookingRef: z.string().max(100).nullish(),
  blNumber: z.string().max(100).nullish(),
  tradeDirection: z.enum(['IMPORT', 'EXPORT']).nullish(),
  cargoMode: z.enum(['FCL', 'LCL']).nullish(),
  operationalSiteId: z.coerce.number().int().positive().nullish(),
  pickupWarehouseSiteId: z.coerce.number().int().positive().nullish(),
  factoryName: z.string().max(255).nullish(),
  shippingLineName: z.string().max(255).nullish(),
  expectedDeliveryDate: isoDateOnlySchema.nullish(),
  customsCutoffAt: shipmentTimestamp.nullish(),
  closingAt: shipmentTimestamp.nullish(),
  plannedReturnAt: shipmentTimestamp.nullish(),
  cargoWeightKg: shipmentWeightKg.optional().nullable(),
  cargoVolumeCbm: shipmentVolumeCbm.optional().nullable(),
  packageCount: shipmentPackageCount.optional().nullable(),
  packageType: z.string().max(100).nullish(),
  operationalNotes: z.string().max(4000).nullish(),
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
  containers: z.array(z.object({
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
    shippingLineName: z.string().trim().max(255).optional().nullable()
      .transform(v => (v === '' ? null : v)),
    pickupPortId: z.coerce.number().int().positive().optional().nullable(),
    dropoffPortId: z.coerce.number().int().positive().optional().nullable(),
    notes: z.string().optional().nullable().transform(v => (v === '' ? null : v)),
  })),
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
  fuelMode: z.nativeEnum(FuelMode).optional(),
});

export const operationalSiteSchema = z.object({
  customerId: z.coerce.number().int().positive('Khách hàng là bắt buộc'),
  code: z.string().trim().min(1, 'Mã điểm vận hành là bắt buộc').max(80),
  name: z.string().trim().min(1, 'Tên điểm vận hành là bắt buộc').max(255),
  siteType: z.nativeEnum(OperationalSiteType),
  address: z.string().trim().min(1, 'Địa chỉ là bắt buộc').max(2000),
  googleMapsUrl: z.string().url('Liên kết Google Maps không hợp lệ').max(2000).optional().nullable(),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  liftFeeInvoiceName: z.string().trim().max(255).optional().nullable(),
  liftFeeInvoiceAddress: z.string().trim().max(2000).optional().nullable(),
  liftFeeTaxCode: z.string().trim().max(40).optional().nullable(),
  strictRules: z.string().trim().max(8000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const decomposeShipmentFulfillmentsSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
});

export const shipmentCarrierAllocationSchema = z.object({
  carrierType: z.enum(['OWN', 'EXTERNAL']),
  externalCarrierId: z.coerce.number().int().positive().optional().nullable(),
  count20: z.coerce.number().int().min(0).max(200).default(0),
  count40: z.coerce.number().int().min(0).max(200).default(0),
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
  const keys = input.carrierAllocations.map((row) => row.carrierType === 'OWN' ? 'OWN' : `EXTERNAL:${row.externalCarrierId}`);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mỗi nhà xe chỉ được xuất hiện một lần', path: ['carrierAllocations'] });
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
  costType: z.nativeEnum(DriverIncidentalCostType),
  amount: z.number().int().positive('Số tiền phải lớn hơn 0'),
  occurredAt: z.string().min(1, 'Ngày phát sinh là bắt buộc'),
  note: z.string().max(1000).optional(),
});

export type DriverIncidentalCostInput = z.infer<typeof driverIncidentalCostSchema>;
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

// ─── Bách Khoa GPS (external third-party response) ───────────────────────────
// The first external-response parse in the codebase. Bách Khoa's GetInfoCar
// returns a JSON array with PascalCase fields and sloppy typing. Parse
// defensively: permissive defaults so one bad row never fails the whole batch.

export const bachKhoaVehicleSchema = z.object({
  Message: z.string().catch(''),
  NumberPlate: z.string().catch(''),
  DeviceID: z.string().nullable().catch(null),
  DriverName: z.string().nullable().catch(null),
  DriverLicense: z.string().nullable().catch(null),
  Date: z.string().nullable().catch(null),          // "HH:mm:ss - dd/MM/yyyy"
  Lt: z.number().catch(0),
  Ln: z.number().catch(0),
  Address: z.string().nullable().catch(null),
  Angle: z.number().catch(0),
  CarStatus: z.string().nullable().catch(null),
  Speed: z.number().catch(0),
  Acc: z.string().nullable().catch(null),            // "Bật" (on) / "Tắt" (off)
  Oil: z.number().nullable().catch(null),            // 0 when no fuel sensor fitted
});

export const bachKhoaResponseSchema = z.array(bachKhoaVehicleSchema);

export type BachKhoaVehicle = z.infer<typeof bachKhoaVehicleSchema>;

/**
 * Parse Bách Khoa's GetInfoCar payload into a clean array.
 *
 * The vendor returns EITHER a JSON array (success) OR a single object carrying
 * a `Message` error string with null fields — e.g. "Không có quyền truy cập"
 * (account lacks API access) or "Sai tài khoản hoặc mật khẩu" (bad credentials).
 * This helper normalizes both shapes: a non-array (error object) yields [].
 * Rows without a plate or with no GPS fix (0,0) are dropped.
 */
export function parseBachKhoaResponse(raw: unknown): BachKhoaVehicle[] {
  if (!Array.isArray(raw)) return [];
  return bachKhoaResponseSchema.parse(raw).filter(
    (v) => v.NumberPlate.trim() !== '' && !(v.Lt === 0 && v.Ln === 0),
  );
}
export type BillingDocumentLineInput = z.infer<typeof billingDocumentLineSchema>;

export * from './governance-action';
export * from './customer-service-finance';
