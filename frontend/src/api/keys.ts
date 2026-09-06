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

  /* ── Catalog (the big bootstrap + individual lookup tables) ─────────── */

  catalogs: {
    /** The single bootstrap blob — used by trip form, dispatch, etc. */
    all: ['catalogs'],
    trucksDrivers: ['trucks-drivers'],
    /** Single truck row — GET /trucks/:id (config-page header, etc.). */
    truckDetail: (id: number | string | undefined) => ['truck', id] as const,
    routesDropdown: ['routes-dropdown'],
    /** Admin operational-sites directory (/config/factories). */
    adminOperationalSites: ['admin-operational-sites'] as const,
    /** Canonical-route options for the admin operational-site editor. */
    adminSiteRoutes: ['admin-site-routes'] as const,
    roadAllowances: ['road-allowances'],
    roadConfig: ['road-config'],
    companyInfo: ['company-info'],
    fuelConfig: ['fuel-config'],
    salaryPeriod: (month: number, year: number) =>
      ['salary-period', month, year] as const,
    suppliers: (page?: number, search?: string, sortBy?: string, sortDir?: string) =>
      ['suppliers', page, search, sortBy ?? '', sortDir ?? ''] as const,
    /** Base key for useTableQueryState-driven supplier list pages. */
    suppliersTable: ['suppliers'],
    expenseCategories: (page?: number, search?: string) =>
      ['expense-categories', page, search] as const,
    customers: (page: number, search: string) =>
      ['customers', page, search] as const,
    /** Base key for useTableQueryState-driven customer list pages. */
    customersTable: ['customers'],
    allCustomers: ['all-customers'],
    users: ['users'],
    /** Admin-only drawer option list: shipments eligible for clerk-scope assignment. */
    userScopeShipments: ['users', 'user-scope-shipments'] as const,
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
    'admin-operational-sites',
    'admin-site-routes',
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

  /* ── CUS shipments workboard (/shipments) ─────────────────────────── */
  shipmentsCus: {
    /** Broad prefix — invalidates every workboard list query. */
    all: ['shipments-cus'],
    /** One workboard page per filter/sort combination. */
    list: (filters: {
      page: number;
      searchSuffix?: string;
      transportDateFrom?: string;
      transportDateTo?: string;
      direction?: string;
      bucket?: string;
      sortBy?: string;
      sortDir?: string;
    }) => ['shipments-cus', 'list', filters] as const,
  },

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

  /* ── Driver portal ──────────────────────────────────────────────────── */

  driver: {
    trips: ['driver-trips'],
    tripDetail: (tripId: number | string | undefined) => ['driver-trip-detail', String(tripId ?? '')] as const,
    tripProgress: (tripId: number | string | undefined) => ['driver-trip-progress', String(tripId ?? '')] as const,
    evidenceStatus: (tripId: number | string | undefined) => ['driver-trip-evidence', String(tripId ?? '')] as const,
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
    /** Driver-app "Hành trình" screen: New/Running/History journey board. */
    journeyBoard: ['driver-journey-board'],
    /** Topbar identity chip: the driver's current vehicle plate. */
    vehicle: ['driver-vehicle'],
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
    /** Broad prefix — matches all forwarder-trips queries. */
    tripsAll: ['forwarder-trips'] as const,
    suppliers: ['forwarder-suppliers'],
    liftPrice: (params: {
      portId: string;
      containerTypeId: string;
      direction: 'LIFT_UP' | 'LIFT_DOWN';
      loadState: 'LOADED' | 'EMPTY';
      expenseDate: string;
    }) => ['forwarder', 'lift-price', params] as const,
    advanceRequests: (status?: string) =>
      ['forwarder-advance-requests', status] as const,
    eligibleAdvanceRequests: ['forwarder-advance-requests', 'eligible-for-settlement'] as const,
    /** Broad prefix — matches all forwarder-advance-requests queries. */
    forwarderAdvanceRequestsAll: ['forwarder-advance-requests'] as const,
    /** Paginated advance-requests table — applied params ride the key via useTableQueryState. */
    advanceRequestsTable: () => [...qk.forwarder.forwarderAdvanceRequestsAll, 'table'] as const,
    settlements: ['forwarder-settlements'] as const,
    /** Paginated settlements list — page/status ride the key. */
    settlementsList: (params?: { status?: string; page?: number; limit?: number }) =>
      [...qk.forwarder.settlements, params?.status ?? 'all', params?.page ?? 1, params?.limit ?? 'default'] as const,
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
    widgets: (month: number, year: number) => ['dashboard-widgets', month, year] as const,
    yearlyPnl: (year: number) => ['yearly-pnl', year] as const,
    profitability: (params: {
      month: number;
      year: number;
      dimension: string;
      page: number;
      lowMarginOnly: boolean;
    }) => ['profitability-report', params] as const,
    renewalReminders: ['renewal-reminders'],
    distributionHistory: ['distribution-history'],
    receivablesSummary: ['receivables-summary'],
    auditRecent: ['dashboard-audit-recent'],
    decisionInbox: (page: number, sortBy?: string, sortDir?: string) =>
      ['dashboard', 'decision-inbox', page, sortBy ?? '', sortDir ?? ''] as const,
    /** Broad prefix — matches every decision-inbox query regardless of page/sort. */
    decisionInboxAll: ['dashboard', 'decision-inbox'] as const,
    approvalQueue: (role: string | undefined, userId: number | undefined) =>
      ['approval-queue', role, userId] as const,
  },

  /* ── Financial ──────────────────────────────────────────────────────── */

  financial: {
    customerAging: (params?: { search?: string; page?: number; limit?: number; bucket?: string }) =>
      ['customer-aging', params?.search ?? '', params?.page ?? 1, params?.limit ?? 25, params?.bucket ?? 'all'] as const,
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
    payablesSummary: (params?: { category?: string; search?: string; page?: number; limit?: number }) =>
      ['payables-summary', params?.category ?? 'all', params?.search ?? '', params?.page ?? 1, params?.limit ?? 25] as const,
    /** Broad prefix — matches all payablesSummary queries regardless of args. */
    payablesSummaryAll: ['payables-summary'] as const,
    /** Trip picker for the commission form — rides the trips prefix so trip
     *  invalidations refresh it, but is scoped per search. */
    commissionTripSelector: (search: string) =>
      [...qk.trips.all, 'commission-selector', search] as const,
    fuelInvoices: (filters: { supplierId?: number; status?: string } = {}) =>
      ['fuel-invoices', filters.supplierId ?? 'all', filters.status ?? 'all'] as const,
    fuelInvoicesAll: ['fuel-invoices'] as const,
    fuelInvoice: (id: number | null | undefined) => ['fuel-invoice', id ?? 'none'] as const,
    fuelInvoiceTripOptions: ['fuel-invoice-trip-options'] as const,
    /** Billing documents panel — per document type + owning entity. */
    billingDocuments: (type: string, entityType: string, entityId: number | null | undefined) =>
      ['billing-docs', type, entityType, entityId ?? 'none'] as const,
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
    /** Broad prefix — matches every expenses query regardless of filters. */
    expensesAll: ['expenses'] as const,
    debtOffsets: (customerId: number | string) =>
      ['debt-offsets', customerId] as const,
    /** Broad prefix — matches all debtOffsets queries regardless of args. */
    debtOffsetsAll: ['debt-offsets'] as const,
    debt: ['debt'],
  },

  accounting: {
    workInbox: (view: 'ACTION' | 'WAITING', page: number, sortBy?: string, sortDir?: string) =>
      ['accounting', 'work-inbox', view, page, sortBy ?? '', sortDir ?? ''] as const,
    receivables: (asOf: string) => ['accounting', 'receivables', asOf] as const,
    payables: (asOf: string) => ['accounting', 'payables', asOf] as const,
    profitability: (month: number, year: number) => ['accounting', 'profitability', month, year] as const,
    transportRegister: (params: {
      from: string;
      to: string;
      page: number;
      search: string;
      customerId: number | null;
      carrierId: number | null;
      ownership: string;
      readiness: string;
      sortBy: string;
      sortDir: string;
    }) =>
      ['accounting', 'transport-register', params] as const,
  },

  /* ── Penalties ──────────────────────────────────────────────────────── */

  penalties: {
    list: ['penalties'],
    catalogs: ['penalty-catalogs'],
    stats: ['/penalty-reasons/stats'],
    /** Base for the insights read (KPI strip / scoreboard) — mutation
     *  invalidation hits this prefix so every period refetches. */
    insightsBase: ['penalties', 'insights'] as const,
    insights: (month: number, year: number) =>
      ['penalties', 'insights', month, year] as const,
    /** Trip picker for the penalty form — rides the trips prefix so trip
     *  invalidations refresh it, but is scoped per driver + search. */
    tripSelector: (driverId: string | null, search: string) =>
      [...qk.trips.all, 'penalty-selector', driverId, search] as const,
  },

  /* ── Governance actions (approval inbox) ───────────────────────────── */

  governance: {
    actions: ['governance-actions'],
  },

  /* ── Fuel-evidence review queue ────────────────────────────────────── */

  fuelEvidence: {
    reviews: (status: string, page: number) =>
      ['fuel-evidence-reviews', status, page] as const,
    /** Broad prefix — matches all fuel-evidence-reviews queries. */
    reviewsAll: ['fuel-evidence-reviews'] as const,
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
    list: (pageSize: number, filter: unknown, search: string, sortBy?: string, sortDir?: string) =>
      ['audit-logs', pageSize, filter, search, sortBy ?? '', sortDir ?? ''] as const,
  },

  /* ── Admin OCR settings (runtime toggle + provider keys) ────────────── */

  ocrSettings: {
    all: ['ocrSettings'] as const,
    detail: ['ocrSettings', 'detail'] as const,
  },

  appSettings: {
    general: ['app-settings'] as const,
    email: ['email-settings'] as const,
    businessUnits: ['app-settings', 'business-units'] as const,
    financialReportingPolicy: ['app-settings', 'financial-reporting-policy'] as const,
    truckFinancialProfiles: (truckId: number | null) =>
      ['app-settings', 'truck-financial-profiles', truckId ?? 'auto'] as const,
  },

  creditOverrides: {
    all: ['credit-overrides'] as const,
    detail: (id: number | null | undefined) =>
      ['credit-overrides', 'detail', id ?? null] as const,
    list: (filters?: { status?: string; customerId?: number; shipmentId?: number; cursor?: string; limit?: number }) =>
      [
        'credit-overrides',
        filters?.status ?? null,
        filters?.customerId ?? null,
        filters?.shipmentId ?? null,
        filters?.cursor ?? null,
        filters?.limit ?? 25,
      ] as const,
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
    adminHealth: ['cfg-count', 'admin-health'] as const,
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
    /** Paginated list slice of a crud entity — entity() stays the broad prefix. */
    entityList: (endpoint: string, listQuery: string) => [endpoint, listQuery] as const,
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
