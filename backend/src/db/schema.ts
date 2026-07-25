import {
  pgTable, serial, varchar, text, integer, boolean, timestamp,
  jsonb, numeric, date, pgEnum, uniqueIndex, index, check, doublePrecision,
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

// Enums
export const tripStatusEnum = pgEnum('trip_status', ['CREATED', 'IN_TRANSIT', 'COMPLETED', 'LOCKED', 'CANCELED']);
export const fuelModeEnum = pgEnum('fuel_mode', ['AUTO', 'FLAT_RATE']);
export const loadingTypeEnum = pgEnum('loading_type', ['HANG', 'VO']);
export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DRIVER', 'FORWARDER', 'CUSTOMER', 'CLERK']);
export const txnTypeEnum = pgEnum('txn_type', ['TRIP_REVENUE', 'PAYMENT_RECEIVED', 'PENALTY', 'MANAGEMENT_FEE', 'ADJUSTMENT', 'DRIVER_SALARY', 'VENDOR_EXPENSE', 'VENDOR_PAYMENT', 'FORWARDER_ADVANCE', 'FORWARDER_SETTLEMENT', 'EXTERNAL_CARRIER_COST', 'FUEL_EXPENSE', 'UNLOCK_REVERSAL', 'COMMISSION', 'DRIVER_PAYOUT', 'SERVICE_FEE']);
export const trailerTypeEnum = pgEnum('trailer_type', ['20FT', '40FT']);
export const truckStatusEnum = pgEnum('truck_status', ['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
export const driverStatusEnum = pgEnum('driver_status', ['ACTIVE', 'INACTIVE']);
export const customerStatusEnum = pgEnum('customer_status', ['ACTIVE', 'LOCKED']);
export const tripPhotoTypeEnum = pgEnum('trip_photo_type', ['CONTAINER', 'SEAL', 'OTHER']);
export const penaltyStatusEnum = pgEnum('penalty_status', ['ACTIVE', 'CANCELED']);
export const vehicleComponentEnum = pgEnum('vehicle_component', ['TRUCK', 'TRAILER']);
export const trailerStatusEnum = pgEnum('trailer_status', ['ACTIVE', 'MAINTENANCE', 'INACTIVE']);
// NOTE: forwarder_expense_type pgEnum removed — replaced by forwarder_expense_types config table.
// trip_expenses.expense_type is now varchar(50) referencing config codes.
export const advanceRequestStatusEnum = pgEnum('advance_request_status', ['PENDING', 'APPROVED', 'REJECTED']);
export const advanceSettlementStatusEnum = pgEnum('advance_settlement_status', ['PENDING', 'CHECKED_BY_ACCOUNTANT', 'APPROVED', 'REJECTED']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'TRIP_CREATED', 'TRIP_DISPATCHED', 'TRIP_IN_TRANSIT', 'TRIP_COMPLETED',
  'TRIP_LOCKED', 'TRIP_UNLOCKED', 'TRIP_CANCELED', 'PAYMENT_RECEIVED', 'PENALTY_CREATED',
  'PENALTY_CANCELED', 'OVERDUE_PAYMENT', 'SALARY_PERIOD_CLOSING', 'SYSTEM_ANNOUNCEMENT',
  'ADVANCE_SETTLEMENT_APPROVED',
]);
export const workDayStatusEnum = pgEnum('work_day_status', ['TRIP_DAY', 'STANDBY', 'PERSONAL_LEAVE', 'WEEKLY_OFF']);
// ─── Onboarding (Phase 4) ───────────────────────────────────────────────────
// Server-side source of truth for tour progress + checklist tasks. The frontend
// `tourProgress.ts` localStorage layer becomes a read-through cache; these
// tables enable cross-device resume, admin visibility, and analytics. The tour
// catalog is TypeScript (not a DB table), so tour_id / current_step_id /
// task_id are plain strings — see plans/2026-07-13-onboarding-orchestration-layer.
export const onboardingStatusEnum = pgEnum('onboarding_status', ['in_progress', 'completed', 'skipped']);
export const onboardingTaskStatusEnum = pgEnum('onboarding_task_status', ['pending', 'completed', 'dismissed']);

// ─── Wave 1: Pricing & Fuel enums ───────────────────────────────────────────
// Direction of a lift (nâng/hạ) container movement at a port/yard.
export const liftDirectionEnum = pgEnum('lift_direction', ['LIFT_UP', 'LIFT_DOWN']);
// Type of ancillary (non-transport) revenue. PRD M2.5 §1 proposes this set;
// additional types can be added via ALTER TYPE ADD VALUE if the customer
// confirms more.
export const ancillaryRevenueTypeEnum = pgEnum('ancillary_revenue_type', [
  'LCL', 'CONSOLIDATION', 'SERVICE_DIFF', 'OTHER',
]);
// How a trip's freight revenue was computed: TIER = weight-tier pricing,
// TABLE = fixed customer-route pricing, MANUAL = operator override.
export const pricingSourceEnum = pgEnum('pricing_source', ['TIER', 'TABLE', 'MANUAL']);

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
  // ON DELETE SET NULL so deleting a customer unlinks its users (rather
  // than cascading the delete onto the user accounts). Non-CUSTOMER roles
  // leave this NULL. M:N expansion (multiple logins per customer org) can
  // layer a customer_users join table on top without changing the helper's
  // signature.
  //
  // NOTE: declared as a plain integer (no Drizzle `.references()`) to avoid
  // a TypeScript circular-initializer error. The chain
  // `users → customers → debitNoteTemplates → users` is valid at runtime
  // (Drizzle's lazy `() =>` resolves it) but TS strict mode rejects the
  // cycle. The actual FK constraint is added in migration 0115 via raw
  // ALTER TABLE — see `drizzle/0115_premium_juggernaut.sql`.
  customerId: integer('customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const trucks = pgTable('trucks', {
  id: serial('id').primaryKey(),
  licensePlate: varchar('license_plate', { length: 20 }).unique().notNull(),
  trailerPlateNumber: varchar('trailer_plate_number', { length: 20 }),
  trailerType: trailerTypeEnum('trailer_type'),
  currentTrailerId: integer('current_trailer_id').references(() => trailers.id),
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
  userId: integer('user_id').references(() => users.id),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  assignedTruckId: integer('assigned_truck_id').references(() => trucks.id),
  baseSalary: numeric('base_salary', { precision: 15, scale: 0 }),
  // BHXH/BHYT monthly contribution — tracked SEPARATELY for cost allocation; NOT part of daily_rate
  // or trip-salary auto-fill (Pete 2026-06: baseSalary only — base/std_days, no socialInsurance)
  socialInsurance: numeric('social_insurance', { precision: 15, scale: 0 }).default('0'),
  status: driverStatusEnum('status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// Defined before customers to allow customers.linkedSupplierId to reference suppliers.id directly.
// suppliers.linkedCustomerId intentionally omits .references() to break the mutual circular
// forward-reference that causes TS7022. The FK constraint is enforced at the DB level via migration.
export const suppliers = pgTable('suppliers', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  contactPerson: varchar('contact_person', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  taxCode: varchar('tax_code', { length: 20 }),
  note: text('note'),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  linkedCustomerId: integer('linked_customer_id'), // FK → customers(id), enforced at DB level
  isFuelSupplier: boolean('is_fuel_supplier').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// ─── N1 — Tires ──────────────────────────────────────────────────────────────
// Tracks individual tires by serial, vehicle assignment (truck OR trailer),
// install/remove dates, supplier, purchase date, and disposal metadata. Status
// is a plain string so the app can stay aligned with the requirement wording
// instead of baking extra lifecycle states into a database enum.
export const tires = pgTable('tires', {
  id: serial('id').primaryKey(),
  serial: varchar('serial', { length: 64 }).notNull().unique(),
  truckId: integer('truck_id').references(() => trucks.id),
  // A tire mounts on a truck OR a trailer; both nullable for a spare in stock.
  // onDelete:'set null' mirrors migration 0070 (a deleted rơ-moóc unlinks its
  // tires instead of blocking the delete); keeps schema.ts ↔ migration in sync.
  trailerId: integer('trailer_id').references(() => trailers.id, { onDelete: 'set null' }),
  position: varchar('position', { length: 64 }),
  size: varchar('size', { length: 32 }),
  installedAt: date('installed_at'),
  removedAt: date('removed_at'),
  supplierId: integer('supplier_id').references(() => suppliers.id),
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
  contactPerson: varchar('contact_person', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  contactInfo: text('contact_info'),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 0 }),
  status: customerStatusEnum('status').default('ACTIVE'),
  isCarrier: boolean('is_carrier').notNull().default(false),
  debitNoteMode: varchar('debit_note_mode', { length: 20 }).notNull().default('MONTHLY'),
  debitNoteTemplateId: integer('debit_note_template_id').references(() => debitNoteTemplates.id),
  linkedSupplierId: integer('linked_supplier_id').references(() => suppliers.id),
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
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  routeId: integer('route_id').references(() => routes.id).notNull(),
  price: numeric('price', { precision: 15, scale: 0 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('pricing_tables_customer_route_date_idx').on(table.customerId, table.routeId, table.effectiveDate),
]);

export const roadAllowances = pgTable('road_allowances', {
  id: serial('id').primaryKey(),
  routeId: integer('route_id').references(() => routes.id).notNull(),
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
  changedBy: integer('changed_by').references(() => users.id),
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
  routeId: integer('route_id').references(() => routes.id).notNull(),
  cargoTypeId: integer('cargo_type_id').references(() => cargoTypes.id).notNull(),
  minKg: numeric('min_kg', { precision: 12, scale: 2 }).notNull(),
  maxKg: numeric('max_kg', { precision: 12, scale: 2 }).notNull(),
  pricePerKg: numeric('price_per_kg', { precision: 12, scale: 4 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('weight_pricing_tiers_route_cargo_date_idx').on(table.routeId, table.cargoTypeId, table.effectiveDate),
]);

// M2.4: lift/up-down (nâng/hạ) price catalog. Port × containerType ×
// direction × effectiveDate → unitPrice. The forwarder expense-entry flow
// (future item) suggests the price and shows suggested/actual/delta.
export const liftPricing = pgTable('lift_pricing', {
  id: serial('id').primaryKey(),
  portId: integer('port_id').references(() => ports.id).notNull(),
  containerTypeId: integer('container_type_id').references(() => containerTypes.id).notNull(),
  direction: liftDirectionEnum('direction').notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 0 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('lift_pricing_port_type_dir_date_idx').on(table.portId, table.containerTypeId, table.direction, table.effectiveDate),
]);

// M2.5: ancillary (non-transport) revenue. Each entry is recorded exactly
// once; refunds use negative amounts with reason. Links to EITHER a
// shipment OR a trip (at least one expected at the application layer).
export const ancillaryRevenue = pgTable('ancillary_revenue', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  shipmentId: integer('shipment_id').references(() => shipments.id),
  tripId: integer('trip_id').references(() => trips.id),
  type: ancillaryRevenueTypeEnum('type').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  tax: numeric('tax', { precision: 15, scale: 0 }).default('0'),
  date: date('date').notNull().defaultNow(),
  documentRef: varchar('document_ref', { length: 100 }),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('ancillary_revenue_customer_date_idx').on(table.customerId, table.date),
  index('ancillary_revenue_shipment_idx').on(table.shipmentId),
  index('ancillary_revenue_trip_idx').on(table.tripId),
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
  routeId: integer('route_id').references(() => routes.id),
  truckId: integer('truck_id').references(() => trucks.id),
  loadedLitersPer100Km: numeric('loaded_liters_per_100km', { precision: 8, scale: 2 }).notNull(),
  emptyLitersPer100Km: numeric('empty_liters_per_100km', { precision: 8, scale: 2 }).notNull(),
  supplementLiters: numeric('supplement_liters', { precision: 8, scale: 2 }).default('0'),
  flatRateLiters: numeric('flat_rate_liters', { precision: 8, scale: 2 }),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
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
  createdBy: integer('created_by').references(() => users.id),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  customerReference: text('customer_reference'),
  truckId: integer('truck_id').references(() => trucks.id),
  driverId: integer('driver_id').references(() => drivers.id),
  routeId: integer('route_id').references(() => routes.id).notNull(),
  trailerId: integer('trailer_id').references(() => trailers.id),
  trailerType: trailerTypeEnum('trailer_type'),
  cargoTypeId: integer('cargo_type_id').references(() => cargoTypes.id).notNull(),
  containerCount: integer('container_count').default(1),
  status: tripStatusEnum('status').default('CREATED'),
  departureDate: date('departure_date').notNull(),
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
  totalRoadAllowance: numeric('total_road_allowance', { precision: 15, scale: 0 }),
  tollCost: numeric('toll_cost', { precision: 15, scale: 0 }),
  roadAllowanceOverride: numeric('road_allowance_override', { precision: 15, scale: 0 }),
  totalCost: numeric('total_cost', { precision: 15, scale: 0 }),
  revenue: numeric('revenue', { precision: 15, scale: 0 }),
  revenueEmptyReturn: numeric('revenue_empty_return', { precision: 15, scale: 0 }).default('0'),
  revenueCombine: numeric('revenue_combine', { precision: 15, scale: 0 }).default('0'),
  twoPointDeliveryBonus: numeric('two_point_delivery_bonus', { precision: 15, scale: 0 }).default('0'),
  vehicleShiftAllowance: numeric('vehicle_shift_allowance', { precision: 15, scale: 0 }).default('0'),
  grossProfit: numeric('gross_profit', { precision: 15, scale: 0 }),
  revenueOriginal: numeric('revenue_original', { precision: 15, scale: 0 }),
  revenueOverriddenBy: integer('revenue_overridden_by'),
  revenueOverriddenAt: timestamp('revenue_overridden_at'),
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
  fuelSupplierId: integer('fuel_supplier_id').references(() => suppliers.id),
  vatRate: numeric('vat_rate', { precision: 5, scale: 3 }).notNull().default('0.000'),
  carrierType: varchar('carrier_type', { length: 20 }).notNull().default('OWN'),
  // D-E decision: external carrier references customers table, NOT suppliers
  externalCarrierId: integer('external_carrier_id').references(() => customers.id),
  externalFreightCost: numeric('external_freight_cost', { precision: 15, scale: 0 }),
  externalPlateNumber: varchar('external_plate_number', { length: 20 }),
  externalDriverName: varchar('external_driver_name', { length: 100 }),
  externalDriverPhone: varchar('external_driver_phone', { length: 20 }),
  // Wave 0: optional link to the shipment (lô hàng) this trip fulfills. Nullable
  // so legacy trip-create flows keep working unchanged (auto-shipment path is a
  // later checkbox). Trip creation refactor to *require* this comes with the
  // SHIPMENT_FIRST_CREATE feature flag in a separate Wave 0 item.
  // FK is intentionally ON DELETE NO ACTION (the default): a shipment with live
  // trips must never be hard-deleted. Use shipments.deletedAt for tombstoning.
  shipmentId: integer('shipment_id').references(() => shipments.id),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('trips_trailer_id_idx').on(table.trailerId),
  // Trip list and report queries filter heavily on status and date
  index('trips_status_idx').on(table.status),
  index('trips_departure_date_idx').on(table.departureDate),
  index('trips_customer_departure_idx').on(table.customerId, table.departureDate),
  // Wave 0: look up a shipment's trips.
  index('trips_shipment_id_idx').on(table.shipmentId),
  // Wave 0 (shipment-routes slice): one LIVE trip per shipment. A partial
  // unique index — scoped to non-CANCELED trips with a non-null shipmentId —
  // lets a shipment have multiple historical/canceled trips over its lifecycle
  // while preventing two concurrent dispatches from each creating a trip for
  // the same shipment. Enforced at the DB so it holds regardless of how many
  // backend processes are running. Canceled trips are excluded so a
  // re-dispatch after a cancel is allowed.
  uniqueIndex('trips_shipment_id_live_uniq')
    .on(table.shipmentId)
    .where(sql`${table.shipmentId} is not null and ${table.status} <> 'CANCELED'`),
]);

export const tripLegs = pgTable('trip_legs', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').references(() => trips.id).notNull(),
  sequence: integer('sequence').notNull(),
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  km: integer('km').notNull(),
  loadingType: loadingTypeEnum('loading_type').notNull(),
  calculatedLiters: numeric('calculated_liters', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  // Hottest query path: every getBalance/postEntry does WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1
  index('ledger_entity_entity_idx').on(table.entityType, table.entityId),
  index('ledger_entity_entity_id_idx').on(table.entityType, table.entityId, table.id),
  index('ledger_entity_txn_timestamp_idx').on(table.entityType, table.txnType, table.timestamp),
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
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const billingDocuments = pgTable('billing_documents', {
  id: serial('id').primaryKey(),
  type: varchar('type', { length: 20 }).notNull(),               // DEBIT_NOTE | PAYMENT_STATEMENT
  entityType: varchar('entity_type', { length: 20 }).notNull(),  // CUSTOMER | VENDOR
  entityId: integer('entity_id').notNull(),
  entityName: varchar('entity_name', { length: 255 }),
  rangeFrom: date('range_from').notNull(),
  rangeTo: date('range_to').notNull(),
  note: text('note'),
  debitNoteTemplateId: integer('debit_note_template_id').references(() => debitNoteTemplates.id),
  // Frozen render-only copy so historical debit notes re-export identically
  // after the template (or its logo) is edited/deleted. Untyped jsonb; the
  // service casts to DebitNoteTemplateSnapshot.
  debitNoteTemplateSnapshot: jsonb('debit_note_template_snapshot'),
  totalInclVat: numeric('total_incl_vat', { precision: 15, scale: 0 }).notNull().default('0'),
  // Net AR delta contributed by this debit note beyond the trip/fee amounts
  // that were already posted when the trip completed. Kept separately so an
  // edit can post only the difference and repeated saves stay idempotent.
  ledgerAdjustmentAmount: numeric('ledger_adjustment_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('billing_documents_entity_idx').on(table.entityType, table.entityId),
  uniqueIndex('billing_documents_active_period_unique')
    .on(table.type, table.entityType, table.entityId, table.rangeFrom, table.rangeTo)
    .where(sql`${table.deletedAt} IS NULL AND ${table.type} = 'DEBIT_NOTE'`),
]);

export const billingDocumentLines = pgTable('billing_document_lines', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').references(() => billingDocuments.id).notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(),  // TRIP | EXPENSE | ADHOC
  sourceId: integer('source_id'),                                // tripId | tripExpenseId | null(ADHOC)
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
  sortOrder: integer('sort_order').default(0).notNull(),
}, (table) => [
  index('billing_document_lines_doc_idx').on(table.documentId),
]);

export const penalties = pgTable('penalties', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').references(() => drivers.id).notNull(),
  tripId: integer('trip_id').references(() => trips.id),
  reasonId: integer('reason_id').references(() => penaltyReasons.id),
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
  truckId: integer('truck_id').references(() => trucks.id).notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  percentage: numeric('percentage', { precision: 5, scale: 2 }).notNull().default('0'),
  // B2 (feedback202606 GAP 7) — role of the partner: INVESTOR (capital partner,
  // default) or DRIVER (driver-contributor modeled as a per-truck profit
  // participant by %). TEXT + CHECK (not a pgEnum) to avoid enum-migration
  // hassle and the name collision with the user-role pgEnum.
  role: text('role').notNull().default('INVESTOR'),
  effectiveDate: date('effective_date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('truck_cap_table_truck_effective_idx').on(table.truckId, table.effectiveDate),
  check('truck_cap_role_check', sql`${table.role} IN ('INVESTOR', 'DRIVER')`),
]);

export const distributions = pgTable('distributions', {
  id: serial('id').primaryKey(),
  quarter: integer('quarter').notNull(),
  year: integer('year').notNull(),
  partnerName: varchar('partner_name', { length: 255 }).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  // F3 — per-vehicle attribution. NULL on legacy entity-wide rows; set to the
  // owning truck's id on new per-vehicle distribution rows.
  truckId: integer('truck_id').references(() => trucks.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const debtOffsets = pgTable('debt_offsets', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  supplierId: integer('supplier_id').references(() => suppliers.id).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  offsetDate: date('offset_date').notNull(),
  note: text('note'),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('PENDING'),
  createdBy: integer('created_by').references(() => users.id),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('debt_offsets_customer_idx').on(table.customerId),
  index('debt_offsets_supplier_idx').on(table.supplierId),
]);

export const managementFees = pgTable('management_fees', {
  id: serial('id').primaryKey(),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const salaryConfirmationStatusEnum = pgEnum('salary_confirmation_status', ['DRAFT', 'CONFIRMED']);

export const salaryConfirmations = pgTable('salary_confirmations', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').references(() => drivers.id).notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  status: salaryConfirmationStatusEnum('status').default('DRAFT').notNull(),
  confirmedBy: integer('confirmed_by').references(() => users.id),
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
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  expenseDate: date('expense_date').notNull(),
  supplierId: integer('supplier_id').references(() => suppliers.id).notNull(),
  categoryId: integer('category_id').references(() => expenseCategories.id).notNull(),
  // `truck_id` is polymorphic — holds either `trucks.id` (when vehicle_component='TRUCK'),
  // `trailers.id` (when vehicle_component='TRAILER'), or null (company-wide expense).
  // No FK constraint because Postgres can't enforce a polymorphic reference; integrity
  // is maintained by the create/update service paths.
  truckId: integer('truck_id'),
  vehicleComponent: vehicleComponentEnum('vehicle_component').default('TRUCK'),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }).notNull(),
  validFrom: timestamp('valid_from'),
  validTo: timestamp('valid_to'),
  receiptId: varchar('receipt_id', { length: 100 }),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
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
  expenseId: integer('expense_id').references(() => expenses.id).notNull(),
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
  code: varchar('code', { length: 50 }).notNull().unique(), // e.g. "LIFTING", "CUSTOMS"
  name: varchar('name', { length: 100 }).notNull(),         // Vietnamese label e.g. "Nâng hạ"
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
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
  tripId: integer('trip_id').references(() => trips.id).notNull(),
  containerTypeId: integer('container_type_id').references(() => containerTypes.id),
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
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_containers_trip_id_idx').on(table.tripId),
]);

// ─── Multi-seal per container (Phase 2) ───────────────────────────────────
// A container may carry multiple seals (customs seal, carrier seal, …).
// Each row is one seal. Cascade on delete so removing a container row also
// cleans up its seals — never leaves orphans.
export const tripContainerSeals = pgTable('trip_container_seals', {
  id: serial('id').primaryKey(),
  tripContainerId: integer('trip_container_id')
    .references(() => tripContainers.id, { onDelete: 'cascade' }).notNull(),
  sealNumber: varchar('seal_number', { length: 50 }).notNull(),
  // Free-form string ("Customs", "Carrier", …). No enum — drivers may label
  // however makes sense in the field.
  sealType: varchar('seal_type', { length: 30 }),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
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
  tripId: integer('trip_id').references(() => trips.id, { onDelete: 'cascade' }).notNull(),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  notes: text('notes'),
  updatedBy: integer('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_instructions_trip_id_unq').on(table.tripId),
]);

export const tripExpenses = pgTable('trip_expenses', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').references(() => trips.id).notNull(),
  forwarderId: integer('forwarder_id').references(() => users.id),  // nullable — accountants also create
  expenseType: varchar('expense_type', { length: 50 }).notNull(),   // FK to forwarder_expense_types.code
  buyAmount: numeric('buy_amount', { precision: 15, scale: 0 }).notNull(),
  sellAmount: numeric('sell_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  settlementMethod: varchar('settlement_method', { length: 20 }).notNull().default('FORWARDER_ADVANCE'),
  supplierId: integer('supplier_id').references(() => suppliers.id),
  invoiceNumber: varchar('invoice_number', { length: 50 }),
  invoiceDate: date('invoice_date'),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  // Free-text container label (DEPRECATED for B5). Kept for back-compat with
  // rows written before the FK existed and as a denormalised mirror; new writes
  // should set `tripContainerId` so the label always matches a real container.
  containerNumber: varchar('container_number', { length: 20 }),
  // B5: authoritative link to the trip's container row. ON DELETE SET NULL so
  // deleting a container row downgrades the expense to trip-level (loose
  // containerNumber still present) instead of orphaning or failing the delete.
  tripContainerId: integer('trip_container_id').references(() => tripContainers.id, { onDelete: 'set null' }),
  approvalStatus: varchar('approval_status', { length: 20 }).notNull().default('APPROVED'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('trip_expenses_trip_id_idx').on(table.tripId),
  index('trip_expenses_container_idx').on(table.containerNumber),
  index('trip_expenses_trip_container_id_idx').on(table.tripContainerId),
]);

export const tripExpensePhotos = pgTable('trip_expense_photos', {
  id: serial('id').primaryKey(),
  tripExpenseId: integer('trip_expense_id').references(() => tripExpenses.id).notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (table) => [
  // Receipt-photo serving (/api/photos) resolves ownership by exact storage_key
  // lookup; this index makes that O(log n) instead of a seq scan. See ADR 0042.
  index('trip_expense_photos_storage_key_idx').on(table.storageKey),
]);

export const tripExpenseCompletionScopes = pgTable('trip_expense_completion_scopes', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').references(() => trips.id, { onDelete: 'cascade' }).notNull(),
  // Null represents the trip-level "Chi phí chung" scope.
  tripContainerId: integer('trip_container_id').references(() => tripContainers.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).notNull().default('IN_PROGRESS'),
  completedBy: integer('completed_by').references(() => users.id),
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
  requesterId: integer('requester_id').references(() => users.id).notNull(),
  amount: numeric('amount', { precision: 15, scale: 0 }).notNull(),
  reason: text('reason').notNull(),
  status: advanceRequestStatusEnum('status').default('PENDING').notNull(),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const advanceSettlements = pgTable('advance_settlements', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull(),
  forwarderId: integer('forwarder_id').references(() => users.id).notNull(),
  totalExpenseAmount: numeric('total_expense_amount', { precision: 15, scale: 0 }).notNull(),
  refundAmount: numeric('refund_amount', { precision: 15, scale: 0 }).default('0').notNull(),
  status: advanceSettlementStatusEnum('status').default('PENDING').notNull(),
  checkedBy: integer('checked_by').references(() => users.id),
  checkedAt: timestamp('checked_at'),
  approvedBy: integer('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('advance_settlements_code_unique_idx').on(table.code),
]);

export const advanceSettlementRequests = pgTable('advance_settlement_requests', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').references(() => advanceSettlements.id).notNull(),
  advanceRequestId: integer('advance_request_id').references(() => advanceRequests.id).notNull(),
}, (table) => [
  uniqueIndex('adv_settlement_req_unique_idx').on(table.settlementId, table.advanceRequestId),
]);

export const settlementExpenses = pgTable('settlement_expenses', {
  id: serial('id').primaryKey(),
  settlementId: integer('settlement_id').references(() => advanceSettlements.id).notNull(),
  tripExpenseId: integer('trip_expense_id').references(() => tripExpenses.id).notNull(),
  originalBuyAmount: numeric('original_buy_amount', { precision: 15, scale: 0 }).notNull(),
  adjustedBuyAmount: numeric('adjusted_buy_amount', { precision: 15, scale: 0 }).notNull(),
  submittedSellAmount: numeric('submitted_sell_amount', { precision: 15, scale: 0 }),
  originalSnapshot: jsonb('original_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustedSnapshot: jsonb('adjusted_snapshot').$type<Record<string, unknown>>().notNull(),
  adjustmentReason: text('adjustment_reason'),
  adjustedBy: integer('adjusted_by').references(() => users.id),
  adjustedAt: timestamp('adjusted_at'),
}, (table) => [
  uniqueIndex('settlement_expense_unique_idx').on(table.settlementId, table.tripExpenseId),
  index('settlement_expense_trip_expense_idx').on(table.tripExpenseId),
]);

// ─── Attendance ──────────────────────────────────────────────────────────────

export const driverWorkDays = pgTable('driver_work_days', {
  id: serial('id').primaryKey(),
  driverId: integer('driver_id').references(() => drivers.id).notNull(),
  date: date('date').notNull(),
  status: workDayStatusEnum('status').notNull(),
  tripId: integer('trip_id').references(() => trips.id),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
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
  tripId: integer('trip_id').references(() => trips.id).notNull(),
  type: tripPhotoTypeEnum('type').notNull(),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id).notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  // Phase 2: optional link to a specific container row, so each container's
  // cont/seal photo(s) can be displayed under that container. ON DELETE SET
  // NULL so deleting a container row keeps the photo as trip-level evidence
  // (rather than destroying the file reference).
  tripContainerId: integer('trip_container_id').references(() => tripContainers.id, { onDelete: 'set null' }),
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
  sourceTripId: integer('source_trip_id').references(() => trips.id),
  routeId: integer('route_id').references(() => routes.id),
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
  tripId: integer('trip_id').references(() => trips.id, { onDelete: 'cascade' }).notNull(),
  routeId: integer('route_id').references(() => routes.id),
  truckId: integer('truck_id').references(() => trucks.id),
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
 * One row per truck: the most recent GPS fix seen by getLiveFleet(). Upserted on
 * every successful live-fleet poll so the dispatch map can fall back to the
 * last-known position (shown offline) when the Bách Khoa provider is down or a
 * specific truck is absent from its response — instead of the map going empty.
 * truck_id is the PK (1:1 per truck); telemetry is double precision so values
 * round-trip as native JS numbers (no numeric string juggling on readback).
 */
export const vehicleLastPositions = pgTable('vehicle_last_positions', {
  truckId: integer('truck_id').references(() => trucks.id).primaryKey(),
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
  userId: integer('user_id').references(() => users.id).notNull(),
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
  userId: integer('user_id').references(() => users.id).notNull(),
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
  userId: integer('user_id').references(() => users.id).notNull(),
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
  conversationId: integer('conversation_id').references(() => agentConversations.id).notNull(),
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

// Per-turn performance metrics. One row per assistant agent_messages turn
// (messageId is both PK and FK → 1:1). Used by the chatbot performance
// monitoring dashboard.
//
// DUAL-LATENCY + ACK-EXCLUSION INVARIANT (read before touching timings):
//   - latency_total_ms       = LLM + tools + final (EXCLUDES ack waits).
//   - latency_user_perceived_ms = total + ack + persist (server-side fallback).
//   - latency_client_wait_ms = browser send -> assistant response shown.
//   - latency_ack_ms         : the ack/emit wait, tracked separately.
//   - latency_tools_ms       : MUST NOT include the ack wait at the mid-loop
//                              instrumentation site — subtract the ack wait
//                              there before persisting.
export const agentTurnMetrics = pgTable('agent_turn_metrics', {
  messageId: integer('message_id').primaryKey().references(() => agentMessages.id),
  traceId: text('trace_id'),
  userId: integer('user_id').references(() => users.id),
  role: text('role'),
  conversationId: integer('conversation_id').references(() => agentConversations.id),
  model: text('model'),
  latencyUserPerceivedMs: integer('latency_user_perceived_ms'),
  latencyClientWaitMs: integer('latency_client_wait_ms'),
  latencyTotalMs: integer('latency_total_ms'),
  latencyLlmMs: integer('latency_llm_ms'),
  latencyToolsMs: integer('latency_tools_ms'),
  latencyFinalMs: integer('latency_final_ms'),
  latencyAckMs: integer('latency_ack_ms'),
  latencyPersistMs: integer('latency_persist_ms'),
  // P0 instrumentation: time-to-first-token (ms from turn start to first
  // streamed TEXT delta OR first tool result, whichever is earlier). Null when
  // the turn produced neither (immediate error / FAQ fast lane). The lever for
  // perceived-latency work — see docs/plans/2026-07-13-fast-response-chatbot-lanes.
  latencyFirstTokenMs: integer('latency_first_token_ms'),
  reactIterations: integer('react_iterations'),
  toolCallCount: integer('tool_call_count').default(0),
  fallbackUsed: boolean('fallback_used').default(false),
  aborted: boolean('aborted').default(false),
  // A4: navigate-compliance telemetry. navigateDirectiveEmitted = a navigate/
  // focus directive was emitted this turn (model or guardrail); guardrailFired
  // = the A3 guardrail synthesized the navigate because the model wrote a path
  // in prose instead of calling ui.navigate.
  navigateDirectiveEmitted: boolean('navigate_directive_emitted').default(false),
  guardrailFired: boolean('guardrail_fired').default(false),
  errorKind: text('error_kind'),
  // P0 instrumentation: which execution lane handled the turn ('faq' | 'nav' |
  // 'lookup' | 'summary' | 'react_fallback' | 'unknown'). Lets the dashboard
  // show intent distribution and measure the route-before-reasoning collapse.
  intentBucket: text('intent_bucket'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  estimatedCostVnd: integer('estimated_cost_vnd'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('agent_turn_metrics_created_at_idx').on(table.createdAt),
  index('agent_turn_metrics_conversation_id_idx').on(table.conversationId),
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

// ─── Onboarding progress (Phase 4) ──────────────────────────────────────────
// Per-user, per-tour-VERSION progress row. Unique (user_id, tour_id,
// tour_version) so a bumped tour version starts a fresh row rather than
// corrupting an in-flight one. `current_step_id` is a free string (the step's
// index — the catalog is the source of truth for step identity); it is
// informational, not an FK. localStorage becomes a cache; this is the source.
export const userOnboardingProgress = pgTable(
  'user_onboarding_progress',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id).notNull(),
    // Free strings (catalog is TS, not a DB table). Length-bounded for safety.
    tourId: varchar('tour_id', { length: 120 }).notNull(),
    tourVersion: integer('tour_version').notNull(),
    currentStepId: varchar('current_step_id', { length: 120 }),
    status: onboardingStatusEnum('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    skippedAt: timestamp('skipped_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_onboarding_progress_user_tour_version_idx')
      .on(table.userId, table.tourId, table.tourVersion),
    index('user_onboarding_progress_user_idx').on(table.userId),
  ],
);

// ─── Onboarding checklist tasks (Phase 4 / Phase 6) ─────────────────────────
// Per-user checklist-item completion. `task_id` is a free string from the
// shared ONBOARDING_TASKS catalog (Phase 6). Composite PK (user_id, task_id)
// so each user has at most one row per task. `metadata` carries optional
// context (e.g. the tripId that completed "create first trip").
export const userOnboardingTasks = pgTable(
  'user_onboarding_tasks',
  {
    userId: integer('user_id').references(() => users.id).notNull(),
    taskId: varchar('task_id', { length: 120 }).notNull(),
    status: onboardingTaskStatusEnum('status').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Composite PRIMARY KEY: one row per (user, task). Expressed via a unique
    // index (drizzle's primaryKey() in the table builder is awkward here; the
    // unique index is functionally equivalent and the ORM query patterns below
    // rely on it for upsert onConflict targets).
    uniqueIndex('user_onboarding_tasks_user_task_idx')
      .on(table.userId, table.taskId),
  ],
);

// ─── Onboarding lifecycle analytics (Phase 5) ───────────────────────────────
// Append-only event log for onboarding telemetry (tour started / step viewed /
// target missing / action completed / step skipped / tour completed / tour
// abandoned). Cheaper than per-event tables; queryable via Drizzle Studio or a
// future dashboard. `event_name` is a plain VARCHAR (not a pgEnum) so adding an
// event needs no migration, but the client only emits from the closed
// `ONBOARDING_EVENT_NAMES` set in shared, and the server filters on it too.
export const onboardingEvents = pgTable(
  'onboarding_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id).notNull(),
    eventName: varchar('event_name', { length: 60 }).notNull(),
    tourId: varchar('tour_id', { length: 120 }),
    tourVersion: integer('tour_version'),
    stepId: varchar('step_id', { length: 120 }),
    role: varchar('role', { length: 20 }).notNull(),
    routeKey: varchar('route_key', { length: 60 }),
    durationMs: integer('duration_ms'),
    triggerSource: varchar('trigger_source', { length: 20 }),
    targetFound: boolean('target_found'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('onboarding_events_user_created_idx').on(table.userId, table.createdAt),
    index('onboarding_events_name_created_idx').on(table.eventName, table.createdAt),
  ],
);

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
  // entity_type is a free-form varchar (not a pgEnum) so the set of geotaggable
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
  recordedBy: integer('recorded_by').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // UNIQUE so the service upsert (ON CONFLICT entity_type, entity_id) enforces
  // one geotag per photo — idempotency on resubmit (M0X-HT-04).
  uniqueIndex('photo_geotags_entity_uniq').on(table.entityType, table.entityId),
]);

// ─── Scheduler (Wave 0) ─────────────────────────────────────────────────────
// Run-log for the cron scheduler introduced in Wave 0. Every job tick acquires
// a Postgres advisory lock (so two backend instances can't double-run the same
// job at the same instant), writes a row at RUNNING, and updates it to SUCCESS
// or FAILED when the handler returns/throws. Wave 2 (email retries) and Wave 3
// (receivable reminders, salary-period close) register jobs against this table.
export const schedulerRunStatusEnum = pgEnum('scheduler_run_status', ['RUNNING', 'SUCCESS', 'FAILED']);

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
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'DRAFT', 'IN_PROGRESS', 'DELIVERED', 'CLOSED', 'CANCELED',
]);

export const shipmentDocumentTypeEnum = pgEnum('shipment_document_type', [
  'BOOKING', 'BL', 'DO', 'DECLARATION', 'OTHER',
]);

// Customs declaration scope: SINGLE = one declaration per container; SHARED =
// one declaration covers multiple containers (issued on approval). M3.1 §3.
export const shipmentDeclarationScopeEnum = pgEnum('shipment_declaration_scope', [
  'SINGLE', 'SHARED',
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
  customerId: integer('customer_id').references(() => customers.id).notNull(),
  status: shipmentStatusEnum('status').default('DRAFT'),
  bookingRef: varchar('booking_ref', { length: 100 }),
  blNumber: varchar('bl_number', { length: 100 }),
  expectedDeliveryDate: date('expected_delivery_date'),
  pickupLocation: varchar('pickup_location', { length: 255 }),
  deliveryLocation: varchar('delivery_location', { length: 255 }),
  contactName: varchar('contact_name', { length: 100 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  createdBy: integer('created_by').references(() => users.id),
  updatedBy: integer('updated_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('shipments_customer_status_idx').on(table.customerId, table.status),
  index('shipments_status_idx').on(table.status),
]);

// Booking confirmation, bill of lading, delivery order, customs declaration
// PDFs, etc. storageKey points at the same object-storage / uploads path
// convention used by other uploads (e.g. trip photos).
export const shipmentDocuments = pgTable('shipment_documents', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id')
    .references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
  type: shipmentDocumentTypeEnum('type'),
  storageKey: varchar('storage_key', { length: 255 }).notNull(),
  uploadedBy: integer('uploaded_by').references(() => users.id),
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
    .references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
  declarationNumber: varchar('declaration_number', { length: 50 }),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  scope: shipmentDeclarationScopeEnum('scope').default('SINGLE'),
  note: text('note'),
  createdBy: integer('created_by').references(() => users.id),
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
    .references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
  fromStatus: shipmentStatusEnum('from_status'),
  toStatus: shipmentStatusEnum('to_status').notNull(),
  reason: text('reason'),
  changedBy: integer('changed_by').references(() => users.id),
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
    .references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
  containerTypeId: integer('container_type_id').references(() => containerTypes.id),
  containerNumber: varchar('container_number', { length: 50 }),
  sealNumber: varchar('seal_number', { length: 50 }),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  notes: text('notes'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('shipment_containers_shipment_id_idx').on(table.shipmentId),
]);
