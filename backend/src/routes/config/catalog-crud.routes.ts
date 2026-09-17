import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../db';
import * as s from '../../db/schema';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { ApiError } from '../../errors';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getUser } from '../../middleware/auth';
import { requireRoles } from '../../middleware/casbin';
import { Role, TxnType } from '@tingting/shared';
import { createCrudRouter } from '../utils/crud-factory';
import { operationalName } from '../../db/master-data-name';

import { cacheInvalidatePattern } from '../../lib/redis';
import { REPORT_CACHE_KEYS } from '../../lib/report-cache';
import * as H from './config-helpers';
import { CustomerMutationPayload, PenaltyReasonPayload, DriverPayload, ExpenseCategoryPayload } from './config-helpers';
import { lockApplicationOwnedUniqueness } from '../../services/application-owned-uniqueness.service';
import { getBootstrapData, getPricing, syncTrailerFields, validateCustomerUniqueness } from '../../services/config.service';
import { getPenaltyStats } from '../../services/reporting.service';
import { restrictRouteCreateForIntake, restrictRouteUpdateForIntake } from '../../services/route-intake.service';
import { restrictCustomerCreateForIntake, restrictCustomerUpdateForIntake, intakeCreatedBy } from '../../services/customer-intake.service';
import { assertTireSerialAvailable } from '../../services/tire.service';

import debitNoteTemplatesRouter from './debit-note-templates.routes';
import masterDataImportRouter from './master-data-import.routes';
import driverUserBindingRouter from './driver-user-binding.routes';
import { customerSchema, customerUpdateSchema, truckSchema, trailerSchema, routeSchema, cargoTypeSchema, pricingTableSchema, roadAllowanceSchema, penaltyReasonSchema, driverSchema, managementFeeSchema, capTableSchema, truckCapSchema, supplierSchema, expenseCategorySchema, containerTypeSchema, sealTypeSchema, portSchema, dispatchZoneSchema, dispatchZoneUpdateSchema, forwarderExpenseTypeSchema, tireSchema, tirePositionSchema, fuelNormSchema, weightPricingTierSchema, liftPricingSchema, ancillaryRevenueSchema, businessCalendarDaySchema, fuelPricePeriodSchema, freightRateTermSchema, fuelConsumptionNormSchema, vehicleSizeClassSchema } from '@tingting/shared';

// Catalog CRUD routes (T3c split) — the 26 crud-factory mounts plus the
// bootstrap/pricing endpoints, moved verbatim from routes/config.ts.
// Helper predicates/guards come from ./config-helpers (H. prefix).

const router = Router();

/**
 * Three-state surcharge threshold confirmation (20260917_11, PRD
 * CuocPhiThietKeDB.md §8): the stored mode and the stored values must agree.
 *   UNSET → both values null (nothing customer-confirmed yet);
 *   NONE  → both values null (customer confirmed "no threshold");
 *   PCT   → pct set, abs null;
 *   ABS   → abs set, pct null.
 * The ENGINE refuses UNSET rows; this route only guards mode/value shape.
 */
function requireThresholdModeConsistency(
  mode: string,
  pct: unknown,
  abs: unknown,
): void {
  if (pct != null && abs != null) {
    throw new ApiError(400, 'Chỉ chọn một dạng ngưỡng biến động giá dầu: phần trăm (%) HOẶC tuyệt đối (VND/lít).');
  }
  switch (mode) {
    case 'PCT':
      if (pct == null) throw new ApiError(400, 'Chọn dạng ngưỡng phần trăm thì phải nhập giá trị ngưỡng (%).');
      if (abs != null) throw new ApiError(400, 'Dạng ngưỡng phần trăm không được kèm giá trị ngưỡng tuyệt đối.');
      break;
    case 'ABS':
      if (abs == null) throw new ApiError(400, 'Chọn dạng ngưỡng tuyệt đối thì phải nhập giá trị ngưỡng (VND/lít).');
      if (pct != null) throw new ApiError(400, 'Dạng ngưỡng tuyệt đối không được kèm giá trị ngưỡng phần trăm.');
      break;
    case 'NONE':
      if (pct != null || abs != null) throw new ApiError(400, 'Xác nhận không áp dụng ngưỡng thì không được nhập giá trị ngưỡng.');
      break;
    case 'UNSET':
      if (pct != null || abs != null) throw new ApiError(400, 'Chưa chốt ngưỡng thì không được nhập giá trị ngưỡng — hãy chốt một dạng ngưỡng hoặc xác nhận không áp dụng.');
      break;
    default:
      throw new ApiError(400, 'Dạng ngưỡng không hợp lệ.');
  }
}

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
  res.json(data);
}));

// ─── Dispatch zones (DB-owned taxonomy; read by dispatch UIs + port config) ──

// Active-only taxonomy read consumed by every dispatch UI and the port form.
// Distinct subpath so it cannot shadow the factory list below — the admin
// surface must see inactive rows too (deactivate → still listed → reactivate),
// while dispatch readers only ever see active zones. Registered BEFORE the
// factory mount so non-admin config readers are not caught by its ADMIN gate.
router.get('/dispatch-zones/active', asyncHandler(async (_req: Request, res: Response) => {
  const zones = await db.select({
    code: s.dispatchZones.code,
    label: s.dispatchZones.label,
    sortOrder: s.dispatchZones.sortOrder,
  }).from(s.dispatchZones)
    .where(eq(s.dispatchZones.isActive, true))
    .orderBy(s.dispatchZones.sortOrder, s.dispatchZones.code);
  res.json({ items: zones });
}));

router.use(
  '/dispatch-zones',
  requireRoles(Role.ADMIN),
  createCrudRouter(s.dispatchZones, dispatchZoneSchema, {
    disableDelete: true,
    orderByField: 'sortOrder',
    updateSchema: dispatchZoneUpdateSchema,
    beforeUpdate: async (id, data, req, tx) => {
      const [current] = await tx.select({ code: s.dispatchZones.code })
        .from(s.dispatchZones).where(eq(s.dispatchZones.id, id)).limit(1);
      if (!current) throw new ApiError(404, 'Không tìm thấy');
      // Codes are immutable: ports and client state key on them. The update
      // schema strips `code`, so inspect the raw body — a differing code is a
      // client bug worth a loud 400, not a silent ignore.
      if ('code' in (req.body ?? {}) && req.body?.code !== current.code) {
        throw new ApiError(400, 'Mã khu vực không thể thay đổi sau khi tạo.');
      }
      // Deactivating a zone that live ports still reference would dangle
      // ports.dispatch_zone — force re-classification first.
      if (data.isActive === false) {
        await H.assertZoneDeactivatable(tx, current.code);
      }
      return data;
    },
  }),
);

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
    throw new ApiError(400, 'customerId và routeId là bắt buộc');
  }
  if (containerTypeIdRaw && (containerTypeId == null || Number.isNaN(containerTypeId))) {
    throw new ApiError(400, 'containerTypeId không hợp lệ');
  }

  const pricing = await getPricing(customerId, routeId, date, {
    containerTypeId,
    pricingRateKey,
  });
  // Preserve the legacy {price: number} shape for HTTP callers; null (no row)
  // surfaces as 0 here.
  res.json({ price: pricing.price ?? 0 });
}));

function validatePricingSelector<T extends { containerTypeId?: number | null; rateKey?: string | null }>(data: T): T {
  if (data.containerTypeId != null && data.rateKey != null) {
    throw new ApiError(400, 'Chỉ được chọn một trong hai: loại container hoặc mã lớp giá');
  }
  return data;
}

// ─── CRUD routes ─────────────────────────────────────────────────────────────

// Partner-list sort whitelists. Each key is the list page's URL sort key; the
// value is the column or a correlated scalar subquery — exactly one value per
// row, so pagination counts never fan out. The two balance keys replicate the
// pages' displayed projections:
// - customers `debt` mirrors buildCustomerDebtMap's carrier-payable exclusion
//   with aging's SQL semantics: a NULL note makes the UNLOCK_REVERSAL
//   predicate evaluate NULL, so such rows are excluded here while the page's
//   JS (`note?.startsWith`) keeps them — an accepted sort-order-only
//   divergence for the rare all-NULL-note customer.
// - suppliers `payable` mirrors the vendor payables summary total (VENDOR
//   ledger, credit − debit), clamped at 0 because the summary drops entities
//   with non-positive outstanding and the page renders those as 0.
const customerDebtSortSql = sql`(
  select coalesce(sum(coalesce(${s.ledger.debit}, 0) - coalesce(${s.ledger.credit}, 0)), 0)
  from ${s.ledger}
  where ${s.ledger.entityType} = 'CUSTOMER'
    and ${s.ledger.entityId} = ${s.customers.id}
    and not (
      ${s.ledger.txnType} = ${TxnType.EXTERNAL_CARRIER_COST}
      or ${s.ledger.txnType} = ${TxnType.VENDOR_PAYMENT}
      or (
        ${s.ledger.txnType} = ${TxnType.UNLOCK_REVERSAL}
        and ${s.ledger.note} like 'Cước thuê ngoài%'
      )
    )
)`;

const supplierPayableSortSql = sql`(
  select greatest(coalesce(sum(coalesce(${s.ledger.credit}, 0) - coalesce(${s.ledger.debit}, 0)), 0), 0)
  from ${s.ledger}
  where ${s.ledger.entityType} = 'VENDOR'
    and ${s.ledger.entityId} = ${s.suppliers.id}
)`;

// The list renders the linked customer's full name (or an em dash when
// unlinked) — sort on that same label, not the raw linked_customer_id.
const supplierLinkedCustomerNameSortSql = sql`(
  select ${s.customers.name}
  from ${s.customers}
  where ${s.customers.id} = ${s.suppliers.linkedCustomerId}
)`;

router.use('/customers', createCrudRouter(s.customers, customerSchema, {
  // 2026-09-10 customer report: lookup by tax code or phone tail found
  // nothing — the catalog search only matched name fields. Identifiers are
  // now searchable too; the factory's contains-ILIKE covers full values
  // and last-4/5-char tails alike.
  searchableFields: ['shortName', 'name', 'taxCode', 'phone', 'contactPerson'],
  sortableColumns: {
    name: operationalName(s.customers.shortName, s.customers.name),
    contactPerson: s.customers.contactPerson,
    creditLimit: s.customers.creditLimit,
    debt: customerDebtSortSql,
  },
  updateSchema: customerUpdateSchema,
  governance: {
    reasonLabel: 'cấu hình khách hàng ảnh hưởng công nợ',
    shouldGovernCreate: (data, req) => {
      // Intake creates by CUS/Dispatchers reach here identity-only (the
      // restrict in beforeCreate stripped credit and billing fields), so
      // they insert directly — mirroring the shipment-route intake bypass.
      // Admin-page creates keep the full materiality gate below.
      if (req.user && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)) return false;
      return H.hasMaterialCustomerConfigChange(data as CustomerMutationPayload);
    },
    shouldGovernUpdate: (_id, data, req, current) => {
      if (req.user && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)) return false;
      return H.hasMaterialCustomerUpdate(data as CustomerMutationPayload, current);
    },
    shouldGovernDelete: (_id, req) => {
      if (req.user && [Role.CUS, Role.DISPATCHER].includes(req.user.role as Role)) return false;
      return true;
    },
  },
  beforeCreate: async (input, req, tx) => {
    const actor = getUser(req);
    const data = restrictCustomerCreateForIntake(input, actor.role);
    data.shortName = data.shortName?.trim() || data.name.trim();
    await H.lockCustomerMutationKeys(tx, data);
    await validateCustomerUniqueness(data);
    const createdBy = intakeCreatedBy(actor.role, actor.userId);
    return createdBy == null ? data : { ...data, createdBy };
  },
  beforeUpdate: async (id, data, req, tx) => {
    const actor = getUser(req);
    data = restrictCustomerUpdateForIntake(data, actor.role) as typeof data;
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
  beforeDelete: async (id, req, tx) => {
    const actor = getUser(req);
    if ([Role.CUS, Role.DISPATCHER].includes(actor.role)) {
      const [row] = await tx.select({ createdAt: s.customers.createdAt })
        .from(s.customers).where(eq(s.customers.id, id)).limit(1);
      if (row && Date.now() - row.createdAt.getTime() > 24 * 60 * 60 * 1000) {
        throw new ApiError(403, 'Chỉ được xóa khách hàng trong vòng 1 ngày sau khi tạo.');
      }
    }
    await H.lockCatalogDelete(tx, 'customer', id);
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
/**
 * Carrier-link validation for trucks.carrierId — mirrors the dispatch
 * planning carrier check exactly: the target must be an ACTIVE, non-deleted
 * customer with isCarrier=true. Null (unassign / own fleet) always passes.
 *
 * Reverse-lock semantics (documented per review): deleting a carrier
 * customer is SOFT (customers tombstone via deletedAt); trucks pointing at
 * a tombstoned carrier keep their carrier_id, this guard blocks NEW
 * assignments to it, and list filters still resolve the id. The FE maps
 * id → name from the live EXTERNAL_CARRIER pool, so a tombstoned carrier's
 * trucks surface with no name rather than dangling text.
 */
async function assertActiveCarrier(tx: H.CrudTx, carrierId: number | null | undefined): Promise<void> {
  if (carrierId == null) return;
  await H.lockCatalogRelationship(tx, 'customer', carrierId);
  const [carrier] = await tx.select({ id: s.customers.id })
    .from(s.customers)
    .where(and(
      eq(s.customers.id, carrierId),
      eq(s.customers.isCarrier, true),
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
    ))
    .limit(1)
    .for('share');
  if (!carrier) {
    throw new ApiError(409, 'Nhà xe không còn hiệu lực hoặc không phải nhà xe.');
  }
}

router.use('/trucks', createCrudRouter(s.trucks, truckSchema, {
  searchableField: 'licensePlate',
  // "Chọn nhà xe → thấy biển số của nó" list filter (integer equality).
  filterFields: ['carrierId'],
  // Dispatchers may add new tractors (casbin route-scoped POST allowance) but
  // not edit or retire existing ones.
  beforeCreate: async (data, _req, tx) => {
    await H.assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
    // Same transfer semantics as the update hook — a NEW truck claiming a
    // held trailer clears the holder.
    const createTrailerId = data.currentTrailerId;
    if (createTrailerId != null) {
      await tx.update(s.trucks)
        .set({ currentTrailerId: null, updatedAt: new Date() })
        .where(eq(s.trucks.currentTrailerId, Number(createTrailerId)));
    }
    await assertActiveCarrier(tx, data.carrierId);
    return syncTrailerFields(data);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.licensePlate !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, id, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    }
    if (data.currentTrailerId !== undefined) {
      await H.requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
      // Transfer semantics: coupling T to THIS truck clears any OTHER truck's
      // link to T in the same transaction — without it the old truck's card
      // would keep displaying a trailer that moved. updatedAt bumps so a
      // concurrent editor of the cleared truck sees the version change.
      const trailerId = data.currentTrailerId;
      if (trailerId != null) {
        await tx.update(s.trucks)
          .set({ currentTrailerId: null, updatedAt: new Date() })
          .where(and(
            eq(s.trucks.currentTrailerId, Number(trailerId)),
            ne(s.trucks.id, id),
          ));
      }
    }
    await assertActiveCarrier(tx, data.carrierId);
    return data.currentTrailerId !== undefined ? syncTrailerFields(data) : data;
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
  beforeUpdate: async (id, data, req, tx) => {
    const actor = getUser(req);
    data = restrictRouteUpdateForIntake(data, actor.role) as typeof data;
    if (data.name !== undefined && data.shortName === undefined) {
      const [current] = await tx.select({ shortName: s.routes.shortName })
        .from(s.routes)
        .where(eq(s.routes.id, id))
        .limit(1);
      if (!current?.shortName.trim()) data.shortName = data.name.trim();
    }
    return data;
  },
  beforeDelete: async (id, req, tx) => {
    const actor = getUser(req);
    if ([Role.CUS, Role.DISPATCHER].includes(actor.role)) {
      const [row] = await tx.select({ createdAt: s.routes.createdAt })
        .from(s.routes).where(eq(s.routes.id, id)).limit(1);
      if (row && Date.now() - row.createdAt.getTime() > 24 * 60 * 60 * 1000) {
        throw new ApiError(403, 'Chỉ được xóa tuyến đường trong vòng 1 ngày sau khi tạo.');
      }
    }
    await H.lockCatalogDelete(tx, 'route', id);
  },
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
    await H.assertDispatchZoneCode(tx, data.dispatchZone);
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'port.code', value: data.code, id, table: s.ports, column: s.ports.code, message: 'Mã cảng đã tồn tại' });
    }
    await H.assertDispatchZoneCode(tx, data.dispatchZone);
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
    return H.withForwarderExpenseTypePolicyDefaults(null, data, tx);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await H.assertUniqueCatalogString({ tx, scope: 'forwarder-expense-type.code', value: data.code, id, table: s.forwarderExpenseTypes, column: s.forwarderExpenseTypes.code, message: 'Mã loại chi phí giao nhận đã tồn tại' });
    }
    return H.withForwarderExpenseTypePolicyDefaults(id, data, tx);
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

// ─── Auto freight pricing engine config (Phương án tính cước tự động) ───────
// Docx §2-A/B/C + §5-1. RBAC rides the config casbin tree (ADMIN wildcard,
// MANAGER/ACCOUNTANT write; DISPATCHER read) exactly like the fuel-norms
// mounts above; the CUS fuel-price entry allowance is a route-scoped bypass
// in the casbin middleware (docx §5-1 names Kế toán/CUS as the entrants).

// Fuel price periods — single-record entry [Ngày hiệu lực][Giá dầu DO/lít].
// Adding a row starts a new period; effectiveFrom is the unique key (409 on
// duplicate via the PG index). Ordered chronologically for the entry screen.
// Deliberately NOT maker-checker governed: docx §5-1 frames this as routine
// market-data entry by "Kế toán/CUS" (a governed flow would reject the CUS
// maker — GOVERNANCE_CREATE is financial-trio only); the heavier contract
// surfaces (rate terms, norms) below stay governed.
router.use('/fuel-price-periods', createCrudRouter(s.fuelPricePeriods, fuelPricePeriodSchema, {
  orderByField: 'effectiveFrom',
}));

// Freight rate terms — one contract block per customer × route. The pct/abs
// threshold XOR cannot live in a superRefine (the crud factory takes a plain
// ZodObject — see the ancillary-revenue note above), so it is enforced as
// ApiError-throwing hooks. Updates must merge the patch against the current
// row because an edit form may send only one threshold while the stored row
// carries the other.
router.use('/freight-rate-terms', createCrudRouter(s.freightRateTerms, freightRateTermSchema, {
  orderByField: 'effectiveDate',
  beforeCreate: async (data, _req, tx) => {
    // Three-state threshold confirmation (20260917_11): mode and values must
    // agree. 'UNSET' (nothing customer-confirmed yet) is a legal creation
    // state — the ENGINE refuses to auto-apply fuel prices to it (PRD §8:
    // never read an empty cell as "always adjust"), not this route.
    requireThresholdModeConsistency(
      data.surchargeThresholdMode ?? 'UNSET',
      data.surchargeThresholdPct ?? null,
      data.surchargeThresholdAbs ?? null,
    );
    await H.requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    const [current] = await tx.select().from(s.freightRateTerms)
      .where(eq(s.freightRateTerms.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'Không tìm thấy điều khoản cước');
    requireThresholdModeConsistency(
      data.surchargeThresholdMode ?? current.surchargeThresholdMode,
      data.surchargeThresholdPct !== undefined ? data.surchargeThresholdPct : current.surchargeThresholdPct,
      data.surchargeThresholdAbs !== undefined ? data.surchargeThresholdAbs : current.surchargeThresholdAbs,
    );
    if (data.customerId !== undefined) await H.requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    if (data.routeId !== undefined) await H.requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  governance: {
    reasonLabel: 'điều khoản cước',
  },
}));

// Fuel consumption norms — revenue-side liters/km per vehicle size class.
router.use('/fuel-consumption-norms', createCrudRouter(s.fuelConsumptionNorms, fuelConsumptionNormSchema, {
  orderByField: 'effectiveDate',
  beforeCreate: async (data, _req, tx) => {
    await H.requireActiveCatalogRow(tx, 'vehicle-size-class', s.vehicleSizeClasses, data.vehicleSizeClassId, 'Loại xe không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.vehicleSizeClassId !== undefined) {
      await H.requireActiveCatalogRow(tx, 'vehicle-size-class', s.vehicleSizeClasses, data.vehicleSizeClassId, 'Loại xe không tồn tại hoặc đã ngưng dùng');
    }
    return data;
  },
  governance: {
    reasonLabel: 'định mức tiêu hao dầu',
  },
}));

// Vehicle size class catalog — the FK-able taxonomy behind pricing rate keys.
// Codes are immutable: pricing_tables.rate_key and engine lookups key on them.
router.use('/vehicle-size-classes', createCrudRouter(s.vehicleSizeClasses, vehicleSizeClassSchema, {
  orderByField: 'sortOrder',
  beforeUpdate: async (id, data, req, tx) => {
    const [current] = await tx.select({ code: s.vehicleSizeClasses.code })
      .from(s.vehicleSizeClasses).where(eq(s.vehicleSizeClasses.id, id)).limit(1);
    if (!current) throw new ApiError(404, 'Không tìm thấy loại xe');
    if ('code' in (req.body ?? {}) && req.body?.code !== current.code) {
      throw new ApiError(400, 'Mã loại xe không thể thay đổi sau khi tạo.');
    }
    return data;
  },
  governance: {
    reasonLabel: 'loại xe',
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
  afterCreate: async () => { cacheInvalidatePattern(REPORT_CACHE_KEYS.pnlPattern); },
  afterUpdate: async () => { cacheInvalidatePattern(REPORT_CACHE_KEYS.pnlPattern); },
  afterDelete: async () => { cacheInvalidatePattern(REPORT_CACHE_KEYS.pnlPattern); },
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
  // Same identifier-search gap as /customers (taxCode/phone were sortable
  // but not searchable) — see the 2026-09-10 customer report.
  searchableFields: ['shortName', 'name', 'taxCode', 'phone', 'contactPerson'],
  sortableColumns: {
    name: operationalName(s.suppliers.shortName, s.suppliers.name),
    contactPerson: s.suppliers.contactPerson,
    phone: s.suppliers.phone,
    taxCode: s.suppliers.taxCode,
    linkedCustomer: supplierLinkedCustomerNameSortSql,
    payable: supplierPayableSortSql,
    // Dispatch catalog "Loại"/"Trạng thái" columns. Empty-string guard folds an
    // empty types array into NULL so both sit in the nulls-last bucket.
    types: sql`nullif(array_to_string(${s.suppliers.types}, ', '), '')`,
    status: s.suppliers.status,
  },
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
    // Policy fields use the direct versioned command for audit and invariants;
    // name-only changes use the ordinary update path.
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
