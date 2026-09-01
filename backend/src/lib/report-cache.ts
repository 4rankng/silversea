/**
 * Single registry for report-cache keys. Every site that spells a `reports:` key —
 * invalidation lists, cacheGet setters, durable-effect key enumeration — derives it
 * from here; lib/redis.ts keeps only the raw cache mechanics. A source-scan unit test
 * (tests/unit/report-cache-registry.test.ts) enforces that no other file hand-spells
 * a quoted `reports:` key.
 *
 * Adding a new report cache:
 *   1. add its key prefix / builder below;
 *   2. add it to the semantic group(s) whose mutations feed it;
 *   3. extend the registry test's group expectations.
 */
import { cacheInvalidate, cacheInvalidatePattern } from './redis';

export const REPORT_CACHE_KEYS = {
  dashboard: 'reports:dashboard',
  dashboardExecutive: 'reports:dashboard:executive',
  pnlPattern: 'reports:pnl:*',
  fuelVariancePattern: 'reports:fuel-variance:*',
  totalArPattern: 'reports:total-ar:*',
  entityResultsPattern: 'reports:entity-results:*',
  dashboardWidgetsPattern: 'reports:dashboard-widgets:*',
} as const;

/** cacheGet setters use these so setter and invalidator can never diverge. */
export const dashboardCacheKey = (executive: boolean): string =>
  executive ? REPORT_CACHE_KEYS.dashboardExecutive : REPORT_CACHE_KEYS.dashboard;

export const pnlMonthKey = (month: number, year: number): string =>
  `reports:pnl:${month}:${year}`;

export const fuelVarianceMonthKey = (month: number, year: number): string =>
  `reports:fuel-variance:${month}:${year}`;

export const totalArRangeKey = (rangeFrom: string, rangeTo: string): string =>
  `reports:total-ar:${rangeFrom}:${rangeTo}`;

/** aging.service composes its multi-segment entity-results keys on this prefix. */
export const ENTITY_RESULTS_KEY_PREFIX = 'reports:entity-results:';

/**
 * `month: 'current'` + empty year is the unset-params cache shape (trailing colon).
 */
export const dashboardWidgetsMonthKey = (month: number | 'current', year: number | ''): string =>
  `reports:dashboard-widgets:${month}:${year}`;

/**
 * Mutation → cache semantics. Membership answers: which report caches derive from
 * this family of writes?
 */
export const REPORT_CACHE_GROUPS = {
  /** Trip writes that shift aging/fuel/KPIs (create, dispatch, figures, completion). */
  tripWrite: [
    REPORT_CACHE_KEYS.dashboard,
    REPORT_CACHE_KEYS.dashboardExecutive,
    REPORT_CACHE_KEYS.entityResultsPattern,
    REPORT_CACHE_KEYS.totalArPattern,
    REPORT_CACHE_KEYS.fuelVariancePattern,
    REPORT_CACHE_KEYS.dashboardWidgetsPattern,
  ],
  /**
   * Trip start / progress only — no financial postings, so no pnl/total-AR.
   * Preserves the exact historical start-side-effect set (4 keys).
   */
  tripStart: [
    REPORT_CACHE_KEYS.dashboard,
    REPORT_CACHE_KEYS.dashboardExecutive,
    REPORT_CACHE_KEYS.entityResultsPattern,
    REPORT_CACHE_KEYS.fuelVariancePattern,
  ],
} as const;

export type ReportCacheGroup = keyof typeof REPORT_CACHE_GROUPS;

/**
 * Bust a semantic group POST-commit (after the mutating transaction resolves —
 * invalidating mid-tx lets a concurrent read recompute against uncommitted rows and
 * cache a stale value). Pnl rides behind `includePnl` because it is the costliest
 * recompute and some callers historically gated it; it defaults ON so the argless
 * call sites keep full coverage. Fail-open: mechanics swallow Redis errors so a
 * write is never broken by cache trouble.
 */
export async function invalidateReportCaches(
  group: ReportCacheGroup = 'tripWrite',
  { includePnl = true }: { includePnl?: boolean } = {},
): Promise<void> {
  const keys: string[] = [...REPORT_CACHE_GROUPS[group]];
  if (includePnl) keys.push(REPORT_CACHE_KEYS.pnlPattern);
  try {
    await Promise.all(keys.map((key) => (key.endsWith('*')
      ? cacheInvalidatePattern(key)
      : cacheInvalidate(key))));
  } catch {
    // Non-critical — never block a write
  }
}
