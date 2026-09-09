// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, index, integer, jsonb, numeric, pgTable, pgView, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { fuelModeEnum, loadingTypeEnum, pricingSourceEnum, trailerTypeEnum, tripPhotoTypeEnum, tripStatusEnum } from './_enums';
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
  // F6 factory snapshot (MasterDataNhaMay MDN-13): the operational site's
  // drift-prone display fields, frozen at dispatch the same way route_id
  // snapshots the route. Editing factory master data mid-trip can no longer
  // drift an in-flight lot. Null on legacy rows ⇒ reads fall back to the
  // live join (trip-factory-site.service).
  factorySiteName: varchar('factory_site_name', { length: 255 }),
  factorySiteAddress: text('factory_site_address'),
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
  notes: text('notes'),
  // 27.8 cost-section Ghi chú: driver-written note that flags cost anomalies
  // for accounting (e.g. "Tiền đường trong auto-row sai, vui lòng soát lại").
  // Distinct from `notes` (general trip memo) and from `shipments.operationalNotes`
  // (cus/dispatcher→driver rule copy surfaced as "Quy định tại điểm làm hàng").
  costSubmissionNote: text('cost_submission_note'),
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
  // O2C field ops hand-off timestamps (Phase 4): Ops paper-order collected +
  // Driver order-accepted. Nullable; populated by the OPS/DRIVER endpoints.
  paperOrderCollectedAt: timestamp('paper_order_collected_at', { withTimezone: true }),
  paperOrderCollectedBy: integer('paper_order_collected_by'),
  // Trip instructions (N2 / B1.3), merged from the 1:1 trip_instructions
  // table (lean-down 2026-09-06). Manager-authored contact + free-text
  // guidance; read-only for drivers via the driver portal.
  instructionContactName: varchar('instruction_contact_name', { length: 100 }),
  instructionContactPhone: varchar('instruction_contact_phone', { length: 20 }),
  instructionNotes: text('instruction_notes'),
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


// Trips split Stage A (lean-down, spec: plans/260906-1032-db-lean-down/): the
// computed financial snapshot columns split out of the 99-column trips god
// table. 1:1 per trip. Stage A is additive-only — trips still holds + writes
// these columns; readers migrate group-by-group (Stage B), writes cut over in
// Stage C, and the trips columns drop in Stage D. Column names/types are
// verbatim copies so the Stage C cutover is a pure move.
export const tripFinancialState = pgTable('trip_financial_state', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  driverSalary: numeric('driver_salary', { precision: 15, scale: 0 }),
  fuelPriceApplied: numeric('fuel_price_applied', { precision: 10, scale: 0 }),
  fuelActualUnitPrice: numeric('fuel_actual_unit_price', { precision: 10, scale: 0 }),
  roadAllowanceBaseApplied: numeric('road_allowance_base_applied', { precision: 15, scale: 0 }),
  fuelLoadedNormApplied: numeric('fuel_loaded_norm_applied', { precision: 6, scale: 2 }),
  fuelEmptyNormApplied: numeric('fuel_empty_norm_applied', { precision: 6, scale: 2 }),
  fuelFixedAllowanceApplied: numeric('fuel_fixed_allowance_applied', { precision: 10, scale: 2 }),
  fuelSupplementNormApplied: numeric('fuel_supplement_norm_applied', { precision: 6, scale: 2 }),
  tollPerStationApplied: numeric('toll_per_station_applied', { precision: 15, scale: 0 }),
  returnCargoBonusApplied: numeric('return_cargo_bonus_applied', { precision: 15, scale: 0 }),
  fuelLiters: numeric('fuel_liters', { precision: 10, scale: 2 }),
  totalFuelCost: numeric('total_fuel_cost', { precision: 15, scale: 0 }),
  fuelSurchargeAmount: numeric('fuel_surcharge_amount', { precision: 15, scale: 0 }).notNull().default('0'),
  fuelSurchargeSnapshot: jsonb('fuel_surcharge_snapshot').$type<Record<string, unknown>>(),
  fuelSurchargeSnapshotDirty: boolean('fuel_surcharge_snapshot_dirty').notNull().default(false),
  totalRoadAllowance: numeric('total_road_allowance', { precision: 15, scale: 0 }),
  tollCost: numeric('toll_cost', { precision: 15, scale: 0 }),
  tollDeduction: numeric('toll_deduction', { precision: 15, scale: 0 }).notNull().default('0'),
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
  revenueOverrideReason: text('revenue_override_reason'),
  pricingSource: pricingSourceEnum('pricing_source'),
  pricingFormula: text('pricing_formula'),
  pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>(),
  customerCommission: numeric('customer_commission', { precision: 15, scale: 0 }).default('0'),
  tripWageDays: integer('trip_wage_days'), // optional override for days to count for this trip
  fuelSupplierId: integer('fuel_supplier_id'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 3 }).notNull().default('0.000'),
  arCostHash: varchar('ar_cost_hash', { length: 64 }),
  arSnapshotDirty: boolean('ar_snapshot_dirty').notNull().default(false),
  arSnapshotChangedAt: timestamp('ar_snapshot_changed_at', { withTimezone: true }),
  apCostHash: varchar('ap_cost_hash', { length: 64 }),
  apSnapshotDirty: boolean('ap_snapshot_dirty').notNull().default(false),
  apSnapshotChangedAt: timestamp('ap_snapshot_changed_at', { withTimezone: true }),
  pnlSnapshotGrossProfit: numeric('pnl_snapshot_gross_profit', { precision: 15, scale: 0 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_financial_state_trip_id_unq').on(table.tripId),
]);

// Trips split Stage A: external-carrier execution block split out of trips
// (all-NULL for in-house trips). Same staged A→D plan as tripFinancialState.
export const tripCarrierInfo = pgTable('trip_carrier_info', {
  id: serial('id').primaryKey(),
  tripId: integer('trip_id').notNull(),
  carrierType: varchar('carrier_type', { length: 20 }).notNull().default('OWN'),
  externalEntityId: integer('external_entity_id'),
  externalEntityType: varchar('external_entity_type', { length: 20 }),
  externalFreightCost: numeric('external_freight_cost', { precision: 15, scale: 0 }),
  externalPlateNumber: varchar('external_plate_number', { length: 20 }),
  externalCarrierVehicleId: integer('external_carrier_vehicle_id'),
  externalDriverName: varchar('external_driver_name', { length: 100 }),
  externalDriverPhone: varchar('external_driver_phone', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trip_carrier_info_trip_id_unq').on(table.tripId),
]);

// Trips split Stage B read seam (lean-down 2026-09-06): the composed trip row —
// trips (operational columns) 1:1 trip_financial_state 1:1 trip_carrier_info.
// Typed as a drop-in replacement for the pre-split `select().from(trips)`:
// every column the old trips row exposed is present with the same name and
// nullability. Full-shape readers migrate to `select().from(tripsComposite)`;
// narrow ops-only reads and `.for('update')` lock reads stay on `trips`
// (views cannot take row locks — join the sidecars explicitly there).
// Column names/types mirror the source tables verbatim.
export const tripsComposite = pgView('trips_composite', {
  // ── operational (trips) ────────────────────────────────────────────────
  id: integer('id').notNull(),
  tripCode: varchar('trip_code', { length: 50 }),
  version: integer('version').notNull(),
  createdBy: integer('created_by'),
  customerId: integer('customer_id').notNull(),
  customerReference: text('customer_reference'),
  truckId: integer('truck_id'),
  driverId: integer('driver_id'),
  routeId: integer('route_id').notNull(),
  trailerId: integer('trailer_id'),
  trailerType: trailerTypeEnum('trailer_type'),
  cargoTypeId: integer('cargo_type_id'),
  containerCount: integer('container_count'),
  status: tripStatusEnum('status'),
  departureDate: date('departure_date').notNull(),
  plannedStartAt: timestamp('planned_start_at'),
  plannedEndAt: timestamp('planned_end_at'),
  canonicalOrigin: varchar('canonical_origin', { length: 160 }),
  canonicalDestination: varchar('canonical_destination', { length: 160 }),
  cargoWeightKg: numeric('cargo_weight_kg', { precision: 10, scale: 2 }),
  vehicleCapacityKg: numeric('vehicle_capacity_kg', { precision: 10, scale: 2 }),
  activeTripPairId: integer('active_trip_pair_id'),
  activeTripPairOrder: integer('active_trip_pair_order'),
  fuelMode: fuelModeEnum('fuel_mode'),
  fuelLitersOverride: numeric('fuel_liters_override', { precision: 10, scale: 2 }),
  fuelSupplementLiters: numeric('fuel_supplement_liters', { precision: 10, scale: 2 }),
  fuelSupplementReason: text('fuel_supplement_reason'),
  tollsDiscount: numeric('tolls_discount', { precision: 15, scale: 0 }),
  tollsAddition: numeric('tolls_addition', { precision: 15, scale: 0 }),
  tollsStations: integer('tolls_stations'),
  hasReturnCargo: boolean('has_return_cargo'),
  notes: text('notes'),
  costSubmissionNote: text('cost_submission_note'),
  shipmentId: integer('shipment_id'),
  fulfillmentId: integer('fulfillment_id'),
  sourceShipmentVersion: integer('source_shipment_version'),
  completedAt: timestamp('completed_at'),
  podRecoveredAt: timestamp('pod_recovered_at', { withTimezone: true }),
  podRecoveredBy: integer('pod_recovered_by'),
  paperOrderCollectedAt: timestamp('paper_order_collected_at', { withTimezone: true }),
  paperOrderCollectedBy: integer('paper_order_collected_by'),
  instructionContactName: varchar('instruction_contact_name', { length: 100 }),
  instructionContactPhone: varchar('instruction_contact_phone', { length: 20 }),
  instructionNotes: text('instruction_notes'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  deletedAt: timestamp('deleted_at'),
  // ── financial (trip_financial_state) ───────────────────────────────────
  driverSalary: numeric('driver_salary', { precision: 15, scale: 0 }),
  fuelPriceApplied: numeric('fuel_price_applied', { precision: 10, scale: 0 }),
  fuelActualUnitPrice: numeric('fuel_actual_unit_price', { precision: 10, scale: 0 }),
  roadAllowanceBaseApplied: numeric('road_allowance_base_applied', { precision: 15, scale: 0 }),
  fuelLoadedNormApplied: numeric('fuel_loaded_norm_applied', { precision: 6, scale: 2 }),
  fuelEmptyNormApplied: numeric('fuel_empty_norm_applied', { precision: 6, scale: 2 }),
  fuelFixedAllowanceApplied: numeric('fuel_fixed_allowance_applied', { precision: 10, scale: 2 }),
  fuelSupplementNormApplied: numeric('fuel_supplement_norm_applied', { precision: 6, scale: 2 }),
  tollPerStationApplied: numeric('toll_per_station_applied', { precision: 15, scale: 0 }),
  returnCargoBonusApplied: numeric('return_cargo_bonus_applied', { precision: 15, scale: 0 }),
  fuelLiters: numeric('fuel_liters', { precision: 10, scale: 2 }),
  totalFuelCost: numeric('total_fuel_cost', { precision: 15, scale: 0 }),
  fuelSurchargeAmount: numeric('fuel_surcharge_amount', { precision: 15, scale: 0 }).notNull(),
  fuelSurchargeSnapshot: jsonb('fuel_surcharge_snapshot').$type<Record<string, unknown>>(),
  fuelSurchargeSnapshotDirty: boolean('fuel_surcharge_snapshot_dirty').notNull(),
  totalRoadAllowance: numeric('total_road_allowance', { precision: 15, scale: 0 }),
  tollCost: numeric('toll_cost', { precision: 15, scale: 0 }),
  tollDeduction: numeric('toll_deduction', { precision: 15, scale: 0 }).notNull(),
  roadAllowanceOverride: numeric('road_allowance_override', { precision: 15, scale: 0 }),
  totalCost: numeric('total_cost', { precision: 15, scale: 0 }),
  revenue: numeric('revenue', { precision: 15, scale: 0 }),
  revenueEmptyReturn: numeric('revenue_empty_return', { precision: 15, scale: 0 }),
  revenueCombine: numeric('revenue_combine', { precision: 15, scale: 0 }),
  twoPointDeliveryBonus: numeric('two_point_delivery_bonus', { precision: 15, scale: 0 }),
  vehicleShiftAllowance: numeric('vehicle_shift_allowance', { precision: 15, scale: 0 }),
  grossProfit: numeric('gross_profit', { precision: 15, scale: 0 }),
  revenueOriginal: numeric('revenue_original', { precision: 15, scale: 0 }),
  revenueOverriddenBy: integer('revenue_overridden_by'),
  revenueOverriddenAt: timestamp('revenue_overridden_at'),
  revenueOverrideReason: text('revenue_override_reason'),
  pricingSource: pricingSourceEnum('pricing_source'),
  pricingFormula: text('pricing_formula'),
  pricingSnapshot: jsonb('pricing_snapshot').$type<Record<string, unknown>>(),
  customerCommission: numeric('customer_commission', { precision: 15, scale: 0 }),
  tripWageDays: integer('trip_wage_days'),
  fuelSupplierId: integer('fuel_supplier_id'),
  vatRate: numeric('vat_rate', { precision: 5, scale: 3 }).notNull(),
  arCostHash: varchar('ar_cost_hash', { length: 64 }),
  arSnapshotDirty: boolean('ar_snapshot_dirty').notNull(),
  arSnapshotChangedAt: timestamp('ar_snapshot_changed_at', { withTimezone: true }),
  apCostHash: varchar('ap_cost_hash', { length: 64 }),
  apSnapshotDirty: boolean('ap_snapshot_dirty').notNull(),
  apSnapshotChangedAt: timestamp('ap_snapshot_changed_at', { withTimezone: true }),
  pnlSnapshotGrossProfit: numeric('pnl_snapshot_gross_profit', { precision: 15, scale: 0 }),
  // ── external carrier (trip_carrier_info) ───────────────────────────────
  carrierType: varchar('carrier_type', { length: 20 }).notNull(),
  externalEntityId: integer('external_entity_id'),
  externalEntityType: varchar('external_entity_type', { length: 20 }),
  externalFreightCost: numeric('external_freight_cost', { precision: 15, scale: 0 }),
  externalPlateNumber: varchar('external_plate_number', { length: 20 }),
  externalCarrierVehicleId: integer('external_carrier_vehicle_id'),
  externalDriverName: varchar('external_driver_name', { length: 100 }),
  externalDriverPhone: varchar('external_driver_phone', { length: 20 }),
}).as(sql`
  select
    trips.id, trips.trip_code, trips.version, trips.created_by, trips.customer_id,
    trips.customer_reference, trips.truck_id, trips.driver_id, trips.route_id,
    trips.trailer_id, trips.trailer_type, trips.cargo_type_id, trips.container_count,
    trips.status, trips.departure_date, trips.planned_start_at, trips.planned_end_at,
    trips.canonical_origin, trips.canonical_destination, trips.cargo_weight_kg,
    trips.vehicle_capacity_kg, trips.active_trip_pair_id, trips.active_trip_pair_order,
    trips.fuel_mode, trips.fuel_liters_override, trips.fuel_supplement_liters,
    trips.fuel_supplement_reason, trips.tolls_discount, trips.tolls_addition,
    trips.tolls_stations, trips.has_return_cargo, trips.notes, trips.cost_submission_note,
    trips.shipment_id, trips.fulfillment_id, trips.source_shipment_version,
    trips.completed_at, trips.pod_recovered_at, trips.pod_recovered_by,
    trips.paper_order_collected_at, trips.paper_order_collected_by,
    trips.instruction_contact_name, trips.instruction_contact_phone,
    trips.instruction_notes, trips.created_at, trips.updated_at, trips.deleted_at,
    trip_financial_state.driver_salary, trip_financial_state.fuel_price_applied,
    trip_financial_state.fuel_actual_unit_price, trip_financial_state.road_allowance_base_applied,
    trip_financial_state.fuel_loaded_norm_applied, trip_financial_state.fuel_empty_norm_applied,
    trip_financial_state.fuel_fixed_allowance_applied, trip_financial_state.fuel_supplement_norm_applied,
    trip_financial_state.toll_per_station_applied, trip_financial_state.return_cargo_bonus_applied,
    trip_financial_state.fuel_liters, trip_financial_state.total_fuel_cost,
    trip_financial_state.fuel_surcharge_amount, trip_financial_state.fuel_surcharge_snapshot,
    trip_financial_state.fuel_surcharge_snapshot_dirty, trip_financial_state.total_road_allowance,
    trip_financial_state.toll_cost, trip_financial_state.toll_deduction,
    trip_financial_state.road_allowance_override, trip_financial_state.total_cost,
    trip_financial_state.revenue, trip_financial_state.revenue_empty_return,
    trip_financial_state.revenue_combine, trip_financial_state.two_point_delivery_bonus,
    trip_financial_state.vehicle_shift_allowance, trip_financial_state.gross_profit,
    trip_financial_state.revenue_original, trip_financial_state.revenue_overridden_by,
    trip_financial_state.revenue_overridden_at, trip_financial_state.revenue_override_reason,
    trip_financial_state.pricing_source, trip_financial_state.pricing_formula,
    trip_financial_state.pricing_snapshot, trip_financial_state.customer_commission,
    trip_financial_state.trip_wage_days, trip_financial_state.fuel_supplier_id,
    trip_financial_state.vat_rate, trip_financial_state.ar_cost_hash,
    trip_financial_state.ar_snapshot_dirty, trip_financial_state.ar_snapshot_changed_at,
    trip_financial_state.ap_cost_hash, trip_financial_state.ap_snapshot_dirty,
    trip_financial_state.ap_snapshot_changed_at, trip_financial_state.pnl_snapshot_gross_profit,
    trip_carrier_info.carrier_type, trip_carrier_info.external_entity_id,
    trip_carrier_info.external_entity_type, trip_carrier_info.external_freight_cost,
    trip_carrier_info.external_plate_number, trip_carrier_info.external_carrier_vehicle_id,
    trip_carrier_info.external_driver_name, trip_carrier_info.external_driver_phone
  from trips
  left join trip_financial_state on trip_financial_state.trip_id = trips.id
  left join trip_carrier_info on trip_carrier_info.trip_id = trips.id
`);

export const tripPairs = pgTable('trip_pairs', {
  id: serial('id').primaryKey(),
  status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
  // KẸP = 2×20' cont on one mooc running simultaneously; KET_HOP = same
  // container shell reused across two back-to-back orders. Pairs created
  // before the 2026-09-06 spec split are all sequential ⇒ KET_HOP (default).
  pairKind: varchar('pair_kind', { length: 20 }).notNull().default('KET_HOP'),
  firstTripId: integer('first_trip_id').notNull(),
  secondTripId: integer('second_trip_id').notNull(),
  emptyDistanceKm: numeric('empty_distance_km', { precision: 10, scale: 2 }),
  combinedEfficiencyPercent: numeric('combined_efficiency_percent', { precision: 6, scale: 2 }),
  requiredGapMinutes: integer('required_gap_minutes'),
  actualGapMinutes: integer('actual_gap_minutes'),
  // Pair salary rule (lương cặp = cuốc cơ bản + phụ phí): the second trip's
  // pre-pair driverSalary snapshot. Stashed on pairing so breaking the pair
  // restores the exact standard per-trip wage, not a recomputed approximation.
  secondSalaryStash: numeric('second_salary_stash', { precision: 15, scale: 0 }),
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
