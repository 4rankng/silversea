export enum TripStatus {
  CREATED = 'CREATED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

/** Trip statuses whose revenue/AP has posted to the ledger → billable on debt notices
 *  (giấy báo nợ) and carrier payment statements.
 *
 *  `COMPLETED` is the single terminal / posting state (O2C reconciliation, 01/08/2026 —
 *  `docs/prd/QuyTrinhO2C.md`). Revenue/AP posts via `postTripCompletion` on the
 *  `IN_TRANSIT → COMPLETED` transition, carrying the migrated photo / zero-revenue /
 *  e-POD gates. The former `LOCKED` milestone has been dropped: costs stay editable
 *  after completion (no hard-freeze); an AR snapshot + dirty-flag on `trips` surfaces
 *  post-completion edits to the accountant reconciliation view instead.
 *
 *  CREATED / IN_TRANSIT / CANCELED have no posted AR and are excluded. */
export const BILLABLE_TRIP_STATUSES = [TripStatus.COMPLETED] as const;

/**
 * Shipment (lô hàng) lifecycle. Mirrors `shipment_status` in
 * `backend/src/db/schema.ts` and the legal edges in
 * `shipment.service.ts`'s `LEGAL_TRANSITIONS`:
 *
 *   PENDING_DATE ──► READY_FOR_DISPATCH ──► DISPATCHED ──► IN_TRANSIT
 *                                                       ──► COMPLETED
 *
 * The PRD requires one canonical shipment status field with five operational
 * stages plus cancellation. Accounting lock is an orthogonal aggregate and
 * never becomes a seventh shipment status.
 */
export enum ShipmentStatus {
  /** Temporary read compatibility for rows created before the 2026 workflow. */
  NEW = 'NEW',
  PENDING_DATE = 'PENDING_DATE',
  READY_FOR_DISPATCH = 'READY_FOR_DISPATCH',
  DISPATCHED = 'DISPATCHED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

export enum ShipmentCusBucket {
  NEW = 'NEW',
  RUNNING = 'RUNNING',
  PENDING_LOCK = 'PENDING_LOCK',
  LOCKED = 'LOCKED',
}

export enum ShipmentDocumentCustody {
  OPS_HOLDING = 'OPS_HOLDING',
  SUBMITTED_TO_ACCOUNTING = 'SUBMITTED_TO_ACCOUNTING',
  SENT_TO_CUSTOMER = 'SENT_TO_CUSTOMER',
}

/** Shipment document types — mirrors `shipment_document_type` PG enum. */
export enum ShipmentDocumentType {
  BOOKING = 'BOOKING',
  BL = 'BL',
  DO = 'DO',
  DECLARATION = 'DECLARATION',
  OTHER = 'OTHER',
}

export enum OperationalSiteType {
  FACTORY = 'FACTORY',
  WAREHOUSE = 'WAREHOUSE',
}

export enum MasterImportStatus {
  ANALYZED = 'ANALYZED',
  APPLIED = 'APPLIED',
  REJECTED = 'REJECTED',
}

export enum MasterImportRowClassification {
  ACCEPTED = 'ACCEPTED',
  BLOCKED = 'BLOCKED',
  TEMPLATE = 'TEMPLATE',
  EXAMPLE = 'EXAMPLE',
}

export enum ShipmentFulfillmentType {
  FCL_CONTAINER = 'FCL_CONTAINER',
  LCL_SHIPMENT = 'LCL_SHIPMENT',
}

export enum FulfillmentCancellationDisposition {
  REPLACED = 'REPLACED',
  NOT_REQUIRED = 'NOT_REQUIRED',
}

export enum TripPodStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

/**
 * Vietnamese labels for e-POD states. The internal approval lifecycle is
 * removed: SUBMITTED evidence is already usable, and ACCEPTED/REJECTED are
 * purely the external customer's acknowledgement outcome.
 */
export const TRIP_POD_STATUS_LABELS: Record<TripPodStatus, string> = {
  [TripPodStatus.DRAFT]: 'Đang chuẩn bị',
  [TripPodStatus.SUBMITTED]: 'Chờ khách xác nhận',
  [TripPodStatus.ACCEPTED]: 'Khách đã xác nhận',
  [TripPodStatus.REJECTED]: 'Khách từ chối',
};

export enum TripPodFileType {
  YARD_OR_DROP_RECEIPT = 'YARD_OR_DROP_RECEIPT',
  SIGNED_DELIVERY_NOTE = 'SIGNED_DELIVERY_NOTE',
  TOLL_TICKET = 'TOLL_TICKET',
}

/** M8.4 — driver-reported progress event types (append-only log). */
export enum DriverProgressEventType {
  ORDER_RECEIVED = 'ORDER_RECEIVED',
  DEPARTED = 'DEPARTED',
  ARRIVED = 'ARRIVED',
  FUELED = 'FUELED',
  INCIDENT = 'INCIDENT',
  NOTE = 'NOTE',
  PICKED_UP = 'PICKED_UP',
  LOADING_OR_RETURNING = 'LOADING_OR_RETURNING',
  DELIVERED = 'DELIVERED',
}

/** Vietnamese labels for driver progress events (PRD Mxx-HT-01). */
export const DRIVER_PROGRESS_EVENT_LABELS: Record<DriverProgressEventType, string> = {
  [DriverProgressEventType.ORDER_RECEIVED]: 'Đã nhận lệnh gốc',
  [DriverProgressEventType.DEPARTED]: 'Xuất phát',
  [DriverProgressEventType.ARRIVED]: 'Đến nơi',
  [DriverProgressEventType.FUELED]: 'Đổ dầu',
  [DriverProgressEventType.INCIDENT]: 'Sự cố',
  [DriverProgressEventType.NOTE]: 'Ghi chú',
  [DriverProgressEventType.PICKED_UP]: 'Đã lấy vỏ / Lấy hàng',
  [DriverProgressEventType.LOADING_OR_RETURNING]: 'Đang đóng / Trả hàng',
  [DriverProgressEventType.DELIVERED]: 'Đã hạ bãi / Giao hàng xong',
} as const;

export const DRIVER_FULFILLMENT_PROGRESS_SEQUENCE = [
  DriverProgressEventType.ORDER_RECEIVED,
  DriverProgressEventType.PICKED_UP,
  DriverProgressEventType.LOADING_OR_RETURNING,
  DriverProgressEventType.DELIVERED,
] as const;

export const TRIP_POD_REQUIRED_FILE_TYPES = [
  TripPodFileType.YARD_OR_DROP_RECEIPT,
  TripPodFileType.SIGNED_DELIVERY_NOTE,
] as const;

/** M8.4 — driver incidental cost types (out-of-pocket expenses).
 *  27.8 spec additions: WAREHOUSE_FEE (Phí chi kho), LIFT_DROP_LACH_HUYEN
 *  (read-only 50.000đ default for Lạch Huyện), ROAD_ALLOWANCE (auto from
 *  `trips.totalRoadAllowance`, read-only), and the "Chi phí khác" sub-options
 *  CONTAINER_WASH (Rửa cont) / CONTAINER_WELD (Hàn cont) / TIRE_WEIGH (Cân lốp).
 *  The three LIFT_DROP_LACH_HUYEN / ROAD_ALLOWANCE / TIRE_WEIGH rows are
 *  read-only on the driver form — they're seeded server-side (Lạch Huyện
 *  default + DB-driven Tiền đường) and only a backend re-compute can change
 *  them. The spec calls for "hệ thống tự động ghi nhận" / "không được điền
 *  tay", so the form just displays them with a note explaining the source. */
export enum DriverIncidentalCostType {
  PER_DIEM = 'PER_DIEM',
  LIFT_FEE = 'LIFT_FEE',
  DROP_FEE = 'DROP_FEE',
  /** Phí chi kho — warehouse / storage fee (27.8). */
  WAREHOUSE_FEE = 'WAREHOUSE_FEE',
  /** Phí nâng/hạ Lạch Huyện — read-only 50.000đ default when route touches
   *  Lạch Huyện (27.8). Seeded server-side, not editable by the driver. */
  LIFT_DROP_LACH_HUYEN = 'LIFT_DROP_LACH_HUYEN',
  /** Tiền đường — auto from `trips.totalRoadAllowance` (27.8). Read-only. */
  ROAD_ALLOWANCE = 'ROAD_ALLOWANCE',
  PARKING = 'PARKING',
  TOLL = 'TOLL',
  FUEL = 'FUEL',
  /** Sub-options for "Chi phí khác" (27.8). */
  CONTAINER_WASH = 'CONTAINER_WASH',
  CONTAINER_WELD = 'CONTAINER_WELD',
  TIRE_WEIGH = 'TIRE_WEIGH',
  OTHER = 'OTHER',
}

/** Vietnamese labels for driver incidental cost types (PRD Mxx-HT-01 + 27.8). */
export const DRIVER_INCIDENTAL_COST_LABELS: Record<DriverIncidentalCostType, string> = {
  [DriverIncidentalCostType.PER_DIEM]: 'Phụ cấp ngày',
  [DriverIncidentalCostType.LIFT_FEE]: 'Phí nâng',
  [DriverIncidentalCostType.DROP_FEE]: 'Phí hạ',
  [DriverIncidentalCostType.WAREHOUSE_FEE]: 'Phí chi kho',
  [DriverIncidentalCostType.LIFT_DROP_LACH_HUYEN]: 'Phí nâng/hạ Lạch Huyện',
  [DriverIncidentalCostType.ROAD_ALLOWANCE]: 'Tiền đường',
  [DriverIncidentalCostType.PARKING]: 'Phí đậu xe',
  [DriverIncidentalCostType.TOLL]: 'Phí cầu đường',
  [DriverIncidentalCostType.FUEL]: 'Tiền dầu',
  [DriverIncidentalCostType.CONTAINER_WASH]: 'Rửa cont',
  [DriverIncidentalCostType.CONTAINER_WELD]: 'Hàn cont',
  [DriverIncidentalCostType.TIRE_WEIGH]: 'Cân lốp',
  [DriverIncidentalCostType.OTHER]: 'Khác',
} as const;

/** Cost types the driver can pick from the form. Read-only auto rows
 *  (LIFT_DROP_LACH_HUYEN, ROAD_ALLOWANCE) are seeded server-side and only
 *  shown in the read-only banner; they never appear in this picker. FUEL is
 *  excluded because it has its own FuelRefillReportForm. */
export const DRIVER_EDITABLE_COST_TYPES: readonly DriverIncidentalCostType[] = [
  DriverIncidentalCostType.LIFT_FEE,
  DriverIncidentalCostType.DROP_FEE,
  DriverIncidentalCostType.WAREHOUSE_FEE,
  DriverIncidentalCostType.PARKING,
  DriverIncidentalCostType.TOLL,
  DriverIncidentalCostType.CONTAINER_WASH,
  DriverIncidentalCostType.CONTAINER_WELD,
  DriverIncidentalCostType.TIRE_WEIGH,
  DriverIncidentalCostType.OTHER,
] as const;

/** Sub-options for the spec's "Chi phí khác" picker (Rửa cont / Hàn cont
 *  / Cân lốp / Khác). The driver picks one and we store the right enum
 *  value. */
export const CHI_PHI_KHAC_SUBOPTIONS: Array<{
  value: DriverIncidentalCostType;
  label: string;
}> = [
  { value: DriverIncidentalCostType.CONTAINER_WASH, label: 'Rửa cont' },
  { value: DriverIncidentalCostType.CONTAINER_WELD, label: 'Hàn cont' },
  { value: DriverIncidentalCostType.TIRE_WEIGH, label: 'Cân lốp' },
  { value: DriverIncidentalCostType.OTHER, label: 'Khác' },
] as const;

/** Vietnamese labels for shipment statuses (PRD Mxx-HT-01). */
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  [ShipmentStatus.NEW]: 'Chờ bổ sung ngày',
  [ShipmentStatus.PENDING_DATE]: 'Chờ chốt lịch',
  [ShipmentStatus.READY_FOR_DISPATCH]: 'Sẵn sàng điều xe',
  [ShipmentStatus.DISPATCHED]: 'Đã phân xe',
  [ShipmentStatus.IN_TRANSIT]: 'Đang chạy',
  [ShipmentStatus.COMPLETED]: 'Hoàn thành',
  [ShipmentStatus.CANCELED]: 'Đã hủy',
};

export const SHIPMENT_CUS_BUCKET_LABELS: Record<ShipmentCusBucket, string> = {
  [ShipmentCusBucket.NEW]: 'Mới tạo',
  [ShipmentCusBucket.RUNNING]: 'Đang chạy',
  [ShipmentCusBucket.PENDING_LOCK]: 'Chờ khóa',
  [ShipmentCusBucket.LOCKED]: 'Đã khóa',
};

export const SHIPMENT_DOCUMENT_CUSTODY_LABELS: Record<ShipmentDocumentCustody, string> = {
  [ShipmentDocumentCustody.OPS_HOLDING]: 'Ops đang giữ',
  [ShipmentDocumentCustody.SUBMITTED_TO_ACCOUNTING]: 'Đã nộp Kế toán',
  [ShipmentDocumentCustody.SENT_TO_CUSTOMER]: 'Đã gửi Khách',
};

export function canonicalShipmentStatus(status: ShipmentStatus | string | null | undefined): ShipmentStatus | null {
  switch (status) {
    case ShipmentStatus.NEW:
    case 'DRAFT':
      return ShipmentStatus.PENDING_DATE;
    case ShipmentStatus.PENDING_DATE:
      return ShipmentStatus.PENDING_DATE;
    case ShipmentStatus.READY_FOR_DISPATCH:
      return ShipmentStatus.READY_FOR_DISPATCH;
    case ShipmentStatus.DISPATCHED:
    case 'IN_PROGRESS':
      return ShipmentStatus.DISPATCHED;
    case ShipmentStatus.IN_TRANSIT:
    // Legacy pre-2026 rows carry 'DELIVERED'; no live rows exist (verified
    // 2026-09-06) — read them as still-in-transit.
    case 'DELIVERED':
      return ShipmentStatus.IN_TRANSIT;
    case ShipmentStatus.COMPLETED:
    case 'CLOSED':
      return ShipmentStatus.COMPLETED;
    case ShipmentStatus.CANCELED:
      return ShipmentStatus.CANCELED;
    default:
      return null;
  }
}

export const SHIPMENT_DOCUMENT_TYPE_LABELS: Record<ShipmentDocumentType, string> = {
  [ShipmentDocumentType.BOOKING]: 'Xác nhận đặt chỗ',
  [ShipmentDocumentType.BL]: 'Vận đơn (B/L)',
  [ShipmentDocumentType.DO]: 'Lệnh giao hàng (D/O)',
  [ShipmentDocumentType.DECLARATION]: 'Tờ khai hải quan',
  [ShipmentDocumentType.OTHER]: 'Khác',
};

export enum FuelMode {
  AUTO = 'AUTO',
  FLAT_RATE = 'FLAT_RATE',
}

export enum LoadingType {
  HANG = 'HANG',
  VO = 'VO',
}

export enum Role {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  ACCOUNTANT = 'ACCOUNTANT',
  DRIVER = 'DRIVER',
  OPS = 'OPS', // formerly FORWARDER — renamed 2024-08 for role migration
  // Wave 0: customer-portal user (M3 customer portal, ships Wave 2). Row-scoped
  // to their own shipments via scopedByCustomer. Today has no UI; the role +
  // `p, CUSTOMER, customer_portal, read` policy row are the forward-looking gate.
  CUSTOMER = 'CUSTOMER',
  // Wave 0: nhân viên CSKH (M10 customer service). Creates/edits shipments
  // and their docs/declarations; cannot dispatch or post to ledger. Gets
  // `shipments read|write` + `customer_portal read` per phase-01 architecture.
  // Formerly CLERK — renamed 2024-08 for role migration.
  CUS = 'CUS',
  DISPATCHER = 'DISPATCHER',
}

/** Roles that can record financial operations and access financial reports. */
export const FINANCIAL_ROLES: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

/** Check whether a role belongs to the financial operations group. */
export function isFinancialRole(role: Role | string | undefined): boolean {
  return !!role && (FINANCIAL_ROLES as readonly string[]).includes(role);
}

export enum TxnType {
  TRIP_REVENUE = 'TRIP_REVENUE',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PENALTY = 'PENALTY',
  MANAGEMENT_FEE = 'MANAGEMENT_FEE',
  ADJUSTMENT = 'ADJUSTMENT',
  DRIVER_SALARY = 'DRIVER_SALARY',
  VENDOR_EXPENSE = 'VENDOR_EXPENSE',
  VENDOR_PAYMENT = 'VENDOR_PAYMENT',
  OPS_ADVANCE = 'OPS_ADVANCE',
  OPS_SETTLEMENT = 'OPS_SETTLEMENT',
  EXTERNAL_CARRIER_COST = 'EXTERNAL_CARRIER_COST',
  FUEL_EXPENSE = 'FUEL_EXPENSE',
  UNLOCK_REVERSAL = 'UNLOCK_REVERSAL',
  COMMISSION = 'COMMISSION',
  DRIVER_PAYOUT = 'DRIVER_PAYOUT',
  SERVICE_FEE = 'SERVICE_FEE',
}

export enum CarrierType {
  OWN = 'OWN',
  EXTERNAL = 'EXTERNAL',
}

export enum SettlementMethod {
  COMPANY_DIRECT = 'COMPANY_DIRECT',
  OPS_ADVANCE = 'OPS_ADVANCE',
}

export enum DebitNoteMode {
  MONTHLY = 'MONTHLY',
  WEEKLY = 'WEEKLY',
  PER_BATCH = 'PER_BATCH',
}

/**
 * B2 (feedback202606 GAP 7) — Role of a `truck_cap_table` partner.
 * INVESTOR (default): a capital partner sharing the truck's profit by %.
 * DRIVER: a driver-contributor modeled as a per-truck profit participant by %.
 * A row with role=DRIVER means that named partner is entitled to that % of
 * the truck's profit (manual fraction per row — no contract table). The
 * distribution math is owner-agnostic; `role` only labels the partner for UI.
 */
export enum TruckCapRole {
  INVESTOR = 'INVESTOR',
  DRIVER = 'DRIVER',
}

export enum TrailerType {
  FT20 = '20FT',
  FT40 = '40FT',
}

export enum TruckStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  INACTIVE = 'INACTIVE',
}

export enum TrailerStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  INACTIVE = 'INACTIVE',
}

export enum DriverStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}


export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
}

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  [TripStatus.CREATED]: 'Mới tạo',
  [TripStatus.IN_TRANSIT]: 'Đang chạy',
  [TripStatus.COMPLETED]: 'Hoàn thành',
  [TripStatus.CANCELED]: 'Đã hủy',
};

/** Canonical status colors — single source of truth for all trip status rendering. */
export const TRIP_STATUS_COLORS: Record<TripStatus, string> = {
  [TripStatus.CREATED]: '#69736F',     // graphite — mới tạo
  [TripStatus.IN_TRANSIT]: '#176E45',  // forest — đang chạy
  [TripStatus.COMPLETED]: '#177448',   // emerald — hoàn thành
  [TripStatus.CANCELED]: '#A0444E',    // oxblood — đã hủy
};

/** Data-completeness strip colors. */
export const DATA_COMPLETENESS_COLORS = {
  complete: '#177448',   // emerald — đầy đủ số liệu
  incomplete: '#A45D1C', // bronze — thiếu số liệu
  na: 'transparent',     // CREATED / CANCELED — not applicable
} as const;

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Quản trị viên',
  [Role.MANAGER]: 'Quản lý',
  [Role.ACCOUNTANT]: 'Kế toán',
  [Role.DRIVER]: 'Lái xe',
  [Role.OPS]: 'Nhân viên vận hành', // formerly 'Giao nhận'
  [Role.CUSTOMER]: 'Khách hàng',
  [Role.DISPATCHER]: 'Điều vận',
  [Role.CUS]: 'CUS',
};

export const FUEL_MODE_LABELS: Record<FuelMode, string> = {
  [FuelMode.AUTO]: 'Tự động',
  [FuelMode.FLAT_RATE]: 'Khoán',
};

export const LOADING_TYPE_LABELS: Record<LoadingType, string> = {
  [LoadingType.HANG]: 'Hàng',
  [LoadingType.VO]: 'Vỏ',
};

export enum PenaltyStatus {
  ACTIVE = 'ACTIVE',
  CANCELED = 'CANCELED',
}

export const PENALTY_STATUS_LABELS: Record<PenaltyStatus, string> = {
  [PenaltyStatus.ACTIVE]: 'Hiệu lực',
  [PenaltyStatus.CANCELED]: 'Đã hủy',
};

/** Default seeds for forwarder_expense_types config table. */
export const OPS_EXPENSE_TYPE_DEFAULTS: Record<string, { name: string; defaultMarkup: boolean; billingLabel: string }> = {
  LIFTING:        { name: 'Phí nâng container',        defaultMarkup: false, billingLabel: 'Phí nâng container' },
  LOWERING:       { name: 'Phí hạ container',           defaultMarkup: false, billingLabel: 'Phí hạ container' },
  WEIGHING:       { name: 'Phí cân hàng',               defaultMarkup: false, billingLabel: 'Phí cân hàng' },
  CUSTOMS:        { name: 'Phí làm tờ khai hải quan',   defaultMarkup: true,  billingLabel: 'Phí hải quan' },
  INFRASTRUCTURE: { name: 'Phí kết cấu hạ tầng',        defaultMarkup: false, billingLabel: 'Phí hạ tầng' },
  INSPECTION:     { name: 'Phí kiểm hóa tại cảng',      defaultMarkup: false, billingLabel: 'Phí kiểm hóa' },
  INSPECTION_SVC: { name: 'Phí phục vụ kiểm hóa',       defaultMarkup: true,  billingLabel: 'Phí phục vụ kiểm hóa' },
  OTHER:          { name: 'Phí chi hộ khác',             defaultMarkup: false, billingLabel: 'Chi phí khác' },
};

export const NO_INVOICE_EVIDENCE_TYPES = [
  'RECEIPT',
  'BANK_TRANSFER',
  'ONSITE_PHOTO',
  'SIGNED_CONFIRMATION',
] as const;

export type NoInvoiceEvidenceType = typeof NO_INVOICE_EVIDENCE_TYPES[number];

export const NO_INVOICE_EVIDENCE_TYPE_LABELS: Record<NoInvoiceEvidenceType, string> = {
  RECEIPT: 'Phiếu thu / biên nhận / vé lẻ',
  BANK_TRANSFER: 'Chuyển khoản / ví điện tử',
  ONSITE_PHOTO: 'Ảnh hiện trường có thời gian / địa điểm',
  SIGNED_CONFIRMATION: 'Xác nhận ký nhận của người nhận / quản lý',
};

export const DEFAULT_NO_INVOICE_EVIDENCE_TYPES: readonly NoInvoiceEvidenceType[] = [
  'RECEIPT',
  'BANK_TRANSFER',
  'ONSITE_PHOTO',
  'SIGNED_CONFIRMATION',
] as const;

export const NO_INVOICE_REQUIRED_SCOPE = 'TRIP_OR_SHIPMENT' as const;

export const NO_INVOICE_DEFAULT_CATEGORY_ALIASES: Record<string, readonly string[]> = {
  LIFTING: ['Bốc xếp tại hiện trường', 'Lao động thời vụ tại hiện trường'],
  LOWERING: ['Hạ container tại hiện trường', 'Lao động thời vụ tại hiện trường'],
  WEIGHING: ['Vé cân hàng', 'Phiếu cân hàng'],
  INFRASTRUCTURE: ['Vé bãi/đò/đường', 'Phí nhỏ có phiếu lẻ'],
  INSPECTION: ['Xử lý khẩn cấp tại cảng/kho', 'Phí kiểm hóa tại cảng/kho'],
  INSPECTION_SVC: ['Dịch vụ xử lý khẩn cấp tại cảng/kho', 'Phục vụ kiểm hóa tại cảng/kho'],
  OTHER: ['Vật tư nhỏ phục vụ chuyến', 'Chi phí hiện trường nhỏ lẻ'],
};

export const NO_INVOICE_POLICY_DEFAULTS = {
  perItemLimit: 1_000_000,
  perDayLimit: 5_000_000,
};

export enum AdvanceRequestStatus {
  RECORDED = 'RECORDED',
  DRAFT = 'DRAFT',
  VOIDED = 'VOIDED',
}

export enum AdvanceSettlementStatus {
  DRAFT = 'DRAFT',
  RECORDED = 'RECORDED',
  VOIDED = 'VOIDED',
  REVERSED = 'REVERSED',
}

export enum ExpenseEntryStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export const CARRIER_TYPE_LABELS: Record<CarrierType, string> = {
  [CarrierType.OWN]: 'Xe nhà',
  [CarrierType.EXTERNAL]: 'Xe ngoài',
};

export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = {
  [SettlementMethod.COMPANY_DIRECT]: 'Công ty trả trực tiếp',
  [SettlementMethod.OPS_ADVANCE]: 'Chi hộ tạm ứng',
};

/** B2 — Vietnamese labels for `truck_cap_table.role`. */
export const TRUCK_CAP_ROLE_LABELS: Record<TruckCapRole, string> = {
  [TruckCapRole.INVESTOR]: 'Đối tác',
  [TruckCapRole.DRIVER]: 'Lái xe',
};

export const ADVANCE_REQUEST_STATUS_LABELS: Record<AdvanceRequestStatus, string> = {
  [AdvanceRequestStatus.RECORDED]: 'Đã ghi nhận',
  [AdvanceRequestStatus.DRAFT]: 'Chưa ghi sổ',
  [AdvanceRequestStatus.VOIDED]: 'Đã hủy',
};

export const ADVANCE_SETTLEMENT_STATUS_LABELS: Record<AdvanceSettlementStatus, string> = {
  [AdvanceSettlementStatus.DRAFT]: 'Chưa hoàn tất',
  [AdvanceSettlementStatus.RECORDED]: 'Đã ghi nhận',
  [AdvanceSettlementStatus.VOIDED]: 'Đã hủy',
  [AdvanceSettlementStatus.REVERSED]: 'Đã hoàn tác',
};

export const TRAILER_STATUS_LABELS: Record<TrailerStatus, string> = {
  [TrailerStatus.ACTIVE]: 'Hoạt động',
  [TrailerStatus.MAINTENANCE]: 'Bảo trì',
  [TrailerStatus.INACTIVE]: 'Ngưng hoạt động',
};

export const TRAILER_TYPE_LABELS: Record<TrailerType, string> = {
  [TrailerType.FT20]: '20FT',
  [TrailerType.FT40]: '40FT',
};

export const TIRE_STATUSES = ['IN_STOCK', 'IN_USE', 'DISPOSED'] as const;
export type TireStatus = typeof TIRE_STATUSES[number];

export const TIRE_STATUS_LABELS: Record<TireStatus, string> = {
  IN_STOCK: 'Dự phòng',
  IN_USE: 'Đang dùng',
  DISPOSED: 'Đã thanh lý',
};

// Lý do thanh lý lốp (chọn từ danh sách khi tháo lốp để thanh lý). "Khác" cho
// phép nhập ghi chú tự do ở phía UI; backend chỉ bắt buộc chuỗi khác rỗng.
export const TIRE_DISPOSAL_REASONS = [
  'Hư hỏng',
  'Mòn gai lốp',
  'Rò rỉ',
  'Hết tuổi thọ',
  'Bán',
  'Mất',
  'Khác',
] as const;

// ─── Notification ───────────────────────────────────────────────────────────
export enum NotificationType {
  TRIP_CREATED = 'TRIP_CREATED',
  TRIP_DISPATCHED = 'TRIP_DISPATCHED',
  TRIP_IN_TRANSIT = 'TRIP_IN_TRANSIT',
  TRIP_COMPLETED = 'TRIP_COMPLETED',
  TRIP_CANCELED = 'TRIP_CANCELED',
  PAYMENT_RECEIVED = 'PAYMENT_RECEIVED',
  PENALTY_CREATED = 'PENALTY_CREATED',
  PENALTY_CANCELED = 'PENALTY_CANCELED',
  OVERDUE_PAYMENT = 'OVERDUE_PAYMENT',
  SALARY_PERIOD_CLOSING = 'SALARY_PERIOD_CLOSING',
  SYSTEM_ANNOUNCEMENT = 'SYSTEM_ANNOUNCEMENT',
  ADVANCE_SETTLEMENT_APPROVED = 'ADVANCE_SETTLEMENT_APPROVED',
  SHIPMENT_HANDOFF = 'SHIPMENT_HANDOFF',
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  [NotificationType.TRIP_CREATED]: 'Chuyến mới',
  [NotificationType.TRIP_DISPATCHED]: 'Chuyến đã điều phối',
  [NotificationType.TRIP_IN_TRANSIT]: 'Chuyến đang chạy',
  [NotificationType.TRIP_COMPLETED]: 'Chuyến hoàn thành',
  [NotificationType.TRIP_CANCELED]: 'Chuyến đã hủy',
  [NotificationType.PAYMENT_RECEIVED]: 'Thanh toán nhận được',
  [NotificationType.PENALTY_CREATED]: 'Phạt mới',
  [NotificationType.PENALTY_CANCELED]: 'Hủy phạt',
  [NotificationType.OVERDUE_PAYMENT]: 'Thanh toán quá hạn',
  [NotificationType.SALARY_PERIOD_CLOSING]: 'Sắp chốt kỳ lương',
  [NotificationType.SYSTEM_ANNOUNCEMENT]: 'Thông báo hệ thống',
  [NotificationType.ADVANCE_SETTLEMENT_APPROVED]: 'Phiếu hoàn ứng đã duyệt',
  [NotificationType.SHIPMENT_HANDOFF]: 'Lô hàng được giao cho điều vận',
};

/**
 * High-value push whitelist — the ONLY notification types that wake a device,
 * and the role audience each pushes to. Everything else stays in-app only
 * (still recorded in the notification drawer) so low-signal events don't spam
 * every role. Absent types => no push. This is the single knob to tune.
 *
 * Audiences (per `docs/prd/QuyTrinhO2C.md` push MVP — scoped to Driver + Điều vận):
 *  - 'driver'      → DRIVER role only.
 *  - 'dispatcher'  → Điều vận authority (MANAGER/ADMIN in the dispatcher seat).
 *  - 'financial'   → ACCOUNTANT + MANAGER/ADMIN (financial office action).
 *  - 'all'         → every role (avoid; the PRD narrows this to truly universal events).
 */
export type PushAudience = 'driver' | 'dispatcher' | 'financial' | 'all';
export const PUSH_RULES: Partial<Record<NotificationType, PushAudience>> = {
  // Driver must act now:
  [NotificationType.TRIP_DISPATCHED]: 'driver',
  [NotificationType.TRIP_CANCELED]: 'driver',
  [NotificationType.PENALTY_CREATED]: 'driver',
  [NotificationType.PENALTY_CANCELED]: 'driver',
  // Office action needed:
  [NotificationType.PAYMENT_RECEIVED]: 'financial',
  // PRD push MVP: settlement-approved is Driver + Điều vận only. Previously
  // pushed to every role ('all'), which violated the MVP scope.
  [NotificationType.ADVANCE_SETTLEMENT_APPROVED]: 'driver',
};

export * from './api-paths';

// ─── Supplier type taxonomy (Wave 3 M6.2) ──────────────────────────────────

/**
 * Canonical supplier-type taxonomy. A supplier may have multiple types
 * (e.g. a PORT that is also a WAREHOUSE, or a CARRIER that also sells
 * FUEL). Stored on `suppliers.types` as a Postgres text[].
 *
 * Backward-compat: `isFuelSupplier` (boolean) is mirrored from
 * `types.includes('FUEL')` by supplier-types.service.syncFuelFlag.
 */
export enum SupplierType {
  CARRIER = 'CARRIER',
  PORT = 'PORT',
  WAREHOUSE = 'WAREHOUSE',
  SHIPPING_LINE = 'SHIPPING_LINE',
  CUSTOMS = 'CUSTOMS',
  SERVICE = 'SERVICE',
  FUEL = 'FUEL',
}

/** Customer-portal scope policy. Multi-entity access is an explicit exception. */
export enum CustomerAccountType {
  SINGLE_ENTITY = 'SINGLE_ENTITY',
  CORPORATE_GROUP = 'CORPORATE_GROUP',
  AGENCY = 'AGENCY',
}

export const SUPPLIER_TYPES: readonly SupplierType[] = Object.freeze([
  SupplierType.CARRIER,
  SupplierType.PORT,
  SupplierType.WAREHOUSE,
  SupplierType.SHIPPING_LINE,
  SupplierType.CUSTOMS,
  SupplierType.SERVICE,
  SupplierType.FUEL,
]);

export const SUPPLIER_TYPE_LABELS: Record<SupplierType, string> = {
  [SupplierType.CARRIER]: 'Vận chuyển',
  [SupplierType.PORT]: 'Cảng',
  [SupplierType.WAREHOUSE]: 'Kho',
  [SupplierType.SHIPPING_LINE]: 'Hãng tàu',
  [SupplierType.CUSTOMS]: 'Hải quan',
  [SupplierType.SERVICE]: 'Dịch vụ',
  [SupplierType.FUEL]: 'Nhiên liệu',
};

/**
 * Standard container shipping lines operating in Vietnam (Hải Phòng, Cát Lái, Cái Mép).
 * Used as standard suggestions for shipment creation and container tracking.
 */
export const DEFAULT_SHIPPING_LINES = Object.freeze([
  'Maersk',
  'MSC',
  'COSCO',
  'CMA CGM',
  'Hapag-Lloyd',
  'ONE',
  'Evergreen',
  'OOCL',
  'Yang Ming',
  'Wan Hai',
  'SITC',
  'ZIM',
  'HMM',
  'PIL',
  'KMTC',
  'TS Lines',
  'Sinokor',
  'Heung-A',
  'RCL',
  'Samudera',
] as const);

// ─── Dispatch planning ──────────────────────────────────────────────────────────

// Dispatch-zone taxonomy is DB-owned (dispatch_zones table, seeded) — codes
// and labels are read from the API (GET /dispatch-zones), never listed in
// code. Zone membership of a port is ports.dispatch_zone, validated against
// the live taxonomy at the write boundary. Never infer zone from port names.

/**
 * Fulfillment-owned operational classification: SINGLE (Đơn), DOUBLE (Kẹp),
 * COMBINED (Kết hợp), LCL (Lẻ). A label only — it never infers trip pairing,
 * vehicle sharing, or shipment-level `Đóng kết hợp`.
 */
export const DISPATCH_CLASSIFICATIONS = ['SINGLE', 'DOUBLE', 'COMBINED', 'LCL'] as const;
export type DispatchClassification = (typeof DISPATCH_CLASSIFICATIONS)[number];

/** Vietnamese operator labels for each classification. */
export const DISPATCH_CLASSIFICATION_LABELS: Record<DispatchClassification, string> = {
  SINGLE: 'Đơn',
  DOUBLE: 'Kẹp',
  COMBINED: 'Kết hợp',
  LCL: 'Lẻ',
};
