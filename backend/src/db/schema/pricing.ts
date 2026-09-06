// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  date, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
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
