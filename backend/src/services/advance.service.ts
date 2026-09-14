/**
 * Advances & settlements — facade.
 *
 * Compatibility re-export module: the implementation lives in
 * `advance-shared.service.ts` (cross-half helpers, O2C auto-offset,
 * outstanding balances), `advance-request.service.ts` (tạm ứng requests and
 * their governance), `advance-settlement.service.ts` (phiếu hoàn ứng create,
 * listings, check, approve), and `advance-settlement-reversal.service.ts`
 * (expense adjustment, reversal governance, rejection). Existing importers
 * keep targeting this file unchanged; the exported surface is identical to
 * the pre-split service. Named re-exports only — the registry scanner cannot
 * follow `export *`.
 */
export {
  AdvanceError,
  generateSettlementCode,
  autoOffsetExpenseApproval,
  getOutstandingAdvanceBalance,
  getOutstandingAdvanceBalances,
} from './advance-shared.service';
export {
  createAdvanceRequest,
  listAdvanceRequests,
  listAdvanceRequestsPaginated,
  getAdvanceRequestCounts,
  getAdvanceRequest,
} from './advance-request.service';
export type { PaginatedAdvanceRequests } from './advance-request.service';
export {
  createAdvanceSettlement,
  listAdvanceSettlements,
  listAdvanceSettlementsPaginated,
  getAdvanceSettlement,
  updateAdvanceSettlement,
} from './advance-settlement.service';
export type {
  AdvanceSettlementRow,
  PaginatedAdvanceSettlements,
} from './advance-settlement.service';
export {
  adjustSettlementExpense,
  requestAdvanceSettlementReversal,
  applyAdvanceSettlementGovernanceAction,
} from './advance-settlement-reversal.service';
