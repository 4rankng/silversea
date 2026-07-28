/**
 * Reporting Shared Utilities
 *
 * Date-range helpers and utility functions shared across reporting sub-modules.
 */

import { sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { resolveSalaryPeriodDateRange, resolveQuarterDateRange } from './salary-period.service';

/** Local date string (YYYY-MM-DD) using system timezone — avoids toISOString() UTC drift. */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Add one day to a YYYY-MM-DD date string using pure arithmetic.
 * Avoids Date/toISOString which shifts dates in non-UTC timezones (e.g. UTC+7 Vietnam).
 */
export function addDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1); // day+1 handles month/year rollover
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Build a [start, exclusive_end) date range for a calendar month/year. Used for trip code counters. */
export function calendarMonthDateRange(year: number, month?: number) {
  if (month) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = month === 12 ? 1 : month + 1;
    const endYear = month === 12 ? year + 1 : year;
    const end = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;
    return { start, end };
  }
  return { start: `${year}-01-01`, end: `${year + 1}-01-01` };
}

/**
 * Resolve salary-period-aware date range for a given month/year.
 * Returns { start, end } where start is inclusive and end is exclusive (next day).
 */
export async function salaryPeriodDateRange(month: number, year: number) {
  const resolved = await resolveSalaryPeriodDateRange(month, year);
  // Convert inclusive end to exclusive end for SQL comparisons
  // Uses local date arithmetic to avoid toISOString() timezone shift
  const exclusiveEnd = addDay(resolved.end);
  return { start: resolved.start, end: exclusiveEnd };
}

/**
 * Resolve quarter date range with exclusive end for SQL comparisons.
 */
export async function quarterDateRange(quarter: number, year: number) {
  const { start: qStart, end: qEndRaw } = await resolveQuarterDateRange(quarter, year);
  const qEnd = addDay(qEndRaw);
  return { start: qStart, end: qEnd };
}

/**
 * Official trip financial reporting anchors to the Vietnam business date of
 * trip completion, not the trip's operational departure date.
 */
export function tripCompletionBusinessDateSql() {
  return sql<string>`(${s.trips.completedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
}

// ─── Cap-table helpers (shared between dashboard-stats and profit-distribution) ──

type CapRow = { partnerName: string; effectiveDate: string; createdAt: Date | string; contributionAmount: string | null; percentage: string | null };

/**
 * Core snapshot resolution: pick the latest effectiveDate ≤ cutoff (falling
 * back to all rows if none have been reached yet), then dedupe by partner name
 * keeping the row with the newest createdAt. Returns the raw deduped rows so
 * callers can decide how to interpret percentage vs contribution amount.
 *
 * Shared by `resolveCapTableSnapshot` (entity-wide, amount-or-percentage) and
 * `resolveTruckCapSnapshot` (per-vehicle, explicit percentage).
 */
function resolveSnapshotRows<T extends { partnerName: string; effectiveDate: string; createdAt: Date | string }>(
  rows: T[],
  cutoffDate: string,
): T[] {
  const named = rows.filter(c => c.partnerName);
  if (named.length === 0) return [];
  const reached = named.filter(c => c.effectiveDate <= cutoffDate);
  const pool = reached.length > 0 ? reached : named;
  const latestDate = pool.reduce((acc, c) => (c.effectiveDate > acc ? c.effectiveDate : acc), pool[0].effectiveDate);
  const snapshot = pool.filter(c => c.effectiveDate === latestDate);
  const byName = new Map<string, T>();
  for (const row of snapshot) {
    const prev = byName.get(row.partnerName);
    if (!prev || new Date(row.createdAt) > new Date(prev.createdAt)) byName.set(row.partnerName, row);
  }
  return Array.from(byName.values());
}

/**
 * Resolve the active cap-table snapshot as of a cutoff date.
 * Picks the latest effective date ≤ cutoff, deduplicates by partner name
 * (keeping the row with the newest createdAt), then auto-calculates
 * percentages from contribution amounts.
 */
export function resolveCapTableSnapshot(
  capRows: CapRow[],
  cutoffDate: string,
): Array<{ partnerName: string; contributionAmount: number; percentage: number }> {
  const rows = resolveSnapshotRows(capRows, cutoffDate);
  if (rows.length === 0) return [];

  // Use stored percentage if all partners have explicit percentages set;
  // otherwise fall back to calculating from contributionAmount.
  const hasStoredPct = rows.every(r => parseFloat(r.percentage ?? '0') > 0);
  if (hasStoredPct) {
    return rows.map(r => ({
      partnerName: r.partnerName,
      contributionAmount: parseFloat(r.contributionAmount ?? '0') || 0,
      percentage: parseFloat(r.percentage ?? '0'),
    }));
  }

  const partners = rows.map(r => ({
    partnerName: r.partnerName,
    contributionAmount: parseFloat(r.contributionAmount ?? '0') || 0,
  }));

  const total = partners.reduce((sum, p) => sum + p.contributionAmount, 0);
  return partners.map(p => ({
    ...p,
    percentage: total > 0 ? Math.round((p.contributionAmount / total) * 10000) / 100 : 0,
  }));
}

/**
 * F3 — Resolve the active per-vehicle cap-table snapshot as of a cutoff date.
 * Same history semantics as `resolveCapTableSnapshot` (latest effectiveDate
 * ≤ cutoff, dedupe by partner keeping newest createdAt), but the percentage is
 * explicit (read directly from the row — owners are named per truck with
 * their % share, not derived from a contribution amount).
 *
 * `capRows` must already be scoped to one truck (caller filters by truckId).
 */
export function resolveTruckCapSnapshot(
  capRows: Array<{ partnerName: string; effectiveDate: string; createdAt: Date | string; percentage: string | null; role?: string | null }>,
  cutoffDate: string,
): Array<{ partnerName: string; percentage: number; role: 'INVESTOR' | 'DRIVER' }> {
  const rows = resolveSnapshotRows(capRows, cutoffDate);
  return rows
    .map(r => ({
      partnerName: r.partnerName,
      percentage: parseFloat(r.percentage ?? '0') || 0,
      // B2 — pass through the partner role, defaulting to INVESTOR for legacy/
      // null rows. normalize guards against an unexpected value landing as
      // INVESTOR rather than an `any`.
      role: (r.role === 'DRIVER' ? 'DRIVER' : 'INVESTOR') as 'INVESTOR' | 'DRIVER',
    }))
    .filter(p => p.percentage > 0);
}
