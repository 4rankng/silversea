// Extracted verbatim from the original schema.ts split; behavior identical.
// Regenerate via drizzle-kit against the barrel: db/schema/index.ts.

import {
  boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { customerStatusEnum, driverStatusEnum, masterImportRowClassificationEnum, masterImportStatusEnum, operationalSiteTypeEnum, trailerStatusEnum, trailerTypeEnum, truckStatusEnum } from './_enums';
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
  // Spec-sheet fields from the customer's tractor master-data sheet.
  vehicleClass: varchar('vehicle_class', { length: 100 }),
  brand: varchar('brand', { length: 100 }),
  towCapacityTons: numeric('tow_capacity_tons', { precision: 6, scale: 1 }),
  fuelLPer100kmLoaded: numeric('fuel_l_per_100km_loaded', { precision: 6, scale: 2 }),
  fuelLPer100kmEmpty: numeric('fuel_l_per_100km_empty', { precision: 6, scale: 2 }),
  preferredRoute: varchar('preferred_route', { length: 255 }),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const trailers = pgTable('trailers', {
  id: serial('id').primaryKey(),
  licensePlate: varchar('license_plate', { length: 20 }).notNull().unique(),
  // Nullable: the customer's fleet sheet usually leaves Loại Moóc blank.
  type: trailerTypeEnum('type'),
  maxPayloadTons: numeric('max_payload_tons', { precision: 6, scale: 1 }),
  maxAxleLoadFrontTons: numeric('max_axle_load_front_tons', { precision: 6, scale: 1 }),
  maxAxleLoadRearTons: numeric('max_axle_load_rear_tons', { precision: 6, scale: 1 }),
  inspectionDeadline: date('inspection_deadline'),
  note: text('note'),
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
  // HR identity + payout fields from the customer's driver master-data sheet.
  code: varchar('code', { length: 50 }),
  idNumber: varchar('id_number', { length: 20 }),
  licenseNumber: varchar('license_number', { length: 20 }),
  licenseExpiryDate: date('license_expiry_date'),
  bankName: varchar('bank_name', { length: 160 }),
  bankAccount: varchar('bank_account', { length: 80 }),
  salaryType: varchar('salary_type', { length: 50 }),
  status: driverStatusEnum('status').default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('drivers_active_user_uniq_idx')
    .on(table.userId)
    .where(sql`${table.userId} is not null and ${table.deletedAt} is null`),
]);


// Driver<->truck pairing as a versioned, DB-constrained assignment instead of
// the legacy drivers.assignedTruckId convention pointer. Exactly one active
// PRIMARY row per truck (partial unique index below) is the 1:1 invariant
// today; relaxing to multiple concurrent drivers per truck later (co-driver,
// shifts) is a constraint-scope change, not a new table.
export const truckDriverAssignments = pgTable('truck_driver_assignments', {
  id: serial('id').primaryKey(),
  truckId: integer('truck_id').notNull(),
  driverId: integer('driver_id').notNull(),
  role: varchar('role', { length: 20 }).default('PRIMARY').notNull(),
  startsAt: timestamp('starts_at').defaultNow().notNull(),
  endsAt: timestamp('ends_at'),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('truck_driver_assignments_active_primary_per_truck')
    .on(table.truckId)
    .where(sql`${table.endsAt} is null and ${table.role} = 'PRIMARY'`),
  // The driver axis of the 1:1 invariant: a driver has exactly one active
  // PRIMARY truck (matching the legacy single-value column's semantics).
  // Both indexes drop/re-scope together when cardinality relaxes.
  uniqueIndex('truck_driver_assignments_active_primary_per_driver')
    .on(table.driverId)
    .where(sql`${table.endsAt} is null and ${table.role} = 'PRIMARY'`),
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
  shortName: varchar('short_name', { length: 255 }).notNull().default(''),
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
  shortName: varchar('short_name', { length: 255 }).notNull().default(''),
  taxCode: varchar('tax_code', { length: 20 }),
  partnerId: integer('partner_id'),
  contactPerson: varchar('contact_person', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  contactInfo: text('contact_info'),
  // Customer master-data sheet: the accountant contact is a separate person
  // from the director (contactPerson/phone above).
  accountantName: varchar('accountant_name', { length: 255 }),
  accountantPhone: varchar('accountant_phone', { length: 20 }),
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
  // Intake provenance: CUS/Dispatcher inline creates stamp the creating actor
  // (`created_by`) for audit. NULL = admin/seed/legacy rows. Staff roles are
  // not customer-scoped, so this stamp has no visibility effect.
  createdBy: integer('created_by'),
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

export const routes = pgTable('routes', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 255 }).notNull().default(''),
  // Business code from the customer's route sheet (Mã Tuyến) — distinct from
  // the surrogate id; not enforced unique since legacy rows predate the sheet.
  code: varchar('code', { length: 80 }),
  // Full load/unload point address (Điểm đóng/trả), as free text.
  loadPoint: text('load_point'),
  note: text('note'),
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


// Port-cluster taxonomy lives in the DB (not code constants): adding a
// cluster is a seed row + port classification, no deploy. Codes are stable
// cross-environment keys; labels are operator-facing.
export const dispatchZones = pgTable('dispatch_zones', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 32 }).notNull().unique(),
  label: varchar('label', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ports = pgTable('ports', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),   // e.g. "Cảng Hải Phòng"
  shortName: varchar('short_name', { length: 255 }).notNull().default(''),
  code: varchar('code', { length: 20 }).unique(),     // e.g. "HPH"
  address: text('address'),
  city: varchar('city', { length: 100 }).default('Hải Phòng'),
  notes: text('notes'),
  // Dispatch zone code — validated against dispatch_zones at the boundary;
  // plain varchar, no FK (repo rule).
  dispatchZone: varchar('dispatch_zone', { length: 32 }),
  // Fields from the customer's port/yard master-data sheet (Cảng & Bãi).
  classification: varchar('classification', { length: 20 }), // Cảng | Bãi
  legalEntity: varchar('legal_entity', { length: 255 }), // Pháp nhân
  isLachHuyen: boolean('is_lach_huyen').default(false).notNull(), // Thuộc Lạch Huyện
  opsPortalUrl: text('ops_portal_url'), // Web tác nghiệp
  position: varchar('position', { length: 255 }), // Vị trí
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



// Customer-owned factories and pickup warehouses. The database row is the
// live master; issued fulfillments snapshot the operational fields that must
// not drift when an administrator later updates this record.
export const operationalSites = pgTable('operational_sites', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  code: varchar('code', { length: 80 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 255 }).notNull().default(''),
  siteType: operationalSiteTypeEnum('site_type').notNull(),
  // A FACTORY has one canonical FCL route. Warehouses intentionally leave this
  // null because LCL routing remains shipment-level.
  routeId: integer('route_id'),
  address: text('address').notNull(),
  googleMapsUrl: text('google_maps_url'),
  contactName: varchar('contact_name', { length: 120 }),
  contactPhone: varchar('contact_phone', { length: 30 }),
  // Free-text warehouse contact block from the sheet (Thông tin liên hệ kho) —
  // often multiple names/phones in one cell, distinct from the single
  // contactName/contactPhone pair above.
  warehouseContactInfo: text('warehouse_contact_info'),
  // Operational lift/drop/cleaning coordination info (Thông tin nâng/hạ/vệ
  // sinh) — distinct from the lift/drop/cleaning INVOICE fields below.
  liftInfo: text('lift_info'),
  dropInfo: text('drop_info'),
  cleaningInfo: text('cleaning_info'),
  liftFeeInvoiceName: varchar('lift_fee_invoice_name', { length: 255 }),
  liftFeeInvoiceAddress: text('lift_fee_invoice_address'),
  liftFeeTaxCode: varchar('lift_fee_tax_code', { length: 40 }),
  // Driver-app spec (260827): same invoicing pattern as lift fee, for the
  // drop-fee and cleaning-fee invoices shown in the driver's Block 4.
  dropFeeInvoiceName: varchar('drop_fee_invoice_name', { length: 255 }),
  dropFeeInvoiceAddress: text('drop_fee_invoice_address'),
  dropFeeTaxCode: varchar('drop_fee_tax_code', { length: 40 }),
  cleaningInvoiceName: varchar('cleaning_invoice_name', { length: 255 }),
  cleaningInvoiceAddress: text('cleaning_invoice_address'),
  cleaningTaxCode: varchar('cleaning_tax_code', { length: 40 }),
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
  index('operational_sites_route_idx').on(table.routeId),
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
