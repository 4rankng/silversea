import { z } from 'zod';
import {
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentStatus,
} from '../constants';

const moneyStringSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const fieldAccessSchema = z.object({
  mode: z.enum(['DIRECT', 'REQUEST', 'READ_ONLY']),
  reason: z.string().min(1),
}).strict();
const suffixSchema = z.string()
  .trim()
  .regex(/^[A-Za-z0-9]{4,5}$/, 'Chỉ được tìm theo đúng 4-5 ký tự chữ hoặc số cuối của Bill/Book hoặc tờ khai.');

// Shared filter shape for both CUS workspace GET surfaces. The overview and
// container endpoints deliberately expose distinct strict contracts: only the
// container workboard accepts the server-derived completeness filter.
const shipmentCusWorkspaceQueryShape = {
  searchSuffix: suffixSchema.optional(),
  transportDateFrom: z.string().date().optional(),
  transportDateTo: z.string().date().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  direction: z.enum(['IMPORT', 'EXPORT']).optional(),
  bucket: z.nativeEnum(ShipmentCusBucket).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

function refineTransportDateOrder(input: { transportDateFrom?: string; transportDateTo?: string }) {
  return !input.transportDateFrom
    || !input.transportDateTo
    || input.transportDateFrom <= input.transportDateTo;
}

const transportDateOrderIssue = {
  message: 'Ngày vận chuyển bắt đầu phải trước hoặc bằng ngày kết thúc.',
  path: ['transportDateTo'] as (string | number)[],
};

export const shipmentCusWorkspaceQuerySchema = z.object(shipmentCusWorkspaceQueryShape)
  .strict()
  .refine(refineTransportDateOrder, transportDateOrderIssue);

// Container-workboard-only query. `informationStatus=MISSING` selects the
// server-derived "Chưa cập nhật" triage queue; the overview schema above
// rejects this parameter by design so a detail-only filter can never silently
// no-op on the overview endpoint.
export const shipmentCusContainerQuerySchema = z.object({
  ...shipmentCusWorkspaceQueryShape,
  informationStatus: z.enum(['MISSING']).optional(),
})
  .strict()
  .refine(refineTransportDateOrder, transportDateOrderIssue);

// Server-derived completeness vocabulary for real FCL container rows on the
// /shipments-detail workboard. Array order is the canonical missing-field
// order: shipment context, container row, then vehicle stage.
export const SHIPMENT_CUS_MISSING_FIELD_CODES = [
  'DIRECTION', 'BILL_BOOKING', 'DECLARATION', 'ROUTE', 'SHIPPING_LINE', 'TRANSPORT_DATE',
  'CONTAINER_NUMBER', 'CONTAINER_TYPE', 'LIFT_SITE', 'DROPOFF_SITE', 'APPOINTMENT',
  'CARRIER', 'BKS',
] as const;
export type ShipmentCusMissingFieldCode = typeof SHIPMENT_CUS_MISSING_FIELD_CODES[number];

export const SHIPMENT_CUS_MISSING_FIELD_LABELS: Record<ShipmentCusMissingFieldCode, string> = {
  DIRECTION: 'Chiều hàng',
  BILL_BOOKING: 'Số Bill/Booking',
  DECLARATION: 'Số tờ khai',
  ROUTE: 'Cung đường',
  SHIPPING_LINE: 'Hãng tàu',
  TRANSPORT_DATE: 'Ngày vận chuyển',
  CONTAINER_NUMBER: 'Số container',
  CONTAINER_TYPE: 'Loại container',
  LIFT_SITE: 'Điểm nhận hàng',
  DROPOFF_SITE: 'Điểm trả hàng',
  APPOINTMENT: 'Lịch hẹn',
  CARRIER: 'Nhà xe',
  BKS: 'BKS',
};

export const shipmentCusMissingFieldSchema = z.object({
  code: z.enum(SHIPMENT_CUS_MISSING_FIELD_CODES),
  label: z.string().min(1),
}).strict();

export const shipmentCusWorkspaceFinanceSummarySchema = z.object({
  customerInvoiceTotal: moneyStringSchema.nullable(),
  customerNoInvoiceTotal: moneyStringSchema.nullable(),
  totalCost: moneyStringSchema.nullable(),
  isLoss: z.boolean().nullable(),
  hasPendingRecovery: z.boolean(),
  customerChargeTotalsAvailable: z.boolean(),
  totalCostAvailable: z.boolean(),
  customerTotalsAuthority: z.enum(['BILLING_DOCUMENT', 'UNAVAILABLE']).optional(),
}).strict();

export const shipmentCusWorkspaceOperationalSummarySchema = z.object({
  scheduleReadiness: z.enum(['WAITING_DATE', 'OVERDUE', 'SCHEDULED']),
  vehicleReadiness: z.enum(['NO_CONTAINERS', 'WAITING_CARRIER', 'WAITING_PLATE', 'READY']),
  totalContainers: z.number().int().nonnegative(),
  assignedContainers: z.number().int().nonnegative(),
  externalContainers: z.number().int().nonnegative(),
  plateAssignedContainers: z.number().int().nonnegative(),
  missingCarrierContainers: z.number().int().nonnegative(),
  missingPlateContainers: z.number().int().nonnegative(),
  transportDateEditable: z.boolean(),
}).strict();

export const shipmentCusWorkspaceDocumentCustodySchema = z.object({
  status: z.nativeEnum(ShipmentDocumentCustody).nullable(),
  label: z.string().nullable(),
  available: z.boolean(),
  editable: z.boolean(),
}).strict();

export const shipmentCusWorkspaceAccountingConfirmationSchema = z.object({
  status: z.enum(['CONFIRMED', 'STALE', 'PENDING', 'UNAVAILABLE']),
  confirmationId: z.number().int().positive().nullable(),
  checksum: z.string().min(1).max(128).nullable(),
  billingDocumentId: z.number().int().positive().nullable(),
  confirmedAt: z.string().datetime().nullable(),
  confirmedByName: z.string().nullable(),
}).strict();

export const shipmentCusWorkspaceActionSchema = z.object({
  kind: z.enum(['CONFIRM_FINANCE', 'LOCK', 'REQUEST_REOPEN', 'NONE']),
  label: z.string(),
  enabled: z.boolean(),
  disabledReason: z.string().nullable(),
}).strict();

export const shipmentCusWorkspaceActiveLockSchema = z.object({
  id: z.number().int().positive(),
  billingDocumentId: z.number().int().positive(),
  activatedAt: z.string().datetime(),
  activatedByName: z.string().nullable(),
  reason: z.string(),
}).strict();

export const shipmentCusWorkspaceDebitNoteSchema = z.object({
  available: z.boolean(),
  billingDocumentId: z.number().int().positive().nullable(),
  documentNumber: z.string().nullable(),
  issuedAt: z.string().datetime().nullable(),
  debitNoteStatus: z.string().nullable(),
  disabledReason: z.string().nullable(),
}).strict();

const shipmentCusWorkspaceShipmentFieldAccessSchema = z.object({
  customerId: fieldAccessSchema,
  factoryName: fieldAccessSchema,
  routeId: fieldAccessSchema,
  deliveryLocation: fieldAccessSchema,
  blNumber: fieldAccessSchema,
  bookingRef: fieldAccessSchema,
  declarationNumber: fieldAccessSchema,
  tradeDirection: fieldAccessSchema,
  shippingLineName: fieldAccessSchema,
  packageCount: fieldAccessSchema,
  packageType: fieldAccessSchema,
  cargoWeightKg: fieldAccessSchema,
  cargoVolumeCbm: fieldAccessSchema,
  customsCutoffAt: fieldAccessSchema,
  closingAt: fieldAccessSchema,
  plannedReturnAt: fieldAccessSchema,
  customerNotes: fieldAccessSchema,
  operationalNotes: fieldAccessSchema,
}).strict();

export const shipmentCusWorkspaceListItemSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  status: z.nativeEnum(ShipmentStatus),
  cargoMode: z.enum(['FCL', 'LCL']).nullable(),
  bucket: z.nativeEnum(ShipmentCusBucket),
  bucketLabel: z.string(),
  customerName: z.string().nullable(),
  factoryName: z.string().nullable(),
  // Effective per-container factory labels (SILVER L1): distinct resolved
  // factories across containers — a multi-factory lot shows every name,
  // never a false single factory. Single-factory lots show one entry.
  effectiveFactoryNames: z.array(z.string()),
  billOrBookNumber: z.string().nullable(),
  declarationNumber: z.string().nullable(),
  shippingLineName: z.string().nullable(),
  routeName: z.string().nullable(),
  isCombined: z.boolean(),
  direction: z.enum(['IMPORT', 'EXPORT']).nullable(),
  containerSummary: z.string(),
  packageCount: z.number().int().positive().nullable(),
  packageType: z.string().nullable(),
  weightKg: z.string().nullable(),
  volumeCbm: z.string().nullable(),
  transportDate: z.string().date().nullable(),
  customsCutoffAt: z.string().datetime().nullable(),
  closingAt: z.string().datetime().nullable(),
  plannedReturnAt: z.string().datetime().nullable(),
  deliveryLocation: z.string().nullable(),
  liftSiteNames: z.array(z.string()),
  dropoffSiteNames: z.array(z.string()),
  customerAppointmentAts: z.array(z.string().datetime()),
  // Per-appointment container groups for the "Lịch trình & điều xe" cell: one
  // entry per distinct (datetime, factory), with a container-type summary
  // ("2x20HC + 1x40HC") so every container close/return time remains visible
  // even when multiple containers share a factory and calendar date.
  // `factoryName` is the effective factory label (container site → shipment
  // site → factory text); null groups use the shipment default.
  appointmentGroups: z.array(z.object({
    at: z.string().datetime(),
    localDate: z.string(),
    factoryName: z.string().nullable(),
    containerSummary: z.string(),
  }).strict()),
  carrierAssignments: z.array(z.object({
    carrierName: z.string().nullable(),
    plateNumber: z.string().nullable(),
  }).strict()),
  customerNotes: z.string().nullable(),
  operationalNotes: z.string().nullable(),
  raw: z.object({
    customerId: z.number().int().positive(),
    factoryName: z.string().nullable(),
    routeId: z.number().int().positive().nullable(),
    deliveryLocation: z.string().nullable(),
    blNumber: z.string().nullable(),
    bookingRef: z.string().nullable(),
    declarationNumber: z.string().nullable(),
    tradeDirection: z.enum(['IMPORT', 'EXPORT']).nullable(),
    shippingLineName: z.string().nullable(),
    packageCount: z.number().int().nonnegative().nullable(),
    packageType: z.string().nullable(),
    cargoWeightKg: z.string().nullable(),
    cargoVolumeCbm: z.string().nullable(),
    customsCutoffAt: z.string().datetime().nullable(),
    closingAt: z.string().datetime().nullable(),
    plannedReturnAt: z.string().datetime().nullable(),
    customerNotes: z.string().nullable(),
    operationalNotes: z.string().nullable(),
    declarationId: z.number().int().positive().nullable(),
    declarationIssuedAt: z.string().datetime().nullable(),
    declarationScope: z.enum(['SINGLE', 'SHARED']).nullable(),
    declarationNote: z.string().nullable(),
  }).strict(),
  fieldAccess: shipmentCusWorkspaceShipmentFieldAccessSchema,
  operational: shipmentCusWorkspaceOperationalSummarySchema,
  finance: shipmentCusWorkspaceFinanceSummarySchema,
  debitNote: shipmentCusWorkspaceDebitNoteSchema,
  documentCustody: shipmentCusWorkspaceDocumentCustodySchema,
  accountingConfirmation: shipmentCusWorkspaceAccountingConfirmationSchema,
  activeLock: shipmentCusWorkspaceActiveLockSchema.nullable(),
  action: shipmentCusWorkspaceActionSchema,
}).strict();

export const shipmentCusWorkspacePassThroughChargeSchema = z.object({
  expenseId: z.number().int().positive(),
  label: z.string(),
  amount: moneyStringSchema,
  invoiceNumber: z.string().nullable(),
  pendingRecovery: z.boolean(),
}).strict();

export const shipmentCusWorkspaceRecoveryFactSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  shipmentContainerId: z.number().int().positive().nullable(),
  kind: z.enum(['DEPOSIT', 'REPAIR', 'OTHER']),
  status: z.enum(['OPEN', 'PARTIAL', 'RECOVERED', 'WAIVED']),
  expectedAmount: moneyStringSchema,
  recoveredAmount: moneyStringSchema,
  outstandingAmount: moneyStringSchema,
  sourceExpenseId: z.number().int().positive().nullable(),
  sourceVersion: z.string().nullable(),
  waiverReason: z.string().nullable(),
}).strict();

const shipmentCusWorkspaceFieldPermissionsSchema = z.object({
  carrierEditable: z.boolean(),
  plateEditable: z.boolean(),
  containerTypeEditable: z.boolean(),
  liftSiteEditable: z.boolean(),
  dropoffSiteEditable: z.boolean(),
  customerAppointmentEditable: z.boolean(),
}).strict();

export const shipmentCusWorkspaceContainerLineSchema = z.object({
  id: z.number().int().positive(),
  ordinal: z.number().int().positive(),
  containerNumber: z.string().nullable(),
  containerTypeId: z.number().int().positive().nullable(),
  containerTypeLabel: z.string().nullable(),
  dispatchStatus: z.enum(['UNASSIGNED', 'PLANNED', 'CREATED', 'IN_TRANSIT', 'COMPLETED']),
  carrierType: z.enum(['OWN', 'EXTERNAL']).nullable(),
  externalCarrierId: z.number().int().positive().nullable(),
  externalCarrierVehicleId: z.number().int().positive().nullable(),
  carrierName: z.string().nullable(),
  plateNumber: z.string().nullable(),
  liftSiteId: z.number().int().positive().nullable(),
  liftSite: z.string().nullable(),
  dropoffSiteId: z.number().int().positive().nullable(),
  dropoffSite: z.string().nullable(),
  customerAppointmentAt: z.string().datetime().nullable(),
  raw: z.object({
    containerNumber: z.string().nullable(),
    containerTypeId: z.number().int().positive().nullable(),
    cargoWeightKg: z.string().nullable(),
    cargoVolumeCbm: z.string().nullable(),
  }).strict(),
  fieldAccess: z.object({
    containerNumber: fieldAccessSchema,
    containerTypeId: fieldAccessSchema,
    cargoWeightKg: fieldAccessSchema,
    cargoVolumeCbm: fieldAccessSchema,
    carrierType: fieldAccessSchema,
    externalCarrierId: fieldAccessSchema,
    externalCarrierVehicleId: fieldAccessSchema,
    plateNumber: fieldAccessSchema,
    liftSiteId: fieldAccessSchema,
    dropoffSiteId: fieldAccessSchema,
    customerAppointmentAt: fieldAccessSchema,
  }).strict(),
  permissions: shipmentCusWorkspaceFieldPermissionsSchema,
  shipmentVersion: z.number().int().positive(),
  relatedTripVersion: z.number().int().positive().nullable(),
}).strict();

const shipmentCusWorkspaceContainerTypeOptionSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  label: z.string(),
}).strict();

const shipmentCusWorkspaceOperationalSiteOptionSchema = z.object({
  id: z.number().int().positive(),
  siteType: z.enum(['FACTORY', 'WAREHOUSE']),
  code: z.string(),
  name: z.string(),
  label: z.string(),
}).strict();

const shipmentCusWorkspaceExternalCarrierOptionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  shortName: z.string().nullable(),
  label: z.string(),
}).strict();

const shipmentCusWorkspaceCarrierVehicleOptionSchema = z.object({
  id: z.number().int().positive(),
  carrierId: z.number().int().positive(),
  licensePlate: z.string(),
  label: z.string(),
}).strict();

const shipmentCusWorkspaceRouteOptionSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  label: z.string(),
}).strict();

const shipmentCusWorkspaceSelectorsSchema = z.object({
  routes: z.array(shipmentCusWorkspaceRouteOptionSchema),
  containerTypes: z.array(shipmentCusWorkspaceContainerTypeOptionSchema),
  operationalSites: z.array(shipmentCusWorkspaceOperationalSiteOptionSchema),
  externalCarriers: z.array(shipmentCusWorkspaceExternalCarrierOptionSchema),
  carrierVehicles: z.array(shipmentCusWorkspaceCarrierVehicleOptionSchema),
}).strict();

export const shipmentCusWorkspaceDetailSchema = z.object({
  summary: shipmentCusWorkspaceListItemSchema,
  containers: z.array(shipmentCusWorkspaceContainerLineSchema),
  selectors: shipmentCusWorkspaceSelectorsSchema,
  dataState: z.object({
    hasExplicitDocumentCustody: z.boolean(),
  }).strict(),
}).strict();

export const shipmentCusFinanceConfirmationCreateSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  billingDocumentId: z.coerce.number().int().positive('Debit Note là bắt buộc'),
  reason: z.string().trim().min(1, 'Lý do xác nhận là bắt buộc').max(2_000),
}).strict();

export const shipmentCusDocumentCustodyUpdateSchema = z.object({
  expectedShipmentVersion: z.coerce.number().int().positive(),
  status: z.nativeEnum(ShipmentDocumentCustody),
  note: z.string().trim().max(500).optional().nullable(),
}).strict();

export const shipmentCusLockSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  confirmationId: z.coerce.number().int().positive('Mã xác nhận kế toán là bắt buộc'),
  confirmationChecksum: z.string().trim().min(1, 'Mã kiểm tra xác nhận là bắt buộc').max(128),
  reason: z.string().trim().min(1, 'Lý do khóa lô là bắt buộc').max(2_000),
  acknowledged: z.literal(true, {
    errorMap: () => ({ message: 'Bạn phải xác nhận trước khi khóa lô.' }),
  }),
}).strict();

export const shipmentCusReopenRequestSchema = z.object({
  expectedShipmentVersion: z.coerce.number().int().positive(),
  activeLockId: z.coerce.number().int().positive('Mã khóa lô hiện hành là bắt buộc'),
  reason: z.string().trim().min(1, 'Lý do đề nghị điều chỉnh là bắt buộc').max(2_000),
}).strict();

export const shipmentCusReopenDecisionSchema = z.object({
  expectedVersion: z.coerce.number().int().positive(),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().min(1, 'Lý do xử lý là bắt buộc').max(2_000),
}).strict();

export const shipmentCusContainerLineUpdateSchema = z.object({
  expectedShipmentVersion: z.coerce.number().int().positive(),
  containerNumber: z.string().trim().max(50, 'Số container không được quá 50 ký tự').nullable().optional(),
  cargoWeightKg: z.union([z.number().finite(), z.string()]).transform((value, ctx) => {
    const raw = String(value).trim();
    if (!/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(raw)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Trọng lượng phải là số không âm, tối đa 8 chữ số nguyên và 2 chữ số thập phân.' });
      return z.NEVER;
    }
    return `${raw.includes('.') ? raw : `${raw}.00`}`.replace(/\.(\d)$/, '.$10');
  }).nullable().optional(),
  cargoVolumeCbm: z.union([z.number().finite(), z.string()]).transform((value, ctx) => {
    const raw = String(value).trim();
    if (!/^(0|[1-9]\d*)(?:\.\d{1,3})?$/.test(raw) || raw.split('.')[0]!.length > 9) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Thể tích phải là số không âm, tối đa 9 chữ số nguyên và 3 chữ số thập phân.' });
      return z.NEVER;
    }
    const [integer, fraction = ''] = raw.split('.');
    return `${integer}.${fraction.padEnd(3, '0')}`;
  }).nullable().optional(),
  carrierType: z.enum(['OWN', 'EXTERNAL']).optional(),
  externalCarrierId: z.coerce.number().int().positive().nullable().optional(),
  externalCarrierVehicleId: z.coerce.number().int().positive().nullable().optional(),
  plateNumber: z.string().trim().max(20).nullable().optional(),
  newExternalCarrier: z.object({
    name: z.string().trim().min(1, 'Tên nhà xe là bắt buộc').max(255),
    plateNumber: z.string().trim().min(1, 'Biển số xe là bắt buộc').max(20),
  }).strict().optional(),
  containerTypeId: z.coerce.number().int().positive().nullable().optional(),
  liftSiteId: z.coerce.number().int().positive().nullable().optional(),
  dropoffSiteId: z.coerce.number().int().positive().nullable().optional(),
  customerAppointmentAt: z.string().datetime().nullable().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.newExternalCarrier && input.carrierType !== 'EXTERNAL') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['carrierType'],
      message: 'Nhà xe mới chỉ dùng khi loại nhà xe là EXTERNAL.',
    });
  }
  if (input.newExternalCarrier && input.externalCarrierId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newExternalCarrier'],
      message: 'Không được gửi đồng thời nhà xe hiện có và nhà xe mới.',
    });
  }
  if (input.newExternalCarrier && input.externalCarrierVehicleId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['externalCarrierVehicleId'],
      message: 'Nhà xe mới không được đi kèm xe nhà xe đã tồn tại.',
    });
  }
  if (input.newExternalCarrier && input.plateNumber != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['plateNumber'],
      message: 'Biển số của nhà xe mới phải nằm trong newExternalCarrier.',
    });
  }
  if (input.carrierType === 'OWN' && input.externalCarrierId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['externalCarrierId'],
      message: 'Xe nội bộ không được đi kèm nhà xe ngoài.',
    });
  }
  if (input.carrierType === 'OWN' && input.externalCarrierVehicleId != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['externalCarrierVehicleId'],
      message: 'Xe nội bộ không được đi kèm xe nhà xe ngoài.',
    });
  }
});

export const shipmentCusContainerLineUpdateResultSchema = z.object({
  line: shipmentCusWorkspaceContainerLineSchema,
}).strict();

const nonNegativeMoneyStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);

export const shipmentRecoveryRecordSchema = z.object({
  expenseId: z.coerce.number().int().positive(),
  expectedExpenseVersion: z.coerce.number().int().positive(),
  expectedSourceVersion: z.string().trim().min(1).max(120),
  expectedRecoveryVersion: z.coerce.number().int().nonnegative(),
  kind: z.enum(['DEPOSIT', 'REPAIR', 'OTHER']),
  recoveredAmount: nonNegativeMoneyStringSchema,
  status: z.enum(['OPEN', 'PARTIAL', 'RECOVERED', 'WAIVED']),
  waiverReason: z.string().trim().max(500).nullable().optional(),
}).strict();

export const shipmentRecoveryRecordResultSchema = z.object({
  fact: shipmentCusWorkspaceRecoveryFactSchema,
}).strict();

export const shipmentCusContainerFlatRowSchema = z.object({
  id: z.number().int().positive(),
  shipmentId: z.number().int().positive(),
  shipmentVersion: z.number().int().positive(),
  ordinal: z.number().int().positive(),
  customerId: z.number().int().positive(),
  customerName: z.string().nullable(),
  factoryName: z.string().nullable(),
  routeName: z.string().nullable(),
  billOrBookNumber: z.string().nullable(),
  declarationNumber: z.string().nullable(),
  shippingLineName: z.string().nullable(),
  isCombined: z.boolean(),
  direction: z.enum(['IMPORT', 'EXPORT']).nullable(),
  containerNumber: z.string().nullable(),
  containerTypeLabel: z.string().nullable(),
  dispatchStatus: z.enum(['UNASSIGNED', 'PLANNED', 'CREATED', 'IN_TRANSIT', 'COMPLETED']),
  carrierName: z.string().nullable(),
  plateNumber: z.string().nullable(),
  liftSite: z.string().nullable(),
  dropoffSite: z.string().nullable(),
  transportDate: z.string().date().nullable(),
  closingAt: z.string().datetime().nullable(),
  plannedReturnAt: z.string().datetime().nullable(),
  customerAppointmentAt: z.string().datetime().nullable(),
  customerNotes: z.string().nullable(),
  operationalNotes: z.string().nullable(),
  raw: z.object({
    containerNumber: z.string().nullable(),
    containerTypeId: z.number().int().positive().nullable(),
    cargoWeightKg: z.string().nullable(),
    cargoVolumeCbm: z.string().nullable(),
  }).strict(),
  fieldAccess: z.object({
    containerNumber: fieldAccessSchema,
    containerTypeId: fieldAccessSchema,
    cargoWeightKg: fieldAccessSchema,
    cargoVolumeCbm: fieldAccessSchema,
  }).strict(),
  shipmentFieldAccess: shipmentCusWorkspaceShipmentFieldAccessSchema,
  // Server-derived triage state for this real FCL container row. COMPLETE
  // means every applicable field has a value; the ordered missingFields list
  // names exactly what is absent and applies only when the row is incomplete.
  informationStatus: z.enum(['COMPLETE', 'MISSING']),
  missingFields: z.array(shipmentCusMissingFieldSchema),
  shipmentScheduleEditable: z.boolean(),
  shipmentNotesEditable: z.boolean(),
  carrierEditable: z.boolean(),
  plateEditable: z.boolean(),
  vehicleReadOnlyReason: z.string().min(1).nullable(),
  liftSiteEditable: z.boolean(),
  dropoffSiteEditable: z.boolean(),
  customerAppointmentEditable: z.boolean(),
  scheduleEditable: z.boolean(),
}).strict();

export const shipmentCusContainerFlatResponseSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  filterOptions: z.object({
    customers: z.array(z.object({
      id: z.number().int().positive(),
      name: z.string(),
    }).strict()),
  }).strict(),
  items: z.array(shipmentCusContainerFlatRowSchema),
}).strict();

export const shipmentCusWorkspaceListResponseSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().min(1).max(100),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  pageSummary: z.object({
    needsSchedule: z.number().int().nonnegative(),
    needsVehicle: z.number().int().nonnegative(),
    waitingAccounting: z.number().int().nonnegative(),
    readyToLock: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(shipmentCusWorkspaceListItemSchema),
}).strict();

export type ShipmentCusWorkspaceQuery = z.infer<typeof shipmentCusWorkspaceQuerySchema>;
export type ShipmentCusContainerQuery = z.infer<typeof shipmentCusContainerQuerySchema>;
export type ShipmentCusMissingField = z.infer<typeof shipmentCusMissingFieldSchema>;
export type ShipmentCusWorkspaceFinanceSummary = z.infer<typeof shipmentCusWorkspaceFinanceSummarySchema>;
export type ShipmentCusWorkspaceOperationalSummary = z.infer<typeof shipmentCusWorkspaceOperationalSummarySchema>;
export type ShipmentCusWorkspaceDocumentCustody = z.infer<typeof shipmentCusWorkspaceDocumentCustodySchema>;
export type ShipmentCusWorkspaceAccountingConfirmation = z.infer<typeof shipmentCusWorkspaceAccountingConfirmationSchema>;
export type ShipmentCusWorkspaceAction = z.infer<typeof shipmentCusWorkspaceActionSchema>;
export type ShipmentCusWorkspaceFieldAccess = z.infer<typeof fieldAccessSchema>;
export type ShipmentCusWorkspaceActiveLock = z.infer<typeof shipmentCusWorkspaceActiveLockSchema>;
export type ShipmentCusWorkspaceListItem = z.infer<typeof shipmentCusWorkspaceListItemSchema>;
export type ShipmentCusWorkspacePassThroughCharge = z.infer<typeof shipmentCusWorkspacePassThroughChargeSchema>;
export type ShipmentCusWorkspaceRecoveryFact = z.infer<typeof shipmentCusWorkspaceRecoveryFactSchema>;
export type ShipmentCusWorkspaceContainerLine = z.infer<typeof shipmentCusWorkspaceContainerLineSchema>;
export type ShipmentCusContainerFlatRow = z.infer<typeof shipmentCusContainerFlatRowSchema>;
export type ShipmentCusContainerFlatResponse = z.infer<typeof shipmentCusContainerFlatResponseSchema>;
export type ShipmentCusWorkspaceDetail = z.infer<typeof shipmentCusWorkspaceDetailSchema>;
export type ShipmentCusWorkspaceListResponse = z.infer<typeof shipmentCusWorkspaceListResponseSchema>;
export type ShipmentCusFinanceConfirmationCreateInput = z.infer<typeof shipmentCusFinanceConfirmationCreateSchema>;
export type ShipmentCusDocumentCustodyUpdateInput = z.infer<typeof shipmentCusDocumentCustodyUpdateSchema>;
export type ShipmentCusLockInput = z.infer<typeof shipmentCusLockSchema>;
export type ShipmentCusReopenRequestInput = z.infer<typeof shipmentCusReopenRequestSchema>;
export type ShipmentCusReopenDecisionInput = z.infer<typeof shipmentCusReopenDecisionSchema>;
export type ShipmentCusContainerLineUpdateInput = z.infer<typeof shipmentCusContainerLineUpdateSchema>;
export type ShipmentCusContainerLineUpdateResult = z.infer<typeof shipmentCusContainerLineUpdateResultSchema>;
export type ShipmentRecoveryRecordInput = z.infer<typeof shipmentRecoveryRecordSchema>;
export type ShipmentRecoveryRecordResult = z.infer<typeof shipmentRecoveryRecordResultSchema>;
