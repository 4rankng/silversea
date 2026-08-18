import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { and, eq, isNull, like, ne } from 'drizzle-orm';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { Role } from '@tingting/shared';
import { createCrudRouter } from '../utils/crud-factory';
import { runIdempotent, resolveIdempotencyKey } from '../../services/idempotency.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../../lib/redis';
import * as H from './config-helpers';
import type { CustomerMutationPayload, PenaltyReasonPayload, DriverPayload, SupplierPayload, ForwarderExpenseTypePayload, ExpenseCategoryPayload } from './config-helpers';
import {
  lockApplicationOwnedUniqueness,
  lockApplicationOwnedUniquenessSet,
} from '../../services/application-owned-uniqueness.service';
import { getBootstrapData, getPricing, syncTrailerFields, validateCustomerUniqueness } from '../../services/config.service';
import { loadClerkShipmentScope } from '../../services/clerk-shipment-scope.service';
import { getPenaltyStats } from '../../services/reporting.service';
import { restrictRouteCreateForIntake } from '../../services/route-intake.service';
import { assertTireSerialAvailable } from '../../services/tire.service';
import { requestOrApplyGovernedConfigAction } from '../../services/price-config-governance.service';
import debitNoteTemplatesRouter from './debit-note-templates.routes';
import masterDataImportRouter from './master-data-import.routes';
import driverUserBindingRouter from './driver-user-binding.routes';
import {
  customerSchema, customerUpdateSchema, truckSchema, trailerSchema, routeSchema,
  cargoTypeSchema, pricingTableSchema, roadAllowanceSchema,
  fuelConfigSchema, penaltyReasonSchema, driverSchema,
  managementFeeSchema, capTableSchema, truckCapSchema,
  supplierSchema, expenseCategorySchema,
  containerTypeSchema, sealTypeSchema, portSchema,
  forwarderExpenseTypeSchema,
  tireSchema, installTireSchema, disposeTireSchema, transferTireSchema, tirePositionSchema,
  fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema,
  businessCalendarDaySchema,
} from '@tingting/shared';

// Catalog CRUD routes (T3c split) — the 27 crud-factory mounts plus the
// bootstrap/pricing endpoints, moved verbatim from routes/config.ts.
// Helper predicates/guards come from ./config-helpers (H. prefix).

const router = Router();

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function portalBootstrap(data: Awaited<ReturnType<typeof getBootstrapData>>) {
  return {
    ...data,
    customers: [],
    externalCarriers: [],
    trucks: [],
    drivers: [],
    routes: [],
    cargoTypes: [],
    expenseCategories: [],
    suppliers: [],
    trailers: [],
  };
}

async function clerkBootstrap(
  data: Awaited<ReturnType<typeof getBootstrapData>>,
  userId: number,
) {
  const scope = await loadClerkShipmentScope(userId);
  if (scope.businessUnitIds.length === 0 || scope.customerIds.length === 0) {
    return {
      ...data,
      customers: [],
      businessUnits: [],
    };
  }
  return {
    ...data,
    customers: data.customers.filter((customer) => scope.customerIds.includes(customer.id)),
    businessUnits: (data.businessUnits ?? []).filter((unit) => scope.businessUnitIds.includes(unit.id)),
  };
}

export const catalogBootstrapRouter = Router();

router.use('/config/master-data-imports', masterDataImportRouter);
router.use('/config/driver-user-bindings', driverUserBindingRouter);

catalogBootstrapRouter.get('/catalogs/bootstrap', asyncHandler(async (req: Request, res: Response) => {
  const data = await getBootstrapData();
  const actor = getUser(req);
  const role = actor.role;
  if (role === Role.DRIVER || role === Role.OPS) {
    return res.json(portalBootstrap(data));
  }
  if (role === Role.CUS) {
    return res.json(await clerkBootstrap(data, actor.userId));
  }
  res.json(data);
}));

// ─── Pricing lookup ──────────────────────────────────────────────────────────

router.get('/pricing', asyncHandler(async (req: Request, res: Response) => {
  const customerId = parseInt(req.query.customerId as string, 10);
  const routeId = parseInt(req.query.routeId as string, 10);
  const containerTypeIdRaw = req.query.containerTypeId as string | undefined;
  const containerTypeId = containerTypeIdRaw ? parseInt(containerTypeIdRaw, 10) : null;
  const pricingRateKey = typeof req.query.pricingRateKey === 'string'
    ? req.query.pricingRateKey.trim() || null
    : null;
  const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

  if (isNaN(customerId) || isNaN(routeId)) {
    return res.status(400).json({ error: 'customerId và routeId là bắt buộc' });
  }
  if (containerTypeIdRaw && (containerTypeId == null || Number.isNaN(containerTypeId))) {
    return res.status(400).json({ error: 'containerTypeId không hợp lệ' });
  }

  const pricing = await getPricing(customerId, routeId, date, {
    containerTypeId,
    pricingRateKey,
  });
  // Preserve the legacy {price: number} shape for HTTP callers; null (no row)
  // surfaces as 0 here. Only the in-process agent tool sees null (so it can
  // distinguish "no pricing table" from a real 0-VND price).
  res.json({ price: pricing.price ?? 0 });
}));

function validatePricingSelector<T extends { containerTypeId?: number | null; rateKey?: string | null }>(data: T): T {
  if (data.containerTypeId != null && data.rateKey != null) {
    throw new ApiError(400, 'Chỉ được chọn một trong hai: loại container hoặc mã lớp giá');
  }
  return data;
}

// ─── CRUD routes ─────────────────────────────────────────────────────────────

router.use('/customers', createCrudRouter(s.customers, customerSchema, {
  searchableFields: ['shortName', 'name'],
  updateSchema: customerUpdateSchema,
  governance: {
    reasonLabel: 'cấu hình khách hàng ảnh hưởng công nợ',
    shouldGovernCreate: (data) => H.hasMaterialCustomerConfigChange(data as CustomerMutationPayload),
    shouldGovernUpdate: (_id, data, _req, current) => H.hasMaterialCustomerUpdate(data as CustomerMutationPayload, current),
    shouldGovernDelete: () => true,
  },
  beforeCreate: async (data, _req, tx) => {
    data.shortName = data.shortName?.trim() || data.name.trim();
    await H.lockCustomerMutationKeys(tx, data);
    await validateCustomerUniqueness(data);
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.name !== undefined && data.shortName === undefined) {
      const [current] = await tx.select({ shortName: s.customers.shortName })
        .from(s.customers)
        .where(eq(s.customers.id, id))
        .limit(1);
      if (!current?.shortName.trim()) data.shortName = data.name.trim();
    }
    if ((data as Record<string, unknown>).debitNoteMode === 'PER_BATCH') {
      const [current] = await tx.select({ debitNoteMode: s.customers.debitNoteMode })
        .from(s.customers)
        .where(eq(s.customers.id, id))
        .limit(1);
      if (current?.debitNoteMode !== 'PER_BATCH') {
        throw new ApiError(400, 'PER_BATCH chỉ được giữ nguyên cho dữ liệu lịch sử');
      }
    }
    await H.lockCustomerMutationKeys(tx, data, id);
    await validateCustomerUniqueness(data, id);
    return data;
  },
  afterCreate: async (item, data, _req, tx) => {
    await H.syncCustomerRelationsHook(tx, item, data);
  },
  afterUpdate: async (item, data, _req, tx) => {
    await H.syncCustomerRelationsHook(tx, item, data);
    if ('fuelSurchargeSharePct' in data) {
      await H.markCompletedFuelSurchargeTripsDirty(tx, { customerId: item.id });
    }
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'customer', id),
}));
router.use(
  '/business-calendar',
  requireRoles(Role.ADMIN),
  createCrudRouter(s.businessCalendarDays, businessCalendarDaySchema, {
    searchableField: 'name',
    deleteMode: 'hard',
    maxLimit: 500,
    orderByField: 'calendarDate',
    governance: {
      reasonLabel: 'lịch làm việc ảnh hưởng ngày công và kỳ lương',
    },
    beforeCreate: async (data, _req, tx) => {
      await lockApplicationOwnedUniqueness(tx, 'catalog.business-calendar.date', [data.calendarDate]);
      const [duplicate] = await tx.select({ id: s.businessCalendarDays.id })
        .from(s.businessCalendarDays)
        .where(eq(s.businessCalendarDays.calendarDate, data.calendarDate))
        .limit(1);
      if (duplicate) throw new ApiError(409, 'Ngày làm việc đã được cấu hình');
      return data;
    },
    beforeUpdate: async (id, data, _req, tx) => {
      if (data.calendarDate !== undefined) {
        await lockApplicationOwnedUniqueness(tx, 'catalog.business-calendar.date', [data.calendarDate]);
        const [duplicate] = await tx.select({ id: s.businessCalendarDays.id })
          .from(s.businessCalendarDays)
          .where(and(eq(s.businessCalendarDays.calendarDate, data.calendarDate), ne(s.businessCalendarDays.id, id)))
          .limit(1);
        if (duplicate) throw new ApiError(409, 'Ngày làm việc đã được cấu hình');
      }
      return data;
    },
  }),
);
router.use('/trucks', createCrudRouter(s.trucks, truckSchema, {
  searchableField: 'licensePlate',
  // Dispatchers may add new tractors (casbin route-scoped POST allowance) but
  // not edit or retire existing ones.
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
    return syncTrailerFields(data);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.licensePlate !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, id, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    }
    if (data.currentTrailerId !== undefined) {
      await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
      return syncTrailerFields(data);
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'truck', id),
}));
router.use('/trailers', createCrudRouter(s.trailers, trailerSchema, {
  searchableField: 'licensePlate',
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'trailer.license-plate', value: data.licensePlate, table: s.trailers, column: s.trailers.licensePlate, message: 'Biển số rơ-moóc đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.licensePlate !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'trailer.license-plate', value: data.licensePlate, id, table: s.trailers, column: s.trailers.licensePlate, message: 'Biển số rơ-moóc đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'trailer', id),
}));
router.use('/routes', createCrudRouter(s.routes, routeSchema, {
  searchableFields: ['shortName', 'name'],
  // Keep the definition registered so legacy pending actions remain
  // reviewable/applicable, while all new route changes take effect directly.
  governance: {
    reasonLabel: 'tham số tuyến ảnh hưởng chi phí và định mức',
    shouldGovernCreate: () => false,
    shouldGovernUpdate: () => false,
    shouldGovernDelete: () => false,
  },
  beforeCreate: (data, req) => restrictRouteCreateForIntake(
    { ...data, shortName: data.shortName?.trim() || data.name.trim() },
    getUser(req).role,
  ),
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.name !== undefined && data.shortName === undefined) {
      const [current] = await tx.select({ shortName: s.routes.shortName })
        .from(s.routes)
        .where(eq(s.routes.id, id))
        .limit(1);
      if (!current?.shortName.trim()) data.shortName = data.name.trim();
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'route', id),
}));
router.use('/cargo-types', createCrudRouter(s.cargoTypes, cargoTypeSchema, {
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'cargo-type', id),
}));
router.use('/container-types', createCrudRouter(s.containerTypes, containerTypeSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'container-type.code', value: data.code, table: s.containerTypes, column: s.containerTypes.code, message: 'Mã loại container đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'container-type.code', value: data.code, id, table: s.containerTypes, column: s.containerTypes.code, message: 'Mã loại container đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'container-type', id),
}));
router.use('/seal-types', createCrudRouter(s.sealTypes, sealTypeSchema, { searchableField: 'name' }));
router.use('/ports', createCrudRouter(s.ports, portSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'port.code', value: data.code, table: s.ports, column: s.ports.code, message: 'Mã cảng đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'port.code', value: data.code, id, table: s.ports, column: s.ports.code, message: 'Mã cảng đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'port', id),
}));
router.use('/forwarder-expense-types', createCrudRouter(s.forwarderExpenseTypes, forwarderExpenseTypeSchema, {
  searchableField: 'name',
  governance: {
    reasonLabel: 'chính sách chứng từ và hạn mức chi hộ',
    shouldGovernCreate: () => true,
    shouldGovernUpdate: (_id, data, _req, current) => H.hasMaterialForwarderExpenseTypeUpdate(data, current),
    shouldGovernDelete: () => true,
  },
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'forwarder-expense-type.code', value: data.code, table: s.forwarderExpenseTypes, column: s.forwarderExpenseTypes.code, message: 'Mã loại chi phí giao nhận đã tồn tại' });
    return H.withForwarderExpenseTypePolicyVersion(null, data, tx);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'forwarder-expense-type.code', value: data.code, id, table: s.forwarderExpenseTypes, column: s.forwarderExpenseTypes.code, message: 'Mã loại chi phí giao nhận đã tồn tại' });
    }
    return H.withForwarderExpenseTypePolicyVersion(id, data, tx);
  },
}));
router.use('/pricing-tables', createCrudRouter(s.pricingTables, pricingTableSchema, {
  beforeCreate: async (data, _req, tx) => {
    validatePricingSelector(data);
    await H.requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'container-type', s.containerTypes, data.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.pricing-table.selector', [
      data.customerId, data.routeId, data.containerTypeId ?? null,
      H.normalizeCatalogKey(data.rateKey), data.effectiveDate,
    ]);
    const [duplicate] = await tx.select({ id: s.pricingTables.id }).from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, data.customerId),
        eq(s.pricingTables.routeId, data.routeId),
        data.containerTypeId == null ? isNull(s.pricingTables.containerTypeId) : eq(s.pricingTables.containerTypeId, data.containerTypeId),
        data.rateKey == null ? isNull(s.pricingTables.rateKey) : eq(s.pricingTables.rateKey, data.rateKey),
        eq(s.pricingTables.effectiveDate, data.effectiveDate),
        isNull(s.pricingTables.deletedAt),
      )).limit(1);
    if (duplicate) throw new ApiError(409, 'Bảng giá cho phạm vi và ngày hiệu lực này đã tồn tại');
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    const [current] = await tx.select().from(s.pricingTables).where(eq(s.pricingTables.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'Không tìm thấy bảng giá');
    const final = validatePricingSelector({ ...current, ...data });
    await H.requireActiveCatalogRow(tx, 'customer', s.customers, final.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'route', s.routes, final.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'container-type', s.containerTypes, final.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.pricing-table.selector', [
      final.customerId, final.routeId, final.containerTypeId ?? null,
      H.normalizeCatalogKey(final.rateKey), final.effectiveDate,
    ]);
    const [duplicate] = await tx.select({ id: s.pricingTables.id }).from(s.pricingTables)
      .where(and(
        eq(s.pricingTables.customerId, final.customerId), eq(s.pricingTables.routeId, final.routeId),
        final.containerTypeId == null ? isNull(s.pricingTables.containerTypeId) : eq(s.pricingTables.containerTypeId, final.containerTypeId),
        final.rateKey == null ? isNull(s.pricingTables.rateKey) : eq(s.pricingTables.rateKey, final.rateKey),
        eq(s.pricingTables.effectiveDate, final.effectiveDate), isNull(s.pricingTables.deletedAt),
        ne(s.pricingTables.id, id),
      )).limit(1);
    if (duplicate) throw new ApiError(409, 'Bảng giá cho phạm vi và ngày hiệu lực này đã tồn tại');
    return data;
  },
  governance: {
    reasonLabel: 'bảng giá cước',
  },
}));
router.use('/road-allowances', createCrudRouter(s.roadAllowances, roadAllowanceSchema, {
  beforeCreate: async (data, _req, tx) => {
    await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.road-allowance.route-type', [data.routeId, data.trailerType]);
    const [duplicate] = await tx.select({ id: s.roadAllowances.id }).from(s.roadAllowances)
      .where(and(eq(s.roadAllowances.routeId, data.routeId), eq(s.roadAllowances.trailerType, data.trailerType), isNull(s.roadAllowances.deletedAt)))
      .limit(1);
    if (duplicate) throw new ApiError(409, 'Phụ cấp cho tuyến và loại rơ-moóc này đã tồn tại');
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    const [current] = await tx.select().from(s.roadAllowances).where(eq(s.roadAllowances.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'Không tìm thấy phụ cấp đường');
    const final = { ...current, ...data };
    await H.requireActiveCatalogRow(tx, 'route', s.routes, final.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.road-allowance.route-type', [final.routeId, final.trailerType]);
    const [duplicate] = await tx.select({ id: s.roadAllowances.id }).from(s.roadAllowances)
      .where(and(eq(s.roadAllowances.routeId, final.routeId), eq(s.roadAllowances.trailerType, final.trailerType), isNull(s.roadAllowances.deletedAt), ne(s.roadAllowances.id, id)))
      .limit(1);
    if (duplicate) throw new ApiError(409, 'Phụ cấp cho tuyến và loại rơ-moóc này đã tồn tại');
    return data;
  },
  governance: {
    reasonLabel: 'phụ cấp đường',
  },
}));

// Wave 1: pricing & fuel catalog CRUD routes. All behind the existing
// config RBAC (office staff: ADMIN/MANAGER/ACCOUNTANT).
router.use('/fuel-norms', createCrudRouter(s.fuelNorms, fuelNormSchema, {
  beforeCreate: async (data, _req, tx) => {
    await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.routeId !== undefined) await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    if (data.truckId !== undefined) await H.requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  governance: {
    reasonLabel: 'định mức nhiên liệu',
  },
}));
router.use('/weight-pricing-tiers', createCrudRouter(s.weightPricingTiers, weightPricingTierSchema, {
  beforeCreate: async (data, _req, tx) => {
    await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'cargo-type', s.cargoTypes, data.cargoTypeId, 'Loại hàng không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.routeId !== undefined) await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    if (data.cargoTypeId !== undefined) await H.requireActiveCatalogRow(tx, 'cargo-type', s.cargoTypes, data.cargoTypeId, 'Loại hàng không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  governance: {
    reasonLabel: 'bậc giá theo trọng lượng',
  },
}));
router.use('/lift-pricing', createCrudRouter(s.liftPricing, liftPricingSchema, {
  beforeCreate: async (data, _req, tx) => {
    await H.requireActiveCatalogRow(tx, 'port', s.ports, data.portId, 'Cảng không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'container-type', s.containerTypes, data.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.lift-pricing.selector', [data.portId, data.containerTypeId, data.direction, data.loadState, data.effectiveDate]);
    const [duplicate] = await tx.select({ id: s.liftPricing.id }).from(s.liftPricing)
      .where(and(
        eq(s.liftPricing.portId, data.portId), eq(s.liftPricing.containerTypeId, data.containerTypeId),
        eq(s.liftPricing.direction, data.direction), eq(s.liftPricing.loadState, data.loadState),
        eq(s.liftPricing.effectiveDate, data.effectiveDate), isNull(s.liftPricing.deletedAt),
      )).limit(1);
    if (duplicate) throw new ApiError(409, 'Giá nâng hạ cho phạm vi và ngày hiệu lực này đã tồn tại');
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    const [current] = await tx.select().from(s.liftPricing).where(eq(s.liftPricing.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'Không tìm thấy giá nâng hạ');
    const final = { ...current, ...data };
    await H.requireActiveCatalogRow(tx, 'port', s.ports, final.portId, 'Cảng không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'container-type', s.containerTypes, final.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.lift-pricing.selector', [final.portId, final.containerTypeId, final.direction, final.loadState, final.effectiveDate]);
    const [duplicate] = await tx.select({ id: s.liftPricing.id }).from(s.liftPricing)
      .where(and(
        eq(s.liftPricing.portId, final.portId), eq(s.liftPricing.containerTypeId, final.containerTypeId),
        eq(s.liftPricing.direction, final.direction), eq(s.liftPricing.loadState, final.loadState),
        eq(s.liftPricing.effectiveDate, final.effectiveDate), isNull(s.liftPricing.deletedAt), ne(s.liftPricing.id, id),
      )).limit(1);
    if (duplicate) throw new ApiError(409, 'Giá nâng hạ cho phạm vi và ngày hiệu lực này đã tồn tại');
    return data;
  },
  governance: {
    reasonLabel: 'giá nâng hạ',
  },
}));
// M2.5: ancillary revenue with refund validation. Refunds (negative amounts)
// require a non-empty note. The createCrudRouter doesn't support superRefine
// (its type expects AnyZodObject), so we validate the refund rule as a
// beforeCreate/beforeUpdate hook that throws ApiError when the rule is violated.
const ancillaryRevenueRouter = createCrudRouter(s.ancillaryRevenue, ancillaryRevenueSchema, {
  governance: {
    reasonLabel: 'doanh thu bổ sung',
  },
  beforeCreate: async (data, _req, tx) => {
    if (Number(data.amount) < 0 && (!data.note || !String(data.note).trim())) {
      throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc khi số tiền âm');
    }
    await H.requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await H.requireExistingRow(tx, 'shipment', s.shipments, data.shipmentId, 'Lô hàng liên kết không tồn tại');
    await H.requireExistingRow(tx, 'trip', s.trips, data.tripId, 'Chuyến xe liên kết không tồn tại');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.amount !== undefined && Number(data.amount) < 0 && (!data.note || !String(data.note).trim())) {
      throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc khi số tiền âm');
    }
    if (data.customerId !== undefined) await H.requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    if (data.shipmentId !== undefined) await H.requireExistingRow(tx, 'shipment', s.shipments, data.shipmentId, 'Lô hàng liên kết không tồn tại');
    if (data.tripId !== undefined) await H.requireExistingRow(tx, 'trip', s.trips, data.tripId, 'Chuyến xe liên kết không tồn tại');
    return data;
  },
});
router.use('/ancillary-revenue', ancillaryRevenueRouter);

router.get('/penalty-reasons/stats', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPenaltyStats());
}));
router.use('/penalty-reasons', createCrudRouter(s.penaltyReasons, penaltyReasonSchema, {
  governance: {
    reasonLabel: 'mức phạt mặc định',
    shouldGovernCreate: (data) => H.hasMaterialPenaltyReasonChange(data as PenaltyReasonPayload),
    shouldGovernUpdate: (_id, data, _req, current) => H.hasMaterialPenaltyReasonUpdate(data as PenaltyReasonPayload, current),
    shouldGovernDelete: () => true,
  },
}));
router.use('/management-fees', createCrudRouter(s.managementFees, managementFeeSchema, {
  deleteMode: 'hard',
  governance: {
    reasonLabel: 'phí quản lý',
  },
  afterCreate: async () => { cacheInvalidatePattern('reports:pnl:*'); },
  afterUpdate: async () => { cacheInvalidatePattern('reports:pnl:*'); },
  afterDelete: async () => { cacheInvalidatePattern('reports:pnl:*'); },
}));
// Cap-table is amount-based: percentages are derived as
// contribution_amount / sum(contribution_amount) per snapshot, so totals are
// always 100% by construction and there's no separate over-allocation check.
router.use('/cap-table', createCrudRouter(s.capTableHistory, capTableSchema, {
  deleteMode: 'hard',
  governance: {
    reasonLabel: 'tỷ lệ phân chia vốn',
  },
}));
// F3 — per-vehicle cap table. Same CRUD pattern; clients filter by truckId via
// the `search`-style list query (the factory's GET passes through query
// params, and the per-truck editor fetches `/config/truck-cap?truckId=X`).
router.use('/truck-cap', createCrudRouter(s.truckCapTable, truckCapSchema, {
  deleteMode: 'hard',
  governance: {
    reasonLabel: 'tỷ lệ phân chia theo xe',
  },
}));
router.use('/suppliers', createCrudRouter(s.suppliers, supplierSchema, {
  searchableFields: ['shortName', 'name'],
  // Dispatchers allocate external capacity from this catalog; they may add
  // subcontractors (casbin route-scoped POST allowance) while updates/deletes
  // stay with MANAGER/ACCOUNTANT/ADMIN.
  // Keep the definition registered so legacy pending actions remain
  // reviewable/applicable, while all new supplier changes take effect directly.
  governance: {
    reasonLabel: 'cấu hình nhà cung cấp',
    shouldGovernCreate: () => false,
    shouldGovernUpdate: () => false,
    shouldGovernDelete: () => false,
  },
  beforeCreate: (data) => H.normalizeSupplierPayload(data),
  beforeUpdate: async (id, data) => H.normalizeSupplierPayload(data, id),
  afterCreate: async (item, data, _req, tx) => {
    await H.syncSupplierRelationsHook(tx, item, data);
    await H.syncSupplierTypesHook(tx, item, data);
  },
  afterUpdate: async (item, data, _req, tx) => {
    await H.syncSupplierRelationsHook(tx, item, data);
    await H.syncSupplierTypesHook(tx, item, data);
  },
  afterDelete: async (id, _req, tx) => {
    await tx.update(s.customers)
      .set({ linkedSupplierId: null, updatedAt: new Date() })
      .where(eq(s.customers.linkedSupplierId, id));
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'supplier', id),
}));
router.use('/expense-categories', createCrudRouter(s.expenseCategories, expenseCategorySchema, {
  searchableField: 'name',
  governance: {
    reasonLabel: 'nhóm chi phí',
    shouldGovernCreate: () => true,
    // Name-only renames apply directly; policy fields (isRenewable,
    // reminderLeadDays, status) still queue for maker→checker→approver.
    shouldGovernUpdate: (_id, data, _req, current) => H.hasMaterialExpenseCategoryUpdate(data as ExpenseCategoryPayload, current),
    shouldGovernDelete: () => true,
  },
  beforeDelete: (id, _req, tx) => H.lockCatalogDelete(tx, 'expense-category', id),
}));
// Debit-note templates — dedicated transactional router (NOT crud-factory) so the
// single-default invariant is enforced atomically. See the route file's header.
router.use('/debit-note-templates', debitNoteTemplatesRouter);
router.use('/tire-positions', createCrudRouter(s.tirePositions, tirePositionSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'tire-position.name', value: data.name, table: s.tirePositions, column: s.tirePositions.name, message: 'Vị trí lốp đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.name !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'tire-position.name', value: data.name, id, table: s.tirePositions, column: s.tirePositions.name, message: 'Vị trí lốp đã tồn tại' });
    }
    return data;
  },
}));

// Drivers — special handling (includes user_id, no delete per spec §4.2)
router.use('/drivers', createCrudRouter(s.drivers, driverSchema, {
  searchableField: 'name',
  disableDelete: true,
  // Dispatchers may add drivers to staff dispatch plans (casbin route-scoped
  // POST allowance); salary/insurance fields remain governed for every role
  // (governance hooks below).
  governance: {
    reasonLabel: 'mức lương và bảo hiểm tài xế',
    shouldGovernCreate: (data) => H.hasMaterialDriverConfigChange(data as DriverPayload),
    shouldGovernUpdate: (_id, data, _req, current) => H.hasMaterialDriverUpdate(data as DriverPayload, current),
  },
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
  beforeCreate: async (data, _req, tx) => {
    if (data.truckId && data.trailerId) {
      throw new ApiError(400, 'Lốp chỉ lắp trên xe đầu kéo hoặc rơ-moóc, không cả hai');
    }
    await H.assertUniqueCatalogString({ tx, scope: 'tire.serial', value: data.serial, table: s.tires, column: s.tires.serial, message: 'Số sê-ri lốp đã tồn tại' });
    await H.requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.trailerId, 'Rơ-moóc không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'supplier', s.suppliers, data.supplierId, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
    await assertTireSerialAvailable(data.serial);
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.truckId && data.trailerId) {
      throw new ApiError(400, 'Lốp chỉ lắp trên xe đầu kéo hoặc rơ-moóc, không cả hai');
    }
    if (data.serial !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'tire.serial', value: data.serial, id, table: s.tires, column: s.tires.serial, message: 'Số sê-ri lốp đã tồn tại' });
    }
    if (data.truckId !== undefined) await H.requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    if (data.trailerId !== undefined) await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.trailerId, 'Rơ-moóc không tồn tại hoặc đã ngưng dùng');
    if (data.supplierId !== undefined) await H.requireActiveCatalogRow(tx, 'supplier', s.suppliers, data.supplierId, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
    await assertTireSerialAvailable(data.serial, id);
    return data;
  },
}));

export default router;
