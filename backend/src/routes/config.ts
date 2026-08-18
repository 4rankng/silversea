import { Router } from 'express';
import { db } from '../db';
import * as s from '../db/schema';
import { COMPANY_INFO_SETTING_KEYS, companyInfoFromSettings } from '../services/company-info.service';
import { and, eq, isNull, like, ne, sql } from 'drizzle-orm';
// auth + Casbin applied at mount point in index.ts
import {
  customerSchema, customerUpdateSchema, truckSchema, trailerSchema, routeSchema,
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
  businessCalendarDaySchema,
  governanceActionVersionSchema,
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_APPROVAL_TITLES,
  NO_INVOICE_POLICY_DEFAULTS,
} from '@tingting/shared';
import type { Request, Response } from 'express';
import { z, type output } from 'zod';
import { createCrudRouter } from './utils/crud-factory';
import debitNoteTemplatesRouter from './config/debit-note-templates.routes';
import masterDataImportRouter from './config/master-data-import.routes';
import driverUserBindingRouter from './config/driver-user-binding.routes';
import { ApiError } from '../errors';
import {
  getBootstrapData,
  getPricing,
  getFuelConfig,
  getFuelConfigUpdatedAt,
  upsertFuelConfigInTx,
  getFuelPriceHistory,
  getEffectiveFuelPrice,
  syncTrailerFields,
  validateCustomerUniqueness,
} from '../services/config.service';
import { cacheInvalidate, cacheInvalidatePattern } from '../lib/redis';
import { Role } from '@tingting/shared';
import { requireRoles } from '../middleware/casbin';
import {
  installTireInTx,
  removeTireInTx,
  disposeTireInTx,
  transferTireInTx,
  isHttpError,
  assertTireSerialAvailable,
} from '../services/tire.service';
import {
  getSalaryPeriodDefault,
  getSalaryPeriodDefaultFrom,
  updateSalaryPeriodDefaultInTx,
  getSalaryPeriodOverrides,
  upsertSalaryPeriodOverrideInTx,
  updateSalaryPeriodOverrideByIdInTx,
  deleteSalaryPeriodOverrideInTx,
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
import { loadClerkShipmentScope } from '../services/clerk-shipment-scope.service';
import { getPenaltyStats } from '../services/reporting.service';
import { normalizeSupplierTypeSelection } from '../services/supplier-types.service';
import { normalizeTaxCode } from '../services/legal-partner.service';
import { resolveIdempotencyKey, runIdempotent } from '../services/idempotency.service';
import { restrictRouteCreateForIntake } from '../services/route-intake.service';
import {
  buildGovernedConfigSnapshot,
  governedConfigVersionFromUpdatedAt,
  registerGovernedCustomResource,
  requestOrApplyGovernedConfigAction,
} from '../services/price-config-governance.service';
import {
  DURABLE_EFFECT_KIND,
  type DurableEffectInput,
} from '../services/durable-effect.service';
import {
  lockApplicationOwnedUniqueness,
  lockApplicationOwnedUniquenessSet,
} from '../services/application-owned-uniqueness.service';

type SupplierPayload = output<typeof supplierSchema>;
type DriverPayload = Partial<output<typeof driverSchema>>;
type PenaltyReasonPayload = Partial<output<typeof penaltyReasonSchema>>;
type ForwarderExpenseTypePayload = output<typeof forwarderExpenseTypeSchema>;
type NoInvoiceEvidenceType = typeof DEFAULT_NO_INVOICE_EVIDENCE_TYPES[number];
type NoInvoiceApprovalTitle = typeof NO_INVOICE_APPROVAL_TITLES[number];
type CrudTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CustomerMutationPayload = Partial<output<typeof customerUpdateSchema>>;
type RoadConfigGovernedPayload = output<typeof roadConfigGovernanceSchema>;

function normalizeCatalogKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi-VN');
}

async function lockCatalogRelationship(
  tx: CrudTx,
  resource: string,
  id: number | null | undefined,
): Promise<void> {
  if (id == null) return;
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID liên kết không hợp lệ');
  await lockApplicationOwnedUniqueness(tx, `relationship.${resource}`, [id]);
}

async function requireActiveCatalogRow(
  tx: CrudTx,
  resource: string,
  table: typeof s.customers | typeof s.routes | typeof s.cargoTypes | typeof s.trucks
    | typeof s.trailers | typeof s.suppliers | typeof s.containerTypes | typeof s.ports,
  id: number | null | undefined,
  message: string,
): Promise<void> {
  if (id == null) return;
  await lockCatalogRelationship(tx, resource, id);
  const [row] = await tx.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1)
    .for('share');
  if (!row) throw new ApiError(400, message);
}

async function requireExistingRow(
  tx: CrudTx,
  resource: string,
  table: typeof s.shipments | typeof s.trips,
  id: number | null | undefined,
  message: string,
): Promise<void> {
  if (id == null) return;
  await lockCatalogRelationship(tx, resource, id);
  const [row] = await tx.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), isNull(table.deletedAt)))
    .limit(1)
    .for('share');
  if (!row) throw new ApiError(400, message);
}

async function assertUniqueCatalogString(args: {
  tx: CrudTx;
  scope: string;
  value: unknown;
  id?: number;
  table: typeof s.trucks | typeof s.trailers | typeof s.tires | typeof s.tirePositions
    | typeof s.containerTypes | typeof s.ports | typeof s.forwarderExpenseTypes;
  column: typeof s.trucks.licensePlate | typeof s.trailers.licensePlate | typeof s.tires.serial
    | typeof s.tirePositions.name | typeof s.containerTypes.code | typeof s.ports.code
    | typeof s.forwarderExpenseTypes.code;
  message: string;
}): Promise<void> {
  const key = normalizeCatalogKey(args.value);
  if (!key) return;
  await lockApplicationOwnedUniqueness(args.tx, `catalog.${args.scope}`, [key]);
  const conditions = [
    sql`upper(regexp_replace(btrim(${args.column}), '\\s+', ' ', 'g')) = ${key}`,
    isNull(args.table.deletedAt),
  ];
  if (args.id != null) conditions.push(ne(args.table.id, args.id));
  const [duplicate] = await args.tx.select({ id: args.table.id }).from(args.table)
    .where(and(...conditions))
    .limit(1);
  if (duplicate) throw new ApiError(409, args.message);
}

async function lockCatalogDelete(tx: CrudTx, resource: string, id: number): Promise<void> {
  await lockCatalogRelationship(tx, resource, id);
}

async function lockCustomerMutationKeys(
  tx: CrudTx,
  data: CustomerMutationPayload,
  id?: number,
): Promise<void> {
  const [current] = id == null
    ? [undefined]
    : await tx.select({ name: s.customers.name, taxCode: s.customers.taxCode })
      .from(s.customers).where(eq(s.customers.id, id)).limit(1);
  const name = String(data.name ?? current?.name ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi-VN');
  const taxCode = normalizeTaxCode(data.taxCode ?? current?.taxCode);
  const claims = [
    ...(name ? [{ scope: 'catalog.customer.name-tax-code', parts: [name, taxCode] }] : []),
    ...(taxCode ? [{ scope: 'catalog.customer.tax-code', parts: [taxCode] }] : []),
  ];
  if (claims.length > 0) await lockApplicationOwnedUniquenessSet(tx, claims);
}

const roadConfigGovernanceSchema = z.object({
  tollPerStation: z.coerce.number().finite().min(0),
  returnCargoBonus: z.coerce.number().finite().min(0),
  defaultDriverSalary: z.coerce.number().finite().min(0).optional(),
  twoPointDeliveryBonus: z.coerce.number().finite().min(0).optional(),
  vehicleShiftDefault: z.coerce.number().finite().min(0).optional(),
});

const ROAD_CONFIG_FALLBACKS = {
  defaultDriverSalary: 400000,
  twoPointDeliveryBonus: 200000,
  vehicleShiftDefault: 200000,
} as const;

const GOVERNED_SINGLETON_RESOURCES = {
  roadConfig: 'road-config',
  fuelConfig: 'fuel-config',
  companyInfo: 'company-info',
  salaryDefault: 'salary-period-default',
  salaryOverride: 'salary-period-override',
} as const;
const CONFIG_COMMANDS = {
  TIRE_INSTALL: 'config.tires.install',
  TIRE_REMOVE: 'config.tires.remove',
  TIRE_DISPOSE: 'config.tires.dispose',
  TIRE_TRANSFER: 'config.tires.transfer',
  ROAD_CONFIG_UPDATE: 'config.road-config.update',
  FUEL_CONFIG_UPDATE: 'config.fuel-config.update',
  COMPANY_INFO_UPDATE: 'config.company-info.update',
  SALARY_DEFAULT_UPDATE: 'config.salary-periods.default.update',
  SALARY_OVERRIDE_CREATE: 'config.salary-periods.override.create',
  SALARY_OVERRIDE_UPDATE: 'config.salary-periods.override.update',
  SALARY_OVERRIDE_DELETE: 'config.salary-periods.override.delete',
  SALARY_EXCLUSION_CREATE: 'config.salary-periods.exclusion.create',
  SALARY_EXCLUSION_CHECK: 'config.salary-periods.exclusion.check',
  SALARY_EXCLUSION_APPROVE: 'config.salary-periods.exclusion.approve',
  SALARY_EXCLUSION_FOLLOWUP_COMPLETE: 'config.salary-periods.exclusion.followup.complete',
  SALARY_CLOSE_REQUEST: 'config.salary-periods.close.request',
  SALARY_CLOSE_CHECK: 'config.salary-periods.close.check',
  SALARY_CLOSE_APPROVE: 'config.salary-periods.close.approve',
  SALARY_REOPEN_REQUEST: 'config.salary-periods.reopen.request',
  SALARY_REOPEN_CHECK: 'config.salary-periods.reopen.check',
  SALARY_REOPEN_APPROVE: 'config.salary-periods.reopen.approve',
} as const;

const MATERIAL_CUSTOMER_CONFIG_FIELDS = new Set<keyof CustomerMutationPayload>([
  'name',
  'phone',
  'contactInfo',
  'taxCode',
  'creditLimit',
  'creditWarningThreshold',
  'paymentTermDays',
  'paymentDatePolicy',
  'debitNoteMode',
  'debitNoteTemplateId',
  'linkedSupplierId',
  // This share directly changes the amount collected through customer AR.
  'fuelSurchargeSharePct',
]);

function hasMaterialCustomerConfigChange(data: CustomerMutationPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_CUSTOMER_CONFIG_FIELDS.has(key as keyof CustomerMutationPayload));
}

/**
 * Edit forms resend the full record on every save, so key presence alone would
 * route every update through approval even when nothing material changed.
 * Compare the incoming values against the current row instead; treat numeric
 * strings ("10.00") as equal to their numeric payload (10), compare arrays of
 * primitives as sets (jsonb evidence lists), and skip keys the payload omits.
 */
function sameConfigValue(current: unknown, incoming: unknown): boolean {
  if (incoming === undefined) return true;
  if (current === null || incoming === null) return current === incoming;
  if (Array.isArray(current) || Array.isArray(incoming)) {
    if (!Array.isArray(current) || !Array.isArray(incoming)) return false;
    if (current.length !== incoming.length) return false;
    const sorted = (values: unknown[]) => [...values].map(String).sort();
    return sorted(current).join(' ') === sorted(incoming).join(' ');
  }
  if (typeof current === 'number' || typeof incoming === 'number') {
    return Number(current) === Number(incoming);
  }
  return String(current) === String(incoming);
}

function hasMaterialValueChange(
  fields: ReadonlySet<string>,
  data: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return Object.entries(data).some(([key, value]) => (
    fields.has(key) && !sameConfigValue(current[key], value)
  ));
}

function hasMaterialCustomerUpdate(
  data: CustomerMutationPayload,
  current: typeof s.customers.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_CUSTOMER_CONFIG_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

const MATERIAL_DRIVER_FIELDS = new Set<keyof DriverPayload>([
  'baseSalary',
  'socialInsurance',
]);

function hasMaterialDriverConfigChange(data: DriverPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_DRIVER_FIELDS.has(key as keyof DriverPayload));
}

function hasMaterialDriverUpdate(
  data: DriverPayload,
  current: typeof s.drivers.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_DRIVER_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

const MATERIAL_PENALTY_REASON_FIELDS = new Set<keyof PenaltyReasonPayload>([
  'defaultAmount',
]);

function hasMaterialPenaltyReasonChange(data: PenaltyReasonPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_PENALTY_REASON_FIELDS.has(key as keyof PenaltyReasonPayload));
}

function hasMaterialPenaltyReasonUpdate(
  data: PenaltyReasonPayload,
  current: typeof s.penaltyReasons.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_PENALTY_REASON_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

async function markCompletedFuelSurchargeTripsDirty(
  tx: CrudTx,
  scope?: { customerId?: number },
): Promise<void> {
  const conditions = [
    eq(s.trips.status, 'COMPLETED'),
    sql`${s.trips.fuelSurchargeSnapshot} is not null`,
  ];
  if (scope?.customerId != null) {
    conditions.push(eq(s.trips.customerId, scope.customerId));
  }
  await tx.update(s.trips)
    .set({ fuelSurchargeSnapshotDirty: true })
    .where(and(...conditions));
}

const MATERIAL_FORWARDER_POLICY_FIELDS = new Set<keyof ForwarderExpenseTypePayload>([
  'requiresInvoice',
  'substituteEvidenceAllowed',
  'noInvoiceEvidenceTypes',
  'noInvoicePerItemLimit',
  'noInvoicePerDayLimit',
  'noInvoiceFinanceLeadItemApprovalLimit',
  'noInvoiceDirectorDayApprovalLimit',
  'noInvoiceFinanceLeadApprovalTitle',
  'noInvoiceDirectorApprovalTitle',
  'noInvoicePolicyVersion',
  'defaultMarkup',
  'billingLabel',
  'vatRate',
]);

function hasMaterialForwarderExpenseTypeChange(
  data: Partial<ForwarderExpenseTypePayload>,
): boolean {
  return Object.keys(data).some((key) => MATERIAL_FORWARDER_POLICY_FIELDS.has(key as keyof ForwarderExpenseTypePayload));
}

function hasMaterialForwarderExpenseTypeUpdate(
  data: Partial<ForwarderExpenseTypePayload>,
  current: typeof s.forwarderExpenseTypes.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_FORWARDER_POLICY_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

function requireIdempotencyKey(req: Request, message: string): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) throw new ApiError(400, message);
  return key;
}

function readExpectedUpdatedAt(req: Request): Date | undefined {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return undefined;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const expected = readExpectedUpdatedAt(req);
  if (!expected) throw new ApiError(428, message);
  return expected;
}

function assertOptionalVersion(current: Date | null, expected: Date | undefined, message: string): void {
  if (!current) return;
  if (!expected) throw new ApiError(428, message);
  if (current.getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

function governedConfigVersion(row: { updatedAt: Date } | null): number {
  return row ? governedConfigVersionFromUpdatedAt(row.updatedAt) : 0;
}

function assertGovernedSnapshotUnchanged(
  resource: string,
  beforeFingerprint: string | null,
  originalVersion: number,
  current: Record<string, unknown> | null,
  updatedAt: Date | null,
): void {
  const currentSnapshot = buildGovernedConfigSnapshot(resource, current);
  const currentVersion = updatedAt ? governedConfigVersionFromUpdatedAt(updatedAt) : 0;
  if (currentSnapshot.fingerprint !== beforeFingerprint || currentVersion !== originalVersion) {
    throw new ApiError(409, 'Cấu hình gốc đã thay đổi; vui lòng lập yêu cầu mới');
  }
}

async function getCompanyInfoUpdatedAt(
  q: typeof db | CrudTx = db,
): Promise<string | null> {
  const rows = await q.select({ updatedAt: s.appSettings.updatedAt })
    .from(s.appSettings)
    .where(like(s.appSettings.key, 'company.%'));
  const latest = rows.reduce<Date | null>(
    (current, row) => !current || row.updatedAt > current ? row.updatedAt : current,
    null,
  );
  return latest?.toISOString() ?? null;
}

async function getCompanyInfoGovernedState(
  q: typeof db | CrudTx = db,
): Promise<(Record<string, unknown> & { updatedAt: Date | null }) | null> {
  const rows = await q.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  const updatedAt = await getCompanyInfoUpdatedAt(q);
  if (rows.length === 0 && !updatedAt) return null;
  const { ...current } = companyInfoFromSettings(rows);
  return {
    ...current,
    updatedAt: updatedAt ? new Date(updatedAt) : null,
  };
}

function salaryOverrideSubjectKey(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function numberFromRoadConfigValue(value: string | null | undefined, fallback: number): number {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRoadConfigPayload(
  payload: RoadConfigGovernedPayload,
  existing?: typeof s.roadConfig.$inferSelect | null,
) {
  return {
    tollPerStation: payload.tollPerStation,
    returnCargoBonus: payload.returnCargoBonus,
    defaultDriverSalary: payload.defaultDriverSalary
      ?? numberFromRoadConfigValue(existing?.defaultDriverSalary ?? null, ROAD_CONFIG_FALLBACKS.defaultDriverSalary),
    twoPointDeliveryBonus: payload.twoPointDeliveryBonus
      ?? numberFromRoadConfigValue(existing?.twoPointDeliveryBonus ?? null, ROAD_CONFIG_FALLBACKS.twoPointDeliveryBonus),
    vehicleShiftDefault: payload.vehicleShiftDefault
      ?? numberFromRoadConfigValue(existing?.vehicleShiftDefault ?? null, ROAD_CONFIG_FALLBACKS.vehicleShiftDefault),
  };
}

function toRoadConfigStorageValues(payload: ReturnType<typeof normalizeRoadConfigPayload>, updatedAt: Date) {
  return {
    tollPerStation: String(payload.tollPerStation),
    returnCargoBonus: String(payload.returnCargoBonus),
    defaultDriverSalary: String(payload.defaultDriverSalary),
    twoPointDeliveryBonus: String(payload.twoPointDeliveryBonus),
    vehicleShiftDefault: String(payload.vehicleShiftDefault),
    updatedAt,
  };
}

function cacheInvalidateEffect(actionId: number, key: string): DurableEffectInput {
  return {
    kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
    payloadVersion: 1,
    dedupeKey: `cache-invalidate:${key}:governance-action:${actionId}`,
    payload: { key },
  };
}

registerGovernedCustomResource({
  resource: GOVERNED_SINGLETON_RESOURCES.roadConfig,
  reasonLabel: 'cấu hình đi đường',
  apply: async (tx, action, before, after) => {
    const [existing] = await tx.select().from(s.roadConfig).limit(1).for('update');
    const payload = normalizeRoadConfigPayload(roadConfigGovernanceSchema.parse(after.data), existing ?? null);
    assertGovernedSnapshotUnchanged(
      GOVERNED_SINGLETON_RESOURCES.roadConfig,
      before.fingerprint,
      action.originalVersion,
      existing ?? null,
      existing?.updatedAt ?? null,
    );
    const nextUpdatedAt = new Date(Math.max(Date.now(), (existing?.updatedAt?.getTime() ?? 0) + 1));
    const values = toRoadConfigStorageValues(payload, nextUpdatedAt);
    const [saved] = existing
      ? await tx.update(s.roadConfig)
        .set(values)
        .where(eq(s.roadConfig.id, existing.id))
        .returning()
      : await tx.insert(s.roadConfig)
        .values(values)
        .returning();
    if (!saved) throw new ApiError(409, 'Không thể lưu cấu hình đường');
    return {
      applicationResult: {
        resource: GOVERNED_SINGLETON_RESOURCES.roadConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: saved.id,
        resultingVersion: governedConfigVersionFromUpdatedAt(saved.updatedAt),
      },
      durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
    };
  },
});

registerGovernedCustomResource({
  resource: GOVERNED_SINGLETON_RESOURCES.fuelConfig,
  reasonLabel: 'cấu hình nhiên liệu',
  apply: async (tx, action, before, after) => {
    const payload = fuelConfigSchema.parse(after.data);
    const currentUpdatedAt = await getFuelConfigUpdatedAt(tx);
    const [existing] = await tx.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1).for('update');
    assertGovernedSnapshotUnchanged(
      GOVERNED_SINGLETON_RESOURCES.fuelConfig,
      before.fingerprint,
      action.originalVersion,
      existing ?? null,
      currentUpdatedAt ? new Date(currentUpdatedAt) : null,
    );
    const saved = await upsertFuelConfigInTx(tx, payload, action.approverId ?? undefined);
    const currentPriceChanged = String(existing?.unitPrice ?? '') !== String(saved.result.unitPrice ?? '');
    const basePriceChanged = String(existing?.baseUnitPrice ?? '') !== String(saved.result.baseUnitPrice ?? '');
    if (currentPriceChanged || basePriceChanged) {
      await markCompletedFuelSurchargeTripsDirty(tx);
    }
    return {
      applicationResult: {
        resource: GOVERNED_SINGLETON_RESOURCES.fuelConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: saved.result.id,
        resultingVersion: governedConfigVersionFromUpdatedAt(saved.result.updatedAt),
      },
      durableEffects: [
        cacheInvalidateEffect(action.id, 'config:fuel'),
        cacheInvalidateEffect(action.id, 'config:fuel-price-history'),
      ],
    };
  },
});

registerGovernedCustomResource({
  resource: GOVERNED_SINGLETON_RESOURCES.companyInfo,
  reasonLabel: 'thông tin pháp lý công ty',
  apply: async (tx, action, before, after) => {
    const candidate = after.data as Record<string, unknown>;
    const payload = companyInfoSchema.parse({
      ...candidate,
      shortName: typeof candidate.shortName === 'string' && candidate.shortName.trim()
        ? candidate.shortName
        : candidate.name,
    });
    const current = await getCompanyInfoGovernedState(tx);
    assertGovernedSnapshotUnchanged(
      GOVERNED_SINGLETON_RESOURCES.companyInfo,
      before.fingerprint,
      action.originalVersion,
      current,
      current?.updatedAt ?? null,
    );
    const now = new Date();
    await tx.insert(s.appSettings)
      .values(
        Object.entries(COMPANY_INFO_SETTING_KEYS).map(([field, key]) => ({
          key,
          value: (payload[field as keyof typeof COMPANY_INFO_SETTING_KEYS] ?? '') as string,
        })),
      )
      .onConflictDoUpdate({
        target: s.appSettings.key,
        set: {
          value: sql`excluded.setting_value`,
          updatedAt: now,
        },
      });
    return {
      applicationResult: {
        resource: GOVERNED_SINGLETON_RESOURCES.companyInfo,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: null,
        resultingVersion: governedConfigVersionFromUpdatedAt(now),
      },
      durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
    };
  },
});

registerGovernedCustomResource({
  resource: GOVERNED_SINGLETON_RESOURCES.salaryDefault,
  reasonLabel: 'mặc định kỳ lương',
  apply: async (tx, action, before, after) => {
    const payload = salaryPeriodDefaultSchema.parse(after.data);
    const current = await getSalaryPeriodDefaultFrom(tx);
    assertGovernedSnapshotUnchanged(
      GOVERNED_SINGLETON_RESOURCES.salaryDefault,
      before.fingerprint,
      action.originalVersion,
      current,
      current?.updatedAt ?? null,
    );
    const saved = await updateSalaryPeriodDefaultInTx(tx, payload.defaultStartDay, payload.defaultEndDay);
    return {
      applicationResult: {
        resource: GOVERNED_SINGLETON_RESOURCES.salaryDefault,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: saved.id,
        resultingVersion: governedConfigVersionFromUpdatedAt(saved.updatedAt),
      },
      durableEffects: [cacheInvalidateEffect(action.id, 'catalogs:bootstrap')],
    };
  },
});

registerGovernedCustomResource({
  resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
  reasonLabel: 'kỳ lương theo tháng',
  apply: async (tx, action, before, after, delta) => {
    if (delta.operation === 'CREATE') {
      const payload = salaryPeriodSchema.parse(after.data);
      const [current] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.month, payload.month),
          eq(s.salaryPeriods.year, payload.year),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      assertGovernedSnapshotUnchanged(
        GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        before.fingerprint,
        action.originalVersion,
        current ?? null,
        current?.updatedAt ?? null,
      );
      const saved = await upsertSalaryPeriodOverrideInTx(
        tx,
        payload.month,
        payload.year,
        payload.startDate,
        payload.endDate,
        payload.label,
      );
      await cacheInvalidate('catalogs:bootstrap');
      return {
        applicationResult: {
          resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
          operation: 'CREATE',
          subjectId: saved.id,
          resultingVersion: governedConfigVersionFromUpdatedAt(saved.updatedAt),
        },
      };
    }

    if (action.subjectId == null) {
      throw new ApiError(409, 'Yêu cầu kỳ lương thiếu đối tượng gốc');
    }
    const [current] = await tx.select()
      .from(s.salaryPeriods)
      .where(and(
        eq(s.salaryPeriods.id, action.subjectId),
        eq(s.salaryPeriods.isDefault, false),
        isNull(s.salaryPeriods.deletedAt),
      ))
      .limit(1)
      .for('update');
    if (!current) throw new ApiError(404, 'Không tìm thấy kỳ lương');
    assertGovernedSnapshotUnchanged(
      GOVERNED_SINGLETON_RESOURCES.salaryOverride,
      before.fingerprint,
      action.originalVersion,
      current,
      current.updatedAt,
    );
    if (delta.operation === 'DELETE') {
      const deleted = await deleteSalaryPeriodOverrideInTx(tx, action.subjectId);
      if (!deleted) throw new ApiError(404, 'Không tìm thấy kỳ lương');
      await cacheInvalidate('catalogs:bootstrap');
      return {
        applicationResult: {
          resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
          operation: 'DELETE',
          subjectId: deleted.id,
          resultingVersion: governedConfigVersionFromUpdatedAt(deleted.updatedAt),
        },
      };
    }
    const payload = salaryPeriodSchema.parse(after.data);
    const updated = await updateSalaryPeriodOverrideByIdInTx(
      tx,
      action.subjectId,
      payload.month,
      payload.year,
      payload.startDate,
      payload.endDate,
      payload.label,
    );
    if (!updated) throw new ApiError(404, 'Không tìm thấy kỳ lương');
    await cacheInvalidate('catalogs:bootstrap');
    return {
      applicationResult: {
        resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: 'UPDATE',
        subjectId: updated.id,
        resultingVersion: governedConfigVersionFromUpdatedAt(updated.updatedAt),
      },
    };
  },
});

function displayTaxCode(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, '');
}

async function upsertPartnerInTransaction(
  tx: CrudTx,
  taxCode: string | null | undefined,
): Promise<number | null> {
  const normalizedTaxCode = normalizeTaxCode(taxCode);
  if (!normalizedTaxCode) return null;
  await lockApplicationOwnedUniqueness(tx, 'partners.normalized-tax-code', [normalizedTaxCode]);
  const [existing] = await tx.select({ id: s.partners.id })
    .from(s.partners)
    .where(eq(s.partners.normalizedTaxCode, normalizedTaxCode))
    .limit(1)
    .for('update');
  if (existing) {
    await tx.update(s.partners).set({
      displayTaxCode: displayTaxCode(taxCode),
      updatedAt: new Date(),
    }).where(eq(s.partners.id, existing.id));
    return existing.id;
  }
  const [created] = await tx.insert(s.partners).values({
    normalizedTaxCode,
    displayTaxCode: displayTaxCode(taxCode),
    currency: 'VND',
  }).returning({ id: s.partners.id });
  return created.id;
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
  // Short-name write boundary: explicit-but-blank shortName falls back to the
  // full name (zod rejects blank before this on the API path, so this covers
  // internal callers). Key-absent creates store '' and display falls back at
  // read time via operationalName — same end-state as the customers hook.
  const shortName = typeof data.shortName === 'string' ? data.shortName.trim() : '';
  if ('name' in data && 'shortName' in data) {
    data.shortName = shortName || (data.name ?? '').toString().trim();
  }
  if (!('types' in data) && !('primaryType' in data)) return data;
  let sourceTypes: unknown = data.types;
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

function normalizeNoInvoiceApprovalTitle(
  value: NoInvoiceApprovalTitle | undefined,
  fallback: NoInvoiceApprovalTitle,
): NoInvoiceApprovalTitle {
  return value ?? fallback;
}

function normalizeForwarderExpenseTypePayload(
  data: Partial<ForwarderExpenseTypePayload>,
  options: { fillDefaults: boolean },
): Partial<ForwarderExpenseTypePayload> {
  const requiresInvoice = data.requiresInvoice === true;
  const substituteEvidenceAllowed = requiresInvoice
    ? false
    : options.fillDefaults
      ? data.substituteEvidenceAllowed !== false
      : data.substituteEvidenceAllowed;
  const noInvoiceEvidenceTypes: NoInvoiceEvidenceType[] = substituteEvidenceAllowed
    ? Array.from(new Set<NoInvoiceEvidenceType>(
      Array.isArray(data.noInvoiceEvidenceTypes)
        ? data.noInvoiceEvidenceTypes
        : DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
    ))
    : [];
  const normalized: Partial<ForwarderExpenseTypePayload> = {
    ...data,
  };
  if (options.fillDefaults || 'requiresInvoice' in data) {
    normalized.requiresInvoice = requiresInvoice;
  }
  if (options.fillDefaults || 'substituteEvidenceAllowed' in data || 'requiresInvoice' in data) {
    normalized.substituteEvidenceAllowed = requiresInvoice ? false : substituteEvidenceAllowed;
  }
  if (
    options.fillDefaults
    || 'noInvoiceEvidenceTypes' in data
    || 'substituteEvidenceAllowed' in data
    || 'requiresInvoice' in data
  ) {
    normalized.noInvoiceEvidenceTypes = substituteEvidenceAllowed ? noInvoiceEvidenceTypes : [];
  }
  if (options.fillDefaults || 'noInvoicePerItemLimit' in data) {
    normalized.noInvoicePerItemLimit = data.noInvoicePerItemLimit ?? NO_INVOICE_POLICY_DEFAULTS.perItemLimit;
  }
  if (options.fillDefaults || 'noInvoicePerDayLimit' in data) {
    normalized.noInvoicePerDayLimit = data.noInvoicePerDayLimit ?? NO_INVOICE_POLICY_DEFAULTS.perDayLimit;
  }
  if (options.fillDefaults || 'noInvoiceFinanceLeadItemApprovalLimit' in data) {
    normalized.noInvoiceFinanceLeadItemApprovalLimit = data.noInvoiceFinanceLeadItemApprovalLimit ?? NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit;
  }
  if (options.fillDefaults || 'noInvoiceDirectorDayApprovalLimit' in data) {
    normalized.noInvoiceDirectorDayApprovalLimit = data.noInvoiceDirectorDayApprovalLimit ?? NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit;
  }
  if (options.fillDefaults || 'noInvoiceFinanceLeadApprovalTitle' in data) {
    normalized.noInvoiceFinanceLeadApprovalTitle = normalizeNoInvoiceApprovalTitle(
      data.noInvoiceFinanceLeadApprovalTitle,
      'FINANCE_LEAD',
    );
  }
  if (options.fillDefaults || 'noInvoiceDirectorApprovalTitle' in data) {
    normalized.noInvoiceDirectorApprovalTitle = normalizeNoInvoiceApprovalTitle(
      data.noInvoiceDirectorApprovalTitle,
      'DIRECTOR',
    );
  }
  return normalized;
}

async function withForwarderExpenseTypePolicyVersion(
  id: number | null,
  data: Partial<ForwarderExpenseTypePayload>,
  tx: CrudTx | typeof db = db,
): Promise<Partial<ForwarderExpenseTypePayload>> {
  if (id == null) {
    return {
      ...normalizeForwarderExpenseTypePayload(data, { fillDefaults: true }),
      noInvoicePolicyVersion: 1,
    };
  }
  if (!hasMaterialForwarderExpenseTypeChange(data)) {
    return data;
  }
  const [existing] = await tx.select({
    requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
    substituteEvidenceAllowed: s.forwarderExpenseTypes.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: s.forwarderExpenseTypes.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: s.forwarderExpenseTypes.noInvoicePerItemLimit,
    noInvoicePerDayLimit: s.forwarderExpenseTypes.noInvoicePerDayLimit,
    noInvoiceFinanceLeadItemApprovalLimit: s.forwarderExpenseTypes.noInvoiceFinanceLeadItemApprovalLimit,
    noInvoiceDirectorDayApprovalLimit: s.forwarderExpenseTypes.noInvoiceDirectorDayApprovalLimit,
    noInvoiceFinanceLeadApprovalTitle: s.forwarderExpenseTypes.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: s.forwarderExpenseTypes.noInvoiceDirectorApprovalTitle,
    noInvoicePolicyVersion: s.forwarderExpenseTypes.noInvoicePolicyVersion,
  }).from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.id, id))
    .limit(1);
  if (!existing) return data;
  const existingPolicy: Partial<ForwarderExpenseTypePayload> = {
    requiresInvoice: existing.requiresInvoice ?? false,
    substituteEvidenceAllowed: existing.substituteEvidenceAllowed ?? true,
    noInvoiceEvidenceTypes: (existing.noInvoiceEvidenceTypes ?? []) as NoInvoiceEvidenceType[],
    noInvoicePerItemLimit: existing.noInvoicePerItemLimit == null
      ? NO_INVOICE_POLICY_DEFAULTS.perItemLimit
      : Number(existing.noInvoicePerItemLimit),
    noInvoicePerDayLimit: existing.noInvoicePerDayLimit == null
      ? NO_INVOICE_POLICY_DEFAULTS.perDayLimit
      : Number(existing.noInvoicePerDayLimit),
    noInvoiceFinanceLeadItemApprovalLimit: existing.noInvoiceFinanceLeadItemApprovalLimit == null
      ? NO_INVOICE_POLICY_DEFAULTS.financeLeadItemApprovalLimit
      : Number(existing.noInvoiceFinanceLeadItemApprovalLimit),
    noInvoiceDirectorDayApprovalLimit: existing.noInvoiceDirectorDayApprovalLimit == null
      ? NO_INVOICE_POLICY_DEFAULTS.directorDayApprovalLimit
      : Number(existing.noInvoiceDirectorDayApprovalLimit),
    noInvoiceFinanceLeadApprovalTitle: normalizeNoInvoiceApprovalTitle(
      (existing.noInvoiceFinanceLeadApprovalTitle ?? undefined) as NoInvoiceApprovalTitle | undefined,
      'FINANCE_LEAD',
    ),
    noInvoiceDirectorApprovalTitle: normalizeNoInvoiceApprovalTitle(
      (existing.noInvoiceDirectorApprovalTitle ?? undefined) as NoInvoiceApprovalTitle | undefined,
      'DIRECTOR',
    ),
    noInvoicePolicyVersion: existing.noInvoicePolicyVersion,
  };
  const normalized = normalizeForwarderExpenseTypePayload({
    ...existingPolicy,
    ...data,
  }, { fillDefaults: true });
  const policyChanged = JSON.stringify({
    requiresInvoice: existingPolicy.requiresInvoice,
    substituteEvidenceAllowed: existingPolicy.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: existingPolicy.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: String(existingPolicy.noInvoicePerItemLimit),
    noInvoicePerDayLimit: String(existingPolicy.noInvoicePerDayLimit),
    noInvoiceFinanceLeadItemApprovalLimit: String(existingPolicy.noInvoiceFinanceLeadItemApprovalLimit),
    noInvoiceDirectorDayApprovalLimit: String(existingPolicy.noInvoiceDirectorDayApprovalLimit),
    noInvoiceFinanceLeadApprovalTitle: existingPolicy.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: existingPolicy.noInvoiceDirectorApprovalTitle,
  }) !== JSON.stringify({
    requiresInvoice: normalized.requiresInvoice,
    substituteEvidenceAllowed: normalized.substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: normalized.noInvoiceEvidenceTypes,
    noInvoicePerItemLimit: String(normalized.noInvoicePerItemLimit),
    noInvoicePerDayLimit: String(normalized.noInvoicePerDayLimit),
    noInvoiceFinanceLeadItemApprovalLimit: String(normalized.noInvoiceFinanceLeadItemApprovalLimit),
    noInvoiceDirectorDayApprovalLimit: String(normalized.noInvoiceDirectorDayApprovalLimit),
    noInvoiceFinanceLeadApprovalTitle: normalized.noInvoiceFinanceLeadApprovalTitle,
    noInvoiceDirectorApprovalTitle: normalized.noInvoiceDirectorApprovalTitle,
  });
  return policyChanged
    ? { ...data, ...normalized, noInvoicePolicyVersion: existing.noInvoicePolicyVersion + 1 }
    : { ...data, noInvoicePolicyVersion: existing.noInvoicePolicyVersion };
}

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
    shouldGovernCreate: (data) => hasMaterialCustomerConfigChange(data as CustomerMutationPayload),
    shouldGovernUpdate: (_id, data, _req, current) => hasMaterialCustomerUpdate(data as CustomerMutationPayload, current),
    shouldGovernDelete: () => true,
  },
  beforeCreate: async (data, _req, tx) => {
    data.shortName = data.shortName?.trim() || data.name.trim();
    await lockCustomerMutationKeys(tx, data);
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
    await lockCustomerMutationKeys(tx, data, id);
    await validateCustomerUniqueness(data, id);
    return data;
  },
  afterCreate: async (item, data, _req, tx) => {
    await syncCustomerRelationsHook(tx, item, data);
  },
  afterUpdate: async (item, data, _req, tx) => {
    await syncCustomerRelationsHook(tx, item, data);
    if ('fuelSurchargeSharePct' in data) {
      await markCompletedFuelSurchargeTripsDirty(tx, { customerId: item.id });
    }
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'customer', id),
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
    await assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    await requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
    return syncTrailerFields(data);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.licensePlate !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'truck.license-plate', value: data.licensePlate, id, table: s.trucks, column: s.trucks.licensePlate, message: 'Biển số xe đầu kéo đã tồn tại' });
    }
    if (data.currentTrailerId !== undefined) {
      await requireActiveCatalogRow(tx, 'trailer', s.trailers, data.currentTrailerId, 'Rơ-moóc liên kết không tồn tại hoặc đã ngưng dùng');
      return syncTrailerFields(data);
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'truck', id),
}));
router.use('/trailers', createCrudRouter(s.trailers, trailerSchema, {
  searchableField: 'licensePlate',
  beforeCreate: async (data, _req, tx) => {
    await assertUniqueCatalogString({ tx, scope: 'trailer.license-plate', value: data.licensePlate, table: s.trailers, column: s.trailers.licensePlate, message: 'Biển số rơ-moóc đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.licensePlate !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'trailer.license-plate', value: data.licensePlate, id, table: s.trailers, column: s.trailers.licensePlate, message: 'Biển số rơ-moóc đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'trailer', id),
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
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'route', id),
}));
router.use('/cargo-types', createCrudRouter(s.cargoTypes, cargoTypeSchema, {
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'cargo-type', id),
}));
router.use('/container-types', createCrudRouter(s.containerTypes, containerTypeSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await assertUniqueCatalogString({ tx, scope: 'container-type.code', value: data.code, table: s.containerTypes, column: s.containerTypes.code, message: 'Mã loại container đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'container-type.code', value: data.code, id, table: s.containerTypes, column: s.containerTypes.code, message: 'Mã loại container đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'container-type', id),
}));
router.use('/seal-types', createCrudRouter(s.sealTypes, sealTypeSchema, { searchableField: 'name' }));
router.use('/ports', createCrudRouter(s.ports, portSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await assertUniqueCatalogString({ tx, scope: 'port.code', value: data.code, table: s.ports, column: s.ports.code, message: 'Mã cảng đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'port.code', value: data.code, id, table: s.ports, column: s.ports.code, message: 'Mã cảng đã tồn tại' });
    }
    return data;
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'port', id),
}));
router.use('/forwarder-expense-types', createCrudRouter(s.forwarderExpenseTypes, forwarderExpenseTypeSchema, {
  searchableField: 'name',
  governance: {
    reasonLabel: 'chính sách chứng từ và hạn mức chi hộ',
    shouldGovernCreate: () => true,
    shouldGovernUpdate: (_id, data, _req, current) => hasMaterialForwarderExpenseTypeUpdate(data, current),
    shouldGovernDelete: () => true,
  },
  beforeCreate: async (data, _req, tx) => {
    await assertUniqueCatalogString({ tx, scope: 'forwarder-expense-type.code', value: data.code, table: s.forwarderExpenseTypes, column: s.forwarderExpenseTypes.code, message: 'Mã loại chi phí giao nhận đã tồn tại' });
    return withForwarderExpenseTypePolicyVersion(null, data, tx);
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.code !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'forwarder-expense-type.code', value: data.code, id, table: s.forwarderExpenseTypes, column: s.forwarderExpenseTypes.code, message: 'Mã loại chi phí giao nhận đã tồn tại' });
    }
    return withForwarderExpenseTypePolicyVersion(id, data, tx);
  },
}));
router.use('/pricing-tables', createCrudRouter(s.pricingTables, pricingTableSchema, {
  beforeCreate: async (data, _req, tx) => {
    validatePricingSelector(data);
    await requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'container-type', s.containerTypes, data.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.pricing-table.selector', [
      data.customerId, data.routeId, data.containerTypeId ?? null,
      normalizeCatalogKey(data.rateKey), data.effectiveDate,
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
    await requireActiveCatalogRow(tx, 'customer', s.customers, final.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'route', s.routes, final.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'container-type', s.containerTypes, final.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
    await lockApplicationOwnedUniqueness(tx, 'catalog.pricing-table.selector', [
      final.customerId, final.routeId, final.containerTypeId ?? null,
      normalizeCatalogKey(final.rateKey), final.effectiveDate,
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
    await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
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
    await requireActiveCatalogRow(tx, 'route', s.routes, final.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
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
    await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.routeId !== undefined) await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    if (data.truckId !== undefined) await requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  governance: {
    reasonLabel: 'định mức nhiên liệu',
  },
}));
router.use('/weight-pricing-tiers', createCrudRouter(s.weightPricingTiers, weightPricingTierSchema, {
  beforeCreate: async (data, _req, tx) => {
    await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'cargo-type', s.cargoTypes, data.cargoTypeId, 'Loại hàng không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.routeId !== undefined) await requireActiveCatalogRow(tx, 'route', s.routes, data.routeId, 'Tuyến đường không tồn tại hoặc đã ngưng dùng');
    if (data.cargoTypeId !== undefined) await requireActiveCatalogRow(tx, 'cargo-type', s.cargoTypes, data.cargoTypeId, 'Loại hàng không tồn tại hoặc đã ngưng dùng');
    return data;
  },
  governance: {
    reasonLabel: 'bậc giá theo trọng lượng',
  },
}));
router.use('/lift-pricing', createCrudRouter(s.liftPricing, liftPricingSchema, {
  beforeCreate: async (data, _req, tx) => {
    await requireActiveCatalogRow(tx, 'port', s.ports, data.portId, 'Cảng không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'container-type', s.containerTypes, data.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
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
    await requireActiveCatalogRow(tx, 'port', s.ports, final.portId, 'Cảng không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'container-type', s.containerTypes, final.containerTypeId, 'Loại container không tồn tại hoặc đã ngưng dùng');
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
    await requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    await requireExistingRow(tx, 'shipment', s.shipments, data.shipmentId, 'Lô hàng liên kết không tồn tại');
    await requireExistingRow(tx, 'trip', s.trips, data.tripId, 'Chuyến xe liên kết không tồn tại');
    return data;
  },
  beforeUpdate: async (_id, data, _req, tx) => {
    if (data.amount !== undefined && Number(data.amount) < 0 && (!data.note || !String(data.note).trim())) {
      throw new ApiError(400, 'Lý do hoàn tiền là bắt buộc khi số tiền âm');
    }
    if (data.customerId !== undefined) await requireActiveCatalogRow(tx, 'customer', s.customers, data.customerId, 'Khách hàng không tồn tại hoặc đã ngưng dùng');
    if (data.shipmentId !== undefined) await requireExistingRow(tx, 'shipment', s.shipments, data.shipmentId, 'Lô hàng liên kết không tồn tại');
    if (data.tripId !== undefined) await requireExistingRow(tx, 'trip', s.trips, data.tripId, 'Chuyến xe liên kết không tồn tại');
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
    shouldGovernCreate: (data) => hasMaterialPenaltyReasonChange(data as PenaltyReasonPayload),
    shouldGovernUpdate: (_id, data, _req, current) => hasMaterialPenaltyReasonUpdate(data as PenaltyReasonPayload, current),
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
  afterDelete: async (id, _req, tx) => {
    await tx.update(s.customers)
      .set({ linkedSupplierId: null, updatedAt: new Date() })
      .where(eq(s.customers.linkedSupplierId, id));
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'supplier', id),
}));
router.use('/expense-categories', createCrudRouter(s.expenseCategories, expenseCategorySchema, {
  searchableField: 'name',
  governance: {
    reasonLabel: 'nhóm chi phí',
    shouldGovernCreate: () => true,
    shouldGovernUpdate: () => true,
    shouldGovernDelete: () => true,
  },
  beforeDelete: (id, _req, tx) => lockCatalogDelete(tx, 'expense-category', id),
}));
// Debit-note templates — dedicated transactional router (NOT crud-factory) so the
// single-default invariant is enforced atomically. See the route file's header.
router.use('/debit-note-templates', debitNoteTemplatesRouter);
router.use('/tire-positions', createCrudRouter(s.tirePositions, tirePositionSchema, {
  searchableField: 'name',
  beforeCreate: async (data, _req, tx) => {
    await assertUniqueCatalogString({ tx, scope: 'tire-position.name', value: data.name, table: s.tirePositions, column: s.tirePositions.name, message: 'Vị trí lốp đã tồn tại' });
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.name !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'tire-position.name', value: data.name, id, table: s.tirePositions, column: s.tirePositions.name, message: 'Vị trí lốp đã tồn tại' });
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
    shouldGovernCreate: (data) => hasMaterialDriverConfigChange(data as DriverPayload),
    shouldGovernUpdate: (_id, data, _req, current) => hasMaterialDriverUpdate(data as DriverPayload, current),
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
    await assertUniqueCatalogString({ tx, scope: 'tire.serial', value: data.serial, table: s.tires, column: s.tires.serial, message: 'Số sê-ri lốp đã tồn tại' });
    await requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'trailer', s.trailers, data.trailerId, 'Rơ-moóc không tồn tại hoặc đã ngưng dùng');
    await requireActiveCatalogRow(tx, 'supplier', s.suppliers, data.supplierId, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
    await assertTireSerialAvailable(data.serial);
    return data;
  },
  beforeUpdate: async (id, data, _req, tx) => {
    if (data.truckId && data.trailerId) {
      throw new ApiError(400, 'Lốp chỉ lắp trên xe đầu kéo hoặc rơ-moóc, không cả hai');
    }
    if (data.serial !== undefined) {
      await assertUniqueCatalogString({ tx, scope: 'tire.serial', value: data.serial, id, table: s.tires, column: s.tires.serial, message: 'Số sê-ri lốp đã tồn tại' });
    }
    if (data.truckId !== undefined) await requireActiveCatalogRow(tx, 'truck', s.trucks, data.truckId, 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng');
    if (data.trailerId !== undefined) await requireActiveCatalogRow(tx, 'trailer', s.trailers, data.trailerId, 'Rơ-moóc không tồn tại hoặc đã ngưng dùng');
    if (data.supplierId !== undefined) await requireActiveCatalogRow(tx, 'supplier', s.suppliers, data.supplierId, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
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
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi lắp lốp.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi lắp.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: CONFIG_COMMANDS.TIRE_INSTALL,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => installTireInTx(tx, id, {
        truckId: data.truckId ?? null,
        trailerId: data.trailerId ?? null,
        position: data.position ?? null,
      }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/remove', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tháo lốp.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi tháo.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: CONFIG_COMMANDS.TIRE_REMOVE,
      idempotencyKey,
      payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => removeTireInTx(tx, id, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/dispose', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = disposeTireSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi thanh lý lốp.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi thanh lý.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: CONFIG_COMMANDS.TIRE_DISPOSE,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => disposeTireInTx(tx, id, { reason: data.reason }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
  } catch (e) {
    if (isHttpError(e)) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

tireLifecycleRouter.post('/:id/transfer', requireRoles(Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = transferTireSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi chuyển lốp.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Cần tải lại phiên bản lốp mới nhất trước khi điều chuyển.',
  );
  try {
    const { result, replayed } = await runIdempotent({
      endpoint: CONFIG_COMMANDS.TIRE_TRANSFER,
      idempotencyKey,
      payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
      createdBy: req.user?.userId ?? null,
      entityType: 'tires',
      create: async (tx) => transferTireInTx(tx, id, {
        truckId: data.truckId ?? null,
        trailerId: data.trailerId ?? null,
        position: data.position ?? null,
      }, expectedUpdatedAt),
    });
    if (!replayed) {
      await cacheInvalidatePattern('catalogs:*');
    }
    res.json({ ...result, replayed });
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
  const requestedData = roadConfigGovernanceSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình đường.');
  const expectedUpdatedAt = readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.ROAD_CONFIG_UPDATE,
    idempotencyKey,
    payload: {
      body: requestedData,
      expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null,
    },
    createdBy: actor.userId,
    entityType: 'road-config',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select().from(s.roadConfig).limit(1).for('update');
      assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản cấu hình đường. Vui lòng tải lại trước khi cập nhật.',
      );
      const data = normalizeRoadConfigPayload(requestedData, existing ?? null);
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.roadConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: GOVERNED_SINGLETON_RESOURCES.roadConfig,
        originalVersion: governedConfigVersion(existing ?? null),
        beforeRow: existing ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// Fuel config — singleton GET/PUT
router.get('/fuel-config', asyncHandler(async (_req: Request, res: Response) => {
  const row = await getFuelConfig();
  if (!row) return res.json(null);
  res.json(row);
}));

router.put('/fuel-config', asyncHandler(async (req: Request, res: Response) => {
  const data = fuelConfigSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật cấu hình nhiên liệu.');
  const expectedUpdatedAt = readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.FUEL_CONFIG_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'fuel-config',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select().from(s.fuelConfig).where(isNull(s.fuelConfig.deletedAt)).limit(1).for('update');
      assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản cấu hình nhiên liệu. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.fuelConfig,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: GOVERNED_SINGLETON_RESOURCES.fuelConfig,
        originalVersion: governedConfigVersion(existing ?? null),
        beforeRow: existing ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

// Company info — singleton stored as app_settings key/value rows
router.get('/company-info', asyncHandler(async (_req: Request, res: Response) => {
  // Only the company.* rows are ever relevant; don't load unrelated app_settings.
  const rows = await db.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  res.json({ ...companyInfoFromSettings(rows), updatedAt: await getCompanyInfoUpdatedAt() });
}));

router.put('/company-info', asyncHandler(async (req: Request, res: Response) => {
  const candidate = req.body as Record<string, unknown>;
  const data = companyInfoSchema.parse({
    ...candidate,
    shortName: typeof candidate.shortName === 'string' && candidate.shortName.trim()
      ? candidate.shortName
      : candidate.name,
  });
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật thông tin công ty.');
  const expectedUpdatedAt = readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.COMPANY_INFO_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'app-settings',
    responseStatusCode: 201,
    create: async (tx) => {
      const current = await getCompanyInfoGovernedState(tx);
      assertOptionalVersion(
        current?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản thông tin công ty. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.companyInfo,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: null,
        subjectKey: GOVERNED_SINGLETON_RESOURCES.companyInfo,
        originalVersion: current?.updatedAt ? governedConfigVersionFromUpdatedAt(current.updatedAt) : 0,
        beforeRow: current,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
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
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật mặc định kỳ lương.');
  const expectedUpdatedAt = readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_DEFAULT_UPDATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const current = await getSalaryPeriodDefaultFrom(tx);
      assertOptionalVersion(
        current?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản mặc định kỳ lương. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.salaryDefault,
        operation: current ? 'UPDATE' : 'CREATE',
        subjectId: current?.id ?? null,
        subjectKey: GOVERNED_SINGLETON_RESOURCES.salaryDefault,
        originalVersion: governedConfigVersion(current ?? null),
        beforeRow: current ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

salaryPeriodsAdminRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const items = await getSalaryPeriodOverrides();
  res.json({ items, total: items.length });
}));

salaryPeriodsAdminRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const data = salaryPeriodSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi tạo kỳ lương.');
  const expectedUpdatedAt = readExpectedUpdatedAt(req);
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_OVERRIDE_CREATE,
    idempotencyKey,
    payload: { body: data, expectedUpdatedAt: expectedUpdatedAt?.toISOString() ?? null },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [existing] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.month, data.month),
          eq(s.salaryPeriods.year, data.year),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      assertOptionalVersion(
        existing?.updatedAt ?? null,
        expectedUpdatedAt,
        'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.',
      );
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: existing ? 'UPDATE' : 'CREATE',
        subjectId: existing?.id ?? null,
        subjectKey: salaryOverrideSubjectKey(data.month, data.year),
        originalVersion: governedConfigVersion(existing ?? null),
        beforeRow: existing ?? null,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

salaryPeriodsAdminRouter.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID không hợp lệ' });
  const data = salaryPeriodSchema.parse(req.body);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi cập nhật kỳ lương.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.',
  );
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_OVERRIDE_UPDATE,
    idempotencyKey,
    payload: { id, body: data, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [row] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.id, id),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new ApiError(404, 'Không tìm thấy');
      assertOptionalVersion(row.updatedAt, expectedUpdatedAt, 'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi cập nhật.');
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: 'UPDATE',
        subjectId: id,
        subjectKey: salaryOverrideSubjectKey(data.month, data.year),
        originalVersion: governedConfigVersion(row),
        beforeRow: row,
        afterData: data,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
}));

salaryPeriodsAdminRouter.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  const idempotencyKey = requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi xóa kỳ lương.');
  const expectedUpdatedAt = requireExpectedUpdatedAt(
    req,
    'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi xóa.',
  );
  const actor = getUser(req);
  const { result, replayed } = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_OVERRIDE_DELETE,
    idempotencyKey,
    payload: { id, expectedUpdatedAt: expectedUpdatedAt.toISOString() },
    createdBy: actor.userId,
    entityType: 'salary-periods',
    responseStatusCode: 201,
    create: async (tx) => {
      const [row] = await tx.select()
        .from(s.salaryPeriods)
        .where(and(
          eq(s.salaryPeriods.id, id),
          eq(s.salaryPeriods.isDefault, false),
          isNull(s.salaryPeriods.deletedAt),
        ))
        .limit(1)
        .for('update');
      if (!row) throw new ApiError(404, 'Không tìm thấy');
      assertOptionalVersion(row.updatedAt, expectedUpdatedAt, 'Thiếu phiên bản kỳ lương. Vui lòng tải lại trước khi xóa.');
      return (await requestOrApplyGovernedConfigAction({
        resource: GOVERNED_SINGLETON_RESOURCES.salaryOverride,
        operation: 'DELETE',
        subjectId: id,
        subjectKey: salaryOverrideSubjectKey(row.month ?? 0, row.year ?? 0),
        originalVersion: governedConfigVersion(row),
        beforeRow: row,
        afterData: null,
        makerId: actor.userId,
        makerRole: actor.role,
        transaction: tx,
      })).action;
    },
  });
  res.status(replayed ? 200 : 201).json({ ...result, replayed });
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
  const rawHandlingMode = typeof (body as { handlingMode?: unknown }).handlingMode === 'string'
    ? (body as { handlingMode: string }).handlingMode.trim()
    : '';
  if (rawHandlingMode !== 'SUPPLEMENTARY_PERIOD' && rawHandlingMode !== 'ADJUSTMENT') {
    throw new ApiError(400, 'handlingMode không hợp lệ');
  }
  const handlingMode = rawHandlingMode;
  const targetPeriod = typeof (body as { targetPeriod?: unknown }).targetPeriod === 'string'
    ? (body as { targetPeriod: string }).targetPeriod.trim()
    : null;
  const note = typeof (body as { note?: unknown }).note === 'string'
    ? (body as { note: string }).note
    : null;

  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_EXCLUSION_CREATE,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị loại trừ kỳ lương.'),
    payload: { period, driverId, reason, handlingMode, targetPeriod, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => createSalaryPeriodExclusion({
      period,
      driverId,
      actorId: u.userId,
      actorRole: u.role,
      reason,
      handlingMode,
      targetPeriod,
      note,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_EXCLUSION_CHECK,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra loại trừ kỳ lương.'),
    payload: { period, actionId, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodExclusion({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
      note,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_EXCLUSION_APPROVE,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt loại trừ kỳ lương.'),
    payload: { period, actionId, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodExclusion({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : null,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/exclusions/:actionId/complete-followup', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_EXCLUSION_FOLLOWUP_COMPLETE,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi hoàn tất xử lý lương bổ sung.'),
    payload: { period, actionId },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => completeSalaryPeriodExclusionFollowup({
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      transaction: tx,
    }),
    getEntityId: (result) => result.actionId,
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const period = req.params.period as string;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_CLOSE_REQUEST,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị chốt kỳ lương.'),
    payload: { period, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestSalaryPeriodClose({
      period,
      actorId: u.userId,
      actorRole: u.role,
      reason: note,
      note,
      transaction: tx,
    }),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_CLOSE_CHECK,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra đề nghị chốt kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodClose({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/close-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_CLOSE_APPROVE,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt chốt kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodClose({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen', asyncHandler(async (req: Request, res: Response) => {
  const u = getUser(req);
  const expectedVersion = Number((req.body as { expectedVersion?: unknown } | undefined)?.expectedVersion);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null;
  const note = typeof req.body?.note === 'string' ? req.body.note : null;
  const period = req.params.period as string;
  const normalizedVersion = Number.isInteger(expectedVersion) ? expectedVersion : 0;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_REOPEN_REQUEST,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi đề nghị mở lại kỳ lương.'),
    payload: { period, expectedVersion: normalizedVersion, reason, note },
    createdBy: u.userId,
    entityType: 'governance_action',
    responseStatusCode: 201,
    create: (tx) => requestSalaryPeriodReopen({
      period,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: normalizedVersion,
      reason,
      note,
      transaction: tx,
    }),
  });
  res.status(outcome.statusCode).json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/check', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_REOPEN_CHECK,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi kiểm tra đề nghị mở lại kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => checkSalaryPeriodReopen({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
}));

salaryPeriodsAdminRouter.post('/:period/reopen-actions/:actionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const actionId = Number(req.params.actionId);
  if (!Number.isInteger(actionId) || actionId < 1) {
    throw new ApiError(400, 'actionId không hợp lệ');
  }
  const input = governanceActionVersionSchema.parse(req.body);
  const u = getUser(req);
  const period = req.params.period as string;
  const outcome = await runIdempotent({
    endpoint: CONFIG_COMMANDS.SALARY_REOPEN_APPROVE,
    idempotencyKey: requireIdempotencyKey(req, 'Idempotency-Key là bắt buộc khi phê duyệt mở lại kỳ lương.'),
    payload: { period, actionId, expectedVersion: input.expectedVersion },
    createdBy: u.userId,
    entityType: 'governance_action',
    create: (tx) => approveSalaryPeriodReopen({
      period,
      actionId,
      actorId: u.userId,
      actorRole: u.role,
      expectedVersion: input.expectedVersion,
      transaction: tx,
    }),
  });
  res.json({ ...outcome.result, replayed: outcome.replayed });
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
