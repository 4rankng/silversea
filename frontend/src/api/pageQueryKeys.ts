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
  /** Quotation config: the kế-toán fuel-approval alert + its batch drawer. */
  quotationFuelApprovals: {
    all: ['quotation-fuel-approvals'] as const,
    pending: ['quotation-fuel-approvals', 'PENDING'] as const,
  },
};
