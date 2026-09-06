// Config route helpers (T3c split) — shared predicates, governed-resource
// registrations, catalog guards, and payload normalizers used by the config
// route modules. Split out of routes/config.ts; the five governed singleton
// registrations still run at module load exactly as before (import this module
// for the side effect even when no helper is used).

import { db } from '../../db';
import * as s from '../../db/schema';
import { and, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { z, type output } from 'zod';
import { ApiError } from '../../errors';
import {
  customerUpdateSchema,
  driverSchema,
  penaltyReasonSchema,
  forwarderExpenseTypeSchema,
  expenseCategorySchema,
  supplierSchema,
  DEFAULT_NO_INVOICE_EVIDENCE_TYPES,
  NO_INVOICE_APPROVAL_TITLES,
  NO_INVOICE_POLICY_DEFAULTS,
  fuelConfigSchema,
  companyInfoSchema,
  salaryPeriodSchema,
  salaryPeriodDefaultSchema,
} from '@tingting/shared';
import type { Request } from 'express';
import { COMPANY_INFO_SETTING_KEYS, companyInfoFromSettings } from '../../services/company-info.service';
import { upsertFuelConfigInTx, getFuelConfigUpdatedAt } from '../../services/config.service';
import {
  updateSalaryPeriodDefaultInTx,
  upsertSalaryPeriodOverrideInTx,
  updateSalaryPeriodOverrideByIdInTx,
  deleteSalaryPeriodOverrideInTx,
  getSalaryPeriodDefaultFrom,
} from '../../services/salary-period.service';
import { cacheInvalidate } from '../../lib/redis';
import { normalizeTaxCode } from '../../services/legal-partner.service';
import { normalizeSupplierTypeSelection } from '../../services/supplier-types.service';
import { resolveIdempotencyKey } from '../../services/idempotency.service';
import {
  buildGovernedConfigSnapshot,
  governedConfigVersionFromUpdatedAt,
  registerGovernedCustomResource,
} from '../../services/price-config-governance.service';
import {
  DURABLE_EFFECT_KIND,
  type DurableEffectInput,
} from '../../services/durable-effect.service';
import {
  lockApplicationOwnedUniqueness,
  lockApplicationOwnedUniquenessSet,
} from '../../services/application-owned-uniqueness.service';

export type SupplierPayload = output<typeof supplierSchema>;
export type DriverPayload = Partial<output<typeof driverSchema>>;
export type PenaltyReasonPayload = Partial<output<typeof penaltyReasonSchema>>;
export type ForwarderExpenseTypePayload = output<typeof forwarderExpenseTypeSchema>;
export type ExpenseCategoryPayload = Partial<output<typeof expenseCategorySchema>>;
export type NoInvoiceEvidenceType = typeof DEFAULT_NO_INVOICE_EVIDENCE_TYPES[number];
export type NoInvoiceApprovalTitle = typeof NO_INVOICE_APPROVAL_TITLES[number];
export type CrudTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type CustomerMutationPayload = Partial<output<typeof customerUpdateSchema>>;
export type RoadConfigGovernedPayload = output<typeof roadConfigGovernanceSchema>;

// ─── Shared helpers below (moved verbatim from routes/config.ts) ───────────

export function normalizeCatalogKey(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi-VN');
}

export async function lockCatalogRelationship(
  tx: CrudTx,
  resource: string,
  id: number | null | undefined,
): Promise<void> {
  if (id == null) return;
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'ID liên kết không hợp lệ');
  await lockApplicationOwnedUniqueness(tx, `relationship.${resource}`, [id]);
}

export async function requireActiveCatalogRow(
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

export async function requireExistingRow(
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

export async function assertUniqueCatalogString(args: {
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

/** Zone codes are DB-owned (dispatch_zones) — reject writes carrying a code
 *  that is not in the live taxonomy before it can reach ports.dispatch_zone. */
export async function assertDispatchZoneCode(tx: CrudTx, code: string | null | undefined): Promise<void> {
  if (code == null) return;
  const [zone] = await tx.select({ id: s.dispatchZones.id })
    .from(s.dispatchZones)
    .where(and(eq(s.dispatchZones.code, code), eq(s.dispatchZones.isActive, true)))
    .limit(1);
  if (!zone) throw new ApiError(400, 'Khu vực điều phối không hợp lệ.');
}

/** A zone may only be deactivated when no live port still references it —
 *  otherwise ports.dispatch_zone would dangle with no FK to catch it. The
 *  operator must re-classify those ports first. */
export async function assertZoneDeactivatable(tx: CrudTx, code: string): Promise<void> {
  const [referenced] = await tx.select({ id: s.ports.id })
    .from(s.ports)
    .where(and(
      eq(s.ports.dispatchZone, code),
      isNull(s.ports.deletedAt),
    ))
    .limit(1);
  if (referenced) {
    throw new ApiError(400, 'Còn cảng/bãi đang thuộc khu vực này. Hãy gán lại khu vực cho các cảng trước khi ngưng sử dụng.');
  }
}

export async function lockCatalogDelete(tx: CrudTx, resource: string, id: number): Promise<void> {
  await lockCatalogRelationship(tx, resource, id);
}

export async function lockCustomerMutationKeys(
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

export const roadConfigGovernanceSchema = z.object({
  tollPerStation: z.coerce.number().finite().min(0),
  returnCargoBonus: z.coerce.number().finite().min(0),
  defaultDriverSalary: z.coerce.number().finite().min(0).optional(),
  twoPointDeliveryBonus: z.coerce.number().finite().min(0).optional(),
  vehicleShiftDefault: z.coerce.number().finite().min(0).optional(),
});

export const ROAD_CONFIG_FALLBACKS = {
  defaultDriverSalary: 400000,
  twoPointDeliveryBonus: 200000,
  vehicleShiftDefault: 200000,
} as const;

export const GOVERNED_SINGLETON_RESOURCES = {
  roadConfig: 'road-config',
  fuelConfig: 'fuel-config',
  companyInfo: 'company-info',
  salaryDefault: 'salary-period-default',
  salaryOverride: 'salary-period-override',
} as const;
export const CONFIG_COMMANDS = {
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

export const MATERIAL_CUSTOMER_CONFIG_FIELDS = new Set<keyof CustomerMutationPayload>([
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

export function hasMaterialCustomerConfigChange(data: CustomerMutationPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_CUSTOMER_CONFIG_FIELDS.has(key as keyof CustomerMutationPayload));
}

/**
 * Edit forms resend the full record on every save, so key presence alone would
 * route every update through approval even when nothing material changed.
 * Compare the incoming values against the current row instead; treat numeric
 * strings ("10.00") as equal to their numeric payload (10), compare arrays of
 * primitives as sets (jsonb evidence lists), and skip keys the payload omits.
 */
export function sameConfigValue(current: unknown, incoming: unknown): boolean {
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

export function hasMaterialValueChange(
  fields: ReadonlySet<string>,
  data: Record<string, unknown>,
  current: Record<string, unknown>,
): boolean {
  return Object.entries(data).some(([key, value]) => (
    fields.has(key) && !sameConfigValue(current[key], value)
  ));
}

export function hasMaterialCustomerUpdate(
  data: CustomerMutationPayload,
  current: typeof s.customers.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_CUSTOMER_CONFIG_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

export const MATERIAL_DRIVER_FIELDS = new Set<keyof DriverPayload>([
  'baseSalary',
  'socialInsurance',
]);

export function hasMaterialDriverConfigChange(data: DriverPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_DRIVER_FIELDS.has(key as keyof DriverPayload));
}

export function hasMaterialDriverUpdate(
  data: DriverPayload,
  current: typeof s.drivers.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_DRIVER_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

export const MATERIAL_PENALTY_REASON_FIELDS = new Set<keyof PenaltyReasonPayload>([
  'defaultAmount',
]);

export function hasMaterialPenaltyReasonChange(data: PenaltyReasonPayload): boolean {
  return Object.keys(data).some((key) => MATERIAL_PENALTY_REASON_FIELDS.has(key as keyof PenaltyReasonPayload));
}

export function hasMaterialPenaltyReasonUpdate(
  data: PenaltyReasonPayload,
  current: typeof s.penaltyReasons.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_PENALTY_REASON_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

// Name-only edits of an expense category are cosmetic (display label); the
// renewable/reminder/status fields are what change expense policy, so only
// those govern. Mirrors the customers/drivers/penalty-reasons value-diff fix.
export const MATERIAL_EXPENSE_CATEGORY_FIELDS = new Set<keyof ExpenseCategoryPayload>([
  'isRenewable',
  'reminderLeadDays',
  'status',
]);

export function hasMaterialExpenseCategoryUpdate(
  data: ExpenseCategoryPayload,
  current: typeof s.expenseCategories.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_EXPENSE_CATEGORY_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

export async function markCompletedFuelSurchargeTripsDirty(
  tx: CrudTx,
  scope?: { customerId?: number },
): Promise<void> {
  // Trips split: both flag and snapshot live on trip_financial_state (1:1 by
  // trip_id); scope via the operational trips table by id.
  const tripIds = tx.select({ id: s.trips.id }).from(s.trips)
    .where(scope?.customerId != null
      ? and(eq(s.trips.status, 'COMPLETED'), eq(s.trips.customerId, scope.customerId))
      : eq(s.trips.status, 'COMPLETED'));
  await tx.update(s.tripFinancialState)
    .set({ fuelSurchargeSnapshotDirty: true })
    .where(and(
      sql`${s.tripFinancialState.fuelSurchargeSnapshot} is not null`,
      inArray(s.tripFinancialState.tripId, tripIds),
    ));
}

export const MATERIAL_FORWARDER_POLICY_FIELDS = new Set<keyof ForwarderExpenseTypePayload>([
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

export function hasMaterialForwarderExpenseTypeChange(
  data: Partial<ForwarderExpenseTypePayload>,
): boolean {
  return Object.keys(data).some((key) => MATERIAL_FORWARDER_POLICY_FIELDS.has(key as keyof ForwarderExpenseTypePayload));
}

export function hasMaterialForwarderExpenseTypeUpdate(
  data: Partial<ForwarderExpenseTypePayload>,
  current: typeof s.forwarderExpenseTypes.$inferSelect,
): boolean {
  return hasMaterialValueChange(
    MATERIAL_FORWARDER_POLICY_FIELDS,
    data as Record<string, unknown>,
    current as Record<string, unknown>,
  );
}

export function requireIdempotencyKey(req: Request, message: string): string {
  const key = resolveIdempotencyKey({
    headerValue: req.header('Idempotency-Key'),
    requestId: req.body?._requestId,
  });
  if (!key) throw new ApiError(400, message);
  return key;
}

export function readExpectedUpdatedAt(req: Request): Date | undefined {
  const raw = req.header('If-Unmodified-Since')?.trim();
  if (!raw) return undefined;
  const expected = new Date(raw);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, 'Phiên bản dữ liệu không hợp lệ.');
  }
  return expected;
}

export function requireExpectedUpdatedAt(req: Request, message: string): Date {
  const expected = readExpectedUpdatedAt(req);
  if (!expected) throw new ApiError(428, message);
  return expected;
}

export function assertOptionalVersion(current: Date | null, expected: Date | undefined, message: string): void {
  if (!current) return;
  if (!expected) throw new ApiError(428, message);
  if (current.getTime() !== expected.getTime()) {
    throw new ApiError(409, 'Dữ liệu đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.');
  }
}

export function governedConfigVersion(row: { updatedAt: Date } | null): number {
  return row ? governedConfigVersionFromUpdatedAt(row.updatedAt) : 0;
}

export function assertGovernedSnapshotUnchanged(
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

export async function getCompanyInfoUpdatedAt(
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

export async function getCompanyInfoGovernedState(
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

export function salaryOverrideSubjectKey(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function numberFromRoadConfigValue(value: string | null | undefined, fallback: number): number {
  const parsed = value == null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeRoadConfigPayload(
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

export function toRoadConfigStorageValues(payload: ReturnType<typeof normalizeRoadConfigPayload>, updatedAt: Date) {
  return {
    tollPerStation: String(payload.tollPerStation),
    returnCargoBonus: String(payload.returnCargoBonus),
    defaultDriverSalary: String(payload.defaultDriverSalary),
    twoPointDeliveryBonus: String(payload.twoPointDeliveryBonus),
    vehicleShiftDefault: String(payload.vehicleShiftDefault),
    updatedAt,
  };
}

export function cacheInvalidateEffect(actionId: number, key: string): DurableEffectInput {
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

export function displayTaxCode(value: string | null | undefined): string {
  return String(value ?? '').trim().replace(/\s+/g, '');
}

export async function upsertPartnerInTransaction(
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

export async function syncCustomerRelationsHook(
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

export async function syncSupplierRelationsHook(
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
export async function syncSupplierTypesHook(
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

export async function normalizeSupplierPayload(
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

export function normalizeNoInvoiceApprovalTitle(
  value: NoInvoiceApprovalTitle | undefined,
  fallback: NoInvoiceApprovalTitle,
): NoInvoiceApprovalTitle {
  return value ?? fallback;
}

export function normalizeForwarderExpenseTypePayload(
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

export async function withForwarderExpenseTypePolicyVersion(
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
