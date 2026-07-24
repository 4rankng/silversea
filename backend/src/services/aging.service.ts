import { db } from '../db';
import * as s from '../db/schema';
import { cacheGet } from '../lib/redis';
import { eq, and, or, sql, inArray, like } from 'drizzle-orm';
import { computeFifoAging, TxnType } from '@tingting/shared';
import type { PayableSummary, PayablesCategory, Supplier } from '@tingting/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

type LedgerEntry = { debit: string | null; credit: string | null; timestamp: Date | null };

interface AgingConfig {
  entityType: 'CUSTOMER' | 'VENDOR' | 'CARRIER';
  /** Whether to invert debit/credit before FIFO computation (true for VENDOR) */
  invertSigns: boolean;
}

interface FetchOptions {
  /** Point-in-time snapshot: only include entries up to this date (inclusive) */
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
  if (opts.asOfDate) conditions.push(sql`${s.ledger.timestamp} <= ${opts.asOfDate}::timestamptz`);
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
): EntityAgingResult[] {
  const now = new Date();
  const results: EntityAgingResult[] = [];

  for (const [entityId, entries] of grouped) {
    const { aging, openInvoices } = computeAging(entries, now, config.invertSigns);
    const totalOutstanding = aging.current + aging.d30 + aging.d60 + aging.over90;

    let maxOverdueDays = 0;
    for (const inv of openInvoices) {
      if (inv.open <= 0) continue;
      const ageDays = Math.floor((now.getTime() - new Date(inv.ts).getTime()) / 86400000);
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
  const asOfKey = opts.asOfDate ?? new Date().toISOString().slice(0, 10);
  const txnKey = opts.carrierPayables
    ? 'carrier-payables'
    : opts.txnTypes && opts.txnTypes.length > 0
      ? opts.txnTypes.join(',')
      : 'all';
  const entityKey = opts.entityTypes?.join(',') ?? config.entityType;
  const projectionKey = opts.excludeCarrierPayables ? 'no-carrier-ap' : 'all-projections';
  return cacheGet<EntityAgingResult[]>(
    `reports:entity-results:${entityKey}:${config.invertSigns ? 'inv' : 'std'}:${asOfKey}:${txnKey}:${projectionKey}`,
    300,
    async () => {
      const grouped = await fetchLedgerGrouped(config, {
        asOfDate: opts.asOfDate,
        txnTypes: opts.txnTypes,
        carrierPayables: opts.carrierPayables,
        entityTypes: opts.entityTypes,
        excludeCarrierPayables: opts.excludeCarrierPayables,
      });
      return computeEntityResults(grouped, config);
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
  const results = await getEntityResultsCached(
    { entityType: 'CUSTOMER', invertSigns: false },
    { ...opts, excludeCarrierPayables: true },
  );

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

  return { buckets, totalOutstanding, totalCustomers, overdueCustomers: totalCustomers - buckets[0].count };
}

export async function getTopOverdueCustomer(): Promise<{ name: string; balance: number; days: number } | null> {
  const results = await getEntityResultsCached(
    { entityType: 'CUSTOMER', invertSigns: false },
    { excludeCarrierPayables: true },
  );
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

export async function getCustomerAgingList(opts: { search?: string; asOfDate?: string; page?: number; limit?: number } = {}): Promise<CustomerAgingListResult> {
  // Container-number / name search: if provided, narrow customer IDs to those
  // whose customer name OR linked trips' containers (trip_containers or
  // trip_expenses.container_number) match the query. Matches the test guide's
  // expectation that "/debt" supports lookup by container.
  const trimmedSearch = opts.search?.trim();
  const searchedCustomerIds = trimmedSearch ? await findCustomerIdsForAgingSearch(trimmedSearch) : undefined;
  // Full per-entityType result (cached); narrow by search in JS. The cache key
  // intentionally omits entityIds so a search reuses the browse result.
  const allResults = await getEntityResultsCached(
    { entityType: 'CUSTOMER', invertSigns: false },
    { asOfDate: opts.asOfDate, excludeCarrierPayables: true },
  );
  const results = searchedCustomerIds
    ? allResults.filter(r => searchedCustomerIds.has(r.entityId))
    : allResults;

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
    const apResults = computeEntityResults(apGrouped, { entityType: 'VENDOR', invertSigns: true });
    for (const r of apResults) {
      apByVendor.set(r.entityId, r.totalOutstanding);
    }
  }

  const mapped: CustomerAgingListItem[] = results.map(r => {
    const linkedSupplierId = linkedSupplierMap.get(r.entityId) ?? null;
    const linkedSupplierApBalance = linkedSupplierId != null ? (apByVendor.get(linkedSupplierId) ?? 0) : 0;
    return {
      customerId: r.entityId,
      customerName: nameMap.get(r.entityId) || `Khách hàng #${r.entityId}`,
      contactInfo: contactMap.get(r.entityId) || null,
      linkedSupplierId,
      linkedSupplierApBalance,
      netBalance: r.totalOutstanding - linkedSupplierApBalance,
      totalOutstanding: r.totalOutstanding,
      aging: r.aging,
      maxOverdueDays: r.maxOverdueDays,
    };
  });

  mapped.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  const page = paginateAgingRows(mapped, opts);
  return {
    customers: page.rows,
    page: page.page,
    limit: page.limit,
    total: page.total,
    totalPages: page.totalPages,
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
    return mergePayablesSummaries(summaries);
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

  return getPayablesForScope(scope, opts.asOfDate);
}
