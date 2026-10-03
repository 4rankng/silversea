/**
 * Query domains for the pages whose inline `queryKey: [...]` arrays were
 * centralized by the 2026-09-27 @tingting/no-bare-query-key sweep.
 *
 * Lives outside keys.ts (which sits under a frozen LOC ratchet) and is
 * composed into `qk` exactly like the `expenseQueryKeys` and
 * `shipmentDebitQueryKeys` groups, so callers still write `qk.<domain>.<key>`.
 */
export const pageQueryKeys = {
  /** Xe ngoài page (dispatch/catalogs/ExternalFleetView) — the union list and
   *  its EXTERNAL_CARRIER picker. */
  externalFleet: {
    union: ['external-fleet-union'] as const,
    carrierOptions: ['external-carrier-options'] as const,
  },
  /** Driver portal: the phi-norms option source of the incidental-cost form. */
  driverFeeNorms: ['driver', 'fee-norms'] as const,
  /** Ops portal: read-only drawer for a trip expense entered by accounting. */
  opsLegacyExpense: (sourceId: number | undefined) => ['ops-legacy-expense', sourceId] as const,
  /** Supplier directory: status pill counts over the whole dataset. */
  suppliersStatusCounts: ['suppliers', 'status-counts'] as const,
  /**
   * The nhà xe population — carriers only, read from `GET /customers` with
   * `?isCarrier=true`. Carriers ARE customers rows, so this RIDES the
   * `all-customers` prefix rather than declaring a sibling: catalog mutations
   * then bust the customer list and the carrier list in one invalidateQueries
   * pass, and no new entry is owed to `allCatalogKeys`.
   */
  allCarriers: ['all-customers', 'carriers'] as const,
  /** Quotation config: the kế-toán fuel-approval alert + its batch drawer. */
  quotationFuelApprovals: {
    all: ['quotation-fuel-approvals'] as const,
    pending: ['quotation-fuel-approvals', 'PENDING'] as const,
  },
  /** Customers screen: the server-side freight projection behind the "Bỏ xe
   *  công ty" tick (card 20260928_177). The tick is a REQUEST parameter, so it
   *  is part of the key — a different tick is a different, server-recomputed
   *  figure, and sharing one cache entry between ON and OFF would show stale
   *  numbers. */
  customerDebtSummary: (customerIds: string, excludeOwnFleet: boolean) =>
    ['customer-debt-summary', customerIds, excludeOwnFleet] as const,
};
