import {
  pgTable, serial, varchar, text, integer, boolean, timestamp,
  jsonb, numeric, date, uniqueIndex, index, doublePrecision, smallint,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// pgvector `vector(N)` column type. Drizzle doesn't know pgvector, so we declare
// a custom type whose SQL is `vector(dim)`. Runtime reads/writes of the vector
// go through raw `db.execute(sql\`...\`)` with the `<=>` operator (see
// services/agent/faq-fast-lane.ts); this def gives the table object + typing.
// The JS representation is the pgvector string literal '[0.1,0.2,...]'.
// Usage: `vectorColumn1536('embedding')` — returns a column. We export a
// pre-configured column for the 1536-dim FAQ embeddings (the only vector column).
const vector1536Builder = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
});
export const vectorColumn1536 = vector1536Builder;

// Application-owned enum values; PostgreSQL stores unrestricted text columns.

function applicationEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const builder = (name: string) => text(name, { enum: values });
  return Object.assign(builder, { enumValues: values });
}

// Enums
export const tripStatusEnum = applicationEnum(['CREATED', 'IN_TRANSIT', 'COMPLETED', 'CANCELED']);
export const fuelModeEnum = applicationEnum(['AUTO', 'FLAT_RATE']);
export const loadingTypeEnum = applicationEnum(['HANG', 'VO']);
export const roleEnum = applicationEnum(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'FORWARDER', 'CUSTOMER', 'CLERK', 'DISPATCHER']);
export const customerAccountTypeEnum = applicationEnum(['SINGLE_ENTITY', 'CORPORATE_GROUP', 'AGENCY']);
export const txnTypeEnum = applicationEnum(['TRIP_REVENUE', 'PAYMENT_RECEIVED', 'PENALTY', 'MANAGEMENT_FEE', 'ADJUSTMENT', 'DRIVER_SALARY', 'VENDOR_EXPENSE', 'VENDOR_PAYMENT', 'FORWARDER_ADVANCE', 'FORWARDER_SETTLEMENT', 'EXTERNAL_CARRIER_COST', 'FUEL_EXPENSE', 'UNLOCK_REVERSAL', 'COMMISSION', 'DRIVER_PAYOUT', 'SERVICE_FEE']);
export const trailerTypeEnum = applicationEnum(['20FT', '40FT']);
export const truckStatusEnum = applicationEnum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
export const driverStatusEnum = applicationEnum(['ACTIVE', 'INACTIVE']);
export const customerStatusEnum = applicationEnum(['ACTIVE', 'LOCKED']);
export const tripPhotoTypeEnum = applicationEnum(['CONTAINER', 'SEAL', 'OTHER']);
export const penaltyStatusEnum = applicationEnum(['ACTIVE', 'CANCELED']);
export const vehicleComponentEnum = applicationEnum(['TRUCK', 'TRAILER']);
export const trailerStatusEnum = applicationEnum(['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
// NOTE: forwarder_expense_type pgEnum removed — replaced by forwarder_expense_types config table.
// trip_expenses.expense_type is now varchar(50) referencing config codes.
export const advanceRequestStatusEnum = applicationEnum(['PENDING', 'APPROVED', 'REJECTED']);
export const advanceSettlementStatusEnum = applicationEnum(['PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED', 'REVERSED']);
export const creditOverrideStatusEnum = applicationEnum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELED']);
export const creditOverrideScopeEnum = applicationEnum(['SHIPMENT', 'EXPIRY']);
export const creditOverrideTierEnum = applicationEnum(['FINANCE_TIER_1', 'DIRECTOR']);
export const notificationTypeEnum = applicationEnum([
  'TRIP_CREATED', 'TRIP_DISPATCHED', 'TRIP_IN_TRANSIT', 'TRIP_COMPLETED',
  'TRIP_CANCELED', 'PAYMENT_RECEIVED', 'PENALTY_CREATED',
  'PENALTY_CANCELED', 'OVERDUE_PAYMENT', 'SALARY_PERIOD_CLOSING', 'SYSTEM_ANNOUNCEMENT',
  'ADVANCE_SETTLEMENT_APPROVED', 'SHIPMENT_HANDOFF',
]);
export const workDayStatusEnum = applicationEnum(['TRIP_DAY', 'STANDBY', 'PERSONAL_LEAVE', 'WEEKLY_OFF']);

// ─── Wave 1: Pricing & Fuel enums ───────────────────────────────────────────
// Direction of a lift (nâng/hạ) container movement at a port/yard.
export const liftDirectionEnum = applicationEnum(['LIFT_UP', 'LIFT_DOWN']);
// O2C B3: cargo state for the lift-pricing matrix. The customer's port-fee
// schedule (THÔNG TIN CẢNG BÃI) prices lifts differently for empty vs loaded
// containers (Container Rỗng vs Container Hàng).
export const loadStateEnum = applicationEnum(['LOADED', 'EMPTY']);
// Type of ancillary (non-transport) revenue. PRD M2.5 §1 proposes this set;
// additional types are application changes and require no database enum migration.
export const ancillaryRevenueTypeEnum = applicationEnum([
  'LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER',
]);
// How a trip's freight revenue was computed: TIER = weight-tier pricing,
// TABLE = fixed customer-route pricing, MANUAL = operator override.
export const pricingSourceEnum = applicationEnum(['TIER', 'TABLE', 'MANUAL']);

// ─── Wave 2: CUS enums ─────────────────────────────────────────────────────
// Debit-note lifecycle (M3.6). Extends the implicit 'DRAFT' default the
// existing billing_documents table already uses (no status column yet).
export const debitNoteStatusEnum = applicationEnum([
  'DRAFT', 'SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID',
  'PAID', 'REJECTED', 'CANCELED',
]);
// Milestone type for shipment tracking (M3.3). Derived from trip status +
// manual CUS notifications.
export const milestoneTypeEnum = applicationEnum([
  'BOOKING_RECEIVED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED',
  'CUSTOMS_CLEARED', 'PICKED_UP', 'MANUAL',
]);
// Email log status for the customer_email_logs table (M3.3).
export const emailStatusEnum = applicationEnum([
  'PENDING', 'SENT', 'FAILED', 'OPENED',
]);
export const fuelEvidenceOcrOutcomeEnum = applicationEnum([
  'ACCEPTED', 'UNREADABLE', 'MULTI_SCREEN', 'NON_PUMP', 'ANOMALY',
]);
export const fuelEvidenceReviewStatusEnum = applicationEnum([
  'PENDING', 'CONFIRMED', 'REJECTED',
]);

// ─── Config tables ───────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 100 }).unique(),
  email: varchar('email', { length: 255 }).unique(),
  phone: varchar('phone', { length: 20 }).unique(),
  // Human-readable full name (e.g. "Lê Văn Tài"). Used as the actor label in
  // audit log messages so users see "Quản lý Lê Văn Tài khóa chuyến" instead
  // of the email "Quản lý giamdoc@nepo.vn khóa chuyến #76".
  fullName: varchar('full_name', { length: 255 }),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('DRIVER'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  // Wave 0: optional 1:1 link from a CUSTOMER-role user to the AR customer
  // whose data they may see in the customer portal (Wave 2). Nullable +
  // Application delete handling unlinks users when deleting a customer (rather
  // than cascading the delete onto the user accounts). Non-CUSTOMER roles
  // leave this NULL. M:N expansion (multiple logins per customer org) can
  // layer a customer_users join table on top without changing the helper's
  // signature.
  //
  // NOTE: declared as a plain integer to avoid
  // a TypeScript circular-initializer error. The chain
  // `users → customers → debitNoteTemplates → users` is valid at runtime
  // (Drizzle's lazy `() =>` resolves it) but TS strict mode rejects the
  // cycle. The application service enforces this relationship.
  customerId: integer('customer_id'),
  customerAccountType: customerAccountTypeEnum('customer_account_type').notNull().default('SINGLE_ENTITY'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const trucks = pgTable('trucks', {
  id: serial('id').primaryKey(),
  licensePlate: varchar('license_plate', { length: 20 }).unique().notNull(),
  trailerPlateNumber: varchar('trailer_plate_number', { length: 20 }),
  trailerType: trailerTypeEnum('trailer_type'),
  currentTrailerId: integer('current_trailer_id'),
  status: truckStatusEnum('status').default('ACTIVE'),
  // N5 / A12 + B4: user-keyed compliance/service dates for alerts.
  nextInspectionDate: date('next_inspection_date'),
  insuranceExpiryDate: date('insurance_expiry_date'),
  // NEXT oil-service due date (YYYY-MM-DD). The form lets a manager set it
  // directly OR compute it from "last change + N months"; only the resolved
  // next-due is persisted. Legacy column name retained (deployed in 0049).
  lastOilServiceDate: date('last_oil_service_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const trailers = pgTable('trailers', {
  id: serial('id').primaryKey(),
  licensePlate: varchar('license_plate', { length: 20 }).notNull().unique(),
  type: trailerTypeEnum('type').notNull(),
  status: trailerStatusEnum('status').default('ACTIVE').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const drivers = pgTable('drivers', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  assignedTruckId: integer('assigned_truck_id'),
  baseSalary: numeric('base_salary', { precision: 15, scale: 0 }),
  // BHXH/BHYT monthly contribution — tracked SEPARATELY for cost allocation; NOT part of daily_rate
  // or trip-salary auto-fill (Pete 2026-06: baseSalary only — base/std_days, no socialInsurance)
  socialInsurance: numeric('social_insurance', { precision: 15, scale: 0 }).default('0'),
  status: driverStatusEnum('status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('drivers_active_user_uniq_idx')
    .on(table.userId)
    .where(sql`${table.userId} is not null and ${table.deletedAt} is null`),
]);

export const partners = pgTable('partners', {
  id: serial('id').primaryKey(),
  normalizedTaxCode: varchar('normalized_tax_code', { length: 40 }).notNull(),
  displayTaxCode: varchar('display_tax_code', { length: 40 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('partners_normalized_tax_code_uniq_idx').on(table.normalizedTaxCode),
]);

// Defined before customers to allow customers.linkedSupplierId to reference suppliers.id directly.
// suppliers.linkedCustomerId stays a plain identifier to break the mutual circular
// forward-reference that causes TS7022. Application services enforce the relationship.
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  contactPerson: varchar('contact_person', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  taxCode: varchar('tax_code', { length: 20 }),
  partnerId: integer('partner_id'),
  note: text('note'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  linkedCustomerId: integer('linked_customer_id'), // Customer relationship is enforced in application code.
  isFuelSupplier: boolean('is_fuel_supplier').default(false).notNull(),
  // Wave 3 M6.2: supplier-type taxonomy (multi-value). NULL or empty =
  // uncategorized. The `isFuelSupplier` boolean above is mirrored from
  // `types.includes('FUEL')` by supplier-types.service.syncFuelFlag, so
  // existing reads keep working unchanged.
  types: text('types').array(),
  primaryType: varchar('primary_type', { length: 30 }),
  // O2C rev1 §B0: a real NCC has two distinct debt milestones — chi-hộ
  // disbursements and freight/cước. Both nullable: NULL = unset (the ledger
  // post leaves paymentTermDaysApplied null and aging falls back to default).
  chiHoDueDays: integer('chi_ho_due_days'),
  cuocDueDays: integer('cuoc_due_days'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('suppliers_partner_idx').on(table.partnerId),
]);

// ─── N1 — Tires ──────────────────────────────────────────────────────────────
// Tracks individual tires by serial, vehicle assignment (truck OR trailer),
// install/remove dates, supplier, purchase date, and disposal metadata. Status
// is a plain string so the app can stay aligned with the requirement wording
// instead of baking extra lifecycle states into a database enum.
export const tires = pgTable('tires', {
  id: serial('id').primaryKey(),
  serial: varchar('serial', { length: 64 }).notNull().unique(),
  truckId: integer('truck_id'),
  // A tire mounts on a truck OR a trailer; both nullable for a spare in stock.
  // onDelete:'set null' mirrors migration 0070 (a deleted rơ-moóc unlinks its
  // tires instead of blocking the delete); keeps schema.ts ↔ migration in sync.
  trailerId: integer('trailer_id'),
  position: varchar('position', { length: 64 }),
  size: varchar('size', { length: 32 }),
  installedAt: date('installed_at'),
  removedAt: date('removed_at'),
  supplierId: integer('supplier_id'),
  cost: numeric('cost', { precision: 15, scale: 0 }).default('0'),
  // Ngày mua lốp (renamed from warranty_until). Drives "tuổi lốp" (tire age).
  purchasedAt: date('purchased_at'),
  status: varchar('status', { length: 20 }).default('IN_STOCK'),
  // Disposal (thanh lý) metadata — set when a tire is taken out of service.
  disposalDate: date('disposal_date'),
  disposalReason: varchar('disposal_reason', { length: 120 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (t) => ({
  truckIdx: index('tires_truck_id_idx').on(t.truckId),
  trailerIdx: index('tires_trailer_id_idx').on(t.trailerId),
}));

export const tirePositions = pgTable('tire_positions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  sortOrder: integer('sort_order').default(0).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  taxCode: varchar('tax_code', { length: 20 }),
  partnerId: integer('partner_id'),
  contactPerson: varchar('contact_person', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  contactInfo: text('contact_info'),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 0 }),
  // Wave 3 M5.3: credit-warning threshold (percentage of creditLimit, e.g. 0.8
  // = warn at 80% utilization). NULL = no warning (use the global default).
  creditWarningThreshold: numeric('credit_warning_threshold', { precision: 3, scale: 2 }),
  // Wave 3: payment-term days for this customer (e.g. 30 = net 30). Used by
  // M5.1 to compute overdue-days. NULL = use the global default.
  paymentTermDays: integer('payment_term_days'),
  fuelSurchargeSharePct: numeric('fuel_surcharge_share_pct', { precision: 5, scale: 2 }),
  // O2C G1: dual payment terms — the customer's HĐVC specifies two independent
  // due-date windows. HẠN TT CƯỚC (freight) and HẠN TT CHI HỘ (agency/chi hộ
  // fees) have different term lengths (e.g. Long Minh: freight=15d, chi hộ=25d).
  // The aging report and debit-note due-date computation key off the matching
  // term per line type. NULL = fall back to paymentTermDays.
  freightPaymentTermDays: integer('freight_payment_term_days'),
  agencyFeePaymentTermDays: integer('agency_fee_payment_term_days'),
  // Q19: contract-level override. The default rolls a due/processing date that
  // lands on a weekend or configured holiday to the next business day.
  paymentDatePolicy: varchar('payment_date_policy', { length: 30 })
    .notNull()
    .default('NEXT_BUSINESS_DAY'),
  status: customerStatusEnum('status').default('ACTIVE'),
  isCarrier: boolean('is_carrier').notNull().default(false),
  debitNoteMode: varchar('debit_note_mode', { length: 20 }).notNull().default('MONTHLY'),
  debitNoteTemplateId: integer('debit_note_template_id'),
  linkedSupplierId: integer('linked_supplier_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('customers_active_name_tax_code_uniq_idx')
    .on(
      sql`lower(btrim(${table.name}))`,
      sql`coalesce(nullif(lower(btrim(${table.taxCode})), ''), '')`,
    )
    .where(sql`${table.deletedAt} is null`),
  uniqueIndex('customers_active_tax_code_uniq_idx')
    .on(sql`lower(btrim(${table.taxCode}))`)
    .where(sql`${table.deletedAt} is null and nullif(btrim(${table.taxCode}), '') is not null`),
  index('customers_partner_idx').on(table.partnerId),
]);

/**
 * Q19 business-calendar exceptions.
 *
 * Weekdays are business days and weekends are non-business days by default.
 * Rows override that default, allowing both holidays (`isWorkingDay=false`)
 * and make-up working weekends (`isWorkingDay=true`).
 */
export const businessCalendarDays = pgTable('business_calendar_days', {
  id: serial('id').primaryKey(),
  calendarDate: date('calendar_date').notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  isWorkingDay: boolean('is_working_day').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_calendar_days_date_uniq_idx').on(table.calendarDate),
]);

export const userCustomerLinks = pgTable('user_customer_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  customerId: integer('customer_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_customer_links_user_customer_uniq_idx').on(table.userId, table.customerId),
  index('user_customer_links_user_idx').on(table.userId),
  index('user_customer_links_customer_idx').on(table.customerId),
]);

export const businessUnits = pgTable('business_units', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('business_units_name_uniq_idx').on(table.name),
  index('business_units_status_idx').on(table.status),
]);

export const userBusinessUnitLinks = pgTable('user_business_unit_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  businessUnitId: integer('business_unit_id')
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_business_unit_links_user_unit_uniq_idx').on(table.userId, table.businessUnitId),
  index('user_business_unit_links_user_idx').on(table.userId),
  index('user_business_unit_links_business_unit_idx').on(table.businessUnitId),
]);

export const routes = pgTable('routes', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  distanceKm: integer('distance_km'),
  isMountain: boolean('is_mountain').default(false),
  fixedFuelAllowance: numeric('fixed_fuel_allowance', { precision: 10, scale: 2 }),
  tollsStations: integer('tolls_stations'),
  driverSalary: numeric('driver_salary', { precision: 15, scale: 0 }),
  defaultLegs: jsonb('default_legs').$type<Array<{ origin: string, destination: string, km: number, loadingType: 'HANG' | 'VO' }>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const cargoTypes = pgTable('cargo_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  requiresPhotos: boolean('requires_photos').default(false),
  // Wave 1: when true, resolveFreightPrice uses weight_pricing_tiers;
  // when false, uses pricing_tables. Defaults false so existing cargo
  // types keep the fixed-price model.
  isBulk: boolean('is_bulk').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const pricingTables = pgTable('pricing_tables', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  routeId: integer('route_id').notNull(),
  price: numeric('price', { precision: 15, scale: 0 }).notNull(),
  containerTypeId: integer('container_type_id'),
  rateKey: varchar('rate_key', { length: 32 }),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('pricing_tables_general_date_idx')
    .on(table.customerId, table.routeId, table.effectiveDate)
    .where(sql`${table.containerTypeId} is null and ${table.rateKey} is null`),
  uniqueIndex('pricing_tables_container_date_idx')
    .on(table.customerId, table.routeId, table.containerTypeId, table.effectiveDate)
    .where(sql`${table.containerTypeId} is not null and ${table.rateKey} is null`),
  uniqueIndex('pricing_tables_rate_key_date_idx')
    .on(table.customerId, table.routeId, table.rateKey, table.effectiveDate)
    .where(sql`${table.containerTypeId} is null and ${table.rateKey} is not null`),
]);

export const roadAllowances = pgTable('road_allowances', {
  id: serial('id').primaryKey(),
  routeId: integer('route_id').notNull(),
  trailerType: trailerTypeEnum('trailer_type').notNull(),
  baseAmount: numeric('base_amount', { precision: 15, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('road_allowances_route_type_idx').on(table.routeId, table.trailerType),
]);

export const fuelConfig = pgTable('fuel_config', {
  id: serial('id').primaryKey(),
  loadedNorm: numeric('loaded_norm', { precision: 6, scale: 2 }).notNull(),
  emptyNorm: numeric('empty_norm', { precision: 6, scale: 2 }).notNull(),
  supplement: numeric('supplement', { precision: 6, scale: 2 }).default('3'),
  unitPrice: numeric('unit_price', { precision: 10, scale: 0 }).notNull(),
  baseUnitPrice: numeric('base_unit_price', { precision: 10, scale: 0 }),
  warningThreshold: numeric('warning_threshold', { precision: 6, scale: 2 }).default('37'),
  criticalThreshold: numeric('critical_threshold', { precision: 6, scale: 2 }).default('40'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const fuelPriceHistory = pgTable('fuel_price_history', {
  id: serial('id').primaryKey(),
  unitPrice: numeric('unit_price', { precision: 10, scale: 0 }).notNull(),
  effectiveDate: timestamp('effective_date').notNull(),
  changedBy: integer('changed_by'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── Wave 1: Pricing & Fuel Data Layer ──────────────────────────────────────
//
// These tables close the revenue/fuel-correctness gap before Wave 3
// (financial close) touches P&L. See
// `plans/silversea-prd-roadmap/phase-02-wave-1-pricing-fuel-data-layer.md`
// for the full design.
//
// Scope of THIS slice: schema (tables + enums + columns) + migration only.
// The service layer (resolveFreightPrice, resolveFuelNorm, etc.) and route
// integrations are subsequent Wave 1 roadmap items.

// M2.2: weight-tier pricing for bulk cargo. Each tier covers a half-open
// [minKg, maxKg) weight range; `resolveFreightPrice` picks the matching
// tier by trip weight × route × cargoType at the trip date. No two tiers
// for the same (route, cargoType, effectiveDate) may overlap — enforced
// by the service layer (M02-02-03) because PG has no native range-overlap
// constraint without the `range` type.
export const weightPricingTiers = pgTable('weight_pricing_tiers', {
  id: serial('id').primaryKey(),
  routeId: integer('route_id').notNull(),
  cargoTypeId: integer('cargo_type_id').notNull(),
  minKg: numeric('min_kg', { precision: 12, scale: 2 }).notNull(),
  maxKg: numeric('max_kg', { precision: 12, scale: 2 }).notNull(),
  pricePerKg: numeric('price_per_kg', { precision: 12, scale: 4 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('weight_pricing_tiers_route_cargo_date_idx').on(table.routeId, table.cargoTypeId, table.effectiveDate),
]);

// M2.4 + O2C B3: lift/up-down (nâng/hạ) price catalog. Port × containerType ×
// direction × cargoState × effectiveDate → unitPrice. The customer's port-fee
// schedule prices empty vs loaded containers differently. The forwarder
// expense-entry flow suggests the price and shows suggested/actual/delta.
export const liftPricing = pgTable('lift_pricing', {
  id: serial('id').primaryKey(),
  portId: integer('port_id').notNull(),
  containerTypeId: integer('container_type_id').notNull(),
  direction: liftDirectionEnum('direction').notNull(),
  // O2C B3: EMPTY (Container Rỗng) vs LOADED (Container Hàng) — the port-fee
  // matrix has separate columns for each. Defaults LOADED so existing rows
  // (pre-O2C) are treated as loaded (the more common case).
  loadState: loadStateEnum('load_state').notNull().default('LOADED'),
  unitPrice: numeric('unit_price', { precision: 15, scale: 0 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('lift_pricing_port_type_state_dir_date_uniq').on(table.portId, table.containerTypeId, table.direction, table.loadState, table.effectiveDate),
]);

// M2.5: ancillary (non-transport) revenue. Each entry is recorded exactly
// once; refunds use negative amounts with reason. Links to EITHER a
// shipment OR a trip (at least one expected at the application layer).
export const ancillaryRevenue = pgTable('ancillary_revenue', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  tripId: integer('trip_id'),
  type: ancillaryRevenueTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  tax: numeric('tax', { precision: 15, scale: 0 }).default('0'),
  date: date('date').notNull().defaultNow(),
  documentRef: varchar('document_ref', { length: 100 }),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('ancillary_revenue_customer_date_idx').on(table.customerId, table.date),
  index('ancillary_revenue_shipment_idx').on(table.shipmentId),
  index('ancillary_revenue_trip_idx').on(table.tripId),
]);

// O2C B1: fuel-surcharge (phụ phí xăng dầu) configuration. The customer's
// pricing template (MẪU BÁO GIÁ) computes: phụ phí = (giá dầu hiện tại − giá dầu
// gốc) × định mức lít/km × số km × tỷ lệ chia sẻ % (per customer). This table
// stores the per-customer share rate + the global base/current fuel prices live
// in app_settings (fuelPriceApplied). Each row defines how much of the fuel
// surcharge a customer bears (e.g. Long Minh 2%, ASKEY 4%, Sunrise 2.5%).
export const fuelSurchargeConfigs = pgTable('fuel_surcharge_configs', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  // Tỷ lệ chia sẻ % (e.g. 0.02 = 2%). The customer's share of the fuel-cost
  // delta. NULL or 0 = customer pays no surcharge.
  shareRate: numeric('share_rate', { precision: 5, scale: 4 }).notNull().default('0'),
  // Base fuel price (giá dầu gốc) locked at contract signing. The surcharge
  // formula compares the current fuel price against this baseline.
  baseFuelPrice: numeric('base_fuel_price', { precision: 10, scale: 0 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('fuel_surcharge_customer_active_uniq').on(table.customerId).where(sql`${table.deletedAt} is null`),
]);

// M12.1: per-route / per-truck fuel norms. Replaces the singleton fuel_config
// for new trips (legacy fuel_config stays as the fallback for trips created
// before this table existed). Both routeId and truckId are optional — a row
// with routeId set + truckId NULL = per-route norm; a row with both set =
// per-route-per-truck norm; a row with routeId NULL + truckId set =
// per-truck default. `flatRateLiters` is used for mountain routes
// (M12.1 §5, open PRD question on exact behaviour — the column is here so
// the service layer can apply it without another migration).
export const fuelNorms = pgTable('fuel_norms', {
  id: serial('id').primaryKey(),
  routeId: integer('route_id'),
  truckId: integer('truck_id'),
  loadedLitersPer100Km: numeric('loaded_liters_per_100km', { precision: 8, scale: 2 }).notNull(),
  emptyLitersPer100Km: numeric('empty_liters_per_100km', { precision: 8, scale: 2 }).notNull(),
  supplementLiters: numeric('supplement_liters', { precision: 8, scale: 2 }).default('0'),
  flatRateLiters: numeric('flat_rate_liters', { precision: 8, scale: 2 }),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('fuel_norms_route_truck_date_idx').on(table.routeId, table.truckId, table.effectiveDate),
]);

export const penaltyReasons = pgTable('penalty_reasons', {
  id: serial('id').primaryKey(),
  reasonText: text('reason_text').notNull(),
  defaultAmount: numeric('default_amount', { precision: 15, scale: 0 }).notNull(),
  severity: text('severity').notNull().default('mid'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// ─── Operations ──────────────────────────────────────────────────────────────

export const trips = pgTable('trips', {
  id: serial('id').primaryKey(),
  tripCode: varchar('trip_code', { length: 50 }).unique(),
  version: integer('version').default(1).notNull(),
  createdBy: integer('created_by'),
  customerId: integer('customer_id').notNull(),
  customerReference: text('customer_reference'),
  truckId: integer('truck_id'),
  driverId: integer('driver_id'),
  routeId: integer('route_id').notNull(),
  trailerId: integer('trailer_id'),
  trailerType: trailerTypeEnum('trailer_type'),
  cargoTypeId: integer('cargo_type_id'),
  containerCount: integer('container_count').default(1),
  status: tripStatusEnum('status').default('CREATED'),
  departureDate: date('departure_date').notNull(),
  plannedStartAt: timestamp('planned_start_at'),
  plannedEndAt: timestamp('planned_end_at'),
  canonicalOrigin: varchar('canonical_origin', { length: 160 }),
  canonicalDestination: varchar('canonical_destination', { length: 160 }),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  vehicleCapacityKg: numeric('vehicle_capacity_kg', { precision: 10, scale: 2 }),
  // Declared as a plain integer to avoid a schema initializer cycle with
  // trip_pairs -> trips. Application services enforce the relationship.
  activeTripPairId: integer('active_trip_pair_id'),
  activeTripPairOrder: integer('active_trip_pair_order'),
  fuelMode: fuelModeEnum('fuel_mode').default('AUTO'),
  fuelLitersOverride: numeric('fuel_liters_override', { precision: 10, scale: 2 }),
  fuelSupplementLiters: numeric('fuel_supplement_liters', { precision: 10, scale: 2 }).default('0'),
  fuelSupplementReason: text('fuel_supplement_reason'),
  tollsDiscount: numeric('tolls_discount', { precision: 15, scale: 0 }).default('0'),
  tollsAddition: numeric('tolls_addition', { precision: 15, scale: 0 }).default('0'),
  tollsStations: integer('tolls_stations').default(0),
  hasReturnCargo: boolean('has_return_cargo').default(false),
  driverSalary: numeric('driver_salary', { precision: 15, scale: 0 }),
  // Rate Snapshots
  fuelPriceApplied: numeric('fuel_price_applied', { precision: 10, scale: 0 }),
  fuelActualUnitPrice: numeric('fuel_actual_unit_price', { precision: 10, scale: 0 }),
  roadAllowanceBaseApplied: numeric('road_allowance_base_applied', { precision: 15, scale: 0 }),
  fuelLoadedNormApplied: numeric('fuel_loaded_norm_applied', { precision: 6, scale: 2 }),
  fuelEmptyNormApplied: numeric('fuel_empty_norm_applied', { precision: 6, scale: 2 }),
  fuelFixedAllowanceApplied: numeric('fuel_fixed_allowance_applied', { precision: 10, scale: 2 }),
  fuelSupplementNormApplied: numeric('fuel_supplement_norm_applied', { precision: 6, scale: 2 }),
  tollPerStationApplied: numeric('toll_per_station_applied', { precision: 15, scale: 0 }),
  returnCargoBonusApplied: numeric('return_cargo_bonus_applied', { precision: 15, scale: 0 }),
  // Derived Fields
  fuelLiters: numeric('fuel_liters', { precision: 10, scale: 2 }),
  totalFuelCost: numeric('total_fuel_cost', { precision: 15, scale: 0 }),
  fuelSurchargeAmount: numeric('fuel_surcharge_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  fuelSurchargeSnapshot: jsonb('fuel_surcharge_snapshot').$type<Record<string, unknown>>(),
  fuelSurchargeSnapshotDirty: boolean('fuel_surcharge_snapshot_dirty').notNull().default(false),
  totalRoadAllowance: numeric('total_road_allowance', { precision: 15, scale: 0 }),
  tollCost: numeric('toll_cost', { precision: 15, scale: 0 }),
  // O2C "kẹp hàng" (backhaul pair) toll dedup (PRD Bước 2, 01/08/2026): a
  // closed-loop road toll (VETC) is physically paid once for a paired two-way
  // trip, so the second trip carries a `toll_deduction` equal to its gross toll.
  // `computeTripTotals` nets this off `tollCost` (the single source of truth),
  // which then flows to totalCost / P&L / ledger. Distinct from `tollsDiscount`,
  // which is a manual override that also docks the driver's road allowance and
  // would double-count if reused here.
  tollDeduction: numeric('toll_deduction', { precision: 15, scale: 0 }).notNull().default('0'),
  roadAllowanceOverride: numeric('road_allowance_override', { precision: 15, scale: 0 }),
  totalCost: numeric('total_cost', { precision: 15, scale: 0 }),
  revenue: numeric('revenue', { precision: 15, scale: 0 }),
  revenueEmptyReturn: numeric('revenue_empty_return', { precision: 15, scale: 0 }).default('0'),
  revenueCombine: numeric('revenue_combine', { precision: 15, scale: 0 }).default('0'),
  twoPointDeliveryBonus: numeric('two_point_delivery_bonus', { precision: 15, scale: 0 }).default('0'),
  vehicleShiftAllowance: numeric('vehicle_shift_allowance', { precision: 15, scale: 0 }).default('0'),
  // O2C C1: storage/demurrage fee (lưu ca xe). HĐVC §3.5: 1.000.000đ/cont/ngày
  // after 8h free time. Recorded as a revenue line per trip when applicable.
  // NULL = not assessed; the accountant enters it based on actual detention.
  storageFeeRevenue: numeric('storage_fee_revenue', { precision: 15, scale: 0 }),
  grossProfit: numeric('gross_profit', { precision: 15, scale: 0 }),
  revenueOriginal: numeric('revenue_original', { precision: 15, scale: 0 }),
  revenueOverriddenBy: integer('revenue_overridden_by'),
  revenueOverriddenAt: timestamp('revenue_overridden_at'),
  // Wave 1 M2.1: mandatory reason when the operator overrides the auto-
  // computed revenue (pricingSource = TIER or TABLE). NULL when revenue was
  // never overridden or when pricingSource is MANUAL (no auto-computation to
  // deviate from).
  revenueOverrideReason: text('revenue_override_reason'),
  // Wave 1: pricing-snapshot columns. Track how the revenue was computed
  // so accountants can distinguish AUTO (tier/table) from MANUAL. Nullable
  // — existing trips have NULL (no regression); new trips get populated by
  // resolveFreightPrice (future service-layer item).
  pricingSource: pricingSourceEnum('pricing_source'),
  pricingFormula: text('pricing_formula'),
  pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>(),
  notes: text('notes'),
  // Per-trip customer commission (hoa hồng). Deducted from freightExVat to produce recordedRevenue.
  // Recorded immediately on data entry (not at lock). Default 0 = no commission.
  customerCommission: numeric('customer_commission', { precision: 15, scale: 0 }).default('0'),
  tripWageDays: integer('trip_wage_days'), // optional override for days to count for this trip
  fuelSupplierId: integer('fuel_supplier_id'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 3 }).notNull().default('0.000'),
  carrierType: varchar('carrier_type', { length: 20 }).notNull().default('OWN'),
  // O2C reconciliation (01/08/2026, docs/prd/O2C dev.md): the external carrier
  // (Xe ngoài / subcontractor) may be a customer (AR-side) or a supplier
  // (AP-side). We replaced the locked `external_carrier_id → customers.id` FK
  // with two **plain nullable columns and NO DB FK** — a soft pointer resolved
  // by the app-layer `resolveExternalCarrier(trip)` helper (per the project's
  // "readable/maintainable tables over FK rigor" convention). Both null for
  // OWN trips (the majority); populated only when carrier_type = EXTERNAL.
  // Application validation guards the canonical carrier set.
  externalEntityId: integer('external_entity_id'),
  externalEntityType: varchar('external_entity_type', { length: 20 }),
  externalFreightCost: numeric('external_freight_cost', { precision: 15, scale: 0 }),
  externalPlateNumber: varchar('external_plate_number', { length: 20 }),
  externalCarrierVehicleId: integer('external_carrier_vehicle_id'),
  externalDriverName: varchar('external_driver_name', { length: 100 }),
  externalDriverPhone: varchar('external_driver_phone', { length: 20 }),
  // Wave 0: optional link to the shipment (lô hàng) this trip fulfills. Nullable
  // so legacy trip-create flows keep working unchanged (auto-shipment path is a
  // later checkbox). Trip creation refactor to *require* this comes with the
  // SHIPMENT_FIRST_CREATE feature flag in a separate Wave 0 item.
  // Application delete guards prevent hard-deleting a shipment with live trips.
  // Use shipments.deletedAt for tombstoning.
  shipmentId: integer('shipment_id'),
  fulfillmentId: integer('fulfillment_id'),
  sourceShipmentVersion: integer('source_shipment_version'),
  completedAt: timestamp('completed_at'),
  // O2C POD-recovery gate (docs/prd/O2C dev.md). Distinct from digital e-POD
  // acceptance (TripPodStatus.ACCEPTED): this records "Đã thu hồi chứng từ gốc
  // (POD mộc đỏ)" — the physical paper return. The IN_TRANSIT → COMPLETED
  // transition throws if null; shipment closure requires it set.
  podRecoveredAt: timestamp('pod_recovered_at', { withTimezone: true }),
  podRecoveredBy: integer('pod_recovered_by'),
  // O2C AR snapshot + dirty-flag. Costs remain editable after COMPLETED (no
  // hard-freeze). On completion `captureSnapshot` stores the canonical cost
  // hash and sets ar_snapshot_dirty = false; any later cost edit recomputes the
  // hash and flips ar_snapshot_dirty = true so the accountant reconciliation
  // view surfaces it. The canonical AR total for downstream is `trips.revenue`
  // (incl-VAT); billing_documents.totalInclVat is populated from it at debit-
  // note generation time.
  arCostHash: varchar('ar_cost_hash', { length: 64 }),
  arSnapshotDirty: boolean('ar_snapshot_dirty').notNull().default(false),
  arSnapshotChangedAt: timestamp('ar_snapshot_changed_at', { withTimezone: true }),
  apCostHash: varchar('ap_cost_hash', { length: 64 }),
  apSnapshotDirty: boolean('ap_snapshot_dirty').notNull().default(false),
  apSnapshotChangedAt: timestamp('ap_snapshot_changed_at', { withTimezone: true }),
  // O2C H4: P&L snapshot of grossProfit captured at completion. The mutable
  // `grossProfit` column can drift if costs are edited post-completion; P&L
  // reports (pnl.service, profit-distribution, fuel-variance) read this frozen
  // snapshot so a closed period's totals don't silently change. NULL for
  // in-progress trips; set by captureSnapshot at IN_TRANSIT → COMPLETED.
  pnlSnapshotGrossProfit: numeric('pnl_snapshot_gross_profit', { precision: 15, scale: 0 }),
  // O2C field ops hand-off timestamps (Phase 4): Ops paper-order collected +
  // Driver order-accepted. Nullable; populated by the FORWARDER/DRIVER endpoints.
  paperOrderCollectedAt: timestamp('paper_order_collected_at', { withTimezone: true }),
  paperOrderCollectedBy: integer('paper_order_collected_by'),
  driverOrderAcceptedAt: timestamp('driver_order_accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('trips_trailer_id_idx').on(table.trailerId),
  // Trip list and report queries filter heavily on status and date
  index('trips_status_idx').on(table.status),
  index('trips_departure_date_idx').on(table.departureDate),
  index('trips_customer_departure_idx').on(table.customerId, table.departureDate),
  index('trips_active_trip_pair_idx').on(table.activeTripPairId),
  uniqueIndex('trips_active_trip_pair_order_uniq')
    .on(table.activeTripPairId, table.activeTripPairOrder)
    .where(sql`${table.activeTripPairId} is not null`),
  // Wave 0: look up a shipment's trips.
  index('trips_shipment_id_idx').on(table.shipmentId),
  index('trips_fulfillment_id_idx').on(table.fulfillmentId),
  index('trips_external_carrier_vehicle_idx').on(table.externalCarrierVehicleId),
  uniqueIndex('trips_id_fulfillment_uniq_idx').on(table.id, table.fulfillmentId),
  // A fulfillment is the independently dispatchable authority. Multiple live
  // trips may belong to one shipment only when they reference distinct
  // fulfillments; canceled history does not prevent a governed replacement.
  uniqueIndex('trips_fulfillment_id_live_uniq')
    .on(table.fulfillmentId)
    .where(sql`${table.fulfillmentId} is not null and ${table.status} <> 'CANCELED'`),
  // Until every trip-create surface supplies a fulfillment, an unassigned
  // live trip still reserves the shipment. This prevents the nullable column
  // from bypassing the one-active-trip-per-dispatch-unit invariant.
  uniqueIndex('trips_shipment_without_fulfillment_live_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.fulfillmentId} is null and ${table.status} <> 'CANCELED'`),
]);

export const tripPairs = pgTable('trip_pairs', {
  id: serial('id').primaryKey(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  firstTripId: integer('first_trip_id').notNull(),
  secondTripId: integer('second_trip_id').notNull(),
  emptyDistanceKm: numeric('empty_distance_km', { precision: 10, scale: 2 }),
  combinedEfficiencyPercent: numeric('combined_efficiency_percent', { precision: 6, scale: 2 }),
  requiredGapMinutes: integer('required_gap_minutes'),
  actualGapMinutes: integer('actual_gap_minutes'),
  breakReason: varchar('break_reason', { length: 40 }),
  survivingTripId: integer('surviving_trip_id'),
  lateByMinutes: integer('late_by_minutes'),
  createdBy: integer('created_by'),
  brokenBy: integer('broken_by'),
  brokenAt: timestamp('broken_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_pairs_trip_order_uniq_idx').on(table.firstTripId, table.secondTripId),
  index('trip_pairs_status_idx').on(table.status, table.createdAt),
]);

export const tripLegs = pgTable('trip_legs', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  sequence: integer('sequence').notNull(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  km: integer('km').notNull(),
  loadingType: loadingTypeEnum('loading_type').notNull(),
  calculatedLiters: numeric('calculated_liters', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Canonical financial posting version for one trip. Operational trip.version
// is deliberately not used as financial provenance because unrelated dossier
// edits also advance it.
export const tripFinancialPostings = pgTable('trip_financial_postings', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  version: integer('version').notNull(),
  tripVersion: integer('trip_version').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  reason: varchar('reason', { length: 30 }).notNull(),
  governanceActionId: integer('governance_action_id'),
  supersedesId: integer('supersedes_id'),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_financial_postings_trip_version_uniq').on(table.tripId, table.version),
  uniqueIndex('trip_financial_postings_trip_active_uniq')
    .on(table.tripId)
    .where(sql`${table.status} = 'ACTIVE'`),
  uniqueIndex('trip_financial_postings_supersedes_uniq')
    .on(table.supersedesId)
    .where(sql`${table.supersedesId} is not null`),
  index('trip_financial_postings_trip_status_idx').on(table.tripId, table.status),
]);

// ─── Financials ──────────────────────────────────────────────────────────────

export const ledger = pgTable('ledger', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  txnType: txnTypeEnum('txn_type').notNull(),
  txnId: integer('txn_id'),
  receiptId: varchar('receipt_id', { length: 100 }),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: integer('entity_id').notNull(),
  credit: numeric('credit', { precision: 15, scale: 0 }).default('0'),
  debit: numeric('debit', { precision: 15, scale: 0 }).default('0'),
  balance: numeric('balance', { precision: 15, scale: 0 }).notNull(),
  note: text('note'),
  // Q19 immutable payment-date authority. These values are frozen when an AR
  // obligation is posted so later customer/calendar edits cannot rewrite
  // historical overdue dates. Non-AR and unbackfillable legacy rows stay NULL.
  originalDueDate: date('original_due_date'),
  processingDueDate: date('processing_due_date'),
  paymentTermDaysApplied: integer('payment_term_days_applied'),
  paymentDatePolicyApplied: varchar('payment_date_policy_applied', { length: 30 }),
  financialPostingId: integer('financial_posting_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Hottest query path: every getBalance/postEntry does WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1
  index('ledger_entity_entity_idx').on(table.entityType, table.entityId),
  index('ledger_entity_entity_id_idx').on(table.entityType, table.entityId, table.id),
  index('ledger_entity_txn_timestamp_idx').on(table.entityType, table.txnType, table.timestamp),
  index('ledger_financial_posting_idx').on(table.financialPostingId),
  uniqueIndex('ledger_forwarder_settlement_once_idx')
    .on(table.txnType, table.txnId, table.entityType, table.entityId)
    .where(sql`${table.txnType} = 'FORWARDER_SETTLEMENT'`),
]);

// ─── Billing Documents (debit notes + payment statements) ─────────────────────
// Saved documents composed by kế toán / quản lý. PAYMENT_STATEMENT is a pure
// presentation snapshot. DEBIT_NOTE edits reconcile amount overrides, ad-hoc
// rows, and exclusions through append-only customer-ledger adjustments.
// entityType CUSTOMER = AR debit-note customer OR AP external carrier (carriers
// live in customers per decision D-E/F); entityType VENDOR = AP supplier.

// ─── Debit-note (Giấy báo nợ) templates ──────────────────────────────────────
// Form-driven, Excel-only layout presets. Single default enforced in code by the
// transactional route handler (NOT a partial unique index — see migration 0076 +
// the salary_periods.isDefault precedent). document_type is reserved for
// forward-compat; the resolver guards to DEBIT_NOTE today.
export const debitNoteTemplates = pgTable('debit_note_templates', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  documentType: varchar('document_type', { length: 20 }).notNull().default('DEBIT_NOTE'),
  titleText: varchar('title_text', { length: 100 }).notNull().default('GIẤY BÁO NỢ'),
  issuerName: varchar('issuer_name', { length: 200 }),
  issuerAddress: varchar('issuer_address', { length: 300 }),
  issuerTaxCode: varchar('issuer_tax_code', { length: 50 }),
  issuerRepresentative: varchar('issuer_representative', { length: 100 }),
  accentColor: varchar('accent_color', { length: 20 }).notNull().default('#1F4E79'),
  showContainerColumn: boolean('show_container_column').notNull().default(true),
  showUnitColumn: boolean('show_unit_column').notNull().default(true),
  groupingMode: varchar('grouping_mode', { length: 20 }).notNull().default('ROUTE'),
  columns: jsonb('columns').$type<Array<{
    id: string;
    label: string;
    variable: string;
    width: number;
    align: 'left' | 'center' | 'right';
    format: 'text' | 'date' | 'number' | 'currency';
    total?: boolean;
  }>>().notNull().default(sql`'[]'::jsonb`),
  // Phase 2: rendered read-only in UI; reserved for a future vndToWords() helper.
  amountInWords: boolean('amount_in_words').notNull().default(false),
  orientation: varchar('orientation', { length: 10 }).notNull().default('landscape'),
  termsText: text('terms_text'),
  signatureLeftLabel: varchar('signature_left_label', { length: 100 }).default('Khách hàng'),
  signatureLeftName: varchar('signature_left_name', { length: 100 }),
  signatureRightLabel: varchar('signature_right_label', { length: 100 }).default('Kế toán trưởng'),
  signatureRightName: varchar('signature_right_name', { length: 100 }),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const billingDocuments = pgTable('billing_documents', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().default(1),
  type: varchar('type', { length: 20 }).notNull(),               // DEBIT_NOTE | PAYMENT_STATEMENT
  entityType: varchar('entity_type', { length: 20 }).notNull(),  // CUSTOMER | VENDOR
  entityId: integer('entity_id').notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  note: text('note'),
  debitNoteTemplateId: integer('debit_note_template_id'),
  // Frozen render-only copy so historical debit notes re-export identically
  // after the template (or its logo) is edited/deleted. Untyped jsonb; the
  // service casts to DebitNoteTemplateSnapshot.
  debitNoteTemplateSnapshot: jsonb('debit_note_template_snapshot'),
  // Immutable legal/bank/signature identity used by issued-document renders.
  // Separate from the template so legacy documents without a template can be
  // backfilled without inventing a partial template object.
  officialIdentitySnapshot: jsonb('official_identity_snapshot'),
  // Reference-only legal invoice handoff state. This metadata never posts AR
  // and never replaces the Debit Note as the debt instrument authority.
  legalInvoiceRef: jsonb('legal_invoice_ref').$type<{
    provider?: string;
    status: 'PENDING' | 'UNKNOWN' | 'ISSUED' | 'DEAD' | 'CANCELED';
    providerReference?: string;
    requestVersion: number;
    payloadHash?: string;
    checksum?: string;
    issuedAt?: string;
    updatedAt: string;
  }>(),
  totalInclVat: numeric('total_incl_vat', { precision: 15, scale: 0 }).notNull().default('0'),
  totalNet: numeric('total_net', { precision: 15, scale: 0 }).notNull().default('0'),
  totalTax: numeric('total_tax', { precision: 15, scale: 0 }).notNull().default('0'),
  totalGross: numeric('total_gross', { precision: 15, scale: 0 }).notNull().default('0'),
  vatTreatmentVersion: varchar('vat_treatment_version', { length: 30 }).notNull().default('VAT-V1'),
  // Wave 2 M3.6: debit-note lifecycle status. Defaults to DRAFT (existing
  // documents are treated as DRAFT until explicitly transitioned). Nullable
  // for backward compat (old documents get NULL = implicitly DRAFT).
  debitNoteStatus: debitNoteStatusEnum('debit_note_status').default('DRAFT'),
  // Wave 2 M3.6: when the customer confirmed/rejected the note. NULL = no
  // customer action yet.
  customerConfirmedAt: timestamp('customer_confirmed_at', { withTimezone: true }),
  customerConfirmedBy: varchar('customer_confirmed_by', { length: 255 }),
  // Net AR delta contributed by this debit note beyond the trip/fee amounts
  // that were already posted when the trip completed. Kept separately so an
  // edit can post only the difference and repeated saves stay idempotent.
  ledgerAdjustmentAmount: numeric('ledger_adjustment_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  // Frozen contractual due-date snapshot for customer debit notes.
  originalDueDate: date('original_due_date'),
  processingDueDate: date('processing_due_date'),
  paymentTermDaysApplied: integer('payment_term_days_applied'),
  paymentDatePolicyApplied: varchar('payment_date_policy_applied', { length: 30 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  authorityState: varchar('authority_state', { length: 30 }).notNull().default('CURRENT'),
  authorityWarningReason: text('authority_warning_reason'),
  authorityWarningAt: timestamp('authority_warning_at', { withTimezone: true }),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('billing_documents_entity_idx').on(table.entityType, table.entityId),
  uniqueIndex('billing_documents_active_period_unique')
    .on(table.type, table.entityType, table.entityId, table.rangeFrom, table.rangeTo)
    .where(sql`${table.deletedAt} IS NULL AND ${table.type} = 'DEBIT_NOTE'`),
]);

// Q21: reusable period-lock authority for salary, fuel, and debit-note cycles.
// Scope is GLOBAL for company-wide domains and CUSTOMER for debit-note locks.
export const periodLocks = pgTable('period_locks', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 30 }).notNull(),
  scopeType: varchar('scope_type', { length: 20 }).notNull().default('GLOBAL'),
  scopeId: integer('scope_id').notNull().default(0),
  cycle: varchar('cycle', { length: 20 }).notNull(),
  periodKey: varchar('period_key', { length: 40 }).notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('CLOSED'),
  closedBy: integer('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }).defaultNow().notNull(),
  reopenedBy: integer('reopened_by'),
  reopenedAt: timestamp('reopened_at', { withTimezone: true }),
  note: text('note'),
  reopenNote: text('reopen_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('period_locks_domain_scope_period_uniq')
    .on(table.domain, table.scopeType, table.scopeId, table.periodKey),
  index('period_locks_lookup_idx').on(
    table.domain,
    table.scopeType,
    table.scopeId,
    table.status,
    table.periodStart,
    table.periodEnd,
  ),
]);

// Q18/Q15: append-only authority envelope. Domain services still own and
// atomically apply their effects; this table owns actor separation, evidence,
// source versions and the decision lifecycle.
export const governanceActions = pgTable('governance_actions', {
  id: serial('id').primaryKey(),
  subjectType: varchar('subject_type', { length: 30 }).notNull(),
  subjectId: integer('subject_id'),
  subjectKey: varchar('subject_key', { length: 120 }),
  actionKind: varchar('action_kind', { length: 40 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('PENDING_CHECK'),
  reason: text('reason').notNull(),
  originalVersion: integer('original_version').notNull(),
  originalPeriodLockId: integer('original_period_lock_id')
    ,
  beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown>>().notNull(),
  afterSnapshot: jsonb('after_snapshot').$type<Record<string, unknown>>().notNull(),
  deltaSnapshot: jsonb('delta_snapshot').$type<Record<string, unknown>>(),
  makerId: integer('maker_id').notNull(),
  makerRole: varchar('maker_role', { length: 20 }),
  checkerId: integer('checker_id'),
  checkerRole: varchar('checker_role', { length: 20 }),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  approverId: integer('approver_id'),
  approverRole: varchar('approver_role', { length: 20 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedBy: integer('rejected_by'),
  rejectedRole: varchar('rejected_role', { length: 20 }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  returnedBy: integer('returned_by'),
  returnedRole: varchar('returned_role', { length: 20 }),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  returnReason: text('return_reason'),
  canceledBy: integer('canceled_by'),
  canceledRole: varchar('canceled_role', { length: 20 }),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  ledgerEntryId: integer('ledger_entry_id'),
  applicationResult: jsonb('application_result').$type<Record<string, unknown>>(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('governance_actions_subject_idx').on(
    table.subjectType,
    table.subjectId,
    table.createdAt,
  ),
  index('governance_actions_subject_key_idx').on(
    table.subjectType,
    table.subjectKey,
    table.createdAt,
  ),
  index('governance_actions_status_idx').on(table.status, table.createdAt),
  uniqueIndex('governance_actions_active_subject_key_uniq')
    .on(table.subjectType, table.subjectKey, table.actionKind, table.originalVersion)
    .where(sql`${table.subjectKey} is not null and ${table.status} in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE')`),
  uniqueIndex('governance_actions_active_subject_id_uniq')
    .on(table.subjectType, table.subjectId, table.actionKind, table.originalVersion)
    .where(sql`${table.subjectId} is not null and ${table.actionKind} not in ('TRIP_AR_ADJUSTMENT', 'TRIP_REOPEN') and ${table.status} in ('PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE')`),
]);

export const financialReportingPolicyVersions = pgTable('financial_reporting_policy_versions', {
  id: serial('id').primaryKey(),
  effectiveFrom: date('effective_from').notNull(),
  depreciationMethod: varchar('depreciation_method', { length: 30 }).notNull(),
  allocationBasis: varchar('allocation_basis', { length: 50 }).notNull(),
  lowMarginThresholdRatio: numeric('low_margin_threshold_ratio', { precision: 5, scale: 4 }),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  createdBy: integer('created_by')

    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('financial_reporting_policy_versions_effective_from_uniq')
    .on(table.effectiveFrom),
  uniqueIndex('financial_reporting_policy_versions_governance_action_uniq')
    .on(table.governanceActionId),
  index('financial_reporting_policy_versions_effective_lookup_idx')
    .on(table.effectiveFrom, table.createdAt),
]);

export const truckFinancialProfileVersions = pgTable('truck_financial_profile_versions', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id')

    .notNull(),
  effectiveFrom: date('effective_from').notNull(),
  acquisitionCost: numeric('acquisition_cost', { precision: 15, scale: 0 }).notNull(),
  residualValue: numeric('residual_value', { precision: 15, scale: 0 }).notNull(),
  inServiceDate: date('in_service_date').notNull(),
  usefulLifeMonths: integer('useful_life_months').notNull(),
  monthlyFixedCost: numeric('monthly_fixed_cost', { precision: 15, scale: 0 }).notNull(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  createdBy: integer('created_by')

    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('truck_financial_profile_versions_truck_month_uniq')
    .on(table.truckId, table.effectiveFrom),
  uniqueIndex('truck_financial_profile_versions_governance_action_uniq')
    .on(table.governanceActionId),
  index('truck_financial_profile_versions_lookup_idx')
    .on(table.truckId, table.effectiveFrom, table.createdAt),
]);

// Q21: late debit-note adjustments keep an internal link to the original
// locked periods they are correcting. A single adjustment document may point
// back to multiple locked periods when approved source lines come in late.
export const billingDocumentSourcePeriodLocks = pgTable('billing_document_source_period_locks', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')

    .notNull(),
  periodLockId: integer('period_lock_id')

    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_document_source_period_locks_doc_period_uniq')
    .on(table.documentId, table.periodLockId),
  index('billing_document_source_period_locks_period_idx').on(table.periodLockId),
]);

// Active trip claims prevent overlapping non-voided Debit Notes from billing
// the same trip twice while still allowing separate non-overlapping periods
// (for example late recoverable fees in July and freight completion in August).
// Release happens through the billing-document lifecycle: soft-delete or
// CANCELED transitions mark the claim released instead of erasing history.
export const billingDocumentTripClaims = pgTable('billing_document_trip_claims', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')

    .notNull(),
  tripId: integer('trip_id')

    .notNull(),
  financialPostingId: integer('financial_posting_id')

    .notNull(),
  financialPostingVersion: integer('financial_posting_version').notNull(),
  postingChecksum: varchar('posting_checksum', { length: 64 }).notNull(),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: integer('released_by'),
  releaseReason: varchar('release_reason', { length: 32 }),
}, (table) => [
  uniqueIndex('billing_document_trip_claims_document_trip_active_uniq')
    .on(table.documentId, table.tripId)
    .where(sql`${table.releasedAt} is null`),
  index('billing_document_trip_claims_document_idx').on(table.documentId),
  index('billing_document_trip_claims_trip_idx').on(table.tripId),
]);

export const billingDocumentLines = pgTable('billing_document_lines', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(),  // TRIP | EXPENSE | ADHOC
  sourceId: integer('source_id'),                                // tripId | tripExpenseId | null(ADHOC)
  sourceVersion: varchar('source_version', { length: 120 }),
  sourceChangedAt: timestamp('source_changed_at', { withTimezone: true }),
  financialPostingId: integer('financial_posting_id'),
  financialPostingVersion: integer('financial_posting_version'),
  postingChecksum: varchar('posting_checksum', { length: 64 }),
  lineType: varchar('line_type', { length: 20 }).notNull(),      // FREIGHT | SERVICE_FEE | ADHOC
  typeLabel: varchar('type_label', { length: 100 }).notNull().default('Khác'),
  unit: varchar('unit', { length: 50 }).notNull().default('lần'),
  description: text('description').notNull(),
  routeName: varchar('route_name', { length: 255 }),
  containerNumbers: text('container_numbers'),                   // comma-joined (no PG arrays in this schema)
  renderData: jsonb('render_data').$type<Record<string, unknown>>(),
  baseAmount: numeric('base_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  amountOverride: numeric('amount_override', { precision: 15, scale: 0 }),
  excluded: boolean('excluded').default(false).notNull(),
  vatTreatment: varchar('vat_treatment', { length: 20 }).notNull().default('EXEMPT'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('0'),
  vatTreatmentVersion: varchar('vat_treatment_version', { length: 30 }).notNull().default('VAT-V1'),
  netAmount: numeric('net_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  taxAmount: numeric('tax_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  grossAmount: numeric('gross_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  sortOrder: integer('sort_order').default(0).notNull(),
}, (table) => [
  index('billing_document_lines_doc_idx').on(table.documentId),
]);

// One recoverable expense may be claimed by only one Debit Note. Approval and
// eligibility remain authoritative on trip_expenses; this table only freezes
// the source/version link and prevents double billing.
export const billingDocumentRecoverableClaims = pgTable('billing_document_recoverable_claims', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id')
    .notNull(),
  // Plain integer avoids the schema initializer cycle: trip_expenses is
  // declared later in this file. The generated migration adds the FK.
  expenseId: integer('expense_id').notNull(),
  expenseVersion: integer('expense_version').notNull(),
  sourceVersion: varchar('source_version', { length: 120 }).notNull(),
  evidenceSnapshot: jsonb('evidence_snapshot').$type<Record<string, unknown>>().notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  releasedBy: integer('released_by'),
  releaseReason: varchar('release_reason', { length: 32 }),
}, (table) => [
  uniqueIndex('billing_document_recoverable_claims_expense_active_uniq')
    .on(table.expenseId)
    .where(sql`${table.releasedAt} is null`),
  index('billing_document_recoverable_claims_document_idx').on(table.documentId),
]);

export const billingDocumentDisputes = pgTable('billing_document_disputes', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull(),
  documentVersion: integer('document_version').notNull(),
  customerId: integer('customer_id').notNull(),
  disputedBy: integer('disputed_by').notNull(),
  reason: text('reason').notNull(),
  evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  disputedAt: timestamp('disputed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('billing_document_disputes_idempotency_uniq').on(table.idempotencyKey),
  index('billing_document_disputes_document_idx').on(table.documentId, table.disputedAt),
]);

export const penalties = pgTable('penalties', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  tripId: integer('trip_id'),
  reasonId: integer('reason_id'),
  customReason: text('custom_reason'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  date: date('date').notNull(),
  status: penaltyStatusEnum('status').default('ACTIVE').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('penalties_date_idx').on(table.date),
]);

export const capTableHistory = pgTable('cap_table_history', {
  id: serial('id').primaryKey(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  // Optional — application drives cap-table ownership via percentage; this
  // column is reserved for future amount-based book-keeping.
  contributionAmount: numeric('contribution_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  // Snapshot ownership percentage (0–100). Distribution math reads this
  // directly; contributionAmount is a separate book-keeping field.
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Per-vehicle ownership (F3) ─────────────────────────────────────────────
// History-based mirrors of `cap_table_history`, but scoped per truck. Each row
// is a snapshot of one partner's stake at an `effectiveDate` for a truck; the
// latest effectiveDate ≤ cutoff (deduped by partner) resolves the active
// owners whose % share that truck's profit. `percentage` is explicit (0–100);
// contribution amount is not tracked per-vehicle.
export const truckCapTable = pgTable('truck_cap_table', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id').notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  // B2 (feedback202606 GAP 7) — role of the partner: INVESTOR (capital partner,
  // default) or DRIVER (driver-contributor modeled as a per-truck profit
  // participant by %). Application validation owns the allowed values.
  role: text('role').notNull().default('INVESTOR'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('truck_cap_table_truck_effective_idx').on(table.truckId, table.effectiveDate),
]);

export const distributions = pgTable('distributions', {
  id: serial('id').primaryKey(),
  quarter: integer('quarter').notNull(),
  year: integer('year').notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // F3 — per-vehicle attribution. NULL on legacy entity-wide rows; set to the
  // owning truck's id on new per-vehicle distribution rows.
  truckId: integer('truck_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const debtOffsets = pgTable('debt_offsets', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  supplierId: integer('supplier_id').notNull(),
  // Q08: legacy offsets may predate canonical partner linkage. Keep nullable
  // at-rest for upgrade safety; new writes must still provide the canonical
  // partner through the service-layer validator.
  partnerId: integer('partner_id'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  offsetDate: date('offset_date').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  minutesReference: varchar('minutes_reference', { length: 120 }),
  minutesDocumentHash: varchar('minutes_document_hash', { length: 120 }),
  note: text('note'),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('PENDING'),
  createdBy: integer('created_by'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('debt_offsets_customer_idx').on(table.customerId),
  index('debt_offsets_supplier_idx').on(table.supplierId),
  index('debt_offsets_partner_idx').on(table.partnerId, table.offsetDate),
]);

export const managementFees = pgTable('management_fees', {
  id: serial('id').primaryKey(),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const salaryConfirmationStatusEnum = applicationEnum(['DRAFT', 'CONFIRMED']);

export const salaryConfirmations = pgTable('salary_confirmations', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: salaryConfirmationStatusEnum('status').default('DRAFT').notNull(),
  confirmedBy: integer('confirmed_by'),
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salary_confirmations_driver_period_idx').on(table.driverId, table.year, table.month),
]);

export const salaryPeriods = pgTable('salary_periods', {
  id: serial('id').primaryKey(),
  // null for the global default row; 1-12 for per-month overrides
  month: integer('month'),
  year: integer('year'),
  // Explicit dates for per-month overrides; null for global default (derived)
  startDate: date('start_date'),
  endDate: date('end_date'),
  label: varchar('label', { length: 100 }),
  // Only set on the global default row (isDefault = true)
  defaultStartDay: integer('default_start_day'),
  defaultEndDay: integer('default_end_day'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// ─── Vendor & Expense ────────────────────────────────────────────────────────────
// suppliers is declared above customers (before routes) to avoid circular forward-ref.

export const expenseCategories = pgTable('expense_categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  isRenewable: boolean('is_renewable').default(false),
  reminderLeadDays: integer('reminder_lead_days').default(30),
  // Wave 2 M3.7: per-type invoice-required rule. When true, expenses in this
  // category MUST have a supplier invoice (invoiceNumber + invoiceDate) before
  // approval. When false, substitute evidence is accepted. Defaults false
  // (back-compat — existing categories accept any evidence).
  requiresInvoice: boolean('requires_invoice').default(false),
  // Wave 3 M4.7: when requiresInvoice is false, this flag indicates whether
  // substitute evidence is explicitly allowed. Defaults true (back-compat —
  // non-invoice categories accept substitute evidence).
  substituteEvidenceAllowed: boolean('substitute_evidence_allowed').default(true),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  expenseDate: date('expense_date').notNull(),
  supplierId: integer('supplier_id').notNull(),
  categoryId: integer('category_id').notNull(),
  // `truck_id` is polymorphic — holds either `trucks.id` (when vehicle_component='TRUCK'),
  // `trailers.id` (when vehicle_component='TRAILER'), or null (company-wide expense).
  // Polymorphic relationship integrity is maintained by create/update services.
  truckId: integer('truck_id'),
  vehicleComponent: vehicleComponentEnum('vehicle_component').default('TRUCK'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }).notNull(),
  validFrom: timestamp('valid_from'),
  validTo: timestamp('valid_to'),
  receiptId: varchar('receipt_id', { length: 100 }),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('expenses_date_idx').on(table.expenseDate),
  index('expenses_supplier_idx').on(table.supplierId),
  index('expenses_category_idx').on(table.categoryId),
  index('expenses_vehicle_idx').on(table.truckId, table.vehicleComponent),
]);

export const expensePhotos = pgTable('expense_photos', {
  id: serial('id').primaryKey(),
  expenseId: integer('expense_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  // Receipt-photo serving (/api/photos) resolves ownership by exact storage_key
  // lookup; this index makes that O(log n) instead of a seq scan. See ADR 0042.
  index('expense_photos_storage_key_idx').on(table.storageKey),
]);

// ─── Forwarder catalogs ──────────────────────────────────────────────────────────

export const containerTypes = pgTable('container_types', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(), // e.g. "20DC", "40HC"
  name: varchar('name', { length: 50 }).notNull(),          // e.g. "20'DC", "40'HC"
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const sealTypes = pgTable('seal_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),          // e.g. "Customs", "Carrier"
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const ports = pgTable('ports', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),   // e.g. "Cảng Hải Phòng"
  code: varchar('code', { length: 20 }).unique(),     // e.g. "HPH"
  address: text('address'),
  city: varchar('city', { length: 100 }).default('Hải Phòng'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const forwarderExpenseTypes = pgTable('forwarder_expense_types', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  // Wave 2 M3.7: when true, trip expenses of this type MUST have an invoice
  // number before approval. When false (default), substitute evidence is OK.
  requiresInvoice: boolean('requires_invoice').default(false),
  // Wave 3 M4.7: when requiresInvoice is false, this flag controls whether
  // substitute evidence (e.g.现场 biên nhận, ảnh hiện trường) is accepted
  // for this type. Default true = backward compat (existing types accept
  // substitute evidence). When false, no-invoice expenses of this type are
  // blocked at approval.
  substituteEvidenceAllowed: boolean('substitute_evidence_allowed').default(true),
  noInvoiceEvidenceTypes: jsonb('no_invoice_evidence_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  noInvoicePerItemLimit: numeric('no_invoice_per_item_limit', { precision: 15, scale: 0 }).notNull().default('1000000'),
  noInvoicePerDayLimit: numeric('no_invoice_per_day_limit', { precision: 15, scale: 0 }).notNull().default('5000000'),
  noInvoiceFinanceLeadItemApprovalLimit: numeric('no_invoice_finance_lead_item_approval_limit', { precision: 15, scale: 0 }).notNull().default('5000000'),
  noInvoiceDirectorDayApprovalLimit: numeric('no_invoice_director_day_approval_limit', { precision: 15, scale: 0 }).notNull().default('10000000'),
  noInvoiceFinanceLeadApprovalTitle: varchar('no_invoice_finance_lead_approval_title', { length: 50 }).notNull().default('FINANCE_LEAD'),
  noInvoiceDirectorApprovalTitle: varchar('no_invoice_director_approval_title', { length: 50 }).notNull().default('DIRECTOR'),
  noInvoicePolicyVersion: integer('no_invoice_policy_version').notNull().default(1),
  defaultMarkup: boolean('default_markup').notNull().default(false),
  billingLabel: varchar('billing_label', { length: 120 }),
  vatRate: numeric('vat_rate', { precision: 5, scale: 3 }).notNull().default('0.080'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// ─── Forwarder ──────────────────────────────────────────────────────────────────

export const tripContainers = pgTable('trip_containers', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  // Plain integers here avoid a forward-reference cycle with shipment tables.
  // Application services enforce these relationships.
  sourceShipmentId: integer('source_shipment_id'),
  sourceShipmentContainerId: integer('source_shipment_container_id'),
  sourceShipmentVersion: integer('source_shipment_version'),
  containerTypeId: integer('container_type_id'),
  containerNumber: varchar('container_number', { length: 50 }),
  // Kept for back-compat during the Phase 2 multi-seal migration. New writes
  // also maintain this as the "primary seal" mirror (= first child row in
  // trip_container_seals). To be dropped in a follow-up once no client reads it.
  sealNumber: varchar('seal_number', { length: 50 }),
  // Cargo weight in kilograms. Added 2026-06 per Pete's request to capture
  // trọng lượng hàng per container; report aggregations can sum/avg as needed.
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  notes: text('notes'),
  // createdBy is nullable now because the row may also be filled in by
  // accountant/manager via the trip edit form (not just forwarder during receipt).
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_containers_trip_id_idx').on(table.tripId),
  index('trip_containers_shipment_source_idx')
    .on(table.sourceShipmentId, table.sourceShipmentContainerId),
]);

// ─── Multi-seal per container (Phase 2) ───────────────────────────────────
// A container may carry multiple seals (customs seal, carrier seal, …).
// Each row is one seal. Application delete handling removes its seals with the
// container so no orphan is left behind.
export const tripContainerSeals = pgTable('trip_container_seals', {
  id: serial('id').primaryKey(),
  tripContainerId: integer('trip_container_id')
    .notNull(),
  sealNumber: varchar('seal_number', { length: 50 }).notNull(),
  // Free-form string ("Customs", "Carrier", …). No enum — drivers may label
  // however makes sense in the field.
  sealType: varchar('seal_type', { length: 30 }),
  notes: text('notes'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_container_seals_container_idx').on(table.tripContainerId),
]);

// ─── Trip instructions (N2 / B1.3) ─────────────────────────────────────────
// Manager-authored contact + free-text guidance for a trip. Manager writes via
// TripEdit; driver reads read-only via DriverTripDetailPage. One row per trip.
export const tripInstructions = pgTable('trip_instructions', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  notes: text('notes'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_instructions_trip_id_unq').on(table.tripId),
]);

export const tripExpenses = pgTable('trip_expenses', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  version: integer('version').notNull().default(1),
  forwarderId: integer('forwarder_id'),  // nullable — accountants also create
  // Q15: authoritative maker. Legacy forwarder-created rows are safely
  // backfilled from forwarder_id; unknown office-side legacy makers stay NULL.
  createdBy: integer('created_by'),
  expenseType: varchar('expense_type', { length: 50 }).notNull(),   // FK to forwarder_expense_types.code
  buyAmount: numeric('buy_amount', { precision: 15, scale: 0 }).notNull(),
  sellAmount: numeric('sell_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  // Explicit customer recovery decomposition. Legacy rows remain NULL and are
  // reported as missing accounting classification instead of being guessed
  // from buy amount/markup.
  recoverablePrincipalAmount: numeric('recoverable_principal_amount', { precision: 15, scale: 0 }),
  serviceFeeAmount: numeric('service_fee_amount', { precision: 15, scale: 0 }),
  settlementMethod: varchar('settlement_method', { length: 20 }).notNull().default('FORWARDER_ADVANCE'),
  supplierId: integer('supplier_id'),
  expenseDate: date('expense_date'),
  payeeName: varchar('payee_name', { length: 200 }),
  invoiceNumber: varchar('invoice_number', { length: 50 }),
  invoiceDate: date('invoice_date'),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  // Free-text container label (DEPRECATED for B5). Kept for back-compat with
  // rows written before the FK existed and as a denormalised mirror; new writes
  // should set `tripContainerId` so the label always matches a real container.
  containerNumber: varchar('container_number', { length: 20 }),
  // B5: authoritative link to the trip's container row. Application delete
  // handling downgrades the expense to trip-level by clearing this identifier.
  tripContainerId: integer('trip_container_id'),
  // Immutable pricing evidence for lift/lower expenses. The FK identifies the
  // catalog row; the JSON snapshot preserves the selectors and resolved price
  // even if that catalog row is later edited or retired.
  liftPricingId: integer('lift_pricing_id'),
  liftPricingSnapshot: jsonb('lift_pricing_snapshot').$type<{
    portId: number;
    containerTypeId: number;
    direction: 'LIFT_UP' | 'LIFT_DOWN';
    loadState: 'LOADED' | 'EMPTY';
    expenseDate: string;
    effectiveDate: string;
    unitPrice: number;
  }>(),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('APPROVED'),
  // O2C: real approval timestamp. Unlike approvalStatus (which defaults to
  // 'APPROVED' for legacy rows), this is NULL until a real accountant approval
  // action — the signal the delete-authorization matrix keys off. Added
  // (260801-2200) so the accountant-approved undeletable exception is accurate.
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: integer('approved_by'),
  note: text('note'),
  noInvoiceEvidenceTypes: jsonb('no_invoice_evidence_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  noInvoicePolicySnapshot: jsonb('no_invoice_policy_snapshot').$type<Record<string, unknown>>(),
  returnForEvidenceReason: text('return_for_evidence_reason'),
  returnedForEvidenceAt: timestamp('returned_for_evidence_at'),
  returnedForEvidenceBy: integer('returned_for_evidence_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_expenses_trip_id_idx').on(table.tripId),
  index('trip_expenses_container_idx').on(table.containerNumber),
  index('trip_expenses_trip_container_id_idx').on(table.tripContainerId),
  index('trip_expenses_lift_pricing_id_idx').on(table.liftPricingId),
  index('trip_expenses_no_invoice_aggregate_idx').on(table.expenseType, table.expenseDate, table.payeeName),
]);

export const fuelInvoices = pgTable('fuel_invoices', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id').notNull(),
  invoiceNumber: varchar('invoice_number', { length: 80 }).notNull(),
  invoiceDate: date('invoice_date').notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  totalLiters: numeric('total_liters', { precision: 15, scale: 2 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('PENDING'),
  note: text('note'),
  createdBy: integer('created_by'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('fuel_invoices_supplier_idx').on(table.supplierId, table.invoiceDate),
  uniqueIndex('fuel_invoices_supplier_invoice_uniq_idx')
    .on(
      table.supplierId,
      sql`lower(btrim(${table.invoiceNumber}))`,
      table.invoiceDate,
    ),
]);

export const fuelInvoiceAllocations = pgTable('fuel_invoice_allocations', {
  id: serial('id').primaryKey(),
  fuelInvoiceId: integer('fuel_invoice_id')

    .notNull(),
  tripId: integer('trip_id').notNull(),
  truckId: integer('truck_id'),
  tripExpenseId: integer('trip_expense_id'),
  voucherReference: varchar('voucher_reference', { length: 120 }).notNull(),
  voucherDate: date('voucher_date').notNull(),
  liters: numeric('liters', { precision: 15, scale: 2 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('fuel_invoice_allocations_invoice_idx').on(table.fuelInvoiceId),
  index('fuel_invoice_allocations_truck_idx').on(table.truckId, table.voucherDate),
  uniqueIndex('fuel_invoice_allocations_trip_expense_uniq_idx')
    .on(table.tripExpenseId)
    .where(sql`${table.tripExpenseId} is not null`),
  uniqueIndex('fuel_invoice_allocations_invoice_voucher_uniq_idx')
    .on(table.fuelInvoiceId, table.tripId, table.voucherReference),
]);

export const tripExpensePhotos = pgTable('trip_expense_photos', {
  id: serial('id').primaryKey(),
  tripExpenseId: integer('trip_expense_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  // Receipt-photo serving (/api/photos) resolves ownership by exact storage_key
  // lookup; this index makes that O(log n) instead of a seq scan. See ADR 0042.
  index('trip_expense_photos_storage_key_idx').on(table.storageKey),
]);

export const fuelEvidenceReviews = pgTable('fuel_evidence_reviews', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  ownerDriverId: integer('owner_driver_id').notNull(),
  ownerUserId: integer('owner_user_id').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  storageHash: varchar('storage_hash', { length: 64 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 255 }),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  gpsAccuracy: numeric('gps_accuracy', { precision: 8, scale: 2 }),
  gpsAltitude: numeric('gps_altitude', { precision: 8, scale: 2 }),
  gpsAt: timestamp('gps_at', { withTimezone: true }),
  geotagSource: varchar('geotag_source', { length: 20 }),
  geotagSampleCount: integer('geotag_sample_count'),
  geotagBestAccuracy: numeric('geotag_best_accuracy', { precision: 8, scale: 2 }),
  geotagElapsedMs: integer('geotag_elapsed_ms'),
  ocrOutcome: fuelEvidenceOcrOutcomeEnum('ocr_outcome').notNull(),
  reviewStatus: fuelEvidenceReviewStatusEnum('review_status').notNull().default('PENDING'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  reviewRequired: boolean('review_required').notNull().default(true),
  litres: numeric('litres', { precision: 12, scale: 3 }),
  unitPrice: numeric('unit_price', { precision: 15, scale: 0 }),
  totalAmount: numeric('total_amount', { precision: 15, scale: 0 }),
  computedTotal: numeric('computed_total', { precision: 15, scale: 0 }),
  mismatch: boolean('mismatch').notNull().default(false),
  anomalyCode: varchar('anomaly_code', { length: 40 }),
  anomalyReason: text('anomaly_reason'),
  ocrProvider: varchar('ocr_provider', { length: 40 }),
  ocrModel: varchar('ocr_model', { length: 100 }),
  ocrError: text('ocr_error'),
  reviewerId: integer('reviewer_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewNote: text('review_note'),
  createdBy: integer('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  version: integer('version').notNull().default(1),
}, (table) => [
  uniqueIndex('fuel_evidence_reviews_trip_owner_hash_uniq').on(table.tripId, table.ownerDriverId, table.storageHash),
  index('fuel_evidence_reviews_trip_idx').on(table.tripId, table.reviewStatus),
  index('fuel_evidence_reviews_owner_idx').on(table.ownerDriverId, table.createdAt),
  index('fuel_evidence_reviews_review_queue_idx').on(table.reviewStatus, table.createdAt),
  index('fuel_evidence_reviews_storage_key_idx').on(table.storageKey),
]);

export const tripExpenseCompletionScopes = pgTable('trip_expense_completion_scopes', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  // Null represents the trip-level "Chi phí chung" scope.
  tripContainerId: integer('trip_container_id'),
  status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'),
  completedBy: integer('completed_by'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_expense_scope_container_unq').on(table.tripContainerId).where(sql`${table.tripContainerId} IS NOT NULL`),
  uniqueIndex('trip_expense_scope_general_unq').on(table.tripId).where(sql`${table.tripContainerId} IS NULL`),
  index('trip_expense_scope_trip_idx').on(table.tripId),
]);

export const advanceRequests = pgTable('advance_requests', {
  id: serial('id').primaryKey(),
  version: integer('version').default(1).notNull(),
  requesterId: integer('requester_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  status: advanceRequestStatusEnum('status').default('PENDING').notNull(),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const advanceSettlements = pgTable('advance_settlements', {
  id: serial('id').primaryKey(),
  version: integer('version').default(1).notNull(),
  code: varchar('code', { length: 20 }).notNull(),
  forwarderId: integer('forwarder_id').notNull(),
  totalExpenseAmount: numeric('total_expense_amount', { precision: 15, scale: 0 }).notNull(),
  refundAmount: numeric('refund_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  status: advanceSettlementStatusEnum('status').default('PENDING').notNull(),
  checkedBy: integer('checked_by'),
  checkedAt: timestamp('checked_at'),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at'),
  // Immutable idempotency authority for the automatic O2C expense-offset hook.
  // Manual settlements leave this null; one approved expense can create at
  // most one automatic settlement even under concurrent approval replays.
  autoOffsetExpenseId: integer('auto_offset_expense_id'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('advance_settlements_code_unique_idx').on(table.code),
  uniqueIndex('advance_settlements_auto_offset_expense_uniq')
    .on(table.autoOffsetExpenseId)
    .where(sql`${table.autoOffsetExpenseId} IS NOT NULL`),
]);

export const advanceSettlementRequests = pgTable('advance_settlement_requests', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').notNull(),
  advanceRequestId: integer('advance_request_id').notNull(),
  // The consumed slice of this advance. A request can fund multiple automatic
  // settlements while its unallocated residual remains outstanding.
  allocatedAmount: numeric('allocated_amount', { precision: 15, scale: 0 }).default('0').notNull(),
}, (table) => [
  uniqueIndex('adv_settlement_req_unique_idx').on(table.settlementId, table.advanceRequestId),
  index('adv_settlement_req_request_idx').on(table.advanceRequestId),
]);

export const settlementExpenses = pgTable('settlement_expenses', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').notNull(),
  tripExpenseId: integer('trip_expense_id').notNull(),
  originalBuyAmount: numeric('original_buy_amount', { precision: 15, scale: 0 }).notNull(),
  adjustedBuyAmount: numeric('adjusted_buy_amount', { precision: 15, scale: 0 }).notNull(),
  submittedSellAmount: numeric('submitted_sell_amount', { precision: 15, scale: 0 }),
  originalSnapshot: jsonb('original_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustedSnapshot: jsonb('adjusted_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustmentReason: text('adjustment_reason'),
  adjustedBy: integer('adjusted_by'),
  adjustedAt: timestamp('adjusted_at'),
}, (table) => [
  uniqueIndex('settlement_expense_unique_idx').on(table.settlementId, table.tripExpenseId),
  index('settlement_expense_trip_expense_idx').on(table.tripExpenseId),
]);

// Q18: immutable audit history for every accountant correction applied to a
// settlement expense. The current effective snapshot remains on
// settlement_expenses for approval/reporting, while these child rows preserve
// every before/after transition and its eventual approval authority.
export const settlementExpenseAdjustments = pgTable('settlement_expense_adjustments', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id')

    .notNull(),
  settlementExpenseId: integer('settlement_expense_id')

    .notNull(),
  tripExpenseId: integer('trip_expense_id')

    .notNull(),
  sequence: integer('sequence').notNull(),
  sourceVersion: integer('source_version').notNull(),
  beforeSnapshot: jsonb('before_snapshot').$type<Record<string, unknown>>().notNull(),
  afterSnapshot: jsonb('after_snapshot').$type<Record<string, unknown>>().notNull(),
  reason: text('reason').notNull(),
  adjustedBy: integer('adjusted_by').notNull(),
  adjustedAt: timestamp('adjusted_at', { withTimezone: true }).defaultNow().notNull(),
  approvedBy: integer('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('settlement_expense_adjustments_link_sequence_uniq')
    .on(table.settlementExpenseId, table.sequence),
  index('settlement_expense_adjustments_settlement_idx')
    .on(table.settlementId, table.adjustedAt),
  index('settlement_expense_adjustments_expense_idx')
    .on(table.tripExpenseId, table.adjustedAt),
]);

// ─── Attendance ──────────────────────────────────────────────────────────────

export const driverWorkDays = pgTable('driver_work_days', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').notNull(),
  date: date('date').notNull(),
  status: workDayStatusEnum('status').notNull(),
  tripId: integer('trip_id'),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('driver_work_days_driver_date_idx').on(table.driverId, table.date),
  index('driver_work_days_driver_idx').on(table.driverId),
]);

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  userId: integer('user_id'),
  actorName: varchar('actor_name', { length: 255 }),
  message: text('message').notNull(),
  entityType: varchar('entity_type', { length: 50 }),
  entityId: integer('entity_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ─── E2E Epic Extensions ──────────────────────────────────────────────────────

export const roadConfig = pgTable('road_config', {
  id: serial('id').primaryKey(),
  tollPerStation: numeric('toll_per_station', { precision: 15, scale: 0 }).notNull(),
  returnCargoBonus: numeric('return_cargo_bonus', { precision: 15, scale: 0 }).notNull(),
  defaultDriverSalary: numeric('default_driver_salary', { precision: 15, scale: 0 }).default('400000'),
  twoPointDeliveryBonus: numeric('two_point_delivery_bonus', { precision: 15, scale: 0 }).default('200000'),
  vehicleShiftDefault: numeric('vehicle_shift_default', { precision: 15, scale: 0 }).default('200000'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  key: varchar('setting_key', { length: 120 }).primaryKey(),
  value: text('setting_value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const tripCodeCounters = pgTable('trip_code_counters', {
  yearMonth: varchar('year_month', { length: 10 }).primaryKey(),
  counter: integer('counter').notNull(),
});

export const tripPhotos = pgTable('trip_photos', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  type: tripPhotoTypeEnum('type').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by').notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  // Phase 2: optional link to a specific container row, so each container's
  // cont/seal photo(s) can be displayed under that container. Application delete
  // handling clears this identifier so the photo remains trip-level evidence.
  tripContainerId: integer('trip_container_id'),
}, (table) => [
  // Phase 2: index the per-container photo lookups (listTripContainers joins
  // trip_photos by trip_container_id; container-scoped deletes filter by it).
  index('trip_photos_trip_container_id_idx').on(table.tripContainerId),
]);

/**
 * Real driven routes between two locations, captured from Bách Khoa GPS tracks.
 * Keyed by cleaned (origin, destination) — the SAME key the trip-queries + gps
 * joins build from trip_legs (`.trim().toLowerCase()`). Populated by the
 * route-capture backfill + runtime completion hook. The SOLE source of route
 * polylines + distances for trip/dispatch map display — Google Directions was
 * removed entirely, so every shown route is one the vehicle actually drove.
 */
export const routePolylines = pgTable('route_polylines', {
  id: serial('id').primaryKey(),
  originCleaned: varchar('origin_cleaned', { length: 255 }).notNull(),
  destinationCleaned: varchar('destination_cleaned', { length: 255 }).notNull(),
  encodedPolyline: text('encoded_polyline').notNull(),
  pointCount: integer('point_count').notNull(),
  distanceKm: numeric('distance_km', { precision: 10, scale: 2 }).notNull(),
  sourceTripId: integer('source_trip_id'),
  routeId: integer('route_id'),
  derivedAt: timestamp('derived_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('route_polylines_uniq_idx').on(table.originCleaned, table.destinationCleaned),
]);

/**
 * The full, lossless GPS breadcrumb trail a truck actually drove for one trip —
 * the raw ground truth captured from Bách Khoa (getJourney), before per-leg
 * slicing/derivation. Kept per the GPS-route-DB plan (user decision #2: "store
 * all") so routes can be re-derived later (e.g. consensus path) without re-hitting
 * the provider. 1:1 per trip (unique trip_id). `encoded_polyline` is the complete
 * trail; `status` is app-controlled ('ok' | 'partial' | 'empty' | 'failed').
 * `segment_matched` records whether per-leg derivation succeeded for every leg.
 */
export const tripGpsTracks = pgTable('trip_gps_tracks', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  routeId: integer('route_id'),
  truckId: integer('truck_id'),
  carId: integer('car_id'),
  licensePlate: varchar('license_plate', { length: 20 }),
  encodedPolyline: text('encoded_polyline').notNull(),
  pointCount: integer('point_count').notNull().default(0),
  distanceKm: numeric('distance_km', { precision: 10, scale: 2 }).notNull().default('0.00'),
  /** The truck's ordered significant stops (Bách Khoa DetailStop, ≥3min) — real
   *  GPS waypoints {lat,lng,address,startTime,durationSec}. Captured alongside
   *  the trail so the map can place numbered markers at real stop coordinates
   *  (every stop 1..N), independent of per-leg route derivation. Null when no
   *  stops were resolved (e.g. older rows captured before this column existed). */
  stops: jsonb('stops').$type<Array<{ lat: number; lng: number; address: string | null; startTime: string | null; durationSec: number | null }>>(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: varchar('status', { length: 16 }).notNull().default('ok'),
  segmentMatched: boolean('segment_matched').notNull().default(false),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  errorKind: varchar('error_kind', { length: 32 }),
}, (table) => [
  uniqueIndex('trip_gps_tracks_trip_uniq_idx').on(table.tripId),
  index('trip_gps_tracks_route_idx').on(table.routeId),
  index('trip_gps_tracks_truck_ended_idx').on(table.truckId, table.endedAt),
]);

/**
 * Durable outbox for GPS capture/route derivation after an approved trip close.
 * The approval transaction inserts one row before it can return success.
 * Workers lease rows and retain diagnostic retry state instead of relying on a
 * client to replay a successful approval request.
 */
export const tripGpsCaptureJobs = pgTable('trip_gps_capture_jobs', {
  id: serial('id').primaryKey(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  tripId: integer('trip_id').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  leaseToken: varchar('lease_token', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_gps_capture_jobs_action_uniq_idx').on(table.governanceActionId),
  index('trip_gps_capture_jobs_retry_idx').on(table.status, table.nextAttemptAt),
]);

/**
 * Typed durable effects for cross-boundary side effects that must survive
 * process restarts. Domain transactions insert rows here and workers execute
 * them with leased at-least-once delivery instead of best-effort callbacks.
 */
export const durableEffectJobs = pgTable('durable_effect_jobs', {
  id: serial('id').primaryKey(),
  kind: varchar('kind', { length: 40 }).notNull(),
  payloadVersion: smallint('payload_version').notNull().default(1),
  dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: varchar('status', { length: 16 }).notNull().default('PENDING'),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(20),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  leaseToken: varchar('lease_token', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  lastError: text('last_error'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('durable_effect_jobs_kind_dedupe_uniq_idx').on(table.kind, table.dedupeKey),
  index('durable_effect_jobs_due_idx').on(table.status, table.nextAttemptAt, table.id),
  index('durable_effect_jobs_lease_idx').on(table.status, table.leaseExpiresAt),
]);

/**
 * One row per truck: the most recent GPS fix seen by getLiveFleet(). Upserted on
 * every successful live-fleet poll so the dispatch map can fall back to the
 * last-known position (shown offline) when the Bách Khoa provider is down or a
 * specific truck is absent from its response — instead of the map going empty.
 * truck_id is the PK (1:1 per truck); telemetry is double precision so values
 * round-trip as native JS numbers (no numeric string juggling on readback).
 */
export const vehicleLastPositions = pgTable('vehicle_last_positions', {
  truckId: integer('truck_id').primaryKey(),
  deviceId: varchar('device_id', { length: 50 }),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  speed: doublePrecision('speed'),
  angle: doublePrecision('angle'),
  address: text('address'),
  ignitionOn: boolean('ignition_on').default(false).notNull(),
  fuel: doublePrecision('fuel'),
  gpsDriverName: varchar('gps_driver_name', { length: 255 }),
  lastSeenAt: timestamp('last_seen_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message').notNull(),
  relatedEntityType: varchar('related_entity_type', { length: 50 }),
  relatedEntityId: integer('related_entity_id'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('notifications_user_unread_idx').on(table.userId, table.isRead),
  index('notifications_user_created_idx').on(table.userId, table.createdAt),
]);

// ─── Push subscriptions (Web Push) ──────────────────────────────────────────
// One row per (user, browser endpoint). Upserted on subscribe; auto-removed
// when the push service returns 410/404 (stale endpoint). device_type is
// sniffed client-side (ios/android/web) for reporting only.

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  endpoint: varchar('endpoint', { length: 500 }).notNull(),
  keysP256dh: varchar('keys_p256dh', { length: 200 }).notNull(),
  keysAuth: varchar('keys_auth', { length: 100 }).notNull(),
  deviceType: varchar('device_type', { length: 20 }).default('web').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('push_sub_user_endpoint_idx').on(table.userId, table.endpoint),
  index('push_sub_user_idx').on(table.userId),
]);

// ─── Agent (command-and-insight assistant) ─────────────────────────────────
// Conversation history for the bot. Persisted to Postgres (not Redis) for
// auditability — every user turn, assistant answer, and tool call is
// reconstructable. The bot has no identity of its own: every conversation is
// scoped to a user and the bot acts with that user's role (re-checked inside
// each tool). `role` is a snapshot of the user's role at conversation time, so
// a later role change never rewrites history.

export const agentConversations = pgTable('agent_conversations', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  role: roleEnum('role').notNull(),
  title: varchar('title', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('agent_conversations_user_updated_idx').on(table.userId, table.updatedAt),
]);

// A turn in a conversation. `role` here is the message author ('user' |
// 'assistant'), distinct from the conversation's RBAC role above.
//   - content     : plain text (user message or an assistant 'text' answer)
//   - response    : the structured AgentResponse (insight_card | tutorial |
//                   directive | text) for assistant turns; null for user turns
//   - toolTrace   : jsonb array of { toolName, toolCallId, args, result, ok }
//                   — the full reasoning path, attached to the assistant turn
//                   that issued the calls. (The plan modelled these as separate
//                   columns; a jsonb trace is used instead because one turn
//                   fans out to N tool calls.)
//   - directives  : directives emitted this turn, denormalised for fast
//                   "what did the bot do" / audit queries
//   - tokens*     : cost accounting
export const agentMessages = pgTable('agent_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content'),
  response: jsonb('response'),
  toolTrace: jsonb('tool_trace'),
  directives: jsonb('directives'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('agent_messages_conversation_idx').on(table.conversationId),
]);

// ─── FAQ knowledge base (chatbot pre-LLM fast lane) ─────────────────────────
// Seeded domain Q&A answered with ZERO LLM calls via a 4-stage cascade matcher
// (exact → rule → cosine similarity via pgvector → score/margin gate). The
// `embedding` column is populated by db/backfill-faq-embeddings.ts (OpenRouter
// text-embedding-3-small, 1536 dims). See drizzle/0104_faq_knowledge_base.sql
// for the full table + seed, and services/agent/faq-fast-lane.ts for matching.
export const faqEntries = pgTable('faq_entries', {
  id: serial('id').primaryKey(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  questionVariants: text('question_variants').array().notNull().default([]),
  requiredTerms: text('required_terms').array().notNull().default([]),
  forbiddenTerms: text('forbidden_terms').array().notNull().default([]),
  searchText: text('search_text').notNull().default(''),
  // pgvector column — JS representation is the literal string '[0.1,0.2,...]'.
  // NULL until the backfill script embeds the row. Vector ops go through raw SQL.
  embedding: vectorColumn1536('embedding'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Knowledge chunks (P2 doc-RAG over CONTEXT.md / ADRs / product docs) ────
// Generalizes the FAQ fast-lane retrieval to arbitrary product documentation.
// Each chunk is one semantic unit (heading/section/step) from a doc, embedded
// with the same text-embedding-3-small model. Retrieved via pgvector cosine
// similarity + metadata filtering. See services/agent/knowledge-retrieval.ts.
export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: serial('id').primaryKey(),
  // What kind of source: 'context' (CONTEXT.md), 'adr', 'doc', 'faq'.
  sourceType: text('source_type').notNull(),
  // Repo-relative path (e.g. 'CONTEXT.md', 'docs/adr/0001-...').
  sourcePath: text('source_path').notNull(),
  // Heading or section title within the source.
  heading: text('heading').notNull(),
  // The chunk content (one semantic unit, ≤500 chars).
  content: text('content').notNull(),
  // pgvector embedding (1536 dims, same model as FAQ). NULL until embedded.
  embedding: vectorColumn1536('embedding'),
  // Version watermark for stale-detection (hash of the source file at ingest).
  docVersion: text('doc_version'),
  // Vietnamese language code for the chunk.
  lang: text('lang').notNull().default('vi'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('knowledge_chunks_source_idx').on(table.sourceType, table.sourcePath),
]);

/**
 * Event-driven mobile GPS geotag for a photo submission (foundation module).
 *
 * Captures an accurate phone GPS fix at the moment a portal user submits a
 * photo (container/seal, port receipt, fuel pump, …) so the photo's claimed
 * location is provable — anti-fraud + compliance. This is the CLIENT-push
 * counterpart to the server-pulled Bách Khoa truck GPS (trip_gps_tracks /
 * vehicle_last_positions): those track the vehicle; this geotags a moment.
 *
 * Polymorphic over (entity_type, entity_id) so one table serves all three photo
 * tables — trip_photos (driver), trip_expense_photos (forwarder), expense_photos
 * (office) — plus future entities without further schema changes. One geotag per
 * entity: the service upserts on (entity_type, entity_id) so resubmits don't
 * duplicate (idempotency, M0X-HT-04). Ownership is resolved per-entity-type
 * inside the service (driver→own trip_photo, forwarder→own trip_expense_photo,
 * office→any) — not encoded here.
 *
 * Requirements: M08-05 / M09-05 / M12-03-03 (photo capture flows +
 * "thiếu vị trí phải cảnh báo"), M0X-HT-03 (audit trail via recordedBy).
 */
export const photoGeotags = pgTable('photo_geotags', {
  id: serial('id').primaryKey(),
  // entity_type is free-form text so the set of geotaggable
  // entities can grow without a migration — the shared GEOTAG_ENTITY_TYPES
  // const is the validated whitelist at the API boundary.
  entityType: varchar('entity_type', { length: 32 }).notNull(),
  entityId: integer('entity_id').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  accuracy: doublePrecision('accuracy'),           // meters, device-reported
  altitude: doublePrecision('altitude'),           // meters
  // Device fix timestamp — the anti-replay freshness key. The service rejects
  // fixes >300s stale or >60s future (ported from the payroll reference).
  gpsAt: timestamp('gps_at', { withTimezone: true }),
  source: varchar('source', { length: 16 }).notNull().default('phone'), // phone | exif | manual
  // Diagnostic fields captured by the warm-fix hook — stored for triage, not
  // used for acceptance gating.
  sampleCount: integer('sample_count'),
  bestAccuracy: doublePrecision('best_accuracy'),
  elapsedMs: integer('elapsed_ms'),
  recordedBy: integer('recorded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Application locking plus lookup enforces one geotag per photo and keeps
  // resubmission idempotent.
  uniqueIndex('photo_geotags_entity_uniq').on(table.entityType, table.entityId),
]);

// ─── Scheduler (Wave 0) ─────────────────────────────────────────────────────
// Run-log for the cron scheduler introduced in Wave 0. Every job tick acquires
// a Postgres advisory lock (so two backend instances can't double-run the same
// job at the same instant), writes a row at RUNNING, and updates it to SUCCESS
// or FAILED when the handler returns/throws. Wave 2 (email retries) and Wave 3
// (receivable reminders, salary-period close) register jobs against this table.
export const schedulerRunStatusEnum = applicationEnum(['RUNNING', 'SUCCESS', 'FAILED']);

export const schedulerRunLogs = pgTable('scheduler_run_logs', {
  id: serial('id').primaryKey(),
  // Free-form job name (matches registry key). varchar not enum so new jobs
  // don't need a migration.
  jobName: varchar('job_name', { length: 64 }).notNull(),
  // Cron expression actually scheduled (useful when a job's cadence is env-driven).
  cron: varchar('cron', { length: 32 }).notNull(),
  status: schedulerRunStatusEnum('status').notNull().default('RUNNING'),
  attempt: integer('attempt').notNull().default(1),
  // Null on SUCCESS; the thrown error message on FAILED. Text (not jsonb) so
  // a quick SELECT is readable without parsing.
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (table) => [
  index('scheduler_run_logs_job_started_idx').on(table.jobName, table.startedAt),
]);

// ─── Shipments (Wave 0) ─────────────────────────────────────────────────────
// First-class `shipments` (lô hàng) entity. A shipment owns booking docs,
// containers, and declarations, and *precedes and outlives* any single trip:
// booking → documents → dispatch → delivery → debit-note. A trip becomes a
// fulfillment of (part of) a shipment via `trips.shipmentId` (added above).
// This is the keystone for M3 (CUS), M4 (debit-note from approved expenses),
// M5.6 (payment allocation), M9/M10 (forwarder/clerk mobile).
//
// Scope of this Wave 0 schema slice: tables + FK + migration only. The
// service, router, RBAC, and frontend are subsequent Wave 0 checkboxes.
export const shipmentStatusEnum = applicationEnum([
  'NEW', 'PENDING_DATE', 'READY_FOR_DISPATCH', 'DISPATCHED', 'IN_TRANSIT',
  'PENDING_EXPENSE_APPROVAL', 'COMPLETED', 'CANCELED',
]);

export const shipmentDocumentTypeEnum = applicationEnum([
  'BOOKING', 'BL', 'DO', 'DECLARATION', 'OTHER',
]);

// Customs declaration scope: SINGLE = one declaration per container; SHARED =
// one declaration covers multiple containers (issued on approval). M3.1 §3.
export const shipmentDeclarationScopeEnum = applicationEnum([
  'SINGLE', 'SHARED',
]);
export const shipmentTradeDirectionEnum = applicationEnum([
  'IMPORT', 'EXPORT',
]);
export const shipmentCargoModeEnum = applicationEnum([
  'FCL', 'LCL',
]);
export const shipmentChangeRequestKindEnum = applicationEnum([
  'PLAN_UPDATE',
  'CONTAINER_RECONCILE',
]);
export const operationalSiteTypeEnum = applicationEnum([
  'FACTORY', 'WAREHOUSE',
]);
export const masterImportStatusEnum = applicationEnum([
  'ANALYZED', 'APPLIED', 'REJECTED',
]);
export const masterImportRowClassificationEnum = applicationEnum([
  'ACCEPTED', 'BLOCKED', 'TEMPLATE', 'EXAMPLE',
]);
export const shipmentFulfillmentTypeEnum = applicationEnum([
  'FCL_CONTAINER', 'LCL_SHIPMENT',
]);
export const fulfillmentCancellationDispositionEnum = applicationEnum([
  'REPLACED', 'NOT_REQUIRED',
]);
export const tripPodStatusEnum = applicationEnum([
  'DRAFT', 'SUBMITTED', 'ACCEPTED', 'REJECTED',
]);
export const tripPodFileTypeEnum = applicationEnum([
  'YARD_OR_DROP_RECEIPT', 'SIGNED_DELIVERY_NOTE', 'TOLL_TICKET',
]);

// Customer-owned factories and pickup warehouses. The database row is the
// live master; issued fulfillments snapshot the operational fields that must
// not drift when an administrator later updates this record.
export const operationalSites = pgTable('operational_sites', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  code: varchar('code', { length: 80 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  siteType: operationalSiteTypeEnum('site_type').notNull(),
  address: text('address').notNull(),
  googleMapsUrl: text('google_maps_url'),
  contactName: varchar('contact_name', { length: 120 }),
  contactPhone: varchar('contact_phone', { length: 30 }),
  liftFeeInvoiceName: varchar('lift_fee_invoice_name', { length: 255 }),
  liftFeeInvoiceAddress: text('lift_fee_invoice_address'),
  liftFeeTaxCode: varchar('lift_fee_tax_code', { length: 40 }),
  strictRules: text('strict_rules'),
  version: integer('version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('operational_sites_customer_code_uniq_idx')
    .on(table.customerId, table.code)
    .where(sql`${table.deletedAt} is null`),
  uniqueIndex('operational_sites_customer_id_id_uniq_idx').on(table.customerId, table.id),
  index('operational_sites_customer_type_idx').on(table.customerId, table.siteType, table.isActive),
]);

// Persistent, auditable workbook analysis. The uploaded source is private and
// short-lived; row results expose only classification and redacted reasons.
export const masterImportBatches = pgTable('master_import_batches', {
  id: serial('id').primaryKey(),
  sourceFileName: varchar('source_file_name', { length: 255 }).notNull(),
  sourceFileHash: varchar('source_file_hash', { length: 64 }).notNull(),
  parserVersion: varchar('parser_version', { length: 40 }).notNull(),
  privateStorageKey: varchar('private_storage_key', { length: 255 }),
  status: masterImportStatusEnum('status').notNull().default('ANALYZED'),
  summary: jsonb('summary').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  warningCodes: jsonb('warning_codes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  version: integer('version').notNull().default(1),
  analyzedBy: integer('analyzed_by').notNull(),
  appliedBy: integer('applied_by'),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).defaultNow().notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('master_import_batches_hash_parser_uniq_idx')
    .on(table.sourceFileHash, table.parserVersion),
]);

export const masterImportRowResults = pgTable('master_import_row_results', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id')
    .notNull(),
  sheetName: varchar('sheet_name', { length: 160 }).notNull(),
  rowNumber: integer('row_number').notNull(),
  entityType: varchar('entity_type', { length: 80 }).notNull(),
  classification: masterImportRowClassificationEnum('classification').notNull(),
  naturalKeyHash: varchar('natural_key_hash', { length: 64 }),
  payloadHash: varchar('payload_hash', { length: 64 }),
  reasonCode: varchar('reason_code', { length: 80 }),
  redactedReason: text('redacted_reason'),
  appliedEntityType: varchar('applied_entity_type', { length: 80 }),
  appliedEntityId: integer('applied_entity_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('master_import_rows_batch_sheet_row_uniq_idx')
    .on(table.batchId, table.sheetName, table.rowNumber),
  index('master_import_rows_batch_class_idx').on(table.batchId, table.classification),
]);

export const shipments = pgTable('shipments', {
  id: serial('id').primaryKey(),
  // Auto-generated unique code. Format pending PRD M3.1 §5 (proposed
  // `{customerCode}-{YYMMDD}-{NNN}`); the gen logic ships with the service in
  // a later Wave 0 checkbox. Nullable here so draft rows can exist before code
  // assignment.
  shipmentCode: varchar('shipment_code', { length: 50 }).unique(),
  // Optimistic locking, mirroring trips.
  version: integer('version').default(1).notNull(),
  customerId: integer('customer_id').notNull(),
  routeId: integer('route_id'),
  cargoTypeId: integer('cargo_type_id'),
  responsibleUnitId: integer('responsible_unit_id')
    ,
  status: shipmentStatusEnum('status').default('PENDING_DATE'),
  bookingRef: varchar('booking_ref', { length: 100 }),
  blNumber: varchar('bl_number', { length: 100 }),
  tradeDirection: shipmentTradeDirectionEnum('trade_direction'),
  cargoMode: shipmentCargoModeEnum('cargo_mode'),
  operationalSiteId: integer('operational_site_id'),
  pickupWarehouseSiteId: integer('pickup_warehouse_site_id'),
  factoryName: varchar('factory_name', { length: 255 }),
  shippingLineName: varchar('shipping_line_name', { length: 255 }),
  expectedDeliveryDate: date('expected_delivery_date'),
  customsCutoffAt: timestamp('customs_cutoff_at', { withTimezone: true }),
  closingAt: timestamp('closing_at', { withTimezone: true }),
  plannedReturnAt: timestamp('planned_return_at', { withTimezone: true }),
  orderExchangeStartedAt: timestamp('order_exchange_started_at', { withTimezone: true }),
  orderExchangeStartedBy: integer('order_exchange_started_by'),
  orderExchangeCompletedAt: timestamp('order_exchange_completed_at', { withTimezone: true }),
  orderExchangeCompletedBy: integer('order_exchange_completed_by'),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  cargoVolumeCbm: numeric('cargo_volume_cbm', { precision: 10, scale: 3 }),
  packageCount: integer('package_count'),
  packageType: varchar('package_type', { length: 100 }),
  operationalNotes: text('operational_notes'),
  pickupLocation: varchar('pickup_location', { length: 255 }),
  deliveryLocation: varchar('delivery_location', { length: 255 }),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('shipments_id_cargo_mode_uniq_idx').on(table.id, table.cargoMode),
  index('shipments_customer_status_idx').on(table.customerId, table.status),
  index('shipments_route_idx').on(table.routeId),
  index('shipments_responsible_unit_idx').on(table.responsibleUnitId, table.status),
  index('shipments_status_idx').on(table.status),
  index('shipments_operational_site_idx').on(table.operationalSiteId),
  index('shipments_pickup_warehouse_idx').on(table.pickupWarehouseSiteId),
]);

// Booking confirmation, bill of lading, delivery order, customs declaration
// PDFs, etc. storageKey points at the same object-storage / uploads path
// convention used by other uploads (e.g. trip photos).
export const shipmentDocuments = pgTable('shipment_documents', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  type: shipmentDocumentTypeEnum('type'),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  // Wave 2 M3.2: document expiry date. When set and past, an expired DO
  // blocks dispatch. NULL = no expiry (permanent document).
  expiresAt: date('expires_at'),
  // Wave 2 M3.2: when this document replaces a previous version, the old
  // document's id is stored here so the replacement history is traceable.
  // The old document is NOT deleted — it stays for audit.
  replacedBy: integer('replaced_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_documents_shipment_id_idx').on(table.shipmentId),
]);

// Customs declarations. Per M3.1 §3, one declaration may cover N containers
// (SHARED) or be per-container (SINGLE). The link from a declaration to the
// containers it covers is many-to-many in full; this Wave 0 slice captures
// the declaration row itself. Container-level linkage ships with the
// container-snapshot service in a later Wave 0 checkbox.
export const shipmentDeclarations = pgTable('shipment_declarations', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  scope: shipmentDeclarationScopeEnum('scope').default('SINGLE'),
  note: text('note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_declarations_shipment_id_idx').on(table.shipmentId),
]);

// Append-only status transitions. Every status change writes a row with the
// reason (free text) and the acting user. fromStatus is nullable for the
// initial DRAFT creation row.
export const shipmentStatusHistory = pgTable('shipment_status_history', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  fromStatus: shipmentStatusEnum('from_status'),
  toStatus: shipmentStatusEnum('to_status').notNull(),
  reason: text('reason'),
  changedBy: integer('changed_by'),
  // timestamptz: an audit-style timestamp, kept unambiguous across deploy
  // regions (matches the file's recent direction for similar audit columns).
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('shipment_status_history_shipment_id_idx').on(table.shipmentId),
]);

// Shipment-side container record. Per phase-01 architecture, reusing
// trip_containers is wrong because a shipment can exist before any trip. This
// table mirrors trip_containers' shape; on dispatch, the relevant containers
// are snapshotted into trip_containers (which is tightly coupled to trip
// expense photos, geotags, multi-seal). Multi-seal on the shipment side will
// mirror trip_container_seals when the dispatch service lands.
export const shipmentContainers = pgTable('shipment_containers', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  containerTypeId: integer('container_type_id'),
  containerNumber: varchar('container_number', { length: 50 }),
  sealNumber: varchar('seal_number', { length: 50 }),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  shippingLineName: varchar('shipping_line_name', { length: 255 }),
  pickupPortId: integer('pickup_port_id'),
  dropoffPortId: integer('dropoff_port_id'),
  notes: text('notes'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_containers_shipment_id_idx').on(table.shipmentId),
  index('shipment_containers_pickup_port_idx').on(table.pickupPortId),
  index('shipment_containers_dropoff_port_idx').on(table.dropoffPortId),
  uniqueIndex('shipment_containers_shipment_id_id_uniq_idx').on(table.shipmentId, table.id),
]);

// Independently dispatchable unit derived from one shipment. Execution state
// remains authoritative on trips; this row owns only identity, requiredness,
// assignment snapshots, and governed cancellation/replacement provenance.
export const shipmentFulfillments = pgTable('shipment_fulfillments', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  fulfillmentType: shipmentFulfillmentTypeEnum('fulfillment_type').notNull(),
  cargoMode: shipmentCargoModeEnum('cargo_mode').notNull(),
  shipmentContainerId: integer('shipment_container_id')
    ,
  sourceShipmentVersion: integer('source_shipment_version').notNull(),
  siteSnapshot: jsonb('site_snapshot').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  plannedCarrierType: varchar('planned_carrier_type', { length: 20 }),
  plannedExternalCarrierId: integer('planned_external_carrier_id'),
  version: integer('version').notNull().default(1),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  canceledBy: integer('canceled_by'),
  cancellationReason: text('cancellation_reason'),
  cancellationDisposition: fulfillmentCancellationDispositionEnum('cancellation_disposition'),
  replacementFulfillmentId: integer('replacement_fulfillment_id'),
  notRequiredApprovedBy: integer('not_required_approved_by'),
  notRequiredApprovedAt: timestamp('not_required_approved_at', { withTimezone: true }),
  notRequiredReason: text('not_required_reason'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_fulfillments_shipment_id_id_uniq_idx').on(table.shipmentId, table.id),
  index('shipment_fulfillments_shipment_idx').on(table.shipmentId),
  index('shipment_fulfillments_planned_external_carrier_idx').on(table.plannedExternalCarrierId),
  uniqueIndex('shipment_fulfillments_active_container_uniq_idx')
    .on(table.shipmentContainerId)
    .where(sql`${table.shipmentContainerId} is not null and ${table.canceledAt} is null`),
  uniqueIndex('shipment_fulfillments_active_lcl_uniq_idx')
    .on(table.shipmentId)
    .where(sql`${table.fulfillmentType} = 'LCL_SHIPMENT' and ${table.canceledAt} is null`),
  uniqueIndex('shipment_fulfillments_replacement_uniq_idx')
    .on(table.replacementFulfillmentId)
    .where(sql`${table.replacementFulfillmentId} is not null`),
]);

// External partner vehicles are deliberately separate from `trucks`: the
// latter is SilverSea's owned fleet and feeds maintenance, depreciation and
// fixed-cost allocation. Trips retain the selected plate snapshot even when a
// carrier later edits this catalog row.
export const carrierFleetVehicles = pgTable('carrier_fleet_vehicles', {
  id: serial('id').primaryKey(),
  carrierId: integer('carrier_id').notNull(),
  licensePlate: varchar('license_plate', { length: 20 }).notNull(),
  normalizedPlate: varchar('normalized_plate', { length: 20 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: integer('created_by'),
  updatedBy: integer('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('carrier_fleet_vehicles_carrier_plate_uniq_idx')
    .on(table.carrierId, table.normalizedPlate)
    .where(sql`${table.deletedAt} is null`),
  index('carrier_fleet_vehicles_carrier_active_idx')
    .on(table.carrierId, table.isActive),
]);

// Accounting lock is orthogonal to ShipmentStatus. It freezes the shipment's
// operational source graph after an issued Debit Note closes the debt cycle.
// Corrections use financial adjustment/reversal authorities, never a seventh
// O2C status.
export const shipmentAccountingLocks = pgTable('shipment_accounting_locks', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id').notNull(),
  billingDocumentId: integer('billing_document_id').notNull(),
  billingDocumentVersion: integer('billing_document_version').notNull(),
  billingPeriodSnapshot: jsonb('billing_period_snapshot').$type<{
    rangeFrom: string;
    rangeTo: string;
    issuedAt: string;
  }>().notNull(),
  shipmentVersionAtLock: integer('shipment_version_at_lock').notNull(),
  reason: text('reason').notNull(),
  activatedBy: integer('activated_by').notNull(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_accounting_locks_shipment_uniq_idx').on(table.shipmentId),
  index('shipment_accounting_locks_document_idx').on(table.billingDocumentId),
]);

// Immutable, versioned proof-of-delivery submissions. Generic trip photos do
// not satisfy these typed slots. Phase 4 owns driver submission; Phase 5 owns
// first-winner review and shipment aggregate closure.
export const tripPodSubmissions = pgTable('trip_pod_submissions', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  fulfillmentId: integer('fulfillment_id')
    .notNull(),
  submissionVersion: integer('submission_version').notNull(),
  sourceTripVersion: integer('source_trip_version').notNull(),
  status: tripPodStatusEnum('status').notNull().default('DRAFT'),
  supersedesSubmissionId: integer('supersedes_submission_id')
    ,
  submittedBy: integer('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_pod_submissions_trip_id_id_uniq_idx').on(table.tripId, table.id),
  uniqueIndex('trip_pod_submissions_trip_version_uniq_idx')
    .on(table.tripId, table.submissionVersion),
  uniqueIndex('trip_pod_submissions_supersedes_uniq_idx')
    .on(table.supersedesSubmissionId)
    .where(sql`${table.supersedesSubmissionId} is not null`),
  uniqueIndex('trip_pod_submissions_open_uniq_idx')
    .on(table.tripId)
    .where(sql`${table.status} in ('DRAFT', 'SUBMITTED')`),
  uniqueIndex('trip_pod_submissions_accepted_uniq_idx')
    .on(table.tripId)
    .where(sql`${table.status} = 'ACCEPTED'`),
  index('trip_pod_submissions_fulfillment_status_idx').on(table.fulfillmentId, table.status),
]);

export const tripPodFiles = pgTable('trip_pod_files', {
  id: serial('id').primaryKey(),
  submissionId: integer('submission_id')
    .notNull(),
  fileType: tripPodFileTypeEnum('file_type').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  originalFileName: varchar('original_file_name', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 120 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  uploadedBy: integer('uploaded_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_pod_files_storage_key_uniq_idx').on(table.storageKey),
  uniqueIndex('trip_pod_files_required_slot_uniq_idx')
    .on(table.submissionId, table.fileType)
    .where(sql`${table.fileType} <> 'TOLL_TICKET'`),
  index('trip_pod_files_submission_idx').on(table.submissionId),
]);

export const userShipmentLinks = pgTable('user_shipment_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  shipmentId: integer('shipment_id').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('user_shipment_links_user_shipment_uniq_idx').on(table.userId, table.shipmentId),
  index('user_shipment_links_user_idx').on(table.userId),
  index('user_shipment_links_shipment_idx').on(table.shipmentId),
]);

// Versioned salesperson authority. A shipment-specific active assignment wins
// over the customer's active default; missing history remains unattributed.
export const salespersonAssignments = pgTable('salesperson_assignments', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  salespersonUserId: integer('salesperson_user_id').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  version: integer('version').notNull(),
  supersedesAssignmentId: integer('supersedes_assignment_id')
    ,
  changeReason: text('change_reason').notNull(),
  changedBy: integer('changed_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salesperson_assignments_customer_default_active_uniq')
    .on(table.customerId)
    .where(sql`${table.shipmentId} is null and ${table.effectiveTo} is null`),
  uniqueIndex('salesperson_assignments_shipment_active_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.effectiveTo} is null`),
  uniqueIndex('salesperson_assignments_supersedes_uniq')
    .on(table.supersedesAssignmentId)
    .where(sql`${table.supersedesAssignmentId} is not null`),
  index('salesperson_assignments_lookup_idx').on(table.customerId, table.shipmentId, table.effectiveFrom),
]);

export const shipmentChangeRequests = pgTable('shipment_change_requests', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  sourceVersion: integer('source_version').notNull(),
  requestKind: shipmentChangeRequestKindEnum('request_kind').notNull(),
  requestedBy: integer('requested_by').notNull(),
  beforeSnapshot: jsonb('before_snapshot').notNull(),
  afterSnapshot: jsonb('after_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('shipment_change_requests_shipment_version_uniq_idx')
    .on(table.shipmentId, table.sourceVersion),
  index('shipment_change_requests_shipment_created_idx').on(table.shipmentId, table.createdAt),
]);

// ─── Wave 2: CUS Core tables ────────────────────────────────────────────────
//
// Schema-only slice for Wave 2. The service/route/UI items are subsequent
// roadmap checkboxes. See phase-03 plan for full design.

// M3.3: shipment milestones. Each milestone tracks a point in the shipment
// lifecycle (booking, dispatch, transit, delivery, customs, pickup) derived
// from trip status changes or entered manually by CUS staff. Append-only.
export const shipmentMilestones = pgTable('shipment_milestones', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  type: milestoneTypeEnum('type').notNull(),
  note: text('note'),
  // Optional link to the trip that triggered this milestone (e.g. IN_TRANSIT
  // when the dispatched trip enters transit). NULL for manual milestones.
  tripId: integer('trip_id'),
  changedBy: integer('changed_by'),
  // Timestamp when the milestone occurred (not when it was recorded — the
  // operator may backdate to the actual event time).
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_milestones_shipment_idx').on(table.shipmentId, table.occurredAt),
  uniqueIndex('shipment_milestones_trip_type_uniq')
    .on(table.shipmentId, table.tripId, table.type)
    .where(sql`${table.tripId} is not null`),
]);

// Immutable, portal-safe customer communication content. Operational notes
// remain in shipment_milestones and are never serialized through this table.
export const customerVisibleEvents = pgTable('customer_visible_events', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .notNull(),
  customerId: integer('customer_id').notNull(),
  milestoneId: integer('milestone_id'),
  eventKey: varchar('event_key', { length: 120 }).notNull(),
  contentVersion: integer('content_version').notNull(),
  eventType: varchar('event_type', { length: 40 }).notNull(),
  classification: varchar('classification', { length: 30 }).notNull().default('CUSTOMER_VISIBLE'),
  contentSnapshot: jsonb('content_snapshot').$type<{
    title: string;
    message: string;
    occurredAt: string;
    shipmentCode?: string;
  }>().notNull(),
  supersedesEventId: integer('supersedes_event_id')
    ,
  createdBy: integer('created_by').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('customer_visible_events_key_version_uniq').on(table.eventKey, table.contentVersion),
  uniqueIndex('customer_visible_events_supersedes_uniq')
    .on(table.supersedesEventId)
    .where(sql`${table.supersedesEventId} is not null`),
  index('customer_visible_events_shipment_idx').on(table.shipmentId, table.occurredAt),
  index('customer_visible_events_customer_idx').on(table.customerId, table.occurredAt),
]);

export const customerEventAcknowledgements = pgTable('customer_event_acknowledgements', {
  id: serial('id').primaryKey(),
  eventId: integer('event_id')
    .notNull(),
  eventVersion: integer('event_version').notNull(),
  customerId: integer('customer_id').notNull(),
  acknowledgedBy: integer('acknowledged_by').notNull(),
  kind: varchar('kind', { length: 20 }).notNull().default('ACKNOWLEDGED'),
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('customer_event_ack_actor_kind_uniq').on(table.eventId, table.acknowledgedBy, table.kind),
  uniqueIndex('customer_event_ack_idempotency_uniq').on(table.idempotencyKey),
  index('customer_event_ack_customer_idx').on(table.customerId, table.acknowledgedAt),
]);

// M3.3: customer email logs. Tracks every email sent to a customer (debit
// note sent, delivery confirmation, milestone notification). Used for retry
// via the Wave-0 scheduler and for audit of customer communication.
export const customerEmailLogs = pgTable('customer_email_logs', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  billingDocumentId: integer('billing_document_id'),
  customerVisibleEventId: integer('customer_visible_event_id'),
  // The email template / event type (e.g. 'DEBIT_NOTE_SENT', 'DELIVERY_CONFIRM').
  subject: varchar('subject', { length: 255 }).notNull(),
  recipientEmail: varchar('recipient_email', { length: 255 }),
  status: emailStatusEnum('status').default('PENDING'),
  // Error message from the email provider when status=FAILED.
  errorMessage: text('error_message'),
  // Provider message ID for tracking opens/clicks.
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  // Retry count for the scheduler (0 = first attempt).
  retryCount: integer('retry_count').default(0).notNull(),
  sentBy: integer('sent_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('customer_email_logs_customer_idx').on(table.customerId, table.status),
  index('customer_email_logs_status_idx').on(table.status),
  index('customer_email_logs_visible_event_idx').on(table.customerVisibleEventId),
]);

// Q01/Q02: durable over-limit approval workflow. Requests are bounded to one
// shipment or to an explicit expiry window and preserve the exposure snapshot
// that was actually approved.
export const creditOverrideRequests = pgTable('credit_override_requests', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  shipmentId: integer('shipment_id'),
  scopeType: creditOverrideScopeEnum('scope_type').notNull(),
  status: creditOverrideStatusEnum('status').notNull().default('PENDING'),
  requiredTier: creditOverrideTierEnum('required_tier').notNull(),
  reason: text('reason').notNull(),
  requestedBy: integer('requested_by').notNull(),
  requestedRole: varchar('requested_role', { length: 20 }).notNull(),
  proposedAmount: numeric('proposed_amount', { precision: 15, scale: 0 }).notNull(),
  outstandingAmount: numeric('outstanding_amount', { precision: 15, scale: 0 }).notNull(),
  approvedCommitmentAmount: numeric('approved_commitment_amount', { precision: 15, scale: 0 }).notNull(),
  totalExposure: numeric('total_exposure', { precision: 15, scale: 0 }).notNull(),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 0 }).notNull(),
  warningThreshold: numeric('warning_threshold', { precision: 4, scale: 2 }).notNull(),
  overLimitAmount: numeric('over_limit_amount', { precision: 15, scale: 0 }).notNull(),
  overLimitRatio: numeric('over_limit_ratio', { precision: 8, scale: 4 }).notNull(),
  repeatException: boolean('repeat_exception').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  approvedBy: integer('approved_by'),
  approvedRole: varchar('approved_role', { length: 20 }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedBy: integer('rejected_by'),
  rejectedRole: varchar('rejected_role', { length: 20 }),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  consumedTripId: integer('consumed_trip_id'),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('credit_override_requests_customer_idx').on(table.customerId, table.status, table.createdAt),
  index('credit_override_requests_shipment_idx').on(table.shipmentId, table.status),
  uniqueIndex('credit_override_requests_active_shipment_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.status} in ('PENDING', 'APPROVED')`),
]);

// ─── Wave 3: Financial Close tables ─────────────────────────────────────────

export const treasuryAccounts = pgTable('treasury_accounts', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  currency: varchar('currency', { length: 10 }).notNull().default('VND'),
  bankName: varchar('bank_name', { length: 160 }),
  bankAccountNumber: varchar('bank_account_number', { length: 80 }),
  openingBalance: numeric('opening_balance', { precision: 15, scale: 0 }).notNull().default('0'),
  openingBalanceDate: date('opening_balance_date'),
  cutoverAt: timestamp('cutover_at', { withTimezone: true }),
  openingGovernanceActionId: integer('opening_governance_action_id'),
  status: varchar('status', { length: 20 }).notNull().default('DRAFT'),
  version: integer('version').notNull().default(1),
  createdBy: integer('created_by').notNull(),
  updatedBy: integer('updated_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('treasury_accounts_code_uniq').on(table.code),
  index('treasury_accounts_type_status_idx').on(table.type, table.status),
]);

export const paymentReceipts = pgTable('payment_receipts', {
  id: serial('id').primaryKey(),
  receiptId: varchar('receipt_id', { length: 100 }).notNull(),
  customerId: integer('customer_id').notNull(),
  receivedAmount: numeric('received_amount', { precision: 15, scale: 0 }).notNull(),
  allocatedTotal: numeric('allocated_total', { precision: 15, scale: 0 }).notNull(),
  unappliedAmount: numeric('unapplied_amount', { precision: 15, scale: 0 }).notNull(),
  refundedAmount: numeric('refunded_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  allocationMethod: varchar('allocation_method', { length: 20 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  treasuryAccountId: integer('treasury_account_id'),
  valueDate: date('value_date'),
  physicalReference: varchar('physical_reference', { length: 160 }),
  paymentContractVersion: integer('payment_contract_version').notNull().default(1),
  createdBy: integer('created_by'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payment_receipts_receipt_id_uniq').on(table.receiptId),
  index('payment_receipts_customer_created_idx').on(table.customerId, table.createdAt),
]);

// Append-only book movements linked to one physical collection/payment source.
// AR/AP balances continue to live in their existing authorities.
export const treasuryMovements = pgTable('treasury_movements', {
  id: serial('id').primaryKey(),
  treasuryAccountId: integer('treasury_account_id').notNull(),
  direction: varchar('direction', { length: 10 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  valueDate: date('value_date').notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
  status: varchar('status', { length: 20 }).notNull().default('POSTED'),
  paymentReceiptId: integer('payment_receipt_id'),
  ledgerEntryId: integer('ledger_entry_id'),
  sourceVersion: integer('source_version').notNull(),
  paymentContractVersion: integer('payment_contract_version').notNull(),
  physicalReference: varchar('physical_reference', { length: 160 }).notNull(),
  externalReference: varchar('external_reference', { length: 160 }),
  governanceActionId: integer('governance_action_id'),
  reversalOfId: integer('reversal_of_id'),
  createdBy: integer('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('treasury_movements_physical_posted_uniq')
    .on(table.treasuryAccountId, table.direction, table.physicalReference)
    .where(sql`${table.status} = 'POSTED'`),
  uniqueIndex('treasury_movements_receipt_posted_uniq')
    .on(table.paymentReceiptId)
    .where(sql`${table.paymentReceiptId} is not null and ${table.status} = 'POSTED' and ${table.reversalOfId} is null`),
  uniqueIndex('treasury_movements_ledger_posted_uniq')
    .on(table.ledgerEntryId)
    .where(sql`${table.ledgerEntryId} is not null and ${table.status} = 'POSTED' and ${table.reversalOfId} is null`),
  uniqueIndex('treasury_movements_reversal_uniq')
    .on(table.reversalOfId, table.sourceVersion)
    .where(sql`${table.reversalOfId} is not null`),
  index('treasury_movements_account_date_idx').on(table.treasuryAccountId, table.valueDate),
]);

// M5.6: payment allocations. A single receipt (payment) can be split across
// multiple trips/shipments. Each allocation links a payment to one document
// (trip or billing_document) with the amount applied.
export const paymentAllocations = pgTable('payment_allocations', {
  id: serial('id').primaryKey(),
  // The receipt/payment that this allocation belongs to.
  receiptId: varchar('receipt_id', { length: 100 }),
  paymentReceiptId: integer('payment_receipt_id'),
  allocationOrder: integer('allocation_order'),
  originalDueDateSnapshot: date('original_due_date_snapshot'),
  processingDueDateSnapshot: date('processing_due_date_snapshot'),
  issueTimestampSnapshot: timestamp('issue_timestamp_snapshot'),
  // The customer receiving the allocation.
  customerId: integer('customer_id').notNull(),
  billingDocumentId: integer('billing_document_id'),
  sourceTripId: integer('source_trip_id'),
  // What this allocation is applied to: a trip or a billing document.
  targetType: varchar('target_type', { length: 20 }).notNull(), // TRIP | BILLING_DOCUMENT
  targetId: integer('target_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // Allocation strategy: OLDEST_FIRST (default), PROPORTIONAL, MANUAL.
  allocationMethod: varchar('allocation_method', { length: 20 }).notNull().default('OLDEST_FIRST'),
  allocatedBy: integer('allocated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('payment_allocations_customer_idx').on(table.customerId),
  index('payment_allocations_target_idx').on(table.targetType, table.targetId),
  index('payment_allocations_document_idx').on(table.billingDocumentId, table.createdAt),
  index('payment_allocations_source_trip_idx').on(table.sourceTripId, table.createdAt),
  index('payment_allocations_receipt_idx').on(table.receiptId),
  uniqueIndex('payment_allocations_receipt_order_uniq')
    .on(table.paymentReceiptId, table.allocationOrder)
    .where(sql`${table.paymentReceiptId} is not null`),
  uniqueIndex('payment_allocations_receipt_target_uniq')
    .on(
      table.paymentReceiptId,
      table.targetType,
      table.targetId,
      sql`coalesce(${table.sourceTripId}, 0)`,
    )
    .where(sql`${table.paymentReceiptId} is not null`),
]);

export const paymentRefunds = pgTable('payment_refunds', {
  id: serial('id').primaryKey(),
  paymentReceiptId: integer('payment_receipt_id')

    .notNull(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  createdBy: integer('created_by').notNull(),
  approvedBy: integer('approved_by').notNull(),
  ledgerEntryId: integer('ledger_entry_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payment_refunds_governance_action_uniq').on(table.governanceActionId),
  index('payment_refunds_receipt_created_idx').on(table.paymentReceiptId, table.createdAt),
]);

// M7.3: salary period closes. An accountant closes a salary period; after
// close, no further changes to driver salary for that period. Each period has
// at most one close row (enforced by a unique index).
export const salaryPeriodCloses = pgTable('salary_period_closes', {
  id: serial('id').primaryKey(),
  // Period identifier: YYYY-MM format (e.g. '2026-07').
  period: varchar('period', { length: 7 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('CLOSED'), // CLOSED | REOPENED
  // The ledger entry posted when the period was closed (single entry per close).
  ledgerEntryId: integer('ledger_entry_id'),
  closedBy: integer('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }).defaultNow().notNull(),
  note: text('note'),
  payslipIssuedBy: integer('payslip_issued_by'),
  payslipIssuedAt: timestamp('payslip_issued_at', { withTimezone: true }),
  payslipIssuedNote: text('payslip_issued_note'),
  officialPostedBy: integer('official_posted_by'),
  officialPostedAt: timestamp('official_posted_at', { withTimezone: true }),
  officialPostingNote: text('official_posting_note'),
  // Immutable payroll provenance captured in the same transaction as the close.
  // Historical close responses must never be reconstructed from today's global
  // payroll-unit setting or today's unit membership.
  payrollScope: varchar('payroll_scope', { length: 20 }),
  payrollBusinessUnitId: integer('payroll_business_unit_id'),
  payrollBusinessUnitName: text('payroll_business_unit_name'),
  includedDriverIds: jsonb('included_driver_ids').$type<number[]>(),
  excludedDriverIds: jsonb('excluded_driver_ids').$type<number[]>(),
  payrollProvenanceCapturedAt: timestamp('payroll_provenance_captured_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salary_period_closes_period_uniq').on(table.period),
]);

export const salaryPeriodAdjustments = pgTable('salary_period_adjustments', {
  id: serial('id').primaryKey(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  sourcePeriod: varchar('source_period', { length: 7 }).notNull(),
  targetPeriod: varchar('target_period', { length: 7 }).notNull(),
  driverId: integer('driver_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  approvedBy: integer('approved_by').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('salary_period_adjustments_action_uniq').on(table.governanceActionId),
  index('salary_period_adjustments_target_driver_idx').on(table.targetPeriod, table.driverId, table.createdAt),
  index('salary_period_adjustments_source_driver_idx').on(table.sourcePeriod, table.driverId, table.createdAt),
]);

export const fuelPeriodAdjustments = pgTable('fuel_period_adjustments', {
  id: serial('id').primaryKey(),
  governanceActionId: integer('governance_action_id')

    .notNull(),
  fuelInvoiceId: integer('fuel_invoice_id')

    .notNull(),
  sourcePeriodLockId: integer('source_period_lock_id')

    .notNull(),
  sourcePeriod: varchar('source_period', { length: 7 }).notNull(),
  targetPeriod: varchar('target_period', { length: 7 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('fuel_period_adjustments_action_source_uniq')
    .on(table.governanceActionId, table.sourcePeriodLockId),
  index('fuel_period_adjustments_invoice_idx').on(table.fuelInvoiceId, table.createdAt),
  index('fuel_period_adjustments_source_idx').on(table.sourcePeriod, table.createdAt),
  index('fuel_period_adjustments_target_idx').on(table.targetPeriod, table.createdAt),
]);

// M6.1 slice 2: fuel-reconciliation explanations. When the fuel-AP recon
// report flags a supplier as 'VARIANCE' for a period, accountants must
// record an explanation before any of that supplier's fuel expenses in the
// same period can be approved (approval guard in fuel-recon-guard.service).
// Unique on (supplierId, periodFrom, periodTo) so the same period can be
// explained once and re-explained via upsert.
export const fuelReconExplanations = pgTable('fuel_recon_explanations', {
  id: serial('id').primaryKey(),
  supplierId: integer('supplier_id').notNull(),
  // ISO date range (YYYY-MM-DD). The guard uses calendar-month boundaries
  // [first-of-month, last-of-month] derived from the expense's invoiceDate.
  periodFrom: date('period_from').notNull(),
  periodTo: date('period_to').notNull(),
  // Free-text accountant explanation (e.g. "price changed mid-month",
  // "pump calibration drift", "extra top-up not yet invoiced").
  explanationText: text('explanation_text').notNull(),
  // Captured-for-audit: the absolute variance at the moment the explanation
  // was recorded. Stored as a positive integer (VND).
  resolvedVariance: numeric('resolved_variance', { precision: 15, scale: 0 }).notNull(),
  createdBy: integer('created_by'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('fuel_recon_explanations_supplier_period_uniq')
    .on(table.supplierId, table.periodFrom, table.periodTo),
  index('fuel_recon_explanations_supplier_idx').on(table.supplierId),
]);

// Wave 4: dispatch handoffs. When a clerk creates/qualifies a shipment,
// they hand it off to a dispatcher (điều vận). This table tracks the
// handoff lifecycle: UNSEEN → SEEN → ACCEPTED (or REJECTED), with the
// handler, priority, vehicle-needed-by time, operational note, and the
// shipment version at handoff time (for conflict detection — M10-03-03:
// "Nếu dữ liệu bị sửa trong lúc điều vận đang xem, phải cảnh báo có
// phiên bản mới").
export const handoffStatusEnum = applicationEnum([
  'UNSEEN',   // dispatched to dispatcher, not yet opened
  'SEEN',     // dispatcher opened the handoff
  'ACCEPTED', // dispatcher took ownership
  'REJECTED', // dispatcher declined (with reason)
]);

export const dispatchHandoffs = pgTable('dispatch_handoffs', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().default(1),
  // The shipment being handed off.
  shipmentId: integer('shipment_id')
    .notNull(),
  // The dispatcher (user) assigned to handle this handoff.
  handlerId: integer('handler_id'),
  // M10-03 §1: priority level (e.g. 'NORMAL', 'URGENT'). Free-text for now;
  // can be enum-ified when the PRD confirms the levels.
  priority: varchar('priority', { length: 20 }).notNull().default('NORMAL'),
  // M10-03 §1: when the vehicle is needed (thời gian cần xe).
  vehicleNeededBy: timestamp('vehicle_needed_by'),
  // M10-03 §1: operational note (ghi chú vận hành).
  operationalNote: text('operational_note'),
  // Handoff status lifecycle.
  status: handoffStatusEnum('status').default('UNSEEN').notNull(),
  // Snapshot of shipment.version at handoff time — used by M10-03-03 to
  // detect if the shipment was edited after handoff (version conflict).
  handoffVersion: integer('handoff_version').notNull(),
  // Who created the handoff (the clerk).
  createdBy: integer('created_by'),
  // Timestamps for each lifecycle transition (for audit/tracking).
  dispatchedAt: timestamp('dispatched_at').defaultNow().notNull(),
  seenAt: timestamp('seen_at'),
  resolvedAt: timestamp('resolved_at'),
  acceptedBy: integer('accepted_by'),
  supersedesHandoffId: integer('supersedes_handoff_id')
    ,
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  // Free-text reason for REJECTED status.
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('dispatch_handoffs_shipment_idx').on(table.shipmentId),
  index('dispatch_handoffs_handler_idx').on(table.handlerId),
  index('dispatch_handoffs_status_idx').on(table.status),
  // One active handoff per shipment at a time (UNSEEN or SEEN). ACCEPTED/
  // REJECTED rows are historical; a new handoff can be created after one
  // is resolved.
  uniqueIndex('dispatch_handoffs_shipment_active_uniq')
    .on(table.shipmentId)
    .where(sql`${table.status} IN ('UNSEEN', 'SEEN')`),
  uniqueIndex('dispatch_handoffs_supersedes_uniq')
    .on(table.supersedesHandoffId)
    .where(sql`${table.supersedesHandoffId} is not null`),
]);

export const profitabilitySnapshots = pgTable('profitability_snapshots', {
  id: serial('id').primaryKey(),
  financialPostingId: integer('financial_posting_id')
    .notNull(),
  tripId: integer('trip_id').notNull(),
  shipmentId: integer('shipment_id'),
  completedBusinessDate: date('completed_business_date').notNull(),
  revenue: numeric('revenue', { precision: 15, scale: 0 }).notNull(),
  directCost: numeric('direct_cost', { precision: 15, scale: 0 }).notNull(),
  sharedOverhead: numeric('shared_overhead', { precision: 15, scale: 0 }).notNull().default('0'),
  profit: numeric('profit', { precision: 15, scale: 0 }).notNull(),
  attributionStatus: varchar('attribution_status', { length: 30 }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('profitability_snapshots_posting_uniq').on(table.financialPostingId),
  index('profitability_snapshots_business_date_idx').on(table.completedBusinessDate),
]);

export const profitabilitySnapshotDimensions = pgTable('profitability_snapshot_dimensions', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id')
    .notNull(),
  dimension: varchar('dimension', { length: 30 }).notNull(),
  dimensionKey: varchar('dimension_key', { length: 120 }).notNull(),
  dimensionLabel: varchar('dimension_label', { length: 255 }).notNull(),
  attributionStatus: varchar('attribution_status', { length: 30 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
}, (table) => [
  uniqueIndex('profitability_snapshot_dimensions_uniq').on(table.snapshotId, table.dimension),
  index('profitability_snapshot_dimensions_lookup_idx').on(table.dimension, table.dimensionKey),
]);

// Idempotency key registry — server-side dedupe for "resubmit doesn't
// duplicate" (PRD M10-01-03; Q23 proposal: same request id → same result,
// no extra row). Currently used by the M10.1 clerk quick-create endpoint
// (`POST /api/shipments/quick`); future write paths (offline-queue sync,
// driver progress update) reuse the same generic shape.
//
// Design notes:
//   - Primary de-dup key is `(endpoint, idempotencyKey)` — a client-generated
//     opaque token (UUID v4 recommended, any string ≤ 100 chars). The endpoint
//     tag prevents an offline-queue replay for `/shipments/quick` from
//     silently matching a future `/trips/progress` key.
//   - On first write: insert the key with the created entity id, return 201.
//   - On replay with the same key + same payload: return 200 with the stored
//     shipment.
//   - On replay with the same key but a *different* payload: reject 409. This
//     is a client bug per Q23 — never silently overwrite.
//   - `payloadHash` is a shallow SHA-256 over the canonicalised body, used
//     only for the conflict check. We do NOT match on it for the success
//     path: the client-generated key is authoritative.
//   - Retention: rows are kept indefinitely (table size is bounded by total
//     write count). A cleanup job is out of scope for M10.1 slice 1.
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: serial('id').primaryKey(),
  // Logical endpoint tag, e.g. 'shipments.quick-create'. Keeps unrelated
  // endpoints from sharing a keyspace.
  endpoint: varchar('endpoint', { length: 100 }).notNull(),
  // Client-generated idempotency key. Case-sensitive, treated as opaque.
  idempotencyKey: varchar('idempotency_key', { length: 100 }).notNull(),
  // The entity created by the original request. Nullable so future
  // non-entity-producing writes (e.g. "mark seen") can dedupe too.
  entityType: varchar('entity_type', { length: 50 }),
  entityId: integer('entity_id'),
  // SHA-256 hex of the canonicalised request body, for conflict detection.
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
  // The original HTTP success code so future exact-replay consumers can return
  // the persisted command result without re-deriving transport semantics.
  responseStatusCode: integer('response_status_code').default(200).notNull(),
  // Immutable response snapshot returned to later same-key replays, even when
  // the underlying entity later changes. Stored in the exact JSON shape sent
  // back to callers (without the transport-level replayed marker).
  responseSnapshot: jsonb('response_snapshot').$type<Record<string, unknown> | unknown[] | string | number | boolean | null>(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('idempotency_keys_endpoint_key_uniq')
    .on(table.endpoint, table.idempotencyKey),
  index('idempotency_keys_entity_idx').on(table.entityType, table.entityId),
]);

// M8.4 — driver progress events. Append-only log of driver-reported
// milestones (DEPARTED, ARRIVED, FUELED, INCIDENT, NOTE) against a trip.
// This is the foundation for the M8.4 driver mobile progress update: a
// driver records what actually happened on the road, with a client-supplied
// event time (`occurredAt` — may be backdated) and an optional note. The
// create endpoint is server-side idempotent (reuses `idempotency_keys` from
// M10.1) so the offline-queue replay (slice 2) doesn't duplicate events
// (PRD M08-04-03).
//
// These events are audit-style records only — they do NOT mutate trip
// status. Lifecycle transitions stay with `transitionTripStatus`.
export const driverProgressEventTypeEnum = applicationEnum([
  'ORDER_RECEIVED', 'DEPARTED', 'ARRIVED', 'FUELED', 'INCIDENT', 'NOTE',
  'PICKED_UP', 'LOADING_OR_RETURNING', 'DELIVERED',
]);

export const driverProgressEvents = pgTable('driver_progress_events', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id')
    .notNull(),
  driverId: integer('driver_id')
    .notNull(),
  eventType: driverProgressEventTypeEnum('event_type').notNull(),
  // The time the event occurred (driver-reported; may be backdated to the
  // actual event). Distinct from `createdAt` (record-time audit).
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  note: text('note'),
  // The user who recorded the event (audit). Usually the driver; ADMIN may
  // record on a driver's behalf in edge cases.
  recordedBy: integer('recorded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('driver_progress_events_trip_idx').on(table.tripId, table.occurredAt),
  index('driver_progress_events_driver_idx').on(table.driverId),
]);

// M8.4 slice 3 — driver incidental costs. Driver-reported out-of-pocket
// expenses (per-diem, lift fee, parking, toll, fuel, other) against a trip.
// Distinct from `tripExpenses` (forwarder-scoped, buy/sell, supplier,
// approval workflow) — this is a lightweight driver-only record that feeds
// salary/settlement reconciliation. Idempotent create (reuses
// `idempotency_keys`) so the offline-queue replay doesn't duplicate.
//
// COMPLETED trips reject new incidental costs — unlike progress events (which
// are append-only audit logs), costs affect financials, so completion = immutable.
export const driverIncidentalCostTypeEnum = applicationEnum([
  'PER_DIEM', 'LIFT_FEE', 'PARKING', 'TOLL', 'FUEL', 'OTHER',
]);

export const driverIncidentalCosts = pgTable('driver_incidental_costs', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id')
    .notNull(),
  driverId: integer('driver_id')
    .notNull(),
  costType: driverIncidentalCostTypeEnum('cost_type').notNull(),
  // VND amount — integer, no decimals (matches tripExpenses.buyAmount convention).
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // The date the cost was incurred (driver-reported). Distinct from createdAt.
  occurredAt: date('occurred_at').notNull(),
  note: text('note'),
  recordedBy: integer('recorded_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('driver_incidental_costs_trip_idx').on(table.tripId, table.occurredAt),
  index('driver_incidental_costs_driver_idx').on(table.driverId),
]);

// ─── O2C delete-requests queue (260801-2200) ────────────────────────────────
// When a row is out-of-session (beyond the idle window) and not approved, the
// actor cannot delete it directly — they file a delete request that an Admin/
// MANAGER reviews. Approving executes the delete in a transaction.
export const deleteRequestStatusEnum = applicationEnum(['PENDING', 'APPROVED', 'REJECTED']);
export const deleteRequests = pgTable('delete_requests', {
  id: serial('id').primaryKey(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: integer('entity_id').notNull(),
  requestedBy: integer('requested_by').notNull(),
  reason: text('reason'),
  status: deleteRequestStatusEnum('status').notNull().default('PENDING'),
  reviewedBy: integer('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('delete_requests_status_idx').on(table.status),
]);
