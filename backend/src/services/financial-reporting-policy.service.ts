import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  financialReportingPolicyRequestSchema,
  financialReportingPolicyStateSchema,
  truckFinancialProfileRequestSchema,
  truckFinancialProfileStateSchema,
  type FinancialReportingPolicyRequest,
  type FinancialReportingPolicyState,
  type TruckFinancialProfileRequest,
  type TruckFinancialProfileState,
} from '@tingting/shared';
import { ApiError } from '../errors';
import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { DURABLE_EFFECT_KIND, type DurableEffectInput } from './durable-effect.service';
import {
  registerGovernedCustomResource,
  requestOrApplyGovernedConfigAction,
} from './price-config-governance.service';
import type { GovernanceActionRow } from './governance-transition.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const GOVERNANCE_QUEUE_PATH = '/governance-actions';
const ACTIVE_GOVERNANCE_STATUSES = ['PENDING_CHECK', 'PENDING_APPROVAL', 'RETURNED_FOR_EVIDENCE'] as const;

export const FINANCIAL_REPORTING_POLICY_RESOURCE = 'financial-reporting-policy';
export const TRUCK_FINANCIAL_PROFILE_RESOURCE = 'truck-financial-profile';

const actorNameSql = sql<string>`
  coalesce(
    nullif(btrim(${s.users.fullName}), ''),
    nullif(btrim(${s.users.username}), ''),
    nullif(btrim(${s.users.email}), ''),
    'Người dùng'
  )
`;

function vietnamDateParts(now: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return { year, month, day };
}

export function currentVietnamMonthStart(now: Date = new Date()): string {
  const { year, month } = vietnamDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export interface FinancialReportMonthRef {
  month: number;
  year: number;
}

export interface FinancialReportingPolicyForMonth {
  reportMonth: FinancialReportMonthRef;
  reportMonthStart: string;
  status: 'CONFIGURED' | 'UNCONFIGURED';
  source: 'APPROVED_GOVERNANCE' | 'UNCONFIGURED';
  publicVersion: string | null;
  policyVersionId: number | null;
  effectiveFrom: string | null;
  lowMarginThresholdRatio: number | null;
  lowMarginThresholdPercent: number | null;
  depreciationMethod: 'STRAIGHT_LINE' | null;
  allocationBasis: 'COMPLETED_TRIP_REVENUE_SHARE' | null;
}

function monthStartFromPeriod(period: FinancialReportMonthRef): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}-01`;
}

function monthKey(date: string): { year: number; month: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  };
}

function monthLabel(date: string): string {
  const { year, month } = monthKey(date);
  return `tháng ${String(month).padStart(2, '0')}/${year}`;
}

function assertOpenVietnamMonth(effectiveFrom: string, now: Date = new Date()): void {
  const currentMonthStart = currentVietnamMonthStart(now);
  if (effectiveFrom < currentMonthStart) {
    throw new ApiError(
      409,
      'Chọn tháng hiện tại hoặc một tháng trong tương lai. Không thể áp dụng ngược cho kỳ đã đóng.',
    );
  }
}

function toNullableRatio(percent: number | null): string | null {
  if (percent == null) return null;
  return (percent / 100).toFixed(4);
}

function toNullablePercent(ratio: string | null): number | null {
  if (ratio == null) return null;
  return Math.round(Number(ratio) * 10000) / 100;
}

function publicVersionFromRows(rows: Array<{ createdAt: Date }>): string | null {
  return rows[0]?.createdAt?.toISOString() ?? null;
}

function policySubjectKey(effectiveFrom: string): string {
  return `${FINANCIAL_REPORTING_POLICY_RESOURCE}:${effectiveFrom}`;
}

function truckSubjectKey(truckId: number, effectiveFrom: string): string {
  return `${TRUCK_FINANCIAL_PROFILE_RESOURCE}:${truckId}:${effectiveFrom}`;
}

export const REPORTING_CACHE_INVALIDATION_HORIZON_MONTHS = 36;

function addMonths(monthStart: string, delta: number): string {
  const year = Number(monthStart.slice(0, 4));
  const monthIndex = Number(monthStart.slice(5, 7)) - 1;
  const totalMonths = (year * 12) + monthIndex + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

export function reportingCacheKeysFrom(
  effectiveFrom: string,
  horizonMonths: number = REPORTING_CACHE_INVALIDATION_HORIZON_MONTHS,
  now: Date = new Date(),
): string[] {
  const keys = new Set<string>([
    'reports:dashboard',
    'reports:dashboard:executive',
  ]);
  const totalMonths = Math.max(1, horizonMonths);
  for (let offset = 0; offset < totalMonths; offset += 1) {
    const targetMonthStart = addMonths(effectiveFrom, offset);
    const { month, year } = monthKey(targetMonthStart);
    keys.add(`reports:pnl:${month}:${year}`);
    keys.add(`reports:fuel-variance:${month}:${year}`);
    keys.add(`reports:dashboard-widgets:${month}:${year}`);
  }
  if (effectiveFrom === currentVietnamMonthStart(now)) {
    keys.add('reports:dashboard-widgets:current:');
  }
  return [...keys];
}

export function reportingCacheEffects(actionId: number, effectiveFrom: string): DurableEffectInput[] {
  return reportingCacheKeysFrom(effectiveFrom).map((key) => ({
    kind: DURABLE_EFFECT_KIND.CACHE_INVALIDATE,
    payloadVersion: 1,
    dedupeKey: `cache-invalidate:${key}:governance-action:${actionId}`,
    payload: { key },
  }));
}

async function findPendingRequest(
  q: typeof db | Tx,
  subjectKeyPrefix: string,
) {
  const [row] = await q.select({
    status: s.governanceActions.status,
    requestedAt: s.governanceActions.createdAt,
    requestedByName: actorNameSql,
    afterSnapshot: s.governanceActions.afterSnapshot,
  })
    .from(s.governanceActions)
    .leftJoin(s.users, eq(s.users.id, s.governanceActions.makerId))
    .where(and(
      eq(s.governanceActions.subjectType, 'PRICE_CONFIG'),
      eq(s.governanceActions.actionKind, 'PRICE_CONFIG_CHANGE'),
      inArray(s.governanceActions.status, [...ACTIVE_GOVERNANCE_STATUSES]),
      sql`${s.governanceActions.subjectKey} like ${`${subjectKeyPrefix}%`}`,
    ))
    .orderBy(desc(s.governanceActions.createdAt))
    .limit(1);

  if (!row) return null;
  const snapshot = row.afterSnapshot as Record<string, unknown> | null;
  const effectiveFrom = typeof snapshot?.data === 'object' && snapshot.data
    ? String((snapshot.data as Record<string, unknown>).effectiveFrom ?? '')
    : '';
  return {
    status: row.status as 'PENDING_CHECK' | 'PENDING_APPROVAL' | 'RETURNED_FOR_EVIDENCE',
    requestedAt: row.requestedAt.toISOString(),
    requestedByName: row.requestedByName,
    effectiveFrom,
    queuePath: GOVERNANCE_QUEUE_PATH,
  };
}

async function assertNoActivePendingAction(q: typeof db | Tx, subjectKey: string): Promise<void> {
  const [row] = await q.select({ id: s.governanceActions.id })
    .from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectKey, subjectKey),
      eq(s.governanceActions.subjectType, 'PRICE_CONFIG'),
      eq(s.governanceActions.actionKind, 'PRICE_CONFIG_CHANGE'),
      inArray(s.governanceActions.status, [...ACTIVE_GOVERNANCE_STATUSES]),
    ))
    .limit(1);
  if (row) {
    throw new ApiError(
      409,
      'Đã có yêu cầu chờ kiểm tra hoặc phê duyệt cho tháng hiệu lực này. Tải lại để kiểm tra.',
    );
  }
}

async function lockSubjectKey(q: Tx, subjectKey: string): Promise<void> {
  await q.select({ id: s.governanceActions.id })
    .from(s.governanceActions)
    .where(eq(s.governanceActions.subjectKey, subjectKey))
    .limit(1)
    .for('update');
}

export async function getFinancialReportingPolicyState(
  q: typeof db | Tx = db,
): Promise<FinancialReportingPolicyState> {
  const currentMonthStart = currentVietnamMonthStart();
  const rows = await q.select({
    id: s.financialReportingPolicyVersions.id,
    effectiveFrom: s.financialReportingPolicyVersions.effectiveFrom,
    lowMarginThresholdRatio: s.financialReportingPolicyVersions.lowMarginThresholdRatio,
    createdAt: s.financialReportingPolicyVersions.createdAt,
    createdByName: actorNameSql,
  })
    .from(s.financialReportingPolicyVersions)
    .leftJoin(s.users, eq(s.users.id, s.financialReportingPolicyVersions.createdBy))
    .orderBy(desc(s.financialReportingPolicyVersions.effectiveFrom), desc(s.financialReportingPolicyVersions.createdAt));

  const history = rows.map((row) => ({
    id: row.id,
    version: row.id,
    effectiveFrom: row.effectiveFrom,
    lowMarginThresholdRatio: row.lowMarginThresholdRatio == null ? null : Number(row.lowMarginThresholdRatio),
    lowMarginThresholdPercent: toNullablePercent(row.lowMarginThresholdRatio),
    depreciationMethodLabel: 'Đường thẳng' as const,
    allocationBasisLabel: 'Tỷ trọng doanh thu chuyến hoàn thành' as const,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    source: 'APPROVED_GOVERNANCE' as const,
  }));
  const currentPolicy = history.find((row) => row.effectiveFrom <= currentMonthStart) ?? null;
  const futurePolicies = history.filter((row) => row.effectiveFrom > currentMonthStart);
  const pendingRequest = await findPendingRequest(q, `${FINANCIAL_REPORTING_POLICY_RESOURCE}:`);

  return financialReportingPolicyStateSchema.parse({
    status: currentPolicy ? 'CONFIGURED' : 'UNCONFIGURED',
    currentVietnamMonthStart: currentMonthStart,
    publicVersion: publicVersionFromRows(rows),
    currentPolicy,
    futurePolicies,
    history,
    pendingRequest,
  });
}

export async function resolveFinancialReportingPolicyForMonth(
  period: FinancialReportMonthRef,
  q: typeof db | Tx = db,
): Promise<FinancialReportingPolicyForMonth> {
  const reportMonthStart = monthStartFromPeriod(period);
  const rows = await q.select({
    id: s.financialReportingPolicyVersions.id,
    effectiveFrom: s.financialReportingPolicyVersions.effectiveFrom,
    lowMarginThresholdRatio: s.financialReportingPolicyVersions.lowMarginThresholdRatio,
    depreciationMethod: s.financialReportingPolicyVersions.depreciationMethod,
    allocationBasis: s.financialReportingPolicyVersions.allocationBasis,
    createdAt: s.financialReportingPolicyVersions.createdAt,
  })
    .from(s.financialReportingPolicyVersions)
    .orderBy(
      desc(s.financialReportingPolicyVersions.effectiveFrom),
      desc(s.financialReportingPolicyVersions.createdAt),
    );

  const resolved = rows.find((row) => row.effectiveFrom <= reportMonthStart) ?? null;

  return {
    reportMonth: period,
    reportMonthStart,
    status: resolved ? 'CONFIGURED' : 'UNCONFIGURED',
    source: resolved ? 'APPROVED_GOVERNANCE' : 'UNCONFIGURED',
    publicVersion: resolved?.createdAt?.toISOString() ?? null,
    policyVersionId: resolved?.id ?? null,
    effectiveFrom: resolved?.effectiveFrom ?? null,
    lowMarginThresholdRatio: resolved?.lowMarginThresholdRatio == null
      ? null
      : Number(resolved.lowMarginThresholdRatio),
    lowMarginThresholdPercent: toNullablePercent(resolved?.lowMarginThresholdRatio ?? null),
    depreciationMethod: resolved?.depreciationMethod === 'STRAIGHT_LINE'
      ? 'STRAIGHT_LINE'
      : null,
    allocationBasis: resolved?.allocationBasis === 'COMPLETED_TRIP_REVENUE_SHARE'
      ? 'COMPLETED_TRIP_REVENUE_SHARE'
      : null,
  };
}

export async function getTruckFinancialProfileState(
  truckId: number | null | undefined,
  q: typeof db | Tx = db,
): Promise<TruckFinancialProfileState> {
  const currentMonthStart = currentVietnamMonthStart();
  const trucks = await q.select({
    id: s.trucks.id,
    label: s.trucks.licensePlate,
    status: s.trucks.status,
  })
    .from(s.trucks)
    .where(isNull(s.trucks.deletedAt))
    .orderBy(s.trucks.licensePlate);

  const selectedTruckId = truckId ?? trucks[0]?.id ?? null;
  const selectedTruck = trucks.find((row) => row.id === selectedTruckId) ?? null;

  if (!selectedTruck) {
    return truckFinancialProfileStateSchema.parse({
      selectedTruckId: null,
      selectedTruckLabel: null,
      status: 'NO_TRUCK_SELECTED',
      currentVietnamMonthStart: currentMonthStart,
      publicVersion: null,
      trucks,
      currentProfile: null,
      futureProfiles: [],
      history: [],
      pendingRequest: null,
    });
  }

  const rows = await q.select({
    id: s.truckFinancialProfileVersions.id,
    truckId: s.truckFinancialProfileVersions.truckId,
    effectiveFrom: s.truckFinancialProfileVersions.effectiveFrom,
    acquisitionCost: s.truckFinancialProfileVersions.acquisitionCost,
    residualValue: s.truckFinancialProfileVersions.residualValue,
    inServiceDate: s.truckFinancialProfileVersions.inServiceDate,
    usefulLifeMonths: s.truckFinancialProfileVersions.usefulLifeMonths,
    monthlyFixedCost: s.truckFinancialProfileVersions.monthlyFixedCost,
    createdAt: s.truckFinancialProfileVersions.createdAt,
    createdByName: actorNameSql,
  })
    .from(s.truckFinancialProfileVersions)
    .leftJoin(s.users, eq(s.users.id, s.truckFinancialProfileVersions.createdBy))
    .where(eq(s.truckFinancialProfileVersions.truckId, selectedTruck.id))
    .orderBy(desc(s.truckFinancialProfileVersions.effectiveFrom), desc(s.truckFinancialProfileVersions.createdAt));

  const history = rows.map((row) => ({
    id: row.id,
    version: row.id,
    truckId: row.truckId,
    truckLabel: selectedTruck.label,
    effectiveFrom: row.effectiveFrom,
    acquisitionCost: row.acquisitionCost,
    residualValue: row.residualValue,
    inServiceDate: row.inServiceDate,
    usefulLifeMonths: row.usefulLifeMonths,
    monthlyFixedCost: row.monthlyFixedCost,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    source: 'APPROVED_GOVERNANCE' as const,
  }));
  const currentProfile = history.find((row) => row.effectiveFrom <= currentMonthStart) ?? null;
  const futureProfiles = history.filter((row) => row.effectiveFrom > currentMonthStart);
  const pendingRequest = await findPendingRequest(
    q,
    `${TRUCK_FINANCIAL_PROFILE_RESOURCE}:${selectedTruck.id}:`,
  );

  return truckFinancialProfileStateSchema.parse({
    selectedTruckId: selectedTruck.id,
    selectedTruckLabel: selectedTruck.label,
    status: currentProfile ? 'CONFIGURED' : 'UNCONFIGURED',
    currentVietnamMonthStart: currentMonthStart,
    publicVersion: publicVersionFromRows(rows),
    trucks,
    currentProfile,
    futureProfiles,
    history,
    pendingRequest,
  });
}

export async function requestFinancialReportingPolicyVersion(input: {
  body: FinancialReportingPolicyRequest;
  actorId: number;
  actorRole: string;
  transaction?: Tx;
}) {
  const payload = financialReportingPolicyRequestSchema.parse(input.body);
  const execute = async (tx: Tx) => {
    assertOpenVietnamMonth(payload.effectiveFrom);
    const state = await getFinancialReportingPolicyState(tx);
    if ((payload.expectedPublicVersion ?? null) !== state.publicVersion) {
      throw new ApiError(
        409,
        'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
      );
    }
    const subjectKey = policySubjectKey(payload.effectiveFrom);
    await assertNoActivePendingAction(tx, subjectKey);
    const [existing] = await tx.select({ id: s.financialReportingPolicyVersions.id })
      .from(s.financialReportingPolicyVersions)
      .where(eq(s.financialReportingPolicyVersions.effectiveFrom, payload.effectiveFrom))
      .limit(1);
    if (existing) {
      throw new ApiError(
        409,
        'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
      );
    }
    return (await requestOrApplyGovernedConfigAction({
      resource: FINANCIAL_REPORTING_POLICY_RESOURCE,
      operation: 'CREATE',
      subjectId: null,
      subjectKey,
      originalVersion: 0,
      beforeRow: { publicVersion: state.publicVersion },
      afterData: payload,
      reason: `Đề nghị áp dụng chính sách báo cáo từ ${monthLabel(payload.effectiveFrom)}`,
      makerId: input.actorId,
      makerRole: input.actorRole,
      transaction: tx,
    })).action;
  };
  return runInTx(input.transaction, execute);
}

export async function requestTruckFinancialProfileVersion(input: {
  body: TruckFinancialProfileRequest;
  actorId: number;
  actorRole: string;
  transaction?: Tx;
}) {
  const payload = truckFinancialProfileRequestSchema.parse(input.body);
  const execute = async (tx: Tx) => {
    assertOpenVietnamMonth(payload.effectiveFrom);
    const [truck] = await tx.select({
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      deletedAt: s.trucks.deletedAt,
    })
      .from(s.trucks)
      .where(eq(s.trucks.id, payload.truckId))
      .limit(1);
    if (!truck || truck.deletedAt) {
      throw new ApiError(404, 'Không tìm thấy xe đầu kéo để lập hồ sơ tài chính.');
    }
    const state = await getTruckFinancialProfileState(payload.truckId, tx);
    if ((payload.expectedPublicVersion ?? null) !== state.publicVersion) {
      throw new ApiError(
        409,
        'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
      );
    }
    const subjectKey = truckSubjectKey(payload.truckId, payload.effectiveFrom);
    await assertNoActivePendingAction(tx, subjectKey);
    const [existing] = await tx.select({ id: s.truckFinancialProfileVersions.id })
      .from(s.truckFinancialProfileVersions)
      .where(and(
        eq(s.truckFinancialProfileVersions.truckId, payload.truckId),
        eq(s.truckFinancialProfileVersions.effectiveFrom, payload.effectiveFrom),
      ))
      .limit(1);
    if (existing) {
      throw new ApiError(
        409,
        'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
      );
    }
    return (await requestOrApplyGovernedConfigAction({
      resource: TRUCK_FINANCIAL_PROFILE_RESOURCE,
      operation: 'CREATE',
      subjectId: null,
      subjectKey,
      originalVersion: 0,
      beforeRow: { publicVersion: state.publicVersion, truckId: payload.truckId },
      afterData: payload,
      reason: `Đề nghị áp dụng hồ sơ tài chính xe ${truck.licensePlate} từ ${monthLabel(payload.effectiveFrom)}`,
      makerId: input.actorId,
      makerRole: input.actorRole,
      transaction: tx,
    })).action;
  };
  return runInTx(input.transaction, execute);
}

async function applyFinancialReportingPolicyVersion(
  tx: Tx,
  action: GovernanceActionRow,
  payload: FinancialReportingPolicyRequest,
) {
  assertOpenVietnamMonth(payload.effectiveFrom);
  await lockSubjectKey(tx, policySubjectKey(payload.effectiveFrom));
  const [existing] = await tx.select({ id: s.financialReportingPolicyVersions.id })
    .from(s.financialReportingPolicyVersions)
    .where(eq(s.financialReportingPolicyVersions.effectiveFrom, payload.effectiveFrom))
    .limit(1)
    .for('update');
  if (existing) {
    throw new ApiError(
      409,
      'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
    );
  }

  const [created] = await tx.insert(s.financialReportingPolicyVersions).values({
    effectiveFrom: payload.effectiveFrom,
    depreciationMethod: 'STRAIGHT_LINE',
    allocationBasis: 'COMPLETED_TRIP_REVENUE_SHARE',
    lowMarginThresholdRatio: toNullableRatio(payload.lowMarginThresholdPercent),
    governanceActionId: action.id,
    createdBy: action.approverId ?? action.makerId,
  }).returning({
    id: s.financialReportingPolicyVersions.id,
  });

  return {
    applicationResult: {
      resource: FINANCIAL_REPORTING_POLICY_RESOURCE,
      operation: 'CREATE',
      subjectId: created.id,
      resultingVersion: created.id,
    },
    durableEffects: reportingCacheEffects(action.id, payload.effectiveFrom),
  };
}

async function applyTruckFinancialProfileVersion(
  tx: Tx,
  action: GovernanceActionRow,
  payload: TruckFinancialProfileRequest,
) {
  assertOpenVietnamMonth(payload.effectiveFrom);
  await lockSubjectKey(tx, truckSubjectKey(payload.truckId, payload.effectiveFrom));
  const [truck] = await tx.select({
    id: s.trucks.id,
    deletedAt: s.trucks.deletedAt,
  })
    .from(s.trucks)
    .where(eq(s.trucks.id, payload.truckId))
    .limit(1)
    .for('update');
  if (!truck || truck.deletedAt) {
    throw new ApiError(404, 'Không tìm thấy xe đầu kéo để áp dụng hồ sơ tài chính.');
  }
  const [existing] = await tx.select({ id: s.truckFinancialProfileVersions.id })
    .from(s.truckFinancialProfileVersions)
    .where(and(
      eq(s.truckFinancialProfileVersions.truckId, payload.truckId),
      eq(s.truckFinancialProfileVersions.effectiveFrom, payload.effectiveFrom),
    ))
    .limit(1)
    .for('update');
  if (existing) {
    throw new ApiError(
      409,
      'Dữ liệu đã thay đổi hoặc tháng hiệu lực đã có phiên bản. Tải lại để kiểm tra.',
    );
  }

  const [created] = await tx.insert(s.truckFinancialProfileVersions).values({
    truckId: payload.truckId,
    effectiveFrom: payload.effectiveFrom,
    acquisitionCost: payload.acquisitionCost,
    residualValue: payload.residualValue,
    inServiceDate: payload.inServiceDate,
    usefulLifeMonths: payload.usefulLifeMonths,
    monthlyFixedCost: payload.monthlyFixedCost,
    governanceActionId: action.id,
    createdBy: action.approverId ?? action.makerId,
  }).returning({
    id: s.truckFinancialProfileVersions.id,
  });

  return {
    applicationResult: {
      resource: TRUCK_FINANCIAL_PROFILE_RESOURCE,
      operation: 'CREATE',
      subjectId: created.id,
      resultingVersion: created.id,
    },
    durableEffects: reportingCacheEffects(action.id, payload.effectiveFrom),
  };
}

registerGovernedCustomResource({
  resource: FINANCIAL_REPORTING_POLICY_RESOURCE,
  reasonLabel: 'chính sách báo cáo tài chính',
  apply: async (tx, action, _before, after) => {
    const payload = financialReportingPolicyRequestSchema.parse(after.data);
    return applyFinancialReportingPolicyVersion(tx, action, payload);
  },
});

registerGovernedCustomResource({
  resource: TRUCK_FINANCIAL_PROFILE_RESOURCE,
  reasonLabel: 'hồ sơ tài chính xe',
  apply: async (tx, action, _before, after) => {
    const payload = truckFinancialProfileRequestSchema.parse(after.data);
    return applyTruckFinancialProfileVersion(tx, action, payload);
  },
});
