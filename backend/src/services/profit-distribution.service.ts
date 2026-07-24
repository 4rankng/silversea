/**
 * Profit Distribution Service
 *
 * Quarterly profit distribution to cap-table partners, distribution preview,
 * cap-table history, and distribution records.
 *
 * F3 (per-vehicle): each truck distributes its quarter profit (Σ of its LOCKED
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
import { localDateStr, quarterDateRange, resolveTruckCapSnapshot } from './reporting-shared';

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

/**
 * Distribute net profit for a quarter to cap-table partners (per-vehicle).
 */
export async function distributeProfit(quarter: number, year: number) {
  // Read-only computation + exactness reconcile guard (throws BEFORE any write
  // if the math is off).
  const plan = await computeDistribution(quarter, year);

  // Atomic write: the idempotency check + the multi-row insert run in ONE
  // transaction so a partial-insert failure (connection drop, constraint
  // violation) rolls back ALL rows — leaving the quarter cleanly retryable
  // instead of stuck half-distributed with the idempotency guard blocking
  // every retry. (Architect CRITICAL #1.)
  await db.transaction(async (tx) => {
    // Serialize concurrent distributeProfit for the same quarter/year. Two
    // admins (or a double-click) could both pass the SELECT-then-INSERT
    // idempotency check under READ COMMITTED and double-distribute. A
    // transaction-scoped advisory lock keyed by (year, quarter) makes the
    // second caller BLOCK until the first commits — then its SELECT sees the
    // persisted rows and returns 409. Auto-releases on commit/rollback.
    // (A UNIQUE(quarter,year) index would be WRONG here: the table stores one
    // row per truck×partner, so many rows legitimately share quarter+year.)
    // (code-review CRITICAL #1 — corrected fix)
    const lockKey = year * 4 + quarter;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`);

    const [existing] = await tx.select({ id: s.distributions.id })
      .from(s.distributions)
      .where(and(eq(s.distributions.quarter, quarter), eq(s.distributions.year, year)))
      .limit(1);
    if (existing) {
      throw new ApiError(409, `Phân chia lợi nhuận Q${quarter}/${year} đã tồn tại`);
    }

    if (plan.distributions.length > 0) {
      await tx.insert(s.distributions).values(plan.distributions.map(d => ({
        quarter: d.quarter,
        year: d.year,
        truckId: d.truckId,
        partnerName: d.partnerName,
        amount: d.amount,
      })));
    }
  });

  return {
    quarter,
    year,
    netProfit: plan.netProfit,
    distributions: plan.distributions,
    perTruck: plan.perTruck,
    entity: plan.entity,
    undistributedProfit: plan.undistributedProfit,
  };
}

/**
 * Preview profit distribution without persisting.
 * Same logic as distributeProfit but returns the calculation without inserting.
 */
export async function previewDistribution(quarter: number, year: number) {
  const plan = await computeDistribution(quarter, year);
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
 * D5 — reads `trips.grossProfit` for LOCKED trips only; never recomputes a
 * locked trip's totals. Per-vehicle grouping changes only attribution.
 */
async function computeDistribution(quarter: number, year: number): Promise<DistributionPlan> {
  const { start: qStart, end: qEnd } = await quarterDateRange(quarter, year);

  const trips = await db.select({
    truckId: s.trips.truckId,
    grossProfit: s.trips.grossProfit,
  }).from(s.trips).where(
    and(
      eq(s.trips.status, TripStatus.LOCKED),
      isNull(s.trips.deletedAt),
      gte(s.trips.departureDate, qStart),
      sql`${s.trips.departureDate} < ${qEnd}`,
    ),
  );

  // Σ LOCKED grossProfit per truck (D5 — read stored value, never recompute).
  const profitByTruck = new Map<number, number>();
  let tripCount = 0;
  for (const t of trips) {
    if (t.truckId == null) continue; // trips without a truck cannot be attributed
    tripCount++;
    const profit = parseFloat(t.grossProfit || '0');
    profitByTruck.set(t.truckId, (profitByTruck.get(t.truckId) ?? 0) + profit);
  }

  const truckIds = Array.from(profitByTruck.keys());
  const netProfit = Array.from(profitByTruck.values()).reduce((a, b) => a + b, 0);

  // No profit-bearing trucks → nothing to distribute. Legacy callers may have
  // thrown when there were zero entity-wide partners; here the honest answer
  // is an empty plan with zero undistributed profit.
  if (truckIds.length === 0) {
    return { netProfit: 0, tripCount, distributions: [], entity: [], perTruck: [], undistributedProfit: 0 };
  }

  // Load all per-vehicle cap rows for the profit-bearing trucks, scoped once.
  const capRows = truckIds.length > 0
    ? await db.select().from(s.truckCapTable).where(inArray(s.truckCapTable.truckId, truckIds))
    : [];

  // Plates for display — never expose the raw truckId in the UI.
  const trucks = await db.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate })
    .from(s.trucks).where(inArray(s.trucks.id, truckIds));
  const plateById = new Map(trucks.map(t => [t.id, t.licensePlate]));

  const today = localDateStr();
  const cutoff = qEnd > today ? today : qEnd;

  const distributions: DistributionRow[] = [];
  const perTruck: PerTruckDistribution[] = [];
  let undistributedProfit = 0;

  for (const truckId of truckIds) {
    const profit = profitByTruck.get(truckId) ?? 0;
    const plate = plateById.get(truckId) ?? '(không rõ biển số)';
    const rowsForTruck = capRows.filter(r => r.truckId === truckId);
    const owners = resolveTruckCapSnapshot(rowsForTruck, cutoff);

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

  return { netProfit, tripCount, distributions, entity, perTruck, undistributedProfit };
}
