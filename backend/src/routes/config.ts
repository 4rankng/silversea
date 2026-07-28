import { Router } from 'express';
import { db } from '../db';
import * as s from '../db/schema';
import { COMPANY_INFO_SETTING_KEYS, companyInfoFromSettings } from '../services/company-info.service';
import { and, eq, like, ne, sql } from 'drizzle-orm';
// auth + Casbin applied at mount point in index.ts
import {
  customerSchema, customerUpdateSchema, truckSchema, trailerSchema, routeSchema,
  cargoTypeSchema, roadAllowanceSchema,
  fuelConfigSchema, penaltyReasonSchema, driverSchema,
  managementFeeSchema, capTableSchema, truckCapSchema,
  salaryPeriodSchema, salaryPeriodDefaultSchema,
  supplierSchema, expenseCategorySchema,
  containerTypeSchema, sealTypeSchema, portSchema,
  forwarderExpenseTypeSchema,
  companyInfoSchema,
  tireSchema, installTireSchema, disposeTireSchema, transferTireSchema, tirePositionSchema,
  fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema,
  businessCalendarDaySchema,
  governanceActionVersionSchema,
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_POLICY_DEFAULTS,
} from '@tingting/shared';
import type { Request, Response } from 'express';
import type { output } from 'zod';
import { createCrudRouter } from './utils/crud-factory';
import pricingTablesGovernedRouter from './config/pricing-tables-governed.routes';
import debitNoteTemplatesRouter from './config/debit-note-templates.routes';
import { ApiError } from '../errors';
import { getBootstrapData, getPricing, getFuelConfig, upsertFuelConfig, getFuelPriceHistory, getEffectiveFuelPrice, syncTrailerFields, validateCustomerUniqueness } from '../services/config.service';
import { cacheInvalidatePattern } from '../lib/redis';
import { Role } from '@tingting/shared';
import { requireRoles } from '../middleware/casbin';
import { installTire, removeTire, disposeTire, transferTire, isHttpError, assertTireSerialAvailable } from '../services/tire.service';
import {
  getSalaryPeriodDefault,
  updateSalaryPeriodDefault,
  getSalaryPeriodOverrides,
  upsertSalaryPeriodOverride,
  updateSalaryPeriodOverrideById,
  deleteSalaryPeriodOverride,
  resolveSalaryPeriodDateRange,
} from '../services/salary-period.service';
import {
  approveSalaryPeriodClose,
  approveSalaryPeriodReopen,
  checkSalaryPeriodClose,
  checkSalaryPeriodReopen,
  getSalaryPeriodClose,
  listSalaryPeriodCloses,
  getSalaryPeriodReadiness,
  listSalaryPeriodExclusions,
  createSalaryPeriodExclusion,
  checkSalaryPeriodExclusion,
  approveSalaryPeriodExclusion,
  completeSalaryPeriodExclusionFollowup,
  requestSalaryPeriodClose,
  requestSalaryPeriodReopen,
} from '../services/salary-period-close.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { parsePagination } from './utils/pagination';
import { queryAuditLogs } from '../services/audit-query.service';
import { getPenaltyStats } from '../services/reporting.service';
import { normalizeSupplierTypeSelection } from '../services/supplier-types.service';
import { normalizeTaxCode } from '../services/legal-partner.service';

type SupplierPayload = output<typeof supplierSchema>;
type ForwarderExpenseTypePayload = output<typeof forwarderExpenseTypeSchema>;
type NoInvoiceEvidenceType = typeof DEFAULT_NO_INVOICE_EVIDENCE_TYPES[number];
type CrudTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function displayTaxCode(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, '');
}

async function upsertPartnerInTransaction(
  tx: CrudTx,
  taxCode: string | null | undefined,
): Promise<number | null> {
  const normalizedTaxCode = normalizeTaxCode(taxCode);
  if (!normalizedTaxCode) return null;
  const [partner] = await tx.insert(s.partners)
    .values({
      normalizedTaxCode,
      displayTaxCode: displayTaxCode(taxCode),
      currency: 'VND',
    })
    .onConflictDoUpdate({
      target: s.partners.normalizedTaxCode,
      set: {
        displayTaxCode: displayTaxCode(taxCode),
        updatedAt: new Date(),
      },
    })
    .returning({ id: s.partners.id });
  return partner.id;
}

async function syncCustomerRelationsHook(
  tx: CrudTx,
  customer: { id: number; taxCode: string | null },
  data: { linkedSupplierId?: number | null },
): Promise<void> {
  if ('linkedSupplierId' in data) {
    const staleCondition = data.linkedSupplierId == null
      ? eq(s.suppliers.linkedCustomerId, customer.id)
      : and(
        eq(s.suppliers.linkedCustomerId, customer.id),
        ne(s.suppliers.id, data.linkedSupplierId),
      );
    await tx.update(s.suppliers)
      .set({ linkedCustomerId: null, updatedAt: new Date() })
      .where(staleCondition);
    if (data.linkedSupplierId != null) {
      await tx.update(s.suppliers)
        .set({ linkedCustomerId: customer.id, updatedAt: new Date() })
        .where(eq(s.suppliers.id, data.linkedSupplierId));
    }
  }
  const partnerId = await upsertPartnerInTransaction(tx, customer.taxCode);
  await tx.update(s.customers)
    .set({ partnerId, updatedAt: new Date() })
    .where(eq(s.customers.id, customer.id));
}

async function syncSupplierRelationsHook(
  tx: CrudTx,
  supplier: { id: number; taxCode: string | null },
  data: { linkedCustomerId?: number | null },
): Promise<void> {
  if ('linkedCustomerId' in data) {
    const staleCondition = data.linkedCustomerId == null
      ? eq(s.customers.linkedSupplierId, supplier.id)
      : and(
        eq(s.customers.linkedSupplierId, supplier.id),
        ne(s.customers.id, data.linkedCustomerId),
      );
    await tx.update(s.customers)
      .set({ linkedSupplierId: null, updatedAt: new Date() })
      .where(staleCondition);
    if (data.linkedCustomerId != null) {
      await tx.update(s.customers)
        .set({ linkedSupplierId: supplier.id, updatedAt: new Date() })
        .where(eq(s.customers.id, data.linkedCustomerId));
    }
  }
  const partnerId = await upsertPartnerInTransaction(tx, supplier.taxCode);
  await tx.update(s.suppliers)
    .set({ partnerId, updatedAt: new Date() })
    .where(eq(s.suppliers.id, supplier.id));
}

/**
 * Wave 3 M6.2 — afterCreate/afterUpdate hook for suppliers. Normalizes
 * the raw `types` input from the form (which can be lowercase, duped,
 * or contain invalid strings) into the canonical sorted array, persists
 * it, and mirrors `isFuelSupplier` from the FUEL membership so legacy
 * boolean readers see consistent state. Runs after the linked-customer
 * mirror hook.
 */
async function syncSupplierTypesHook(
  tx: CrudTx,
  item: { id: number },
  data: { types?: unknown; primaryType?: unknown },
): Promise<void> {
  // No `types` key in the payload → leave the column untouched (caller
  // is updating some other field).
  if (data == null || (!('types' in data) && !('primaryType' in data))) return;
  const normalized = normalizeSupplierTypeSelection(data);
  await tx.update(s.suppliers)
    .set({
      types: normalized.types,
      primaryType: normalized.primaryType,
      isFuelSupplier: normalized.isFuelSupplier,
      updatedAt: new Date(),
    })
    .where(eq(s.suppliers.id, item.id));
}

async function normalizeSupplierPayload(
  data: Partial<SupplierPayload>,
  supplierId?: number,
): Promise<Partial<SupplierPayload>> {
  if (!('types' in data) && !('primaryType' in data)) return data;
  let sourceTypes: SupplierPayload['types'] | undefined = data.types;
  if (sourceTypes === undefined && supplierId != null) {
    const [current] = await db.select({ types: s.suppliers.types })
      .from(s.suppliers)
      .where(eq(s.suppliers.id, supplierId))
      .limit(1);
    sourceTypes = current?.types;
  }
  const requestedPrimary = typeof data.primaryType === 'string'
    ? data.primaryType.trim().toUpperCase()
    : '';
  const normalized = normalizeSupplierTypeSelection({
    types: sourceTypes,
    primaryType: data.primaryType,
  });
  if (requestedPrimary && normalized.primaryType == null) {
    throw new ApiError(400, 'Nhóm chính phải thuộc danh sách nhóm dịch vụ đã chọn');
  }
  return {
    ...data,
    ...(sourceTypes !== undefined ? { types: normalized.types } : {}),
    primaryType: normalized.primaryType,
    isFuelSupplier: normalized.isFuelSupplier,
  };
}

function normalizeForwarderExpenseTypePayload(
  data: Partial<ForwarderExpenseTypePayload>,
): Partial<ForwarderExpenseTypePayload> {
  const requiresInvoice = data.requiresInvoice === true;
  const substituteEvidenceAllowed = requiresInvoice ? false : data.substituteEvidenceAllowed !== false;
  const noInvoiceEvidenceTypes: NoInvoiceEvidenceType[] = substituteEvidenceAllowed
    ? Array.from(new Set<NoInvoiceEvidenceType>(
      Array.isArray(data.noInvoiceEvidenceTypes)
        ? data.noInvoiceEvidenceTypes
        : DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
    ))
    : [];
  return {
    ...data,
    requiresInvoice,
    substituteEvidenceAllowed,
    noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: data.noInvoicePerItemLimit ?? NO_INVOICE_POLICY_DEFAULTS.perItemLimit,
    noInvoicePerDayLimit: data.noInvoicePerDayLimit ?? NO_INVOICE_POLICY_DEFAULTS.perDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: data.noInvoiceFinanceLeadItemApprovalLimit ?? NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: data.noInvoiceDirectorDayApprovalLimit ?? NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit,
  };
}

async function withForwarderExpenseTypePolicyVersion(
  id: number | null,
  data: Partial<ForwarderExpenseTypePayload>,
): Promise<Partial<ForwarderExpenseTypePayload>> {
  const normalized = normalizeForwarderExpenseTypePayload(data);
  if (id == null) {
    return { ...normalized, noInvoicePolicyVersion: 1 };
  }
  const [existing] = await db.select({
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: s.forwarderExpenseTypes.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: s.forwarderExpenseTypes.noInvoicePerItemLimit,
    noInvoicePerDayLimit: s.forwarderExpenseTypes.noInvoicePerDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: s.forwarderExpenseTypes.noInvoiceFinanceLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: s.forwarderExpenseTypes.noInvoiceDirectorDayApprovalLimit,
    noInvoicePolicyVersion: s.forwarderExpenseTypes.noInvoicePolicyVersion,
  }).from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.id, id))
    .limit(1);
  if (!existing) return normalized;
  const policyChanged = JSON.stringify({
    requiresInvoice: existing.requiresInvoice,
    substituteEvidenceAllowed: existing.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: existing.noInvoiceEvidenceTypes ?? [],
    noInvoicePerItemLimit: String(existing.noInvoicePerItemLimit),
    noInvoicePerDayLimit: String(existing.noInvoicePerDayLimit),
    noInvoiceFinanceLeadItemApprovalLimit: String(existing.noInvoiceFinanceLeadItemApprovalLimit),
    noInvoiceDirectorDayApprovalLimit: String(existing.noInvoiceDirectorDayApprovalLimit),
  }) !== JSON.stringify({
    requiresInvoice: normalized.requiresInvoice,
    substituteEvidenceAllowed: normalized.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: normalized.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: String(normalized.noInvoicePerItemLimit),
    noInvoicePerDayLimit: String(normalized.noInvoicePerDayLimit),
    noInvoiceFinanceLeadItemApprovalLimit: String(normalized.noInvoiceFinanceLeadItemApprovalLimit),
    noInvoiceDirectorDayApprovalLimit: String(normalized.noInvoiceDirectorDayApprovalLimit),
  });
  return policyChanged
    ? { ...normalized, noInvoicePolicyVersion: existing.noInvoicePolicyVersion + 1 }
    : normalized;
}

const router = Router();

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function portalBootstrap(data: Awaited<ReturnType<typeof getBootstrapData>>) {
  return {
    ...data,
    customers: [],
    trucks: [],
    drivers: [],
    routes: [],
    cargoTypes: [],
    expenseCategories: [],
    suppliers: [],
    trailers: [],
  };
}

export const catalogBootstrapRouter = Router();

catalogBootstrapRouter.get('/catalogs/bootstrap', asyncHandler(async (req: Request, res: Response) => {
  const data = await getBootstrapData();
  const role = getUser(req).role;
  if (role === Role.DRIVER || role === Role.FORWARDER) {
    return res.json(portalBootstrap(data));
  }
  res.json(data);
}));

// ─── Pricing lookup ──────────────────────────────────────────────────────────

router.get('/pricing', asyncHandler(async (req: Request, res: Response) => {
  const customerId = parseInt(req.query.customerId as string, 10);
  const routeId = parseInt(req.query.routeId as string, 10);
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

  if (isNaN(customerId) || isNaN(routeId)) {
    return res.status(400).json({ error: 'customerId và routeId là bắt buộc' });
  }

  const pricing = await getPricing(customerId, routeId, date);
  // Preserve the legacy {price: number} shape for HTTP callers; null (no row)
  // surfaces as 0 here. Only the in-process agent tool sees null (so it can
  // distinguish "no pricing table" from a real 0-VND price).
  res.json({ price: pricing.price ?? 0 });
}));

// ─── CRUD routes ─────────────────────────────────────────────────────────────

router.use('/customers', createCrudRouter(s.customers, customerSchema, {
  searchableField: 'name',
  updateSchema: customerUpdateSchema,
  beforeCreate: async (data) => {
    await validateCustomerUniqueness(data);
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if ((data as Record<string, unknown>).debitNoteMode === 'PER_BATCH') {
      const [current] = await tx.select({ debitNoteMode: s.customers.debitNoteMode })
        .from(s.customers)
        .where(eq(s.customers.id, id))
        .limit(1);
      if (current?.debitNoteMode !== 'PER_BATCH') {
        throw new ApiError(400, 'PER_BATCH chỉ được giữ nguyên cho dữ liệu lịch sử');
      }
    }
    await validateCustomerUniqueness(data, id);
    return data;
  },
  afterCreate: async (item, data, _req, tx) => {
    await syncCustomerRelationsHook(tx, item, data);
  },
  afterUpdate: async (item, data, _req, tx) => {
    await syncCustomerRelationsHook(tx, item, data);
  },
}));
router.use(
  '/business-calendar',
  requireRoles(Role.ADMIN),
  createCrudRouter(s.businessCalendarDays, businessCalendarDaySchema, {
    searchableField: 'name',
    deleteMode: 'hard',
    maxLimit: 500,
    orderByField: 'calendarDate',
  }),
);
router.use('/trucks', createCrudRouter(s.trucks, truckSchema, {
  searchableField: 'licensePlate',
  beforeCreate: async (data, _req) => {
    return syncTrailerFields(data);
  },
  beforeUpdate: async (_id, data, _req) => {
    if (data.currentTrailerId !== undefined) {
      return syncTrailerFields(data);
    }
    return data;
  },
}));
router.use('/trailers', createCrudRouter(s.trailers, trailerSchema, { searchableField: 'licensePlate' }));
router.use('/routes', createCrudRouter(s.routes, routeSchema, { searchableField: 'name' }));
router.use('/cargo-types', createCrudRouter(s.cargoTypes, cargoTypeSchema));
router.use('/container-types', createCrudRouter(s.containerTypes, containerTypeSchema, { searchableField: 'name' }));
router.use('/seal-types', createCrudRouter(s.sealTypes, sealTypeSchema, { searchableField: 'name' }));
router.use('/ports', createCrudRouter(s.ports, portSchema, { searchableField: 'name' }));
router.use('/forwarder-expense-types', createCrudRouter(s.forwarderExpenseTypes, forwarderExpenseTypeSchema, {
  searchableField: 'name',
  beforeCreate: async (data) => withForwarderExpenseTypePolicyVersion(null, data),
  beforeUpdate: async (id, data) => withForwarderExpenseTypePolicyVersion(id, data),
}));
router.use('/pricing-tables', pricingTablesGovernedRouter);
router.use('/road-allowances', createCrudRouter(s.roadAllowances, roadAllowanceSchema));

// Wave 1: pricing & fuel catalog CRUD routes. All behind the existing
// config RBAC (office staff: ADMIN/MANAGER/ACCOUNTANT).
router.use('/fuel-norms', createCrudRouter(s.fuelNorms, fuelNormSchema));
router.use('/weight-pricing-tiers', createCrudRouter(s.weightPricingTiers, weightPricingTierSchema));
router.use('/lift-pricing', createCrudRouter(s.liftPricing, liftPricingSchema));
// M2.5: ancillary revenue with refund validation. Refunds (negative amounts)
// require a non-empty note. The createCrudRouter doesn't support superRefine
// (its type expects AnyZodObject), so we validate the refund rule as a
// beforeCreate/beforeUpdate hook that throws ApiError when the rule is violated.
const ancillaryRevenueRouter = createCrudRouter(s.ancillaryRevenue, ancillaryRevenueSchema, {
  beforeCreate: (data) => {
    if (Number(data.amount) < 0 && (!data.note || !String(data.note).trim())) {
      throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc khi số tiền âm');
    }
    return data;
  },
  beforeUpdate: (_id, data) => {
    if (data.amount !== undefined && Number(data.amount) < 0 && (!data.note || !String(data.note).trim())) {
      throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc khi số tiền âm');
    }
    return data;
  },
});
router.use('/ancillary-revenue', ancillaryRevenueRouter);

router.get('/penalty-reasons/stats', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPenaltyStats());
}));
router.use('/penalty-reasons', createCrudRouter(s.penaltyReasons, penaltyReasonSchema));
router.use('/management-fees', createCrudRouter(s.managementFees, managementFeeSchema, {
  afterCreate: async () => { cacheInvalidatePattern('reports:pnl:*'); },
  afterUpdate: async () => { cacheInvalidatePattern('reports:pnl:*'); },
  afterDelete: async () => { cacheInvalidatePattern('reports:pnl:*'); },
}));
// Cap-table is amount-based: percentages are derived as
// contribution_amount / sum(contribution_amount) per snapshot, so totals are
// always 100% by construction and there's no separate over-allocation check.
router.use('/cap-table', createCrudRouter(s.capTableHistory, capTableSchema));
// F3 — per-vehicle cap table. Same CRUD pattern; clients filter by truckId via
// the `search`-style list query (the factory's GET passes through query
// params, and the per-truck editor fetches `/config/truck-cap?truckId=X`).
router.use('/truck-cap', createCrudRouter(s.truckCapTable, truckCapSchema));
router.use('/suppliers', createCrudRouter(s.suppliers, supplierSchema, {
  searchableField: 'name',
  beforeCreate: (data) => normalizeSupplierPayload(data),
  beforeUpdate: async (id, data) => normalizeSupplierPayload(data, id),
  afterCreate: async (item, data, _req, tx) => {
    await syncSupplierRelationsHook(tx, item, data);
    await syncSupplierTypesHook(tx, item, data);
  },
  afterUpdate: async (item, data, _req, tx) => {
    await syncSupplierRelationsHook(tx, item, data);
    await syncSupplierTypesHook(tx, item, data);
  },
}));
router.use('/expense-categories', createCrudRouter(s.expenseCategories, expenseCategorySchema, { searchableField: 'name' }));
// Debit-note templates — dedicated transactional router (NOT crud-factory) so the
// single-default invariant is enforced atomically. See the route file's header.
router.use('/debit-note-templates', debitNoteTemplatesRouter);
router.use('/tire-positions', createCrudRouter(s.tirePositions, tirePositionSchema, { searchableField: 'name' }));

// Drivers — special handling (includes user_id, no delete per spec §4.2)
router.use('/drivers', createCrudRouter(s.drivers, driverSchema, {
  searchableField: 'name',
  disableDelete: true,
}));

// ─── N1 — Tires ────────────────────────────────────────────────────────────
// Generic CRUD for the catalog (list/create/update/delete). The lifecycle
// transitions (install/remove) are dedicated endpoints below because they touch
// multiple fields atomically and validate the target truck exists.
router.use('/fleet/tires', createCrudRouter(s.tires, tireSchema, {
  searchableField: 'serial',
  maxLimit: 2000,
  deleteMode: 'hard',
  // A tire mounts on a truck OR a trailer — never both. installTireSchema
  // already enforces this on the lifecycle endpoint; mirror it on generic CRUD
  // create/update so a row can't be saved mounted on two vehicles at once.
  beforeCreate: async (data) => {
    if (data.truckId && data.trailerId) {
      throw new ApiError(400, 'Lốp chỉ lắp trên xe đầu kéo hoặc rơ-moóc, không cả hai');
    }
    await assertTireSerialAvailable(data.serial);
    return data;
  },
  beforeUpdate: async (id, data) => {
    if (data.truckId && data.trailerId) {
      throw new ApiError(400, 'Lốp chỉ lắp trên xe đầu kéo hoặc rơ-moóc, không cả hai');
    }
    await assertTireSerialAvailable(data.serial, id);
    return data;
  },
}));

// Lifecycle endpoints — MANAGER/ACCOUNTANT/ADMIN only (writes). The mount-level
// config Casbin gate already restricts broadly; requireRoles tightens write actions.
export const tireLifecycleRouter = Router();
tireLifecycleRouter.post('/:id/install', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = installTireSchema.parse(req.body);
  try {
    const tire = await installTire(id, {
      truckId: data.truckId ?? null,
      trailerId: data.trailerId ?? null,
      position: data.position ?? null,
    });
    await cacheInvalidatePattern('catalogs:*');
    res.json(tire);
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/remove', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  try {
    const tire = await removeTire(id);
    await cacheInvalidatePattern('catalogs:*');
    res.json(tire);
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/dispose', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = disposeTireSchema.parse(req.body);
  try {
    const tire = await disposeTire(id, { reason: data.reason });
    await cacheInvalidatePattern('catalogs:*');
    res.json(tire);
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/transfer', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = transferTireSchema.parse(req.body);
  try {
    const tire = await transferTire(id, {
      truckId: data.truckId ?? null,
      trailerId: data.trailerId ?? null,
      position: data.position ?? null,
    });
    await cacheInvalidatePattern('catalogs:*');
    res.json(tire);
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));
// Road config — singleton GET/PUT
router.get('/road-config', asyncHandler(async (_req: Request, res: Response) => {
  const [row] = await db.select().from(s.roadConfig).limit(1);
  if (!row) return res.json(null);
  res.json(row);
}));

router.put('/road-config', asyncHandler(async (req: Request, res: Response) => {
  const { tollPerStation, returnCargoBonus, defaultDriverSalary, twoPointDeliveryBonus, vehicleShiftDefault } = req.body as {
    tollPerStation: string; returnCargoBonus: string;
    defaultDriverSalary?: string; twoPointDeliveryBonus?: string; vehicleShiftDefault?: string;
  };
  const [existing] = await db.select().from(s.roadConfig).limit(1);
  if (existing) {
    const [updated] = await db.update(s.roadConfig)
      .set({ tollPerStation, returnCargoBonus, defaultDriverSalary, twoPointDeliveryBonus, vehicleShiftDefault, updatedAt: new Date() })
      .where(eq(s.roadConfig.id, existing.id))
      .returning();
    return res.json(updated);
  }
  const [created] = await db.insert(s.roadConfig).values({ tollPerStation, returnCargoBonus, defaultDriverSalary, twoPointDeliveryBonus, vehicleShiftDefault }).returning();
  res.status(201).json(created);
}));

// Fuel config — singleton GET/PUT
router.get('/fuel-config', asyncHandler(async (_req: Request, res: Response) => {
  const row = await getFuelConfig();
  if (!row) return res.json(null);
  res.json(row);
}));

router.put('/fuel-config', asyncHandler(async (req: Request, res: Response) => {
  const data = fuelConfigSchema.parse(req.body);
  const { result, status } = await upsertFuelConfig(data, getUser(req).userId);
  res.status(status).json(result);
}));

// Company info — singleton stored as app_settings key/value rows
router.get('/company-info', asyncHandler(async (_req: Request, res: Response) => {
  // Only the company.* rows are ever relevant; don't load unrelated app_settings.
  const rows = await db.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  res.json(companyInfoFromSettings(rows));
}));

router.put('/company-info', asyncHandler(async (req: Request, res: Response) => {
  const data = companyInfoSchema.parse(req.body);
  const now = new Date();
  // Single atomic multi-row upsert. The previous loop issued 7 serial
  // INSERT…ON CONFLICT statements with no transaction, so a mid-loop failure
  // (connection blip) left a half-updated profile; the trailing re-SELECT was
  // also redundant since the values are fully known from the validated input.
  // setting_value is NOT NULL, so a null logoStorageKey (admin removed the
  // logo) is stored as '' and coerced back to null on read.
  await db.insert(s.appSettings)
    .values(
      Object.entries(COMPANY_INFO_SETTING_KEYS).map(([field, key]) => ({
        key,
        value: (data[field as keyof typeof COMPANY_INFO_SETTING_KEYS] ?? '') as string,
      })),
    )
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: {
        value: sql`excluded.setting_value`,
        updatedAt: now,
      },
    });
  res.json({ ...data, logoStorageKey: data.logoStorageKey ?? null, updatedAt: now.toISOString() });
}));

// Fuel price history
router.get('/fuel-price-history', asyncHandler(async (_req: Request, res: Response) => {
  const history = await getFuelPriceHistory();
  res.json(history);
}));

router.get('/fuel-price-history/effective', asyncHandler(async (req: Request, res: Response) => {
  const dateStr = req.query.date as string;
  if (!dateStr) return res.status(400).json({ error: 'Tham số date là bắt buộc (YYYY-MM-DD)' });
  const price = await getEffectiveFuelPrice(new Date(dateStr));
  res.json({ price });
}));

// ─── Salary Period Config ──────────────────────────────────────────────────────
// Two routers:
// 1. salaryPeriodsRouter — public resolve endpoint, mounted with casbinAuthz('salary')
//    so DRIVER can resolve period date ranges.
// 2. salaryPeriodsAdminRouter — admin CRUD (defaults, overrides), mounted with
//    casbinAuthz('config') so only ADMIN/MANAGER/ACCOUNTANT can manage them.

export const salaryPeriodsRouter = Router();

salaryPeriodsRouter.get('/resolve', asyncHandler(async (req: Request, res: Response) => {
  const month = parseInt(req.query.month as string, 10);
  const year = parseInt(req.query.year as string, 10);
  if (!month || !year || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Tháng và năm là bắt buộc (month 1-12, year >= 2000)' });
  }
  res.json(await resolveSalaryPeriodDateRange(month, year));
}));

export const salaryPeriodsAdminRouter = Router();

salaryPeriodsAdminRouter.get('/default', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getSalaryPeriodDefault());
}));

salaryPeriodsAdminRouter.put('/default', asyncHandler(async (req: Request, res: Response) => {
  const data = salaryPeriodDefaultSchema.parse(req.body);
  res.json(await updateSalaryPeriodDefault(data.defaultStartDay, data.defaultEndDay));
}));

salaryPeriodsAdminRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const items = await getSalaryPeriodOverrides();
  res.json({ items, total: items.length });
}));

salaryPeriodsAdminRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = salaryPeriodSchema.parse(req.body);
  res.status(201).json(
    await upsertSalaryPeriodOverride(
      data.month, data.year, data.startDate, data.endDate, data.label,
    ),
  );
}));

salaryPeriodsAdminRouter.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = salaryPeriodSchema.parse(req.body);
  const result = await updateSalaryPeriodOverrideById(
    id, data.month, data.year, data.startDate, data.endDate, data.label,
  );
  if (!result) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json(result);
}));

salaryPeriodsAdminRouter.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const deleted = await deleteSalaryPeriodOverride(id);
  if (!deleted) return res.status(404).json({ error: 'Không tìm thấy' });
  res.json({ ok: true });
}));

// M7.3 — salary period close / reopen. Idempotent; close posts ONE
// consolidated summary ledger entry; reopen posts the reversing entry.
// Both mount under salaryPeriodsAdminRouter (already gated by
// casbinAuthz('config') so only ADMIN/MANAGER/ACCOUNTANT reach them).
// The service re-checks the role for the actual operation (reopen is
// ADMIN/MANAGER only — stricter than close).
salaryPeriodsAdminRouter.get('/closes', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listSalaryPeriodCloses());
}));

salaryPeriodsAdminRouter.get('/closes/:period', asyncHandler(async (req: Request, res: Response) => {
  const row = await getSalaryPeriodClose(req.params.period as string);
  if (!row) return res.status(404).json({ error: 'Kỳ này chưa chốt' });
  res.json(row);
}));

salaryPeriodsAdminRouter.get('/:period/readiness', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSalaryPeriodReadiness(req.params.period as string));
}));

salaryPeriodsAdminRouter.get('/:period/exclusions', asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await listSalaryPeriodExclusions(req.params.period as string) });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const body = req.body ?? {};
  if (!body || typeof body !== 'object') {
    throw new ApiError(400, 'Thiếu dữ liệu loại trừ kỳ lương');
  }
  const driverId = Number((body as { driverId?: unknown }).driverId);
  if (!Number.isInteger(driverId) || driverId < 1) {
    throw new ApiError(400, 'driverId không hợp lệ');
  }
  const reason = typeof (body as { reason?: unknown }).reason === 'string'
    ? (body as { reason: string }).reason.trim()
    : '';
  if (!reason) {
    throw new ApiError(400, 'Cần nhập lý do loại trừ');
  }
  const handlingMode = (body as { handlingMode?: unknown }).handlingMode === 'ADJUSTMENT'
    ? 'ADJUSTMENT'
    : 'SUPPLEMENTARY_PERIOD';
  const targetPeriod = typeof (body as { targetPeriod?: unknown }).targetPeriod === 'string'
    ? (body as { targetPeriod: string }).targetPeriod
    : null;
  const note = typeof (body as { note?: unknown }).note === 'string'
    ? (body as { note: string }).note
    : null;

  const created = await createSalaryPeriodExclusion({
    period: req.params.period as string,
    driverId,
    actorId: u.userId,
    actorRole: u.role,
    reason,
    handlingMode,
    targetPeriod,
    note,
  });
  res.status(201).json(created);
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  res.json(await checkSalaryPeriodExclusion({
    actionId,
    actorId: u.userId,
    actorRole: u.role,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  res.json(await approveSalaryPeriodExclusion({
    actionId,
    actorId: u.userId,
    actorRole: u.role,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/complete-followup', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  res.json(await completeSalaryPeriodExclusionFollowup({
    actionId,
    actorId: u.userId,
    actorRole: u.role,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/close', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const result = await requestSalaryPeriodClose({
    period: req.params.period as string,
    actorId: u.userId,
    actorRole: u.role,
    reason: note,
    note,
  });
  res.status(201).json(result);
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  res.json(await checkSalaryPeriodClose({
    period: req.params.period as string,
    actionId,
    actorId: u.userId,
    actorRole: u.role,
    expectedVersion: input.expectedVersion,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  res.json(await approveSalaryPeriodClose({
    period: req.params.period as string,
    actionId,
    actorId: u.userId,
    actorRole: u.role,
    expectedVersion: input.expectedVersion,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/reopen', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const result = await requestSalaryPeriodReopen({
    period: req.params.period as string,
    actorId: u.userId,
    actorRole: u.role,
    expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : 0,
    reason,
    note,
  });
  res.status(201).json(result);
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  res.json(await checkSalaryPeriodReopen({
    period: req.params.period as string,
    actionId,
    actorId: u.userId,
    actorRole: u.role,
    expectedVersion: input.expectedVersion,
  }));
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  res.json(await approveSalaryPeriodReopen({
    period: req.params.period as string,
    actionId,
    actorId: u.userId,
    actorRole: u.role,
    expectedVersion: input.expectedVersion,
  }));
}));

// ─── Audit logs (mounted separately with audit_logs Casbin resource) ─────────
export const auditLogRouter = Router();
auditLogRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const viewer = getUser(req);
  res.json(await queryAuditLogs({
    page,
    limit,
    category: req.query.category as string,
    search: req.query.search as string,
    viewer: {
      userId: viewer.userId,
      role: viewer.role,
    },
  }));
}));

export default router;
