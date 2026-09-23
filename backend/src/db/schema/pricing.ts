// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, index, integer, numeric, pgTable, serial, text, timestamp,
  uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ancillaryRevenueTypeEnum, liftDirectionEnum, loadStateEnum, trailerTypeEnum } from './_enums';
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


// ─── Auto Freight Pricing Engine (2026-09-09) ──────────────────────────────
//
// 6 new tables for the automatic freight calculation engine.
// Source: `Phương án tính cước tự động.docx` + `CuocPhiThietKeDB.md` §3.
// Formula: freight = basePrice × (1 + sharePct/100)
//        + MAX(0, (fuelPrice − baseFuelPrice) × billedKm × litersPerKm)

// Vehicle size class catalog — replaces free-text rate_key with a FK.
// Seed: 1.25T, 2.5T, 3.5T, 5T, 8T, 10T, 15T, CONT20, CONT40.
export const vehicleSizeClasses = pgTable('vehicle_size_classes', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  isContainer: boolean('is_container').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

// Freight rate terms — per customer × route contract terms.
// One row = one block in the Excel pricing sheet.
export const freightRateTerms = pgTable('freight_rate_terms', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  routeId: integer('route_id').notNull(),
  // % added to base price (NOT fuel surcharge share). Excel: 2 / 2.5 / 4.
  sharePct: numeric('share_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  // One-way km for billing (may differ from actual distance).
  billingKmOneWay: integer('billing_km_one_way').notNull(),
  // Always × 2 for round trip (decision 2026-09-09 Câu 4 = A).
  billingKmMultiplier: numeric('billing_km_multiplier', { precision: 4, scale: 2 })
    .notNull().default('2'),
  // Base fuel price (F) already embedded in contract base price.
  // Excel: 19270 / 1.08 = 17842.5926. Scale ≥ 4 required — see CuocPhiThietKeDB.md §3.2.1.
  baseFuelPrice: numeric('base_fuel_price', { precision: 12, scale: 4 }).notNull(),
  // Lag days before new fuel price applies (NEWEB = 1; others TBD).
  fuelLagDays: integer('fuel_lag_days').notNull().default(0),
  // Whether the lag above is a customer-confirmed term. False = the value is
  // provisional (the API forces an explicit input, but the stored 0 must not
  // be read as an agreed term). See CuocPhiThietKeDB.md §8 (20260917_11).
  fuelLagConfirmed: boolean('fuel_lag_confirmed').notNull().default(false),
  // Surcharge threshold confirmation state — three states per 20260917_11
  // criterion 1 (PRD CuocPhiThietKeDB.md §8 forbids reading an empty cell as
  // "always adjust"):
  //   'UNSET'  — no customer confirmation yet (the historical NULL rows).
  //   'NONE'   — customer confirmed NO threshold (always adjust).
  //   'PCT'    — threshold confirmed as a percentage (surcharge_threshold_pct).
  //   'ABS'    — threshold confirmed as VNĐ/liter (surcharge_threshold_abs).
  surchargeThresholdMode: varchar('surcharge_threshold_mode', { length: 10 })
    .notNull()
    .default('UNSET'),
  // Surcharge threshold — minimum price change to trigger adjustment.
  // Two modes: percentage OR absolute (VNĐ/liter). NULL is allowed only while
  // mode = 'UNSET' (never yet confirmed); mode 'NONE' also keeps both NULL.
  // Per docx §2 B: "Hệ thống hỗ trợ cấu hình ngưỡng biến động giá dầu tối thiểu
  // theo 2 dạng tùy chọn".
  surchargeThresholdPct: numeric('surcharge_threshold_pct', { precision: 5, scale: 2 }),
  surchargeThresholdAbs: numeric('surcharge_threshold_abs', { precision: 12, scale: 2 }),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('freight_rate_terms_cust_route_date_uniq')
    .on(table.customerId, table.routeId, table.effectiveDate),
]);

// Fuel consumption norms — per vehicle size class.
// This is REVENUE-side (lít/km for customer billing), NOT cost-side (fuel_norms).
// See CuocPhiThietKeDB.md §3.3 — intentionally separate from fuel_norms.
export const fuelConsumptionNorms = pgTable('fuel_consumption_norms', {
  id: serial('id').primaryKey(),
  vehicleSizeClassId: integer('vehicle_size_class_id').notNull(),
  litersPerKm: numeric('liters_per_km', { precision: 6, scale: 4 }).notNull(),
  effectiveDate: date('effective_date').notNull().defaultNow(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('fuel_consumption_norms_class_date_uniq')
    .on(table.vehicleSizeClassId, table.effectiveDate),
]);

// Fuel price periods — the "ô M1" from Excel. One global price per period.
// Adding a row = new period; old rows kept for audit trail.
export const fuelPricePeriods = pgTable('fuel_price_periods', {
  id: serial('id').primaryKey(),
  // Fuel price (G), BEFORE VAT. Excel: 21740 (11/7) → 27620 (18/7).
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  sourceNote: text('source_note'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('fuel_price_periods_from_uniq').on(table.effectiveFrom),
]);

// Freight rate snapshots — frozen calculation at trip/shipment issuance.
// Immutable once created — answers "why is this trip 5,071,744 VND?"
export const freightRateSnapshots = pgTable('freight_rate_snapshots', {
  id: serial('id').primaryKey(),
  shipmentId: integer('shipment_id'),
  tripId: integer('trip_id'),
  // Frozen results — integer VND
  freightAmount: numeric('freight_amount', { precision: 15, scale: 0 }).notNull(),
  surchargeAmount: numeric('surcharge_amount', { precision: 15, scale: 0 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 15, scale: 0 }).notNull(),
  // Traceability: which parameter rows were used
  rateTermsId: integer('rate_terms_id').notNull(),
  pricingTableId: integer('pricing_table_id').notNull(),
  fuelNormId: integer('fuel_norm_id').notNull(),
  fuelPricePeriodId: integer('fuel_price_period_id').notNull(),
  // Intermediate values for customer explanation without re-joining
  billedKm: numeric('billed_km', { precision: 10, scale: 2 }).notNull(),
  liters: numeric('liters', { precision: 10, scale: 3 }).notNull(),
  fuelDelta: numeric('fuel_delta', { precision: 12, scale: 4 }).notNull(),
  sharePct: numeric('share_pct', { precision: 5, scale: 2 }).notNull(),
  // Card 20260922_59: the per-cell Hệ số (fuel-surcharge-only multiplier from
  // quotation_cells) APPLIED to surchargeAmount when this snapshot was taken.
  // Default 1 = ordinary round trip; historical rows read as 1 (true).
  heSo: numeric('he_so', { precision: 8, scale: 4 }).notNull().default('1'),
  computedAt: timestamp('computed_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('freight_rate_snapshots_shipment_idx').on(table.shipmentId),
  index('freight_rate_snapshots_trip_idx').on(table.tripId),
]);

// Debit note overrides — manual adjustment by accountant at debit note time.
// system_calculated_freight is read-only; final_debit_freight is the negotiated price.
// Per docx §4: "hệ thống mở ô cho phép Kế toán nhập đè Giá cước thực tế đàm phán".
export const debitNoteOverrides = pgTable('debit_note_overrides', {
  id: serial('id').primaryKey(),
  snapshotId: integer('snapshot_id').notNull(),
  // System-calculated freight (read-only, from snapshot)
  systemCalculatedFreight: numeric('system_calculated_freight',
    { precision: 15, scale: 0 }).notNull(),
  // Accountant-entered negotiated freight (nullable = use system value)
  finalDebitFreight: numeric('final_debit_freight', { precision: 15, scale: 0 }),
  // Required when final != system
  overrideReason: text('override_reason'),
  overrideBy: integer('override_by'),
  overrideAt: timestamp('override_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('debit_note_overrides_snapshot_uniq').on(table.snapshotId),
]);
