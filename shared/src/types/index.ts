import type {
  TripStatus, FuelMode, LoadingType, Role, TxnType,
  TrailerType, TruckStatus, TrailerStatus, DriverStatus, CustomerStatus, PenaltyStatus,
  AdvanceRequestStatus, AdvanceSettlementStatus, ExpenseEntryStatus,
  TireStatus, TruckCapRole,
} from '../constants';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  username: string;
  email: string;
  phone: string | null;
  fullName: string | null;
  passwordHash: string;
  role: Role;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export type UserPublic = Omit<User, 'passwordHash' | 'deletedAt'>;

/**
 * A user row LEFT-JOINED with its optional linked `drivers` profile
 * (drivers.userId). The driver-* fields are null for non-driver users or for
 * drivers that have no profile row. Returned by GET /api/auth/users so the
 * /users page can render salary/truck inline. baseSalary/socialInsurance are
 * string|null because the numeric(15,0) columns serialize as strings (see Driver).
 */
export interface UserWithDriver extends UserPublic {
  driverId: number | null;
  driverName: string | null;
  driverPhone: string | null;
  assignedTruckId: number | null;
  baseSalary: string | null;
  socialInsurance: string | null;
  driverStatus: DriverStatus | null;
}

export interface Driver {
  id: number;
  userId: number | null;
  name: string;
  phone: string | null;
  assignedTruckId: number | null;
  baseSalary: string | null;
  socialInsurance: string | null;
  status: DriverStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Customer {
  id: number;
  name: string;
  taxCode: string | null;
  contactPerson: string | null;
  phone: string | null;
  contactInfo: string | null;
  creditLimit: string | null;
  status: CustomerStatus;
  isCarrier: boolean;
  debitNoteMode: 'MONTHLY' | 'PER_BATCH';
  debitNoteTemplateId?: number | null;
  linkedSupplierId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Truck {
  id: number;
  licensePlate: string;
  trailerPlateNumber: string | null;
  trailerType: TrailerType | null;
  currentTrailerId: number | null;
  status: TruckStatus;
  // N5 / A12 + B4: user-keyed compliance/service dates (ISO 'YYYY-MM-DD' or null).
  nextInspectionDate: string | null;
  insuranceExpiryDate: string | null;
  // NEXT oil-service due date (legacy name). Set directly or computed by the
  // form from last-change + N months; only next-due is persisted.
  lastOilServiceDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ─── N5 / A12 + B4: vehicle compliance/service date alerts ───────────────────
// A non-null user-keyed date on a truck that computeVehicleAlerts evaluates.
export type VehicleAlertField =
  | 'nextInspectionDate'
  | 'insuranceExpiryDate'
  | 'lastOilServiceDate';

export type VehicleAlertStatus = 'overdue' | 'due' | 'ok';

export interface VehicleAlert {
  field: VehicleAlertField;
  /** Vietnamese display label for the date field. */
  label: string;
  /** ISO date string 'YYYY-MM-DD'. */
  date: string;
  /** Whole days from `today` until `date` (negative = past). */
  daysUntil: number;
  status: VehicleAlertStatus;
}

export interface Trailer {
  id: number;
  licensePlate: string;
  type: TrailerType;
  status: TrailerStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ─── N1 — Tires ───────────────────────────────────────────────────────────
// A single tire tracked by its immutable `serial`. A tire mounts on a truck
// (truckId) OR a trailer (trailerId); both null = spare in stock. DISPOSED
// tires are retained for traceability. cost is VND (numeric(15,0) → string).
export interface Tire {
  id: number;
  serial: string;
  truckId: number | null;
  trailerId: number | null;
  position: string | null;
  size: string | null;
  installedAt: string | null;
  removedAt: string | null;
  supplierId: number | null;
  cost: string;
  purchasedAt: string | null;
  disposalDate: string | null;
  disposalReason: string | null;
  status: TireStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TirePosition {
  id: number;
  name: string;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Route {
  id: number;
  name: string;
  distanceKm: number | null;
  isMountain: boolean;
  fixedFuelAllowance: string | null;
  tollsStations: number | null;
  driverSalary: string | null;
  defaultLegs: Array<{ origin: string; destination: string; km: number; loadingType: 'HANG' | 'VO' }> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CargoType {
  id: number;
  name: string;
  requiresPhotos: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PricingTable {
  id: number;
  customerId: number;
  routeId: number;
  price: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoadAllowance {
  id: number;
  routeId: number;
  trailerType: TrailerType;
  baseAmount: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface FuelConfig {
  id: number;
  loadedNorm: string;
  emptyNorm: string;
  supplement: string;
  unitPrice: string;
  warningThreshold: string;
  criticalThreshold: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface RoadConfig {
  id: number;
  tollPerStation: string;
  returnCargoBonus: string;
  defaultDriverSalary: string;
  twoPointDeliveryBonus: string;
  vehicleShiftDefault: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppSetting {
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyInfo {
  name: string;
  address: string;
  taxCode: string;
  representative: string;
  representativeTitle: string;
  bankAccount: string;
  bankName: string;
  phone: string;
  email: string;
  logoStorageKey: string | null;
  updatedAt?: string | null;
}

export interface FuelPriceHistory {
  id: number;
  unitPrice: string;
  effectiveDate: string;
  changedBy: number | null;
  note: string | null;
  createdAt: string;
}

export interface PenaltyReason {
  id: number;
  reasonText: string;
  defaultAmount: string;
  severity: 'low' | 'mid' | 'high';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ─── Operations ──────────────────────────────────────────────────────────────

export interface Trip {
  id: number;
  customerId: number;
  customerReference: string | null;
  truckId: number;
  driverId: number;
  routeId: number;
  trailerId: number | null;
  trailerType: TrailerType | null;
  cargoTypeId: number;
  containerCount: number | null;
  status: TripStatus;
  departureDate: string;
  fuelMode: FuelMode;
  fuelLitersOverride: string | null;
  fuelSupplementLiters: string | null;
  fuelSupplementReason: string | null;
  fuelPriceApplied: string | null;
  fuelActualUnitPrice: string | null;
  fuelSupplierId: number | null;
  tollsDiscount: string;
  tollsAddition: string;
  tollsStations: number;
  hasReturnCargo: boolean;
  driverSalary: string | null;
  fuelLiters: string | null;
  totalFuelCost: string | null;
  totalRoadAllowance: string | null;
  roadAllowanceOverride: string | null;
  totalCost: string | null;
  revenue: string | null;
  revenueEmptyReturn: string | null;
  revenueCombine: string | null;
  customerCommission: string | null;
  tripWageDays: number | null;
  twoPointDeliveryBonus: string;
  vehicleShiftAllowance: string;
  grossProfit: string | null;
  tollCost: string | null;
  revenueOriginal: string | null;
  revenueOverriddenBy: number | null;
  revenueOverriddenAt: string | null;
  photoUrls: string[] | null;
  notes: string | null;
  tripCode: string | null;
  version: number;
  createdBy: number | null;
  roadAllowanceBaseApplied: string | null;
  fuelLoadedNormApplied: string | null;
  fuelEmptyNormApplied: string | null;
  fuelFixedAllowanceApplied: string | null;
  fuelSupplementNormApplied: string | null;
  tollPerStationApplied: string | null;
  returnCargoBonusApplied: string | null;
  vatRate: string;
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  externalFreightCost: string | null;
  externalPlateNumber: string | null;
  externalDriverName: string | null;
  externalDriverPhone: string | null;
  fuelSupplier?: { id: number; name: string } | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TripLeg {
  id: number;
  tripId: number;
  sequence: number;
  origin: string;
  destination: string;
  km: number;
  loadingType: LoadingType;
  calculatedLiters: string | null;
  polylinePath: string | null;
  /** Geocoded/route-derived coordinate of this leg's origin stop, so the map can
   *  place a numbered marker even when no captured route polyline exists.
   *  Null when the place could not be resolved (route endpoint or geocode). */
  originCoord?: { lat: number; lng: number } | null;
  /** Coordinate of this leg's destination stop (same resolution strategy). */
  destinationCoord?: { lat: number; lng: number } | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Financials ──────────────────────────────────────────────────────────────

export interface LedgerEntry {
  id: number;
  timestamp: string;
  txnType: TxnType;
  txnId: number | null;
  receiptId: string | null;
  entityType: string;
  entityId: number;
  credit: string;
  debit: string;
  balance: string;
  note: string | null;
  createdAt: string;
  routeName?: string | null;
  containerNumbers?: string[];
  tripId?: number | null;
  /** Public trip reference for display. Internal database ids must not be shown to users. */
  tripCode?: string | null;
  serviceFeeLabel?: string | null;
  fuelDetails?: {
    departureDate: string;
    truckPlate: string | null;
    routeName: string | null;
    liters: string | null;
    unitPrice: string | null;
    amount: string;
  } | null;
  expenseDetails?: {
    expenseDate: string;
    vehiclePlate: string | null;
    vehicleComponent: 'TRUCK' | 'TRAILER' | null;
    categoryName: string;
    amount: string;
  } | null;
}

export interface Penalty {
  id: number;
  driverId: number;
  tripId: number | null;
  reasonId: number | null;
  customReason: string | null;
  amount: string;
  date: string;
  status: PenaltyStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CapTableHistory {
  id: number;
  partnerName: string;
  contributionAmount: string;
  percentage?: string;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

// F3 — per-vehicle ownership snapshot. Mirrors CapTableHistory but scoped to a
// truck; `percentage` is an explicit owner share (0–100) of that truck's profit.
// B2 — `role` labels the partner: INVESTOR (capital partner) or DRIVER
// (driver-contributor modeled as a per-truck profit participant by %).
export interface TruckCapEntry {
  id: number;
  truckId: number;
  partnerName: string;
  percentage: string;
  role: TruckCapRole;
  effectiveDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface Distribution {
  id: number;
  quarter: number;
  year: number;
  partnerName: string;
  amount: string;
  /** F3 — owning truck for per-vehicle distribution rows; NULL on legacy entity rows. */
  truckId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagementFee {
  id: number;
  month: number;
  year: number;
  amount: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: number;
  timestamp: string;
  userId: number | null;
  message: string;
  entityType: string | null;
  entityId: number | null;
  payload: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

// ─── Notifications ──────────────────────────────────────────────────────────

export interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: number | null;
  isRead: boolean;
  createdAt: string;
}

/** A Web Push subscription delivered to the backend for storage. Mirrors the
 *  browser's `PushSubscription.toJSON()` shape (endpoint + encryption keys). */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceType?: 'ios' | 'android' | 'web';
}

// ─── Vendor & Expense ───────────────────────────────────────────────────────────

export interface Supplier {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  taxCode: string | null;
  note: string | null;
  status: string;
  linkedCustomerId: number | null;
  isFuelSupplier: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  isRenewable: boolean;
  reminderLeadDays: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Expense {
  id: number;
  expenseDate: string;
  supplierId: number;
  categoryId: number;
  truckId: number | null;
  vehicleComponent: 'TRUCK' | 'TRAILER' | null;
  amount: string;
  paymentStatus: string;
  validFrom: string | null;
  validTo: string | null;
  receiptId: string | null;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ExpenseWithRefs extends Expense {
  supplier?: Supplier;
  category?: ExpenseCategory;
  truck?: { id: number; licensePlate: string };
  trailer?: { id: number; licensePlate: string; type: string };
}

export interface PayableSummary {
  supplier: Supplier;
  totalOutstanding: number;
  aging: {
    current: number;
    d30: number;
    d60: number;
    over90: number;
  };
  maxOverdueDays: number;
  /**
   * Origin of the payable row.
   * - 'vendor': a normal supplier (VENDOR ledger) — click-through goes to the
   *   supplier statement page.
   * - 'carrier': an external carrier (CARRIER ledger, with historical CUSTOMER
   *   rows projected for compatibility) — click-through goes to its payable
   *   statement, never the customer receivable workflow.
   * Undefined for legacy responses that did not distinguish the two.
   */
  kind?: 'vendor' | 'carrier';
}

/** Payables category filter — drives the server-side txnType/entityType scoping. */
export type PayablesCategory = 'fuel' | 'ancillary' | 'commission' | 'carrier';

export interface SupplierStatement {
  supplier: Pick<Supplier, 'id' | 'name' | 'phone' | 'contactPerson'>;
  ledgerRows: LedgerEntry[];
  totalOutstanding: number;
  agingBuckets: AgingBucket[];
  /** Only present when the request was scoped to a date range. */
  periodSummary?: PeriodSummary;
}

export interface RenewalReminder {
  id: number;
  expenseId: number;
  categoryId: number;
  categoryName: string;
  truckId: number | null;
  truckPlate: string | null;
  validTo: string;
  reminderLeadDays: number;
  daysRemaining: number;
}

export interface VendorPaymentRequest {
  supplierId: number;
  receiptId: string;
  amount: number;
  date: string;
  confirmOverpay?: boolean;
}

// ─── Forwarder catalogs ──────────────────────────────────────────────────────────

export interface ContainerType {
  id: number;
  code: string;   // e.g. "20DC", "40HC"
  name: string;   // e.g. "20'DC", "40'HC"
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface SealType {
  id: number;
  name: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Port {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ─── Forwarder ────────────────────────────────────────────────────────────────────

export interface TripContainerSeal {
  id: number;
  tripContainerId: number;
  sealNumber: string;
  sealType: string | null;
  notes: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Per-container photo (storage-key + type), grouped under each container. */
export interface TripContainerPhoto {
  id: number;
  type: 'CONTAINER' | 'SEAL';
  storageKey: string;
  uploadedAt: string;
}

export interface TripContainer {
  id: number;
  tripId: number;
  containerTypeId: number | null;
  containerTypeName: string | null; // joined display name
  containerNumber: string | null;
  sealNumber: string | null;
  cargoWeightKg: number | null;
  notes: string | null;
  createdBy: number;
  createdAt: string;
  /** Phase 2: per-container seals (newest-first by id). The legacy
   *  `sealNumber` field is kept as the "primary" seal (first child row)
   *  for back-compat with older clients. */
  seals?: TripContainerSeal[];
  /** Phase 2: photos explicitly linked to this container via
   *  trip_photos.trip_container_id. Photos with null container_id remain
   *  trip-level (surfaced separately in the response, not here). */
  photos?: TripContainerPhoto[];
}

export interface TripExpense {
  id: number;
  tripId: number;
  forwarderId: number | null;
  expenseType: string;
  buyAmount: string;
  sellAmount: string;
  settlementMethod: 'COMPANY_DIRECT' | 'FORWARDER_ADVANCE';
  supplierId: number | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  declarationNumber: string | null;
  containerNumber: string | null;
  tripContainerId: number | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TripExpenseCompletionScope {
  tripId: number;
  tripContainerId: number | null;
  status: ExpenseEntryStatus;
  completedBy: number | null;
  completedAt: string | null;
  completedByName?: string | null;
}

export interface TripExpenseWithRefs extends TripExpense {
  forwarderName?: string | null;
  tripCode?: string | null;
}

export interface AdvanceRequest {
  id: number;
  requesterId: number;
  amount: string;
  reason: string;
  status: AdvanceRequestStatus;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface AdvanceRequestWithRefs extends AdvanceRequest {
  requesterName?: string | null;
  approverName?: string | null;
}

export interface AdvanceSettlement {
  id: number;
  code: string;
  forwarderId: number;
  totalExpenseAmount: string;
  refundAmount: string;
  status: AdvanceSettlementStatus;
  checkedBy: number | null;
  checkedAt: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdvanceSettlementWithRefs extends AdvanceSettlement {
  forwarderName?: string | null;
  checkerName?: string | null;
  approverName?: string | null;
  opsCompletion?: {
    tripCount: number;
    completedGroupCount: number;
    totalGroupCount: number;
    trips: Array<{
      tripId: number;
      tripCode?: string | null;
      departureDate?: string | null;
      completedGroupCount: number;
      totalGroupCount: number;
      groups: Array<{
        tripContainerId: number | null;
        containerNumber?: string | null;
        expenseCount: number;
        status: ExpenseEntryStatus;
      }>;
    }>;
  };
  linkedRequests?: AdvanceRequest[];
  linkedExpenses?: Array<TripExpense & {
    tripCode?: string | null;
    departureDate?: string | null;
    customerName?: string | null;
    routeName?: string | null;
    tripContainerCount?: number | null;
    expenseTypeName?: string | null;
    submittedBuyAmount?: string | null;
    submittedSellAmount?: string | null;
    adjustmentReason?: string | null;
    adjustedAt?: string | null;
    adjustedByName?: string | null;
  }>;
}

/** Trip detail projection returned by the forwarder GET /trips/:id endpoint. */
export interface ForwarderTripDetail {
  id: number;
  tripCode: string | null;
  departureDate: string;
  status: TripStatus;
  routeName: string | null;
  truckPlate: string | null;
  customerName: string | null;
  customerReference: string | null;
  containerCount: number | null;
  cargoTypeName: string | null;
  notes: string | null;
  /** Manager-authored contact + delivery guidance. null when no row exists. */
  instructions: TripInstruction | null;
  legs: TripLeg[];
  containers: Array<{
    id: number;
    tripId: number;
    containerTypeId: number | null;
    containerTypeName: string | null;
    containerNumber: string | null;
    sealNumber: string | null;
    notes: string | null;
    createdBy: number;
    createdAt: string;
  }>;
  completionScopes: TripExpenseCompletionScope[];
  completionProgress: { completed: number; total: number };
  expenses: Array<{
    id: number;
    tripId: number;
    forwarderId: number | null;
    expenseType: string;
    buyAmount: string;
    sellAmount: string;
    settlementMethod: string;
    supplierId: number | null;
    supplierName: string | null;
    containerNumber: string | null;
    tripContainerId: number | null;
    activeSettlementId: number | null;
    canEdit: boolean;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    declarationNumber: string | null;
    approvalStatus: string;
    note: string | null;
    createdAt: string;
    forwarderName: string | null;
  }>;
}

/** Trip expense as returned by forwarder unlinked-expenses and financial advance-settlements endpoints. */
export interface TripExpenseWithSupplier extends TripExpense {
  supplierName?: string | null;
  forwarderName?: string | null;
  tripCode?: string | null;
  departureDate?: string | null;
  truckPlate?: string | null;
  containerNumbers?: string | null;
  completionStatus?: ExpenseEntryStatus;
  completionProgress?: { completed: number; total: number };
}

// ─── API types ───────────────────────────────────────────────────────────────

/**
 * Manager-authored contact + free-text guidance for a trip (N2 / B1.3).
 * One row per trip. Manager writes via TripEdit; driver reads read-only via
 * DriverTripDetailPage. `instructions` is null when no row exists yet.
 */
export interface TripInstruction {
  id: number;
  tripId: number;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  updatedAt: string;
}

/** A real GPS waypoint from the truck's Bách Khoa stop report — used to place
 *  numbered map markers at actual driven stop coordinates. */
export interface GpsStop {
  lat: number;
  lng: number;
  address?: string | null;
  startTime?: string | null;
}

export interface TripDetail extends Trip {
  legs: TripLeg[];
  driver?: Driver;
  truck?: Truck;
  trailer?: Trailer;
  route?: Route;
  customer?: Customer;
  cargoType?: CargoType;
  fuelSupplier?: { id: number; name: string } | null;
  instructions?: TripInstruction | null;
  /** The vehicle's full real GPS trail (Bách Khoa), captured at completion.
   *  The complete driven path — drawn on the trip map as the real route.
   *  `stops` are the truck's ordered significant stops (real GPS waypoints) so
   *  the map can render numbered markers at every real stop 1..N. */
  gpsTrail?: { encodedPolyline: string; distanceKm: number; pointCount: number; stops: GpsStop[] } | null;
}

export interface CreateTripRequest {
  customerId: number;
  routeId: number;
  truckId?: number | null;
  driverId?: number | null;
  cargoTypeId: number;
  departureDate: string;
  customerReference?: string;
  containerCount?: number;
  containerTypeId: number;
  fuelMode?: FuelMode;
  fuelSupplierId?: number | null;
  vatRate?: number;
  carrierType?: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number | null;
  externalFreightCost?: number | null;
  externalPlateNumber?: string | null;
  externalDriverName?: string | null;
  externalDriverPhone?: string | null;
}

export interface TripLegInput {
  sequence: number;
  origin: string;
  destination: string;
  km: number;
  loadingType: LoadingType;
}

export interface UpdateTripFiguresRequest {
  legs: TripLegInput[];
  customerId?: number;
  departureDate?: string;
  completedAt?: string;
  fuelMode: FuelMode;
  fuelLitersOverride?: number | null;
  fuelSupplementLiters?: number;
  fuelSupplementReason?: string;
  fuelActualUnitPrice?: number | null;
  fuelSupplierId?: number | null;
  tollsDiscount?: number;
  tollsAddition?: number;
  tollsStations?: number;
  hasReturnCargo?: boolean;
  roadAllowanceOverride?: number | null;
  driverSalary?: number;
  revenue?: number;
  revenueEmptyReturn?: number;
  revenueCombine?: number;
  customerCommission?: number;
  tripWageDays?: number;
  twoPointDeliveryBonus?: number;
  vehicleShiftAllowance?: number;
  notes?: string;
  photoUrls?: string[];
  version?: number;
  routeId?: number;
  vatRate?: number;
  carrierType?: 'OWN' | 'EXTERNAL';
  externalCarrierId?: number;
  externalFreightCost?: number;
  externalPlateNumber?: string;
  externalDriverName?: string;
  externalDriverPhone?: string;
}

export type BulkTripFiguresMode = 'pre-departure' | 'actuals';

export interface BulkUpdateTripFiguresRequest {
  updates: Array<{
    tripId: number;
    mode?: BulkTripFiguresMode;
    figures: UpdateTripFiguresRequest;
  }>;
}

export interface BulkUpdateTripFiguresResult {
  tripId: number;
  ok: boolean;
  trip?: Trip;
  error?: string;
}

export interface BulkUpdateTripFiguresResponse {
  results: BulkUpdateTripFiguresResult[];
  updated: number;
  failed: number;
}

export interface CreatePaymentRequest {
  customerId: number;
  receiptId: string;
  payments: { tripId: number; amount: number }[];
}

export interface CreatePenaltyRequest {
  driverId: number;
  tripId?: number;
  reasonId?: number;
  customReason?: string;
  amount: number;
  date: string;
}

export interface CreateAdjustmentRequest {
  tripId: number;
  amount: number;
  note: string;
  signedAgreementRef: string;
}

export interface LoginResponse {
  token: string;
  user: UserPublic;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  revenue: number;
  costs: number;
  grossProfit: number;
  tripCount: number;
  /** Count of LOCKED trips — the subset whose revenue/costs contribute to the KPIs. */
  lockedTrips?: number;
  completedTrips: number;
  inTransitTrips: number;
  totalTrucks?: number;
  totalDrivers?: number;
  fleetStatus?: Record<string, number>;
  topOverdueCustomer?: { name: string; balance: number; days: number } | null;
  topShareholder?: { name: string; percentage: number } | null;
  decisionItems?: DashboardDecisionItem[];
}

export type DashboardDecisionSeverity = 'critical' | 'warning' | 'info' | 'success';

export type DashboardDecisionKind =
  | 'receivables'
  | 'dispatch'
  | 'renewal'
  | 'fuel'
  | 'trip-lock'
  | 'trip-data'
  | 'profit-close'
  | 'all-clear';

export interface DashboardDecisionItem {
  id: string;
  kind: DashboardDecisionKind;
  severity: DashboardDecisionSeverity;
  title: string;
  subtitle: string;
  actionLabel?: string;
  route?: string;
  priority: number;
}

/** Parse a threshold value safely — returns fallback for NaN/null/undefined */
export function parseThreshold(raw: string | number | null | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export interface AgingBucket {
  range: string;
  amount: number;
}

/**
 * Period summary for the AR/AP detail pages' period filter.
 *
 * Sign convention (mirrors LedgerService.postEntry):
 *   - CUSTOMER (AR): outstanding balance grows with debits, shrinks with credits.
 *     `periodActivity = debitTotal − creditTotal`.
 *   - VENDOR  (AP): outstanding balance grows with credits, shrinks with debits.
 *     `periodActivity = creditTotal − debitTotal`.
 *
 * `openingBalance` is read from the stored `balance` column of the ledger row
 * with the largest `id` strictly before `dateFrom` (0 if none). `closingBalance
 * = openingBalance + periodActivity`.
 *
 * On the wire this field is OMITTED from `CustomerStatement` /
 * `SupplierStatement` when no period filter is active (the backend returns
 * `null` and the caller omits it). Frontend consumers should treat `undefined`
 * as "no period filter — render the all-time total / loading state" and never
 * expect a present-but-null-valued object.
 */
export interface PeriodSummary {
  openingBalance: number;
  closingBalance: number;
  periodActivity: number;
  debitTotal: number;
  creditTotal: number;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface UnpaidTrip {
  tripId: number;
  date: string;
  outstanding: number;
  note: string;
}

export interface CustomerStatement {
  customer: Pick<Customer, 'id' | 'name' | 'contactInfo' | 'isCarrier'> & { debitNoteMode?: string | null };
  ledgerRows: LedgerEntry[];
  agingBuckets: AgingBucket[];
  totalOutstanding: number;
  unpaidTrips: UnpaidTrip[];
  /** Only present when the request was scoped to a date range. */
  periodSummary?: PeriodSummary;
}

export interface DebtOffset {
  id: number;
  customerId: number;
  supplierId: number;
  amount: string;
  offsetDate: string;
  note: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdBy: number | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

// ─── Billing Documents (debit notes + payment statements) ─────────────────────
// Saved SNAPSHOT documents composed by kế toán / quản lý.
// Saving never mutates the append-only ledger — these are presentation artifacts.
// entityType CUSTOMER = AR customer (debit note) OR AP external carrier (payment
// statement, since carriers live in the customers catalog per decision D-E/F);
// entityType VENDOR = AP supplier (fuel / ancillary).

export type BillingDocumentType = 'DEBIT_NOTE' | 'PAYMENT_STATEMENT';
export type BillingDocumentEntityType = 'CUSTOMER' | 'VENDOR';
export type BillingLineSourceType = 'TRIP' | 'EXPENSE' | 'ADHOC';
export type BillingLineType = 'FREIGHT' | 'SERVICE_FEE' | 'ADHOC';
export type DebitNoteColumnVariable =
  | 'rowIndex'
  | 'departureDate'
  | 'truckPlate'
  | 'actionType'
  | 'origin'
  | 'destination'
  | 'deliveryAddress'
  | 'container20Count'
  | 'container40Count'
  | 'containerCount'
  | 'containerNumbers'
  | 'routeName'
  | 'description'
  | 'lineTypeLabel'
  | 'unit'
  | 'amount'
  | 'freightAmount'
  | 'serviceFeeAmount'
  | 'totalAmount'
  | 'serviceFeeDescription'
  | 'note'
  | 'tripCode'
  | 'documentCode';

export interface BillingLineRenderData {
  tripCode?: string | null;
  documentCode?: string | null;
  departureDate?: string | null;
  truckPlate?: string | null;
  actionType?: string | null;
  origin?: string | null;
  destination?: string | null;
  deliveryAddress?: string | null;
  container20Count?: number | null;
  container40Count?: number | null;
  containerCount?: number | null;
  freightAmount?: number | null;
  serviceFeeAmount?: number | null;
  totalAmount?: number | null;
  serviceFeeDescription?: string | null;
  note?: string | null;
}

export interface BillingDocumentLine {
  id?: number;
  documentId?: number;
  sourceType: BillingLineSourceType;
  sourceId: number | null;        // tripId | tripExpenseId | null (ADHOC)
  lineType: BillingLineType;
  typeLabel: string;              // Custom label for lineType (e.g. Doanh thu, Phí chi hộ)
  unit: string;                   // Custom unit (e.g. lần, chuyến)
  description: string;
  routeName?: string | null;
  containerNumbers?: string[] | null;
  renderData?: BillingLineRenderData | null;
  baseAmount: number;             // generated amount (incl-VAT, VND)
  amountOverride?: number | null; // edited amount; effective = override ?? baseAmount
  excluded?: boolean;             // hidden from this document
  sortOrder: number;
}

export interface BillingDocument {
  id: number;
  type: BillingDocumentType;
  entityType: BillingDocumentEntityType;
  entityId: number;
  entityName?: string;
  rangeFrom: string;              // ISO date (trip departure-date basis)
  rangeTo: string;
  note: string | null;
  totalInclVat: number;           // sum of non-excluded effective line amounts
  ledgerAdjustmentAmount?: number; // net AR adjustment posted by this document
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  // Template used to render this doc. The snapshot is the frozen render-only
  // copy actually used at export — see DebitNoteTemplateSnapshot.
  debitNoteTemplateId?: number | null;
  debitNoteTemplateSnapshot?: DebitNoteTemplateSnapshot | null;
  lines: BillingDocumentLine[];
}

/** Lines returned by the generate/preview step, before save. */
export type BillingDraftLine = Omit<BillingDocumentLine, 'id' | 'documentId'>;

export interface BillingDocumentDraft {
  type: BillingDocumentType;
  entityType: BillingDocumentEntityType;
  entityId: number;
  entityName: string;
  rangeFrom: string;
  rangeTo: string;
  lines: BillingDraftLine[];
  totalInclVat: number;
}

// ─── Billing document Excel templates ────────────────────────────────────────
// Excel-only column templates. Accountants define the table columns and bind
// each column to a supported variable from BillingDocumentLine/renderData.
export interface DebitNoteTemplateColumn {
  id: string;
  label: string;
  variable: DebitNoteColumnVariable;
  width: number;
  align: 'left' | 'center' | 'right';
  format: 'text' | 'date' | 'number' | 'currency';
  total: boolean;
}

export interface DebitNoteTemplate {
  id: number;
  name: string;
  isDefault: boolean;
  documentType: BillingDocumentType;
  titleText: string;
  issuerName: string | null;
  issuerAddress: string | null;
  issuerTaxCode: string | null;
  issuerRepresentative?: string | null;
  accentColor: string;
  showContainerColumn: boolean;
  showUnitColumn: boolean;
  groupingMode: 'ROUTE' | 'LINE_TYPE' | 'NONE';
  columns: DebitNoteTemplateColumn[];
  amountInWords: boolean;        // Phase 2 — rendered read-only in UI
  orientation: 'landscape' | 'portrait';
  termsText: string | null;
  signatureLeftLabel: string | null;
  signatureLeftName: string | null;
  signatureRightLabel: string | null;
  signatureRightName: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Frozen render-only copy of a template, stored on each billing document so a
 * historical debit note re-exports identically after the template is edited or
 * deleted.
 */
export interface DebitNoteTemplateSnapshot {
  id: number | null;
  name: string;
  titleText: string;
  issuerName: string | null;
  issuerAddress: string | null;
  issuerTaxCode: string | null;
  issuerRepresentative?: string | null;
  accentColor: string;
  showContainerColumn: boolean;
  showUnitColumn: boolean;
  groupingMode: 'ROUTE' | 'LINE_TYPE' | 'NONE';
  columns: DebitNoteTemplateColumn[];
  orientation: 'landscape' | 'portrait';
  termsText: string | null;
  signatureLeftLabel: string | null;
  signatureLeftName: string | null;
  signatureRightLabel: string | null;
  signatureRightName: string | null;
}

// ─── Reports ────────────────────────────────────────────────────────────────────

export interface PnlTruck {
  id: number;
  plate: string;
  revenue: number;
  costs: number;
  profit: number;
  trips: number;
  maintenanceExpenses: number;
  serviceMargin?: number;
  externalMargin?: number;
}

export interface PnlMaintenanceItem {
  id: number;
  expenseDate: string;
  categoryName: string;
  supplierName: string;
  vehicleComponent: 'TRUCK' | 'TRAILER' | null;
  amount: number;
  note: string | null;
}

export interface PnlTripDetail {
  id: number;
  tripCode: string;
  departureDate: string;
  routeName: string;
  revenue: number;
  customerCommission: number;
  fuelOrHireCost: number;
  roadAllowance: number;
  tollAndCompanyTickets: number;
  driverAndAllowances: number;
  totalCost: number;
  profit: number;
  costDifference: number;
  costMatches: boolean;
  isExternal: boolean;
  vehicleBucketId: number;
}

export interface PnlReport {
  period: { month: number; year: number };
  totalRevenue: number;
  totalCosts: number;
  grossProfit: number;
  managementFee: number;
  otherIncome: number;
  netProfit: number;
  tripCount: number;
  trucks: PnlTruck[];
  maintenanceExpensesTotal: number;
  maintenanceExpensesByTruck: Record<number, string>;
  maintenanceByComponent: Record<number, { truck: number; trailer: number }>;
  maintenanceItemsByTruck?: Record<number, PnlMaintenanceItem[]>;
  tripDetails?: PnlTripDetail[];
  companyExpenses: number;
  categoryBreakdown: Array<{ categoryName: string; total: string }>;
  serviceMarginTotal?: number;
  externalMarginTotal?: number;
  externalTripsCount?: number;
}

// ─── Salary Period ─────────────────────────────────────────────────────────────

export interface SalaryPeriod {
  id: number;
  month: number | null;           // null for global default row
  year: number | null;            // null for global default row
  startDate: string | null;      // null for global default (derived)
  endDate: string | null;        // null for global default (derived)
  label: string | null;
  defaultStartDay: number | null; // only set on global default
  defaultEndDay: number | null;   // only set on global default
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

// ─── Approval Queue ────────────────────────────────────────────────────────────

export type ApprovalItemType =
  | 'ancillaryFees'
  | 'debtOffsets'
  | 'advances'
  | 'advanceSettlementsCheck'
  | 'advanceSettlementsApprove';

/** Resolved salary period date range returned by the resolve endpoint */
export interface SalaryPeriodRange {
  month: number;
  year: number;
  start: string;  // YYYY-MM-DD inclusive
  end: string;    // YYYY-MM-DD inclusive
  label: string;
}

// ─── Live Fleet Tracking (Bách Khoa GPS) ──────────────────────────────────────

/**
 * Normalized GPS status bucket. The backend derives this from Bách Khoa's
 * free-text `CarStatus` (e.g. "Mất tín hiệu", "Dừng") plus the report's
 * freshness, so the frontend can color markers consistently.
 */
export type LiveFleetStatus = 'moving' | 'stopped' | 'offline';

/** One planned leg of a trip's route, with its cached polyline for map drawing. */
export interface LiveFleetLeg {
  sequence: number;
  origin: string;
  destination: string;
  loadingType: LoadingType;   // HANG = đi (loaded), VO = về (empty return)
  polylinePath: string | null;
}

/**
 * A single tracked vehicle: a live GPS reading joined to its active
 * IN_TRANSIT trip. Only trucks currently on an active trip are returned.
 */
export interface LiveFleetVehicle {
  // Identity / join key
  truckId: number;
  licensePlate: string;
  deviceId: string | null;
  // Live GPS telemetry (Bách Khoa GetInfoCar)
  lat: number;
  lng: number;
  speed: number;            // km/h
  angle: number;            // heading, degrees
  address: string | null;
  status: LiveFleetStatus;
  ignitionOn: boolean;      // Acc "Bật" / "Tắt"
  fuel: number | null;      // Oil sensor reading; null when no sensor fitted
  gpsDriverName: string | null;
  lastSeenAt: string;       // ISO timestamp of the device report
  stale: boolean;           // report older than the staleness threshold
  // Active/recent trip context (joined server-side). Null when the truck has no
  // recent trip (fleet-overview mode shows such trucks at their last-known spot).
  tripId: number | null;
  tripCode: string | null;
  driverName: string | null;
  customerName: string | null;
  routeName: string | null;
  /** Planned route legs (with polylines) for drawing the remaining path to the destination. */
  legs?: LiveFleetLeg[];
  /** Extended telemetry from the portal endpoint (null when only the public API is used). */
  details?: LiveFleetDetails | null;
}

/** Response shape for GET /api/trips/live-fleet. */
export interface LiveFleetResponse {
  vehicles: LiveFleetVehicle[];
  stale: boolean;           // true when every vehicle is stale OR provider down
  fetchedAt: string;        // ISO timestamp of this response
  error?: string;           // present when the provider is unavailable / misconfigured
}

/**
 * Extended telemetry only the web-portal endpoint exposes (the documented public
 * API returns just position/speed/fuel/ignition). All fields nullable because
 * devices vary — e.g. no camera, no odometer, no driver-license RFID.
 */
export interface LiveFleetDetails {
  // Vehicle
  modelCar: string | null;
  odometerKm: number | null;        // total km run
  kmToday: number | null;           // km driven today
  // Engine & power
  engineSince: string | null;       // ignition last turned on (dd/MM/yyyy HH:mm)
  doorStatus: string | null;        // "Đóng" / "Mở"
  airConditioning: string | null;   // "Bật" / "Tắt"
  batteryV: string | null;          // battery voltage
  // Driving behaviour
  drivingTime: string | null;       // driving time this session "HH:mm:ss"
  drivingTimeToday: string | null;  // driving time today "HH:mm:ss"
  stopCount: number | null;         // stops today
  overSpeedCount: number | null;    // overspeed events today
  parkedTime: string | null;        // parked/stopped duration
  // Fuel
  fuelPercent: number | null;       // 0-100
  // Connectivity
  signalDb: number | null;          // GSM signal strength
  // Driver (from device RFID; may differ from the assigned driver)
  driverLicense: string | null;
  driverPhone: string | null;
  licenseIssued: string | null;     // dd/MM/yyyy
  licenseExpiry: string | null;     // dd/MM/yyyy
  // Camera
  cameraImage: string | null;       // latest snapshot URL
}
