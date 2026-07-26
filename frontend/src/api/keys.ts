/**
 * Centralized TanStack Query key factory.
 *
 * Why this exists:
 *   1. The codebase had 170+ raw `queryKey: ['foo', ...]` strings scattered
 *      across 40 files. Adding a filter required grepping for the key.
 *   2. `useCRUD` invalidated `['catalogs']` but mutations elsewhere
 *      invalidated `['trucks-drivers']` — the two caches drifted and pages
 *      saw stale data.
 *   3. Two deprecated/duplicate keys (`['fleet']` and `['trucks-drivers']`)
 *      for the same data caused double-fetches.
 *
 * Convention:
 *   - Each domain gets an object with `all` (used for broad invalidation),
 *     `lists()` (paginated/filtered), and `detail(id)` accessors.
 *   - Hierarchical keys so `invalidateQueries({ queryKey: qk.trips.all })`
 *     matches every trips-prefixed query.
 *   - Frozen `as const` tuples so the keys are type-narrowed and
 *     serializable for DevTools.
 *
 * The `as` casts are deliberate: the factory returns a tuple of
 * `string | number | boolean | undefined` which TanStack's `queryKey` type
 * happily widens.
 */

export const qk = {
  auth: {
    me: ['auth', 'me'],
  },

  /* ── Agent (command-and-insight assistant) ─────────────────────────── */
  // Chat is streamed (not cached); only conversation history is cached.
  agent: {
    conversations: ['agent', 'conversations'] as const,
    conversation: (id: string) => ['agent', 'conversation', id] as const,
  },

  /* ── FAQ entries (admin-managed knowledge base) ────────────────────── */
  faq: {
    all: ['faq-entries'] as const,
    /** Filtered list — search term + inactive visibility are part of the key. */
    list: (search?: string, includeInactive?: boolean) =>
      ['faq-entries', { search, includeInactive }] as const,
  },

  /* ── Catalog (the big bootstrap + individual lookup tables) ─────────── */

  catalogs: {
    /** The single bootstrap blob — used by trip form, dispatch, etc. */
    all: ['catalogs'],
    trucksDrivers: ['trucks-drivers'],
    /** Single truck row — GET /trucks/:id (config-page header, etc.). */
    truckDetail: (id: number | string | undefined) => ['truck', id] as const,
    routesDropdown: ['routes-dropdown'],
    roadAllowances: ['road-allowances'],
    roadConfig: ['road-config'],
    companyInfo: ['company-info'],
    fuelConfig: ['fuel-config'],
    salaryPeriod: (month: number, year: number) =>
      ['salary-period', month, year] as const,
    suppliers: (page?: number, search?: string) =>
      ['suppliers', page, search] as const,
    expenseCategories: (page?: number, search?: string) =>
      ['expense-categories', page, search] as const,
    customers: (page: number, search: string) =>
      ['customers', page, search] as const,
    allCustomers: ['all-customers'],
    users: ['users'],
    ports: ['ports'],
    portsCatalog: ['ports-catalog'],
    tirePositions: ['tire-positions'],
    containerTypes: ['container-types'],
    sealTypes: ['seal-types'],
    trailers: ['trailers'],
    debitNoteTemplates: ['debit-note-templates'],
    debitNoteTemplate: (id: number | string | null | undefined) =>
      ['debit-note-template', id] as const,
    /** Templates filtered by document type (DEBIT_NOTE | PAYMENT_STATEMENT). */
    debitNoteTemplatesByType: (type: string) =>
      ['debit-note-templates', type] as const,
    pricingTables: ['pricing-tables'],
    allSuppliers: ['all-suppliers'],
    allExpenseCategories: ['all-expense-categories'],
    capTable: ['cap-table'],
    tires: (truckId?: number) => ['tires', truckId] as const,
    /** Broad prefix — matches every tires query regardless of truckId. */
    tiresAll: ['tires'] as const,
  },

  /** All catalog-shaped keys, for one-shot invalidation after a config CRUD. */
  allCatalogKeys: [
    'catalogs',
    'trucks-drivers',
    'routes-dropdown',
    'road-allowances',
    'road-config',
    'company-info',
    'fuel-config',
    'cap-table',
    'suppliers',
    'expense-categories',
    'customers',
    'all-customers',
    'users',
    'ports',
    'ports-catalog',
    'tire-positions',
    'container-types',
    'seal-types',
    'trailers',
    'debit-note-templates',
    'debit-note-template',
    'pricing-tables',
    'all-suppliers',
    'all-expense-categories',
    'salary-period',
    'tires',
  ] as const,

  /* ── Trips ──────────────────────────────────────────────────────────── */

  trips: {
    all: ['trips'],
    // Normalize id to a string: callers pass either the string id from the URL
    // (useTripDetail) or the numeric id from the API response (e.g. save-flow
    // setQueryData/invalidate + the 409 retry). TanStack matches keys by
    // deep-equal, so ['trip', 68] !== ['trip', '68'] — leaving id un-coerced
    // made every post-save cache write/refetch hit a phantom key, keeping the
    // detail cache on a stale `version` and defeating the save retry-on-409.
    detail: (id: number | string | undefined) => ['trip', String(id)] as const,
    adjustments: (id: number) => ['trip-adjustments', id] as const,
    /** Broad prefix — matches all trip-adjustments queries. */
    adjustmentsAll: ['trip-adjustments'] as const,
    summary: (dateFrom: string | undefined, dateTo: string | undefined) =>
      ['trips-summary', dateFrom, dateTo] as const,
    /** List view — invalidates any paged/filtered list. */
    list: (...args: unknown[]) => ['trips', ...args] as const,
    monthly: (year: number, month: number, salaryStart: string | undefined) =>
      ['trips', 'monthly', year, month, salaryStart] as const,
    created: ['trips', 'created'],
    costs: (month: number, year: number, salaryStart: string | undefined) =>
      ['trip-costs', month, year, salaryStart] as const,
    dispatch: ['dispatch'],
    badgeCounts: ['badge-counts'],
    suggestedPrice: (customerId: number, routeId: number, date?: string) =>
      ['suggested-price', customerId, routeId, date] as const,
    tripDetail: (id: number) => ['trip-detail', String(id)] as const,
  },

  /* ── Live fleet (GPS tracking) ──────────────────────────────────────── */

  liveFleet: {
    all: ['live-fleet'],
  },

  /* ── Driver portal ──────────────────────────────────────────────────── */

  driver: {
    trips: ['driver-trips'],
    earnings: (month: number, year: number) =>
      ['driver-earnings', month, year] as const,
    penalties: (params: { dateFrom: string; dateTo: string } | undefined) =>
      ['driver-penalties', params] as const,
    /** N5 / B4: the driver's truck compliance/service reminders. */
    vehicleAlerts: ['driver-vehicle-alerts'],
    /** M8.3: two-orders-per-day view (active + next today, firstOrderLate). */
    twoOrders: ['driver-two-orders'],
    /** M8.6: driver payslip periods (issued salary periods with earnings). */
    payslips: ['driver-payslips'],
  },

  /* ── Forwarder portal ──────────────────────────────────────────────── */

  forwarder: {
    trips: (
      status?: string,
      filters?: { search?: string; dateFrom?: string; dateTo?: string },
    ) => ['forwarder-trips', status, filters] as const,
    tripDetail: (id: number) => ['forwarder-trip-detail', id] as const,
    /** Broad prefix — matches all forwarder-trip-detail queries. */
    tripDetailAll: ['forwarder-trip-detail'] as const,
    suppliers: ['forwarder-suppliers'],
    advanceRequests: (status?: string) =>
      ['forwarder-advance-requests', status] as const,
    eligibleAdvanceRequests: ['forwarder-advance-requests', 'eligible-for-settlement'] as const,
    /** Broad prefix — matches all forwarder-advance-requests queries. */
    forwarderAdvanceRequestsAll: ['forwarder-advance-requests'] as const,
    settlements: ['forwarder-settlements'] as const,
    settlementDetail: (id: number) =>
      ['forwarder-settlement-detail', id] as const,
    unlinkedExpenses: ['forwarder-unlinked-expenses'],
    advanceBalance: ['forwarder-advance-balance'] as const,
  },

  /* ── Admin forwarder views ─────────────────────────────────────────── */

  adminForwarder: {
    advanceRequests: (filters?: { status?: string }) =>
      ['admin-advance-requests', filters] as const,
    /** Broad prefix — matches all admin-advance-requests queries. */
    advanceRequestsAll: ['admin-advance-requests'] as const,
    settlements: (filters?: { status?: string }) =>
      ['admin-settlements', filters] as const,
    /** Broad prefix — matches all admin-settlements queries. */
    settlementsAll: ['admin-settlements'] as const,
    settlementDetail: (id: number) =>
      ['admin-settlement-detail', id] as const,
    settlementOpsCompletion: (settlementIds: number[]) =>
      ['admin-settlement-ops-completion', settlementIds] as const,
    settlementOpsCompletionAll: ['admin-settlement-ops-completion'] as const,
    advanceBalances: ['admin-advance-balances'] as const,
  },

  /* ── Dashboard / reports ────────────────────────────────────────────── */

  dashboard: {
    main: ['dashboard'],
    pnl: (month: number, year: number) => ['pnl', month, year] as const,
    yearlyPnl: (year: number) => ['yearly-pnl', year] as const,
    renewalReminders: ['renewal-reminders'],
    distributionHistory: ['distribution-history'],
    receivablesSummary: ['receivables-summary'],
    auditRecent: ['dashboard-audit-recent'],
    approvalQueue: (role: string | undefined, userId: number | undefined) =>
      ['approval-queue', role, userId] as const,
  },

  /* ── Financial ──────────────────────────────────────────────────────── */

  financial: {
    customerAging: (search: string | undefined) =>
      ['customer-aging', search ?? ''] as const,
    /** Broad prefix — matches all customerAging queries regardless of args. */
    customerAgingAll: ['customer-aging'] as const,
    /**
     * Customer statement — keyed by entity id + period range so the AR detail
     * page's month/range filter triggers a fresh fetch. `range` defaults to
     * `{ dateFrom: undefined, dateTo: undefined }`; existing invalidations
     * passing that sentinel shape (or no range at all) still match.
     */
    customerStatement: (
      id: string | number | undefined,
      range: { dateFrom?: string; dateTo?: string } = {},
    ) =>
      // Normalize empty strings to null so range mode with one cleared input
      // doesn't fragment the cache ('' !== null !== undefined for deep-equal).
      ['customer-statement', id, range.dateFrom || null, range.dateTo || null] as const,
    /** Broad prefix — matches every customer-statement query regardless of range. */
    customerStatementAll: ['customer-statement'] as const,
    customerLedgerEntries: ['customer-ledger-entries'],
    payablesSummary: (category: string | undefined) => ['payables-summary', category ?? 'all'] as const,
    /** Broad prefix — matches all payablesSummary queries regardless of category. */
    payablesSummaryAll: ['payables-summary'] as const,
    /** See `customerStatement` — AP mirror, keyed by supplier id + range. */
    supplierStatement: (
      supplierId: number | undefined,
      range: { dateFrom?: string; dateTo?: string } = {},
    ) =>
      ['supplier-statement', supplierId, range.dateFrom || null, range.dateTo || null] as const,
    carrierPayableStatement: (
      carrierId: number | undefined,
      range: { dateFrom?: string; dateTo?: string } = {},
    ) =>
      ['carrier-payable-statement', carrierId, range.dateFrom || null, range.dateTo || null] as const,
    /** Broad prefix — matches every supplier-statement query regardless of range. */
    supplierStatementAll: ['supplier-statement'] as const,
    expenses: (filters: unknown) => ['expenses', filters] as const,
    debtOffsets: (customerId: number | string) =>
      ['debt-offsets', customerId] as const,
    /** Broad prefix — matches all debtOffsets queries regardless of args. */
    debtOffsetsAll: ['debt-offsets'] as const,
    debt: ['debt'],
  },

  /* ── Penalties ──────────────────────────────────────────────────────── */

  penalties: {
    list: ['penalties'],
    catalogs: ['penalty-catalogs'],
    stats: ['/penalty-reasons/stats'],
  },

  /* ── Salary ─────────────────────────────────────────────────────────── */

  salary: {
    list: (year: number, month: number) =>
      ['salary-list', year, month] as const,
    /** Broad prefix — matches all salary-list queries. */
    listAll: ['salary-list'] as const,
    driverSalary: (driverId: number | null, year: number, month: number) =>
      ['driver-salary', driverId, year, month] as const,
    /** Broad prefix — matches all driver-salary queries. */
    driverSalaryAll: ['driver-salary'] as const,
    driverWorkdays: (driverId: number | null, year: number, month: number) =>
      ['driver-workdays', driverId, year, month] as const,
    /** Broad prefix — matches all driver-workdays queries. */
    driverWorkdaysAll: ['driver-workdays'] as const,
    periodDefault: ['salary-period-default'],
    periodResolve: (year: number, month: number) =>
      ['salary-period-resolve', year, month] as const,
    /** Broad prefix — matches all salary-period-resolve queries. */
    periodResolveAll: ['salary-period-resolve'] as const,
  },

  /* ── Notifications ──────────────────────────────────────────────────── */

  notifications: {
    unreadCount: ['notifications', 'unread-count'],
    list: (page = 1, limit = 20) =>
      ['notifications', 'list', page, limit] as const,
    infiniteList: (limit = 20) =>
      ['notifications', 'infinite-list', limit] as const,
    all: ['notifications'],
  },

  /* ── Audit logs ─────────────────────────────────────────────────────── */

  auditLogs: {
    list: (pageSize: number, filter: unknown, search: string) =>
      ['audit-logs', pageSize, filter, search] as const,
  },

  /* ── Chatbot (agent) performance monitoring ─────────────────────────── */

  chatbotMetrics: {
    /** Broad prefix — matches every chatbot-metrics query. */
    all: ['chatbotMetrics'] as const,
    summary: (range: string) => ['chatbotMetrics', 'summary', range] as const,
    latency: (range: string) => ['chatbotMetrics', 'latency', range] as const,
    tools: (range: string) => ['chatbotMetrics', 'tools', range] as const,
    timeseries: (range: string) => ['chatbotMetrics', 'timeseries', range] as const,
    recent: (range: string, sort: string, limit: number) =>
      ['chatbotMetrics', 'recent', range, sort, limit] as const,
  },

  /* ── Admin LLM provider settings (MiniMax / OpenRouter) ─────────────── */

  llmSettings: {
    /** Singleton — the single GET is the only read. */
    all: ['llmSettings'] as const,
    detail: ['llmSettings', 'detail'] as const,
  },

  gpsSettings: {
    detail: ['gps-settings'] as const,
  },

  /* ── Trip-form catalogs (loaded on demand by the create/edit form) ── */

  tripForm: {
    expenseFormCatalogs: ['expense-form-catalogs'],
    expense: (id: number | string) => ['expense', id] as const,
    tripContainers: (tripId: number) => ['trip-containers', tripId] as const,
    tripExpenses: (tripId: number) => ['trip-expenses', tripId] as const,
    /** Broad prefix — matches all trip-expenses queries regardless of args. */
    tripExpensesAll: ['trip-expenses'] as const,
    customersConfig: (search: string) =>
      ['customers-config', search] as const,
    trucksForDrivers: ['trucks-for-drivers-config'],
    routesConfig: (search: string) => ['routes-config', search] as const,
    dualEntities: ['dual-entities'],
  },

  /* ── Generic config-page counts (used by ConfigPage sidebar badges) ─ */

  configCounts: {
    base: 'cfg-count',
    penaltyReasons: ['cfg-count', 'penalty-reasons'],
    roadAllowances: ['cfg-count', 'road-allowances'],
    drivers: ['cfg-count', 'drivers'],
    capTable: ['cfg-count', 'cap-table'],
    customers: ['cfg-count', 'customers'],
    routes: ['cfg-count', 'routes'],
    trucks: ['cfg-count', 'trucks'],
    tirePositions: ['cfg-count', 'tire-positions'],
    trailers: ['cfg-count', 'trailers'],
    cargoTypes: ['cfg-count', 'cargo-types'],
    pricingTables: ['cfg-count', 'pricing-tables'],
    managementFees: ['cfg-count', 'management-fees'],
    salaryDefault: ['cfg-count', 'salary-default'],
    expenseCategories: ['cfg-count', 'expense-categories'],
    fuelConfig: ['cfg-count', 'fuel-config'],
    companyInfo: ['cfg-count', 'company-info'],
    containerTypes: ['cfg-count', 'container-types'],
    sealTypes: ['cfg-count', 'seal-types'],
    ports: ['cfg-count', 'ports'],
    forwarderExpenseTypes: ['cfg-count', 'forwarder-expense-types'],
    debitNoteTemplates: ['cfg-count', 'debit-note-templates'],
  },

  /* ── Generic CRUD page (CrudTable uses [endpoint] as key) ──────────── */

  crud: {
    entity: (endpoint: string) => [endpoint] as const,
  },

  /* ── Onboarding (Phase 4): tour progress + checklist tasks ─────────── */

  onboarding: {
    progressAll: ['onboarding', 'progress'] as const,
    tasksAll: ['onboarding', 'tasks'] as const,
  },

} as const;

// ── Compile-time guard: allCatalogKeys must cover every qk.catalogs prefix ────
// If this errors, a catalog key was added to qk.catalogs but not allCatalogKeys.
type _CatVal = typeof qk.catalogs;
type _ExtractPrefix<T> = T extends readonly [infer F, ...unknown[]] ? F
  : T extends (...a: unknown[]) => readonly [infer F, ...unknown[]] ? F
  : never;
type _CatalogPrefixes = _ExtractPrefix<_CatVal[keyof _CatVal]>;
// Compile-time guard: allCatalogKeys must cover every qk.catalogs prefix.
// The runtime `void` is required so TypeScript actually evaluates the
// conditional type instead of erasing it as unused.
type _AssertCatalogs = _CatalogPrefixes extends typeof qk.allCatalogKeys[number] ? true : never;
const _catalogTypeGuard: _AssertCatalogs = true;
void _catalogTypeGuard;

/**
 * Invalidate every cache key that depends on catalog data. Used by the
 * generic `useCRUD` / CrudTable after create/update/delete so dependent
 * pages (dispatch, trip form, search dropdowns) all refresh in one shot.
 */
export function invalidateAllCatalogs(qc: {
  invalidateQueries: (opts: { queryKey: readonly unknown[] }) => Promise<void>;
}): Promise<void[]> {
  return Promise.all(
    qk.allCatalogKeys.map((key) =>
      // eslint-disable-next-line @tingting/no-bare-query-key -- key is a canonical catalog prefix from allCatalogKeys, not an arbitrary string
      qc.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
