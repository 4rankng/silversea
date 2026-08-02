/**
 * Profit Distribution Service
 *
 * Quarterly profit distribution to cap-table partners, distribution preview,
 * cap-table history, and distribution records.
 *
 * F3 (per-vehicle): each truck distributes its quarter profit (Σ of its COMPLETED
 * trips' grossProfit) across THAT truck's active owners (from `truck_cap_table`).
 * The entity view is derived — group rows by partner_name, Σ amount. Trucks
 * with profit but no configured owners are held aside as `undistributedProfit`.
 *
 * Exactness invariant: Σ all distribution rows == Σ_t P_t == entity netProfit
 * (≤0.01 VND). Each truck distributes with floor + remainder-to-last so it sums
 * exactly, and a reconcile guard aborts the whole plan if the total is off.
 */

import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, isNull, desc, sql, gte, inArray } from 'drizzle-orm';
import { TripStatus } from '@tingting/shared';
import { ApiError } from '../errors';
import { localDateStr, quarterDateRange, resolveTruckCapSnapshot, tripCompletionBusinessDateSql } from './reporting-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import type { GovernanceActionRow } from './governance-transition.service';
import { hashPayload } from './idempotency.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DistributionQueryExecutor = Pick<Tx, 'select'>;
type ProfitDistributionTransactionOptions = NonNullable<Parameters<typeof db.transaction>[1]>;

export const PROFIT_DISTRIBUTION_TRANSACTION_OPTIONS: ProfitDistributionTransactionOptions = {
  isolationLevel: 'serializable',
};

const MAX_PROFIT_SERIALIZATION_RETRIES = 3;

/** A single computed distribution row (one truck × one partner). */
export interface DistributionRow {
  quarter: number;
  year: number;
  truckId: number;
  partnerName: string;
  percentage: string;
  amount: string;
  /** B2 — partner role label for UI (INVESTOR | DRIVER). Not persisted to the
   * `distributions` table; carried on the per-truck breakdown + DTO only. */
  role: 'INVESTOR' | 'DRIVER';
}

/** Per-truck profit + its computed partner distributions. */
export interface PerTruckDistribution {
  truckId: number;
  /** Business label for UI display — never expose the raw truckId. */
  licensePlate: string;
  profit: number;
  partners: Array<{ partnerName: string; percentage: number; amount: number; role: 'INVESTOR' | 'DRIVER' }>;
}

/** Result of computeDistribution — the full per-vehicle plan. */
export interface DistributionPlan {
  netProfit: number;
  tripCount: number;
  /** Per (truck × partner) rows — what gets persisted. */
  distributions: DistributionRow[];
  /** Entity-grouped view for display: partner_name → Σ amount. */
  entity: Array<{ partnerName: string; amount: number }>;
  /** Per-truck breakdown for display. */
  perTruck: PerTruckDistribution[];
  /** Σ profit of ownerless trucks (profit but no truck_cap_table owners). */
  undistributedProfit: number;
}

interface ComputedDistributionSnapshot {
  plan: DistributionPlan;
  sourceFingerprint: string;
}

function requireDistributionReason(reason: string, quarter: number, year: number): string {
  const normalized = reason.trim();
  return normalized || `Phân chia lợi nhuận Q${quarter}/${year}`;
}

function distributionSubjectKey(quarter: number, year: number): string {
  return `${year}-Q${quarter}`;
}

async function lockDistributionQuarter(tx: Tx, quarter: number, year: number): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`profit-distribution\u001f${year}\u001f${quarter}`}, 0))`,
  );
}

function hasSqlState(error: unknown, sqlState: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    code?: unknown;
    cause?: unknown;
  };
  if (candidate.code === sqlState) return true;
  return hasSqlState(candidate.cause, sqlState);
}

function isSerializationFailure(error: unknown): boolean {
  return hasSqlState(error, '40001');
}

export async function runProfitDistributionWithSerializationRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_PROFIT_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationFailure(error)) {
        throw error;
      }
    }
  }
  throw new ApiError(
    409,
    'Dữ liệu lợi nhuận đang được cập nhật đồng thời; vui lòng thử lại.',
  );
}

async function assertDistributionDoesNotExist(
  tx: Tx,
  quarter: number,
  year: number,
): Promise<void> {
  const [existing] = await tx.select({ id: s.distributions.id })
    .from(s.distributions)
    .where(and(eq(s.distributions.quarter, quarter), eq(s.distributions.year, year)))
    .limit(1);
  if (existing) {
    throw new ApiError(409, `Phân chia lợi nhuận Q${quarter}/${year} đã tồn tại`);
  }
}

export async function requestProfitDistributionGovernance(input: {
  quarter: number;
  year: number;
  reason: string;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('PROFIT_DISTRIBUTION', input.makerRole);
  const reason = requireDistributionReason(input.reason, input.quarter, input.year);

  const execute = async (tx: Tx) => {
    await lockDistributionQuarter(tx, input.quarter, input.year);
    await assertDistributionDoesNotExist(tx, input.quarter, input.year);
    const snapshot = await computeDistributionSnapshot(tx, input.quarter, input.year);
    const plan = snapshot.plan;

    const [pending] = await tx.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'PROFIT_DISTRIBUTION'),
        eq(s.governanceActions.subjectKey, distributionSubjectKey(input.quarter, input.year)),
        eq(s.governanceActions.actionKind, 'PROFIT_DISTRIBUTION'),
        inArray(s.governanceActions.status, [
          'PENDING_CHECK',
          'PENDING_APPROVAL',
          'RETURNED_FOR_EVIDENCE',
        ]),
      ))
      .limit(1);
    if (pending) {
      throw new ApiError(409, 'Kỳ lợi nhuận này đã có yêu cầu đang chờ xử lý');
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'PROFIT_DISTRIBUTION',
      subjectId: null,
      subjectKey: distributionSubjectKey(input.quarter, input.year),
      actionKind: 'PROFIT_DISTRIBUTION',
      reason,
      // Version zero is the explicit authority state for an undistributed
      // quarter. Any persisted row invalidates the request during approval.
      originalVersion: 0,
      beforeSnapshot: {
        quarter: input.quarter,
        year: input.year,
        distributed: false,
      },
      afterSnapshot: {
        quarter: input.quarter,
        year: input.year,
        planHash: hashPayload(plan),
        sourceFingerprint: snapshot.sourceFingerprint,
      },
      deltaSnapshot: {
        netProfit: plan.netProfit,
        tripCount: plan.tripCount,
        distributionCount: plan.distributions.length,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };

  return input.transaction ? execute(input.transaction) : db.transaction(execute);
}

/**
 * Approval-only adapter. The public request path can create a pending action,
 * but only the common governance transition service can supply both a locked
 * transaction and the authoritative approved action context needed here.
 */
export async function applyProfitDistributionGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
) {
  if (
    action.actionKind !== 'PROFIT_DISTRIBUTION'
    || action.subjectType !== 'PROFIT_DISTRIBUTION'
  ) {
    throw new ApiError(409, 'Loại yêu cầu không thuộc phân chia lợi nhuận');
  }
  if (action.originalVersion !== 0) {
    throw new ApiError(409, 'Phiên bản kỳ phân chia lợi nhuận không hợp lệ');
  }

  const after = action.afterSnapshot as Record<string, unknown> | null;
  const quarter = Number(after?.quarter);
  const year = Number(after?.year);
  const requestedPlanHash = typeof after?.planHash === 'string' ? after.planHash : '';
  const requestedSourceFingerprint = typeof after?.sourceFingerprint === 'string'
    ? after.sourceFingerprint
    : null;
  if (
    !Number.isInteger(quarter)
    || quarter < 1
    || quarter > 4
    || !Number.isInteger(year)
    || year <= 0
    || !requestedPlanHash
  ) {
    throw new ApiError(409, 'Yêu cầu phân chia lợi nhuận không có dữ liệu hợp lệ');
  }

  await lockDistributionQuarter(tx, quarter, year);
  await assertDistributionDoesNotExist(tx, quarter, year);
  const snapshot = await computeDistributionSnapshot(tx, quarter, year);
  const plan = snapshot.plan;
  if (
    hashPayload(plan) !== requestedPlanHash
    || (requestedSourceFingerprint != null && snapshot.sourceFingerprint !== requestedSourceFingerprint)
  ) {
    throw new ApiError(
      409,
      'Dữ liệu lợi nhuận hoặc tỷ lệ sở hữu đã thay đổi; vui lòng lập yêu cầu mới',
    );
  }

  if (plan.distributions.length > 0) {
    const rows = await tx.insert(s.distributions).values(plan.distributions.map(item => ({
      quarter: item.quarter,
      year: item.year,
      truckId: item.truckId,
      partnerName: item.partnerName,
      amount: item.amount,
    }))).returning({ id: s.distributions.id });
    return {
      applicationResult: {
        quarter,
        year,
        netProfit: plan.netProfit,
        distributionIds: rows.map(row => row.id),
        distributions: plan.distributions,
        perTruck: plan.perTruck,
        entity: plan.entity,
        undistributedProfit: plan.undistributedProfit,
      },
    };
  }

  return {
    applicationResult: {
      quarter,
      year,
      netProfit: plan.netProfit,
      distributionIds: [],
      distributions: [],
      perTruck: plan.perTruck,
      entity: plan.entity,
      undistributedProfit: plan.undistributedProfit,
    },
  };
}

/**
 * Preview profit distribution without persisting.
 * Same logic as distributeProfit but returns the calculation without inserting.
 */
export async function previewDistribution(quarter: number, year: number) {
  const plan = await computeDistribution(db, quarter, year);
  return {
    quarter,
    year,
    netProfit: plan.netProfit,
    tripCount: plan.tripCount,
    distributions: plan.distributions,
    perTruck: plan.perTruck,
    entity: plan.entity,
    undistributedProfit: plan.undistributedProfit,
  };
}

/**
 * Fetch historical distribution records, grouped by quarter/year.
 */
export async function getDistributionHistory() {
  const rows = await db.select().from(s.distributions)
    .orderBy(desc(s.distributions.year), desc(s.distributions.quarter), desc(s.distributions.id));
  return rows;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Distribute a single truck's profit across its owners by %.
 * Uses round + remainder-to-last so the row amounts sum exactly to `profit`
 * (the last owner absorbs the sub-1 residual). Round (not floor) keeps each
 * owner's share within ±0.5 of their contractual % for BOTH positive profit
 * and loss quarters — floor biased non-last owners under losses.
 * Pure function — exported for unit testing of the exactness invariant.
 */
export function distributeTruckProfit(
  truckId: number,
  profit: number,
  owners: Array<{ partnerName: string; percentage: number; role?: 'INVESTOR' | 'DRIVER' }>,
): { partners: Array<{ partnerName: string; percentage: number; amount: number; role: 'INVESTOR' | 'DRIVER' }> } {
  void truckId; // accepted for API symmetry; caller re-attaches truckId to rows
  if (owners.length === 0) return { partners: [] };
  let allocated = 0;
  const partners = owners.map((owner, i) => {
    const isLast = i === owners.length - 1;
    const raw = profit * owner.percentage / 100;
    const amount = isLast ? Math.round(profit - allocated) : Math.round(raw);
    allocated += amount;
    // B2 — role is owner-agnostic to the math; carry it onto the result row so
    // the UI can label investor vs driver-contributor shares. Default INVESTOR
    // for callers that don't supply a role.
    const role: 'INVESTOR' | 'DRIVER' = owner.role === 'DRIVER' ? 'DRIVER' : 'INVESTOR';
    return { partnerName: owner.partnerName, percentage: owner.percentage, amount, role };
  });
  return { partners };
}

/**
 * Compute a per-vehicle profit distribution plan for a quarter.
 * Shared by both distributeProfit (persists) and previewDistribution (returns only).
 *
 * D5 — reads `trips.grossProfit` for COMPLETED trips only; never recomputes a
 * completed trip's totals. Per-vehicle grouping changes only attribution.
 */
async function computeDistributionSnapshot(
  executor: DistributionQueryExecutor,
  quarter: number,
  year: number,
): Promise<ComputedDistributionSnapshot> {
  const { start: qStart, end: qEnd } = await quarterDateRange(quarter, year);
  const completionBusinessDate = tripCompletionBusinessDateSql();

  const trips = await executor.select({
    id: s.trips.id,
    tripVersion: s.trips.version,
    financialPostingId: s.tripFinancialPostings.id,
    financialPostingVersion: s.tripFinancialPostings.version,
    truckId: s.trips.truckId,
    // O2C H4: read the completion-time snapshot, not the mutable live value.
    // Falls back to grossProfit for trips completed before the snapshot column
    // existed (coalesce at the application layer below).
    grossProfit: s.trips.pnlSnapshotGrossProfit,
    liveGrossProfit: s.trips.grossProfit,
    completedAt: s.trips.completedAt,
  }).from(s.trips)
    .leftJoin(s.tripFinancialPostings, and(
      eq(s.tripFinancialPostings.tripId, s.trips.id),
      eq(s.tripFinancialPostings.status, 'ACTIVE'),
    )).where(
    and(
      eq(s.trips.status, TripStatus.COMPLETED),
      isNull(s.trips.deletedAt),
      sql`${s.trips.completedAt} is not null`,
      gte(completionBusinessDate, qStart),
      sql`${completionBusinessDate} < ${qEnd}`,
    ),
  );

  // Σ COMPLETED grossProfit per truck (D5 — read stored value, never recompute).
  const profitByTruck = new Map<number, number>();
  let tripCount = 0;
  for (const t of trips) {
    if (t.truckId == null) continue; // trips without a truck cannot be attributed
    tripCount++;
    // O2C H4: prefer the frozen snapshot; fall back to live for legacy rows.
    const profit = parseFloat(t.grossProfit ?? t.liveGrossProfit ?? '0');
    profitByTruck.set(t.truckId, (profitByTruck.get(t.truckId) ?? 0) + profit);
  }

  const truckIds = Array.from(profitByTruck.keys());
  const netProfit = Array.from(profitByTruck.values()).reduce((a, b) => a + b, 0);

  // No profit-bearing trucks → nothing to distribute. Legacy callers may have
  // thrown when there were zero entity-wide partners; here the honest answer
  // is an empty plan with zero undistributed profit.
  if (truckIds.length === 0) {
    return {
      plan: { netProfit: 0, tripCount, distributions: [], entity: [], perTruck: [], undistributedProfit: 0 },
      sourceFingerprint: hashPayload({ quarter, year, trips: [], trucks: [], ownership: [] }),
    };
  }

  // Load all per-vehicle cap rows for the profit-bearing trucks, scoped once.
  const capRows = truckIds.length > 0
    ? await executor.select({
      id: s.truckCapTable.id,
      truckId: s.truckCapTable.truckId,
      partnerName: s.truckCapTable.partnerName,
      percentage: s.truckCapTable.percentage,
      role: s.truckCapTable.role,
      effectiveDate: s.truckCapTable.effectiveDate,
      createdAt: s.truckCapTable.createdAt,
      updatedAt: s.truckCapTable.updatedAt,
    }).from(s.truckCapTable).where(inArray(s.truckCapTable.truckId, truckIds))
    : [];

  // Plates for display — never expose the raw truckId in the UI.
  const trucks = await executor.select({
    id: s.trucks.id,
    licensePlate: s.trucks.licensePlate,
    updatedAt: s.trucks.updatedAt,
  })
    .from(s.trucks).where(inArray(s.trucks.id, truckIds));
  const plateById = new Map(trucks.map(t => [t.id, t.licensePlate]));

  const today = localDateStr();
  const cutoff = qEnd > today ? today : qEnd;

  const distributions: DistributionRow[] = [];
  const perTruck: PerTruckDistribution[] = [];
  const ownershipSnapshot: Array<{
    truckId: number;
    owners: Array<{ partnerName: string; percentage: number; role: 'INVESTOR' | 'DRIVER' }>;
  }> = [];
  let undistributedProfit = 0;

  for (const truckId of truckIds) {
    const profit = profitByTruck.get(truckId) ?? 0;
    const plate = plateById.get(truckId) ?? '(không rõ biển số)';
    const rowsForTruck = capRows.filter(r => r.truckId === truckId);
    const owners = resolveTruckCapSnapshot(rowsForTruck, cutoff);
    ownershipSnapshot.push({
      truckId,
      owners: owners.map(owner => ({
        partnerName: owner.partnerName,
        percentage: owner.percentage,
        role: owner.role,
      })),
    });

    if (owners.length === 0) {
      // Q1 default — ownerless truck: hold its profit aside, do not distribute.
      undistributedProfit += profit;
      perTruck.push({ truckId, licensePlate: plate, profit, partners: [] });
      continue;
    }

    // Guard: ownership % must sum to 100, else the split is silently wrong
    // (the exactness reconcile only checks the row TOTAL, not whether each
    // owner got their contractual share). Abort loudly with the plate so the
    // operator fixes the config before any money is persisted. (code-review HIGH)
    const pctSum = owners.reduce((sum, o) => sum + o.percentage, 0);
    if (Math.abs(pctSum - 100) > 0.01) {
      throw new ApiError(
        400,
        `Tỷ lệ sở hữu xe ${plate} tổng ${pctSum}% ≠ 100% — không thể phân phối. Sửa tại Cấu hình → Xe → Sở hữu.`,
      );
    }

    const { partners } = distributeTruckProfit(truckId, profit, owners);
    for (const p of partners) {
      distributions.push({
        quarter,
        year,
        truckId,
        partnerName: p.partnerName,
        percentage: String(p.percentage),
        amount: String(p.amount),
        role: p.role,
      });
    }
    perTruck.push({ truckId, licensePlate: plate, profit, partners });
  }

  // Exactness reconcile guard — Σ rows must equal Σ_t P_t (== netProfit).
  // The per-truck floor+remainder guarantees each truck sums exactly, so the
  // total does too. Abort (do not persist) if invariant is violated.
  const distributedTotal = distributions.reduce((sum, d) => sum + Number(d.amount), 0);
  const distributableProfit = netProfit - undistributedProfit;
  if (Math.abs(distributedTotal - distributableProfit) > 0.01) {
    throw new ApiError(
      500,
      `Lỗi đối chiếu phân phối: tổng ${distributedTotal} ≠ lợi nhuận có thể phân chia ${distributableProfit}. Đã hủy — không ghi bản ghi.`,
    );
  }

  // Derived entity view — group rows by partner_name, Σ amount.
  const entityMap = new Map<string, number>();
  for (const d of distributions) {
    entityMap.set(d.partnerName, (entityMap.get(d.partnerName) ?? 0) + Number(d.amount));
  }
  const entity = Array.from(entityMap.entries())
    .map(([partnerName, amount]) => ({ partnerName, amount }))
    .sort((a, b) => b.amount - a.amount);

  const plan = { netProfit, tripCount, distributions, entity, perTruck, undistributedProfit };
  const sourceFingerprint = hashPayload({
    quarter,
    year,
    trips: trips
      .map(trip => ({
        id: trip.id,
        tripVersion: trip.tripVersion,
        financialPostingId: trip.financialPostingId,
        financialPostingVersion: trip.financialPostingVersion,
        truckId: trip.truckId,
        grossProfit: trip.grossProfit,
        liveGrossProfit: trip.liveGrossProfit,
        completedAt: trip.completedAt?.toISOString() ?? null,
      }))
      .sort((left, right) => left.id - right.id),
    trucks: trucks
      .map(truck => ({
        id: truck.id,
        licensePlate: truck.licensePlate,
        updatedAt: truck.updatedAt.toISOString(),
      }))
      .sort((left, right) => left.id - right.id),
    ownership: ownershipSnapshot
      .map(item => ({
        truckId: item.truckId,
        owners: item.owners
          .slice()
          .sort((left, right) => (
            left.partnerName.localeCompare(right.partnerName)
            || left.role.localeCompare(right.role)
            || left.percentage - right.percentage
          )),
      }))
      .sort((left, right) => left.truckId - right.truckId),
  });

  return { plan, sourceFingerprint };
}

async function computeDistribution(
  executor: DistributionQueryExecutor,
  quarter: number,
  year: number,
): Promise<DistributionPlan> {
  return (await computeDistributionSnapshot(executor, quarter, year)).plan;
}
