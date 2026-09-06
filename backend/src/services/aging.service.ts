import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db';
import * as s from '../db/schema';
import { cacheGet } from '../lib/redis';
import { eq, and, or, sql, inArray, like, isNull, lt } from 'drizzle-orm';
import { computeFifoAging, TxnType } from '@tingting/shared';
import { ENTITY_RESULTS_KEY_PREFIX } from '../lib/report-cache';
import type { PayableSummary, PayablesCategory, Supplier } from '@tingting/shared';
import {
  getCustomerReceivableSnapshots,
  resolveVietnamAsOfCutoff,
} from './customer-receivable-authority.service';

// ─── Types ──────────────────────────────────────────────────────────────────

type LedgerEntry = { debit: string | null; credit: string | null; timestamp: Date | null };

interface AgingConfig {
  entityType: 'CUSTOMER' | 'VENDOR' | 'CARRIER';
  /** Whether to invert debit/credit before FIFO computation (true for VENDOR) */
  invertSigns: boolean;
}

interface FetchOptions {
  /** Point-in-time snapshot: include entries before the next Vietnam business midnight. */
  asOfDate?: string;
  /** Restrict to a single entity — avoids fetching all entities when only one is needed */
  entityId?: number;
  /** Restrict to a known set of entities — useful after catalog/search prefiltering */
  entityIds?: number[];
  /** Restrict to a subset of transaction types (e.g. fuel-only payables). */
  txnTypes?: TxnType[];
  /** Carrier AP projection, including only carrier-cost reversals. */
  carrierPayables?: boolean;
  /** Read historical CUSTOMER carrier rows together with current CARRIER rows. */
  entityTypes?: Array<'CUSTOMER' | 'VENDOR' | 'CARRIER'>;
  /** Keep carrier AP activity out of customer AR reports. */
  excludeCarrierPayables?: boolean;
}

interface EntityAgingResult {
  entityId: number;
  aging: { current: number; d30: number; d60: number; over90: number };
  openInvoices: Array<{ ts: string; open: number }>;
  totalOutstanding: number;
  maxOverdueDays: number;
}

interface AgingPageOptions {
  page?: number;
  limit?: number;
}

function reportChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function historicalReportMetadata(asOfDate: string | undefined, definitionVersion: string, payload: unknown) {
  const cutoff = resolveVietnamAsOfCutoff(asOfDate);
  return {
    asOf: cutoff.explicit ? cutoff.businessDate : cutoff.referenceDate.toISOString(),
    asOfExclusive: cutoff.endExclusive.toISOString(),
    timezone: 'Asia/Ho_Chi_Minh' as const,
    definitionVersion,
    consistency: 'BEST_EFFORT' as const,
    checksum: reportChecksum({ definitionVersion, asOfExclusive: cutoff.endExclusive.toISOString(), payload }),
  };
}

export interface CustomerAgingListItem {
  customerId: number;
  customerName: string;
  contactInfo: string | null;
  linkedSupplierId: number | null;
  linkedSupplierApBalance: number;
  netBalance: number;
  totalOutstanding: number;
  aging: { current: number; d30: number; d60: number; over90: number };
  maxOverdueDays: number;
}

export interface CustomerAgingListResult {
  customers: CustomerAgingListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** Full-set aggregates (independent of page/limit), for the list page's KPI strip. */
  totals: AgingListTotals;
}

/** Aging-bucket filter matching the /debt page's bucket pills. */
export type AgingBucketFilter = 'all' | 'current' | 'd30' | 'd60' | 'over90';

export interface AgingListTotals {
  total: number;
  current: number;
  d30: number;
  d60: number;
  over90: number;
  currentCusts: number;
  d30Custs: number;
  d60Custs: number;
  over90Custs: number;
  overdueCount: number;
  highRiskCount: number;
}

/** Mirrors the /debt page's risk badge rule (over90 balance or >100M outstanding = high). */
export function classifyAgingRisk(totalOutstanding: number, aging: { over90: number; d30: number; d60: number }): 'high' | 'med' | 'low' {
  if (totalOutstanding <= 0) return 'low';
  if (aging.over90 > 0 || totalOutstanding > 100_000_000) return 'high';
  if (aging.d30 > 0 || aging.d60 > 0) return 'med';
  return 'low';
}

/** Full-set totals block for the /debt KPI strip, computed before pagination. */
export function summarizeAgingTotals(rows: Array<{ totalOutstanding: number; maxOverdueDays: number; aging: { current: number; d30: number; d60: number; over90: number } }>): AgingListTotals {
  const totals: AgingListTotals = {
    total: 0, current: 0, d30: 0, d60: 0, over90: 0,
    currentCusts: 0, d30Custs: 0, d60Custs: 0, over90Custs: 0,
    overdueCount: 0, highRiskCount: 0,
  };
  for (const r of rows) {
    if (r.totalOutstanding <= 0) continue;
    totals.total += r.totalOutstanding;
    if (r.aging.current > 0) { totals.current += r.aging.current; totals.currentCusts++; }
    if (r.aging.d30 > 0) { totals.d30 += r.aging.d30; totals.d30Custs++; }
    if (r.aging.d60 > 0) { totals.d60 += r.aging.d60; totals.d60Custs++; }
    if (r.aging.over90 > 0) { totals.over90 += r.aging.over90; totals.over90Custs++; }
    if (r.maxOverdueDays > 30) totals.overdueCount++;
    if (classifyAgingRisk(r.totalOutstanding, r.aging) === 'high') totals.highRiskCount++;
  }
  return totals;
}

/** Bucket filter matching the /debt page's pills (each bucket requires outstanding). */
export function filterAgingByBucket<
  T extends { totalOutstanding: number; aging: { current: number; d30: number; d60: number; over90: number } },
>(rows: T[], bucket: AgingBucketFilter): T[] {
  if (bucket === 'all') return rows;
  const hasBucket = (r: T) => r.totalOutstanding > 0 && r.aging[bucket] > 0;
  return rows.filter(hasBucket);
}

// ─── Column sorting (server-side, pre-pagination) ────────────────────────────
//
// Both list endpoints materialize their rows in the service (FIFO aging over
// the ledger, cached per day) rather than a plain SQL projection, so the sort
// whitelist maps URL keys to row readers instead of SQL expressions. The
// contract matches the SQL whitelist pattern elsewhere: absent params keep the
// historical default order, numeric money columns compare numerically, null
// cells sort last in both directions, and a stable id tiebreaker keeps pages
// deterministic for equal keys.

/** Sortable columns of GET /reports/receivables-aging (the /debt list). */
export const CUSTOMER_AGING_SORT_KEYS = [
  'customerName',
  'totalOutstanding',
  'netBalance',
  'maxOverdueDays',
] as const;
export type CustomerAgingSortKey = typeof CUSTOMER_AGING_SORT_KEYS[number];

/** Sortable columns of GET /reports/payables-summary (the /payables list). */
export const PAYABLES_SUMMARY_SORT_KEYS = [
  'supplierName',
  'totalOutstanding',
  'current',
  'd30',
  'd60',
  'over90',
] as const;
export type PayablesSummarySortKey = typeof PAYABLES_SUMMARY_SORT_KEYS[number];

export type AgingSortDir = 'asc' | 'desc';

/** Query params both sort schemas accept; routes safeParse req.query. */
export const customerAgingSortQuerySchema = z.object({
  sortBy: z.enum(CUSTOMER_AGING_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const payablesSummarySortQuerySchema = z.object({
  sortBy: z.enum(PAYABLES_SUMMARY_SORT_KEYS).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

/** Each reader yields one value per row; within a key the value type is
 * homogeneous (string for names, number for money/day counts). */
const CUSTOMER_AGING_SORT_READERS: Record<CustomerAgingSortKey, (row: CustomerAgingListItem) => string | number | null> = {
  customerName: r => r.customerName,
  totalOutstanding: r => r.totalOutstanding,
  netBalance: r => r.netBalance,
  maxOverdueDays: r => r.maxOverdueDays,
};

const PAYABLES_SORT_READERS: Record<PayablesSummarySortKey, (row: PayableSummary) => string | number | null> = {
  supplierName: r => r.supplier?.name ?? null,
  totalOutstanding: r => r.totalOutstanding,
  current: r => r.aging?.current,
  d30: r => r.aging?.d30,
  d60: r => r.aging?.d60,
  over90: r => r.aging?.over90,
};

function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  dir: 1 | -1,
): number {
  // Nulls last in both directions (the JS mirror of `nulls last`).
  if (a == null || b == null) {
    if (a == null && b == null) return 0;
    return a == null ? 1 : -1;
  }
  const cmp = typeof a === 'string'
    ? a.localeCompare(b as string, 'vi')
    : (a as number) - (b as number);
  return cmp * dir;
}

/** Stable tiebreaker: customer id ascending, independent of sort direction. */
export function sortCustomerAgingRows(
  rows: CustomerAgingListItem[],
  sortBy?: CustomerAgingSortKey,
  sortDir: AgingSortDir = 'asc',
): CustomerAgingListItem[] {
  if (!sortBy) {
    // Historical default order — byte-identical to the pre-sort-param behavior.
    rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return rows;
  }
  const read = CUSTOMER_AGING_SORT_READERS[sortBy];
  const dir = sortDir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const primary = compareSortValues(read(a), read(b), dir);
    return primary !== 0 ? primary : a.customerId - b.customerId;
  });
  return rows;
}

/**
 * Sorts a payables list in place. Tiebreaker: vendor rows before carrier rows
 * for the same key value, then supplier id ascending — the same composite the
 * mobile/desktop row keys (`${kind}-${supplier.id}`) use for identity.
 */
export function sortPayablesRows(
  items: PayableSummary[],
  sortBy?: PayablesSummarySortKey,
  sortDir: AgingSortDir = 'asc',
): PayableSummary[] {
  if (!sortBy) return items;
  const read = PAYABLES_SORT_READERS[sortBy];
  const dir = sortDir === 'desc' ? -1 : 1;
  const kindRank = (d: PayableSummary) => (d.kind === 'carrier' ? 1 : 0);
  items.sort((a, b) => {
    const primary = compareSortValues(read(a), read(b), dir);
    return primary !== 0
      ? primary
      : (kindRank(a) - kindRank(b)) || (a.supplier.id - b.supplier.id);
  });
  return items;
}

// ─── Core computation ────────────────────────────────────────────────────────

async function fetchLedgerGrouped(
  config: AgingConfig,
  opts: FetchOptions = {},
): Promise<Map<number, LedgerEntry[]>> {
  if (opts.entityIds && opts.entityIds.length === 0) return new Map();

  const conditions = [
    opts.entityTypes?.length
      ? inArray(s.ledger.entityType, opts.entityTypes)
      : eq(s.ledger.entityType, config.entityType),
  ];
  if (opts.entityId !== undefined) conditions.push(eq(s.ledger.entityId, opts.entityId));
  if (opts.entityIds && opts.entityIds.length > 0) conditions.push(inArray(s.ledger.entityId, opts.entityIds));
  if (opts.asOfDate) {
    const cutoff = resolveVietnamAsOfCutoff(opts.asOfDate);
    conditions.push(lt(s.ledger.timestamp, cutoff.endExclusive));
  }
  if (opts.carrierPayables) {
    conditions.push(or(
      inArray(s.ledger.txnType, [TxnType.EXTERNAL_CARRIER_COST, TxnType.VENDOR_PAYMENT]),
      and(
        eq(s.ledger.txnType, TxnType.UNLOCK_REVERSAL),
        like(s.ledger.note, 'Cước thuê ngoài%'),
      ),
    )!);
  } else if (opts.txnTypes && opts.txnTypes.length > 0) {
    conditions.push(inArray(s.ledger.txnType, opts.txnTypes));
  }
  if (opts.excludeCarrierPayables) {
    conditions.push(sql`not (
      ${s.ledger.txnType} = ${TxnType.EXTERNAL_CARRIER_COST}
      or ${s.ledger.txnType} = ${TxnType.VENDOR_PAYMENT}
      or (
        ${s.ledger.txnType} = ${TxnType.UNLOCK_REVERSAL}
        and ${s.ledger.note} like 'Cước thuê ngoài%'
      )
    )`);
  }

  const ledgerRows = await db.select({
    entityId: s.ledger.entityId,
    debit: s.ledger.debit,
    credit: s.ledger.credit,
    timestamp: s.ledger.timestamp,
  }).from(s.ledger)
    .where(and(...conditions))
    .orderBy(sql`${s.ledger.id} ASC`);

  const grouped = new Map<number, LedgerEntry[]>();
  for (const row of ledgerRows) {
    const entries = grouped.get(row.entityId) || [];
    entries.push({ debit: row.debit, credit: row.credit, timestamp: row.timestamp });
    grouped.set(row.entityId, entries);
  }
  return grouped;
}

function computeAging(entries: LedgerEntry[], now: Date, invertSigns: boolean) {
  return computeFifoAging(
    entries.map(e => ({
      timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : (e.timestamp as string | null),
      debit: invertSigns ? (e.credit ?? '0') : (e.debit ?? '0'),
      credit: invertSigns ? (e.debit ?? '0') : (e.credit ?? '0'),
    })),
    now,
  );
}

function computeEntityResults(
  grouped: Map<number, LedgerEntry[]>,
  config: AgingConfig,
  referenceDate: Date = new Date(),
): EntityAgingResult[] {
  const results: EntityAgingResult[] = [];

  for (const [entityId, entries] of grouped) {
    const { aging, openInvoices } = computeAging(entries, referenceDate, config.invertSigns);
    const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.over90;

    let maxOverdueDays = 0;
    for (const inv of openInvoices) {
      if (inv.open <= 0) continue;
      const ageDays = Math.floor((referenceDate.getTime() - new Date(inv.ts).getTime()) / 86400000);
      if (ageDays > maxOverdueDays) maxOverdueDays = ageDays;
    }

    if (totalOutstanding > 0) {
      results.push({ entityId, aging, openInvoices, totalOutstanding, maxOverdueDays });
    }
  }

  return results;
}

async function getEntityResultsCached(
  config: AgingConfig,
  opts: {
    asOfDate?: string;
    txnTypes?: TxnType[];
    carrierPayables?: boolean;
    entityTypes?: Array<'CUSTOMER' | 'VENDOR' | 'CARRIER'>;
    excludeCarrierPayables?: boolean;
  } = {},
): Promise<EntityAgingResult[]> {
  // Cache the expensive "pull all ledger rows for an entity type + run FIFO
  // aging" step. Keyed by (entityType, invertSigns, asOfDate|today, txnTypes) —
  // never by entityIds, so the full per-entityType result is computed once per
  // TTL and list callers filter in JS. Aging buckets are day-granular, so
  // date-only keying is exact within a day; every ledger write invalidates via
  // invalidateReportCaches() (route-layer, post-commit). The 300s TTL is only a
  // safety net. JSON round-trip is lossless here — EntityAgingResult carries no
  // Date objects (timestamps are ISO strings).
  const cutoff = resolveVietnamAsOfCutoff(opts.asOfDate);
  const asOfKey = cutoff.businessDate;
  const txnKey = opts.carrierPayables
    ? 'carrier-payables'
    : opts.txnTypes && opts.txnTypes.length > 0
      ? opts.txnTypes.join(',')
      : 'all';
  const entityKey = opts.entityTypes?.join(',') ?? config.entityType;
  const projectionKey = opts.excludeCarrierPayables ? 'no-carrier-ap' : 'all-projections';
  return cacheGet<EntityAgingResult[]>(
    `${ENTITY_RESULTS_KEY_PREFIX}${entityKey}:${config.invertSigns ? 'inv' : 'std'}:${asOfKey}:${txnKey}:${projectionKey}`,
    300,
    async () => {
      const grouped = await fetchLedgerGrouped(config, {
        asOfDate: opts.asOfDate,
        txnTypes: opts.txnTypes,
        carrierPayables: opts.carrierPayables,
        entityTypes: opts.entityTypes,
        excludeCarrierPayables: opts.excludeCarrierPayables,
      });
      return computeEntityResults(grouped, config, cutoff.referenceDate);
    },
  );
}

export function paginateAgingRows<T>(
  rows: T[],
  opts: AgingPageOptions = {},
): { rows: T[]; page: number; limit: number; total: number; totalPages: number } {
  const page = Math.max(1, Math.floor(opts.page || 1));
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit || 500)));
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  return {
    rows: rows.slice(start, start + limit),
    page,
    limit,
    total,
    totalPages,
  };
}

async function findCustomerIdsForAgingSearch(search: string): Promise<Set<number>> {
  const escaped = search.replace(/[%_]/g, '\\$&');
  const pattern = `%${escaped}%`;
  const ids = new Set<number>();

  // Name + contact match — tone-insensitive Vietnamese search pushed to SQL via
  // unaccent() (same pattern as trip-queries.service.ts). Replaces the prior
  // loop that loaded every customer row into Node.js and string-matched in JS.
  // The haystack is the SAME `name || ' ' || contactInfo` concatenation the JS
  // used, so result sets are byte-identical — only WHERE it computes changes.
  // ILIKE gives the case-insensitivity the old toLowerCase() did; unaccent()
  // strips tones + maps đ→d, verified equivalent to the prior NFD helper on real
  // customer names (e.g. "Hải Đăng" → "Hai Dang").
  // No expression index: leading-wildcard ILIKE defeats btree, and a pg_trgm
  // GIN only pays off at thousands of customers, not ~58.
  const nameContactTerm = `%${escaped}%`;
  const matched = await db.select({ id: s.customers.id }).from(s.customers).where(
    sql`unaccent(COALESCE(${s.customers.name}, ''::text) || ' ' || COALESCE(${s.customers.contactInfo}, ''::text)) ILIKE unaccent(${nameContactTerm})`,
  );
  matched.forEach(r => ids.add(r.id));

  // Container match via trip_containers
  const byContainer = await db
    .select({ customerId: s.trips.customerId })
    .from(s.tripContainers)
    .innerJoin(s.trips, eq(s.tripContainers.tripId, s.trips.id))
    .where(like(s.tripContainers.containerNumber, pattern));
  byContainer.forEach(r => ids.add(r.customerId));

  // Container match via trip_expenses.container_number
  const byFeeContainer = await db
    .select({ customerId: s.trips.customerId })
    .from(s.tripExpenses)
    .innerJoin(s.trips, eq(s.tripExpenses.tripId, s.trips.id))
    .where(like(s.tripExpenses.containerNumber, pattern));
  byFeeContainer.forEach(r => ids.add(r.customerId));

  return ids;
}

// ─── Accounts Receivable (Customer aging) ────────────────────────────────────

// ─── Accounts Receivable (Customer aging) ────────────────────────────────────

/**
 * The range label identifying the current (not-yet-overdue) receivables bucket.
 * Single source of truth: `getReceivablesSummary` emits this label, and every
 * consumer that derives an "overdue total" by filtering buckets MUST compare
 * against THIS constant rather than a magic `'0-30'` string — otherwise a label
 * change here silently flips the overdue calc to "all outstanding".
 */
export const CURRENT_AGING_RANGE = '0-30';

export async function getReceivablesSummary(opts: { asOfDate?: string } = {}) {
  const customerRows = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(isNull(s.customers.deletedAt));
  const snapshotMap = await getCustomerReceivableSnapshots(
    customerRows.map((row) => row.id),
    { asOfDate: opts.asOfDate },
  );
  const results = [...snapshotMap.values()]
    .filter((snapshot) => snapshot.totalOutstanding > 0)
    .map((snapshot) => ({
      entityId: snapshot.customerId,
      aging: snapshot.aging,
      totalOutstanding: snapshot.totalOutstanding,
      maxOverdueDays: snapshot.maxOverdueDays,
    }));

  const buckets = [
    { range: CURRENT_AGING_RANGE, label: 'Trong hạn', count: 0, amount: 0 },
    { range: '31-60', label: '31-60 ngày', count: 0, amount: 0 },
    { range: '61-90', label: '61-90 ngày', count: 0, amount: 0 },
    { range: '90+', label: 'Trên 90 ngày', count: 0, amount: 0 },
  ];

  let totalOutstanding = 0;
  let totalCustomers = 0;

  for (const r of results) {
    buckets[0].amount += r.aging.current;
    buckets[1].amount += r.aging.d30;
    buckets[2].amount += r.aging.d60;
    buckets[3].amount += r.aging.over90;

    totalCustomers++;
    totalOutstanding += r.totalOutstanding;

    if (r.maxOverdueDays > 90) buckets[3].count++;
    else if (r.maxOverdueDays > 60) buckets[2].count++;
    else if (r.maxOverdueDays > 30) buckets[1].count++;
    else buckets[0].count++;
  }

  const payload = {
    buckets,
    totalOutstanding,
    totalCustomers,
    overdueCustomers: totalCustomers - buckets[0].count,
    overdueAmount: buckets.slice(1).reduce((sum, bucket) => sum + bucket.amount, 0),
  };
  return {
    ...payload,
    ...historicalReportMetadata(opts.asOfDate, 'receivables-summary-v2', payload),
  };
}

export async function getTopOverdueCustomer(): Promise<{ name: string; balance: number; days: number } | null> {
  const customerRows = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(isNull(s.customers.deletedAt));
  const snapshotMap = await getCustomerReceivableSnapshots(customerRows.map((row) => row.id));
  const results = [...snapshotMap.values()]
    .filter((snapshot) => snapshot.totalOutstanding > 0)
    .map((snapshot) => ({
      entityId: snapshot.customerId,
      totalOutstanding: snapshot.totalOutstanding,
      maxOverdueDays: snapshot.maxOverdueDays,
    }));
  const top = results.sort((a, b) => b.totalOutstanding - a.totalOutstanding)[0];
  if (!top) return null;

  const [customer] = await db.select({ name: s.customers.name })
    .from(s.customers)
    .where(eq(s.customers.id, top.entityId))
    .limit(1);

  return {
    name: customer?.name || 'Khách hàng không xác định',
    balance: top.totalOutstanding,
    days: top.maxOverdueDays,
  };
}

export async function getCustomerAgingList(opts: { search?: string; asOfDate?: string; page?: number; limit?: number; bucket?: AgingBucketFilter; sortBy?: CustomerAgingSortKey; sortDir?: AgingSortDir } = {}): Promise<CustomerAgingListResult> {
  // Container-number / name search: if provided, narrow customer IDs to those
  // whose customer name OR linked trips' containers (trip_containers or
  // trip_expenses.container_number) match the query. Matches the test guide's
  // expectation that "/debt" supports lookup by container.
  const trimmedSearch = opts.search?.trim();
  const searchedCustomerIds = trimmedSearch ? await findCustomerIdsForAgingSearch(trimmedSearch) : undefined;
  // Full per-entityType result (cached); narrow by search in JS. The cache key
  // intentionally omits entityIds so a search reuses the browse result.
  const customersScope = searchedCustomerIds
    ? [...searchedCustomerIds]
    : (await db.select({ id: s.customers.id }).from(s.customers).where(isNull(s.customers.deletedAt))).map((row) => row.id);
  const snapshotMap = await getCustomerReceivableSnapshots(customersScope, { asOfDate: opts.asOfDate });
  const results = [...snapshotMap.values()]
    .filter((snapshot) => snapshot.totalOutstanding > 0)
    .map((snapshot) => ({
      entityId: snapshot.customerId,
      aging: snapshot.aging,
      totalOutstanding: snapshot.totalOutstanding,
      maxOverdueDays: snapshot.maxOverdueDays,
    }));

  const customerIds = results.map(r => r.entityId);
  const customers = customerIds.length > 0
    ? await db.select({ id: s.customers.id, name: s.customers.name, contactInfo: s.customers.contactInfo, linkedSupplierId: s.customers.linkedSupplierId })
        .from(s.customers)
        .where(inArray(s.customers.id, customerIds))
    : [];
  const nameMap = new Map(customers.map(c => [c.id, c.name]));
  const contactMap = new Map(customers.map(c => [c.id, c.contactInfo]));
  const linkedSupplierMap = new Map(customers.map(c => [c.id, c.linkedSupplierId]));

  // For dual-role partners (customer with linked supplier), look up the linked
  // supplier's outstanding AP so the list page can show a Net column.
  const linkedSupplierIds = [...new Set(customers.map(c => c.linkedSupplierId).filter((v): v is number => v != null))];
  const apByVendor = new Map<number, number>();
  if (linkedSupplierIds.length > 0) {
    const apGrouped = await fetchLedgerGrouped(
      { entityType: 'VENDOR', invertSigns: true },
      { asOfDate: opts.asOfDate, entityIds: linkedSupplierIds },
    );
    const apCutoff = resolveVietnamAsOfCutoff(opts.asOfDate);
    const apResults = computeEntityResults(
      apGrouped,
      { entityType: 'VENDOR', invertSigns: true },
      apCutoff.referenceDate,
    );
    for (const r of apResults) {
      apByVendor.set(r.entityId, r.totalOutstanding);
    }
  }

  const mapped: CustomerAgingListItem[] = results.map(r => {
    const linkedSupplierId = linkedSupplierMap.get(r.entityId) ?? null;
    const linkedSupplierApBalance = linkedSupplierId != null ? (apByVendor.get(linkedSupplierId) ?? 0) : 0;
    return {
      customerId: r.entityId,
      customerName: nameMap.get(r.entityId) || 'Khách hàng chưa xác định',
      contactInfo: contactMap.get(r.entityId) || null,
      linkedSupplierId,
      linkedSupplierApBalance,
      netBalance: r.totalOutstanding - linkedSupplierApBalance,
      totalOutstanding: r.totalOutstanding,
      aging: r.aging,
      maxOverdueDays: r.maxOverdueDays,
    };
  });

  // Column sort (or the historical outstanding-desc default) lands before the
  // totals/bucket/pagination steps: totals are sums (order-independent), the
  // bucket filter is order-preserving, and pagination slices the sorted list.
  sortCustomerAgingRows(mapped, opts.sortBy, opts.sortDir);
  // Totals describe the whole (search-scoped) result set, independent of the
  // bucket filter and page window, so the KPI strip stays stable while the
  // user pages or narrows to one aging bucket.
  const totals = summarizeAgingTotals(mapped);
  const bucketed = filterAgingByBucket(mapped, opts.bucket ?? 'all');
  const page = paginateAgingRows(bucketed, opts);
  const payload = {
    customers: page.rows,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.totalPages,
    totals,
  };
  return {
    ...payload,
    ...historicalReportMetadata(opts.asOfDate, 'receivables-aging-v2', payload),
  };
}

// ─── Accounts Payable (Vendor aging) ─────────────────────────────────────────

type PayablesScope = {
  entityType: 'CUSTOMER' | 'VENDOR' | 'CARRIER';
  entityTypes?: Array<'CUSTOMER' | 'VENDOR' | 'CARRIER'>;
  txnTypes?: TxnType[];
  invertSigns: boolean;
  kind: 'vendor' | 'carrier';
  carrierPayables?: boolean;
};

type PayablesSummaryResult = {
  items: PayableSummary[];
  totalOutstanding: number;
  totalSuppliers: number;
  overdueSuppliers: number;
};

async function getPayablesForScope(
  scope: PayablesScope,
  asOfDate?: string,
): Promise<PayablesSummaryResult> {
  const results = await getEntityResultsCached(
    { entityType: scope.entityType, invertSigns: scope.invertSigns },
    {
      asOfDate,
      txnTypes: scope.txnTypes,
      carrierPayables: scope.carrierPayables,
      entityTypes: scope.entityTypes,
    },
  );

  let totalOutstanding = 0;
  let overdueSuppliers = 0;

  const items: PayableSummary[] = [];

  if (scope.kind === 'carrier') {
    // Carrier branch: resolve names/phone from `customers` (NOT suppliers).
    //
    // Carrier costs and their outbound payments share a payable-only projection
    // of the CUSTOMER ledger. This avoids mixing the carrier's AP activity with
    // any receivable entries the same catalog entity may also have.
    const carrierIds = results.map(r => r.entityId);
    const carriers = carrierIds.length > 0
      ? await db.select({
          id: s.customers.id,
          name: s.customers.name,
          phone: s.customers.phone,
          contactInfo: s.customers.contactInfo,
        }).from(s.customers).where(inArray(s.customers.id, carrierIds))
      : [];
    const carrierById = new Map(carriers.map(c => [c.id, c]));

    for (const r of results) {
      const carrier = carrierById.get(r.entityId);
      if (!carrier) continue;
      totalOutstanding += r.totalOutstanding;
      if (r.maxOverdueDays > 30) overdueSuppliers++;
      // Build a Supplier-shaped object so the frontend can render uniformly.
      // Fields not present on customers are nulled to satisfy the type.
      const supplierLike = {
        id: carrier.id,
        name: carrier.name,
        contactPerson: null,
        phone: carrier.phone ?? null,
        taxCode: null,
        note: carrier.contactInfo ?? null,
        status: 'ACTIVE',
        linkedCustomerId: null,
        isFuelSupplier: false,
        createdAt: '',
        updatedAt: '',
        deletedAt: null,
      } as unknown as Supplier;
      items.push({
        supplier: supplierLike,
        totalOutstanding: r.totalOutstanding,
        aging: r.aging,
        maxOverdueDays: r.maxOverdueDays,
        kind: 'carrier',
      });
    }
  } else {
    const vendorIds = results.map(r => r.entityId);
    const suppliers = vendorIds.length > 0
      ? await db.select().from(s.suppliers)
          .where(sql`${s.suppliers.id} IN (${sql.join(vendorIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const supplierById = new Map(suppliers.map(sup => [sup.id, sup]));

    for (const r of results) {
      const supplier = supplierById.get(r.entityId);
      if (!supplier) continue;
      totalOutstanding += r.totalOutstanding;
      if (r.maxOverdueDays > 30) overdueSuppliers++;
      items.push({
        supplier: supplier as unknown as Supplier,
        totalOutstanding: r.totalOutstanding,
        aging: r.aging,
        maxOverdueDays: r.maxOverdueDays,
        kind: 'vendor',
      });
    }
  }

  return { items, totalOutstanding, totalSuppliers: items.length, overdueSuppliers };
}

export function mergePayablesSummaries(
  summaries: readonly PayablesSummaryResult[],
): PayablesSummaryResult {
  const items = summaries.flatMap(summary => summary.items)
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return {
    items,
    totalOutstanding: summaries.reduce((sum, summary) => sum + summary.totalOutstanding, 0),
    totalSuppliers: items.length,
    overdueSuppliers: summaries.reduce((sum, summary) => sum + summary.overdueSuppliers, 0),
  };
}

// ─── Payables list pagination (route-level envelope) ─────────────────────────
//
// getPayablesSummary keeps its full-array contract for its in-process
// consumers; the HTTP route wraps the result with this helper so the
// /payables list page gets server-side search + pagination + full-set
// aggregates in one response.

export interface PayablesListTotals {
  current: number;
  d30: number;
  d60: number;
  over90: number;
  currentCount: number;
  d30Count: number;
  d60Count: number;
  over90Count: number;
}

export interface PaginatedPayablesSummary extends PayablesSummaryResult {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totals: PayablesListTotals;
}

export function summarizePayablesTotals(items: PayableSummary[]): PayablesListTotals {
  const totals: PayablesListTotals = {
    current: 0, d30: 0, d60: 0, over90: 0,
    currentCount: 0, d30Count: 0, d60Count: 0, over90Count: 0,
  };
  for (const d of items) {
    if (d.totalOutstanding <= 0) continue;
    if (d.aging.current > 0) { totals.current += d.aging.current; totals.currentCount++; }
    if (d.aging.d30 > 0) { totals.d30 += d.aging.d30; totals.d30Count++; }
    if (d.aging.d60 > 0) { totals.d60 += d.aging.d60; totals.d60Count++; }
    if (d.aging.over90 > 0) { totals.over90 += d.aging.over90; totals.over90Count++; }
  }
  return totals;
}

export function paginatePayablesSummary(
  result: PayablesSummaryResult,
  opts: { search?: string; page?: number; limit?: number; sortBy?: PayablesSummarySortKey; sortDir?: AgingSortDir } = {},
): PaginatedPayablesSummary {
  const q = opts.search?.trim().toLowerCase();
  const filtered = q
    ? result.items.filter(d =>
        d.supplier.name.toLowerCase().includes(q)
        || (d.supplier.phone && d.supplier.phone.toLowerCase().includes(q)))
    : result.items;
  // Without sort params the items keep the merge order (outstanding desc) —
  // the pre-sort-param default. With them, sorting applies to the searched
  // set before pagination so every page window is consistent.
  sortPayablesRows(filtered, opts.sortBy, opts.sortDir);
  const totals = summarizePayablesTotals(filtered);
  const page = paginateAgingRows(filtered, opts);
  return {
    // Full-set headline numbers stay whole (not page-scoped) for the KPI strip.
    totalOutstanding: result.totalOutstanding,
    totalSuppliers: result.totalSuppliers,
    overdueSuppliers: result.overdueSuppliers,
    totals,
    items: page.rows,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.totalPages,
  };
}

export async function getPayablesSummary(opts: { asOfDate?: string; category?: PayablesCategory } = {}) {
  const vendorScope: PayablesScope = {
    entityType: 'VENDOR',
    invertSigns: true,
    kind: 'vendor',
  };
  const carrierScope: PayablesScope = {
    // External carriers are customers in the catalog, but their locked-trip
    // cost is a payable credit and must be present in the all-category view.
    entityType: 'CARRIER',
    entityTypes: ['CUSTOMER', 'CARRIER'],
    carrierPayables: true,
    invertSigns: true,
    kind: 'carrier',
  };

  if (!opts.category) {
    const summaries = await Promise.all([
      getPayablesForScope(vendorScope, opts.asOfDate),
      getPayablesForScope(carrierScope, opts.asOfDate),
    ]);
    const payload = mergePayablesSummaries(summaries);
    return {
      ...payload,
      ...historicalReportMetadata(opts.asOfDate, 'payables-summary-v2', payload),
    };
  }

  const scope: PayablesScope = (() => {
    switch (opts.category) {
      case 'fuel':
        return { ...vendorScope, txnTypes: [TxnType.FUEL_EXPENSE] };
      case 'ancillary':
        return { ...vendorScope, txnTypes: [TxnType.VENDOR_EXPENSE] };
      case 'commission':
        return { ...vendorScope, txnTypes: [TxnType.COMMISSION] };
      case 'carrier':
        return carrierScope;
    }
  })();

  const payload = await getPayablesForScope(scope, opts.asOfDate);
  return {
    ...payload,
    ...historicalReportMetadata(opts.asOfDate, `payables-${opts.category}-v2`, payload),
  };
}
