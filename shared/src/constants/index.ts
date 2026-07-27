export enum TripStatus {
  CREATED = 'CREATED',
  IN_TRANSIT = 'IN_TRANSIT',
  COMPLETED = 'COMPLETED',
  LOCKED = 'LOCKED',
  CANCELED = 'CANCELED',
}

/** Trip statuses whose revenue/AP has posted to the ledger → billable on debt notices
 *  (giấy báo nợ) and carrier payment statements. Revenue posts at COMPLETED
 *  (postTripLock fires on IN_TRANSIT→COMPLETED); LOCKED is a frozen-figures superset of
 *  COMPLETED. CREATED / IN_TRANSIT / CANCELED have no posted AR and are excluded.
 *  NOTE: P&L (pnl.service) and profit distribution remain LOCKED-only by spec — a
 *  distinct concept (grossProfit is finalized at lock) — and must NOT use this set. */
export const BILLABLE_TRIP_STATUSES = [TripStatus.COMPLETED, TripStatus.LOCKED] as const;

/**
 * Shipment (lô hàng) lifecycle. Mirrors `shipment_status` in
 * `backend/src/db/schema.ts` and the legal edges in
 * `shipment.service.ts`'s `LEGAL_TRANSITIONS`:
 *
 *   DRAFT ──► IN_PROGRESS ──► DELIVERED ──► CLOSED
 *                │
 *                └──► CANCELED   (DRAFT can also go straight to CANCELED)
 *
 * CANCELED and CLOSED are terminal sinks. Kept in shared so the zod schema,
 * the frontend, and the service all share one source of truth.
 */
export enum ShipmentStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  CLOSED = 'CLOSED',
  CANCELED = 'CANCELED',
}

/** Shipment document types — mirrors `shipment_document_type` PG enum. */
export enum ShipmentDocumentType {
  BOOKING = 'BOOKING',
  BL = 'BL',
  DO = 'DO',
  DECLARATION = 'DECLARATION',
  OTHER = 'OTHER',
}

/** M8.4 — driver-reported progress event types (append-only log). */
export enum DriverProgressEventType {
  DEPARTED = 'DEPARTED',
  ARRIVED = 'ARRIVED',
  FUELED = 'FUELED',
  INCIDENT = 'INCIDENT',
  NOTE = 'NOTE',
}

/** Vietnamese labels for driver progress events (PRD Mxx-HT-01). */
export const DRIVER_PROGRESS_EVENT_LABELS: Record<DriverProgressEventType, string> = {
  [DriverProgressEventType.DEPARTED]: 'Xuất phát',
  [DriverProgressEventType.ARRIVED]: 'Đến nơi',
  [DriverProgressEventType.FUELED]: 'Đổ dầu',
  [DriverProgressEventType.INCIDENT]: 'Sự cố',
  [DriverProgressEventType.NOTE]: 'Ghi chú',
} as const;

/** M8.4 — driver incidental cost types (out-of-pocket expenses). */
export enum DriverIncidentalCostType {
  PER_DIEM = 'PER_DIEM',
  LIFT_FEE = 'LIFT_FEE',
  PARKING = 'PARKING',
  TOLL = 'TOLL',
  FUEL = 'FUEL',
  OTHER = 'OTHER',
}

/** Vietnamese labels for driver incidental cost types (PRD Mxx-HT-01). */
export const DRIVER_INCIDENTAL_COST_LABELS: Record<DriverIncidentalCostType, string> = {
  [DriverIncidentalCostType.PER_DIEM]: 'Phụ cấp ngày',
  [DriverIncidentalCostType.LIFT_FEE]: 'Phí nâng hạ',
  [DriverIncidentalCostType.PARKING]: 'Phí đậu xe',
  [DriverIncidentalCostType.TOLL]: 'Phí cầu đường',
  [DriverIncidentalCostType.FUEL]: 'Tiền dầu',
  [DriverIncidentalCostType.OTHER]: 'Khác',
} as const;

/** Vietnamese labels for shipment statuses (PRD Mxx-HT-01). */
export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  [ShipmentStatus.DRAFT]: 'Bản nháp',
  [ShipmentStatus.IN_PROGRESS]: 'Đang xử lý',
  [ShipmentStatus.DELIVERED]: 'Đã giao',
  [ShipmentStatus.CLOSED]: 'Đã đóng',
  [ShipmentStatus.CANCELED]: 'Đã hủy',
};

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
  FORWARDER = 'FORWARDER',
  // Wave 0: customer-portal user (M3 customer portal, ships Wave 2). Row-scoped
  // to their own shipments via scopedByCustomer. Today has no UI; the role +
  // `p, CUSTOMER, customer_portal, read` policy row are the forward-looking gate.
  CUSTOMER = 'CUSTOMER',
  // Wave 0: nhân viên chứng từ (M10 document clerk). Creates/edits shipments
  // and their docs/declarations; cannot dispatch or post to ledger. Gets
  // `shipments read|write` + `customer_portal read` per phase-01 architecture.
  CLERK = 'CLERK',
}

/** Roles that can approve expense approvals and access financial reports. */
export const FINANCIAL_ROLES: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT] as const;

/** Check whether a role belongs to the financial/approval group. */
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
  FORWARDER_ADVANCE = 'FORWARDER_ADVANCE',
  FORWARDER_SETTLEMENT = 'FORWARDER_SETTLEMENT',
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
  FORWARDER_ADVANCE = 'FORWARDER_ADVANCE',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  RETURN_FOR_EVIDENCE = 'RETURN_FOR_EVIDENCE',
}

export enum DebitNoteMode {
  MONTHLY = 'MONTHLY',
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
  [TripStatus.LOCKED]: 'Đã khóa',
  [TripStatus.CANCELED]: 'Đã hủy',
};

/** Canonical status colors — single source of truth for all trip status rendering. */
export const TRIP_STATUS_COLORS: Record<TripStatus, string> = {
  [TripStatus.CREATED]: '#6B7280',     // slate gray — mới tạo
  [TripStatus.IN_TRANSIT]: '#3B82F6',  // blue — đang chạy
  [TripStatus.COMPLETED]: '#10B981',   // emerald green — hoàn thành
  [TripStatus.LOCKED]: '#1E293B',      // dark slate — đã khóa
  [TripStatus.CANCELED]: '#EF4444',    // red — đã hủy
};

/** Data-completeness strip colors. */
export const DATA_COMPLETENESS_COLORS = {
  complete: '#10B981',   // emerald — đầy đủ số liệu
  incomplete: '#F59E0B', // amber — thiếu số liệu
  na: 'transparent',     // CREATED / CANCELED — not applicable
} as const;

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Quản trị viên',
  [Role.MANAGER]: 'Quản lý',
  [Role.ACCOUNTANT]: 'Kế toán',
  [Role.DRIVER]: 'Lái xe',
  [Role.FORWARDER]: 'Giao nhận',
  [Role.CUSTOMER]: 'Khách hàng',
  [Role.CLERK]: 'Nhân viên chứng từ',
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
export const FORWARDER_EXPENSE_TYPE_DEFAULTS: Record<string, { name: string; defaultMarkup: boolean; billingLabel: string }> = {
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

export const NO_INVOICE_POLICY_DEFAULTS = {
  perItemLimit: 1_000_000,
  perDayLimit: 5_000_000,
  financeLeadItemApprovalLimit: 5_000_000,
  directorDayApprovalLimit: 10_000_000,
};

export enum AdvanceRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum AdvanceSettlementStatus {
  PENDING = 'PENDING',
  CHECKED_BY_ACCOUNTANT = 'CHECKED_BY_ACCOUNTANT',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
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
  [SettlementMethod.FORWARDER_ADVANCE]: 'Chi hộ tạm ứng',
};

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  [ApprovalStatus.PENDING]: 'Chờ duyệt',
  [ApprovalStatus.APPROVED]: 'Đã duyệt',
  [ApprovalStatus.REJECTED]: 'Từ chối',
  [ApprovalStatus.RETURN_FOR_EVIDENCE]: 'Bổ sung chứng từ',
};

/** B2 — Vietnamese labels for `truck_cap_table.role`. */
export const TRUCK_CAP_ROLE_LABELS: Record<TruckCapRole, string> = {
  [TruckCapRole.INVESTOR]: 'Đối tác',
  [TruckCapRole.DRIVER]: 'Lái xe',
};

export const ADVANCE_REQUEST_STATUS_LABELS: Record<AdvanceRequestStatus, string> = {
  [AdvanceRequestStatus.PENDING]: 'Chờ duyệt',
  [AdvanceRequestStatus.APPROVED]: 'Đã duyệt',
  [AdvanceRequestStatus.REJECTED]: 'Từ chối',
};

export const ADVANCE_SETTLEMENT_STATUS_LABELS: Record<AdvanceSettlementStatus, string> = {
  [AdvanceSettlementStatus.PENDING]: 'Chờ xử lý',
  [AdvanceSettlementStatus.CHECKED_BY_ACCOUNTANT]: 'KT đã kiểm tra',
  [AdvanceSettlementStatus.APPROVED]: 'Đã duyệt',
  [AdvanceSettlementStatus.REJECTED]: 'Từ chối',
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
  TRIP_LOCKED = 'TRIP_LOCKED',
  TRIP_UNLOCKED = 'TRIP_UNLOCKED',
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
  [NotificationType.TRIP_LOCKED]: 'Chuyến đã khóa',
  [NotificationType.TRIP_UNLOCKED]: 'Chuyến đã mở khóa',
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
 */
export type PushAudience = 'driver' | 'financial' | 'all';
export const PUSH_RULES: Partial<Record<NotificationType, PushAudience>> = {
  // Driver must act now:
  [NotificationType.TRIP_DISPATCHED]: 'driver',
  [NotificationType.TRIP_CANCELED]: 'driver',
  [NotificationType.PENALTY_CREATED]: 'driver',
  [NotificationType.PENALTY_CANCELED]: 'driver',
  // Office action needed:
  [NotificationType.PAYMENT_RECEIVED]: 'financial',
  [NotificationType.TRIP_UNLOCKED]: 'financial',
  [NotificationType.ADVANCE_SETTLEMENT_APPROVED]: 'all',
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
