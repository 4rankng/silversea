import { Router } from 'express';
import { db } from '../db';
import * as s from '../db/schema';
import { COMPANY_INFO_SETTING_KEYS, companyInfoFromSettings } from '../services/company-info.service';
import { eq, like, sql } from 'drizzle-orm';
// auth + Casbin applied at mount point in index.ts
import {
  customerSchema, truckSchema, trailerSchema, routeSchema,
  cargoTypeSchema, pricingTableSchema, roadAllowanceSchema,
  fuelConfigSchema, penaltyReasonSchema, driverSchema,
  managementFeeSchema, capTableSchema, truckCapSchema,
  salaryPeriodSchema, salaryPeriodDefaultSchema,
  supplierSchema, expenseCategorySchema,
  containerTypeSchema, sealTypeSchema, portSchema,
  forwarderExpenseTypeSchema,
  companyInfoSchema,
  tireSchema, installTireSchema, disposeTireSchema, transferTireSchema, tirePositionSchema,
  fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema,
} from '@tingting/shared';
import type { Request, Response } from 'express';
import { createCrudRouter } from './utils/crud-factory';
import debitNoteTemplatesRouter from './config/debit-note-templates.routes';
import { ApiError } from '../errors';
import { getBootstrapData, getPricing, getFuelConfig, upsertFuelConfig, getFuelPriceHistory, getEffectiveFuelPrice, mirrorCustomerLink, mirrorSupplierLink, syncTrailerFields, validateCustomerUniqueness } from '../services/config.service';
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
import { asyncHandler } from '../middleware/asyncHandler';
import { getUser } from '../middleware/auth';
import { parsePagination } from './utils/pagination';
import { queryAuditLogs } from '../services/audit-query.service';
import { getPenaltyStats } from '../services/reporting.service';
import { normalizeSupplierTypes, syncFuelFlag } from '../services/supplier-types.service';

/**
 * Wave 3 M6.2 — afterCreate/afterUpdate hook for suppliers. Normalizes
 * the raw `types` input from the form (which can be lowercase, duped,
 * or contain invalid strings) into the canonical sorted array, persists
 * it, and mirrors `isFuelSupplier` from the FUEL membership so legacy
 * boolean readers see consistent state. Runs after the linked-customer
 * mirror hook.
 */
async function syncSupplierTypesHook(
  item: { id: number },
  data: { types?: unknown },
): Promise<void> {
  // No `types` key in the payload → leave the column untouched (caller
  // is updating some other field).
  if (data == null || !('types' in data) || data.types === undefined) return;
  const normalized = normalizeSupplierTypes(data.types);
  await db.update(s.suppliers)
    .set({
      types: normalized,
      isFuelSupplier: syncFuelFlag(normalized),
      updatedAt: new Date(),
    })
    .where(eq(s.suppliers.id, item.id));
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
  beforeCreate: async (data) => {
    await validateCustomerUniqueness(data);
    return data;
  },
  beforeUpdate: async (id, data) => {
    await validateCustomerUniqueness(data, id);
    return data;
  },
  afterCreate: mirrorCustomerLink,
  afterUpdate: mirrorCustomerLink,
}));
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
router.use('/forwarder-expense-types', createCrudRouter(s.forwarderExpenseTypes, forwarderExpenseTypeSchema, { searchableField: 'name' }));
router.use('/pricing-tables', createCrudRouter(s.pricingTables, pricingTableSchema));
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
  afterCreate: async (item, data) => {
    await mirrorSupplierLink(item, data);
    await syncSupplierTypesHook(item, data);
  },
  afterUpdate: async (item, data) => {
    await mirrorSupplierLink(item, data);
    await syncSupplierTypesHook(item, data);
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

// ─── Audit logs (mounted separately with ADMIN-only Casbin resource) ────────
export const auditLogRouter = Router();
auditLogRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  res.json(await queryAuditLogs({
    page,
    limit,
    category: req.query.category as string,
    search: req.query.search as string,
  }));
}));

export default router;
