/**
 * Governance transition hub — direct-money adapter dispatch.
 *
 * 2026-09-11 (maker-checker removal, MC-4): the governance_actions table is
 * gone and requests never persist; the approval-center read services
 * (get/list) and the row-based decision exports lived in it. What remains is
 * the kind→adapter dispatch used by direct-money governed writes.
 */
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type {
  GovernanceActionRow,
  GovernanceApplyAdapter,
  GovernanceApplyResult,
} from './governance-action-core.service';
import { applyCommissionGovernanceAction } from './commission.service';
import {
  applyCarrierPaymentGovernanceAction,
  applyDriverPayoutGovernanceAction,
  applyPenaltyCancelGovernanceAction,
  applyPenaltyCreateGovernanceAction,
  applyVendorPaymentGovernanceAction,
} from './financial.service';
import {
  applyPaymentReceiptGovernanceAction,
  applyPaymentRefundGovernanceAction,
} from './payment-allocation.service';
import { applyProfitDistributionGovernanceAction } from './profit-distribution.service';
import { applyTreasuryGovernanceAction } from './treasury.service';

export { assertActiveApprovalApplication, setGovernanceApprovalAfterApplyHookForTest } from './governance-action-core.service';
export type {
  GovernanceApplyAdapter,
  GovernanceApplyResult,
  GovernanceActionRow,
} from './governance-action-core.service';

const DIRECT_MONEY_ACTION_KINDS = new Set([
  'PAYMENT_RECEIPT',
  'PAYMENT_REFUND',
  'VENDOR_PAYMENT',
  'CARRIER_PAYMENT',
  'DRIVER_PAYOUT',
  'COMMISSION',
  'PENALTY_CREATE',
  'PENALTY_CANCEL',
  'PROFIT_DISTRIBUTION',
  'TREASURY_ACCOUNT_SETUP',
  'TREASURY_CUTOVER',
  'TREASURY_MOVEMENT_REVERSAL',
]);

export function isDirectMoneyGovernanceActionKind(actionKind: string): boolean {
  return DIRECT_MONEY_ACTION_KINDS.has(actionKind);
}

export const applyDirectMoneyGovernanceAction: GovernanceApplyAdapter = async function (
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult | void> {
  switch (action.actionKind) {
    case 'PAYMENT_RECEIPT':
      return applyPaymentReceiptGovernanceAction(tx, action);
    case 'PAYMENT_REFUND':
      return applyPaymentRefundGovernanceAction(tx, action);
    case 'VENDOR_PAYMENT':
      return applyVendorPaymentGovernanceAction(tx, action);
    case 'CARRIER_PAYMENT':
      return applyCarrierPaymentGovernanceAction(tx, action);
    case 'DRIVER_PAYOUT':
      return applyDriverPayoutGovernanceAction(tx, action);
    case 'COMMISSION':
      return applyCommissionGovernanceAction(tx, action);
    case 'PENALTY_CREATE':
      return applyPenaltyCreateGovernanceAction(tx, action);
    case 'PENALTY_CANCEL':
      return applyPenaltyCancelGovernanceAction(tx, action);
    case 'PROFIT_DISTRIBUTION':
      return applyProfitDistributionGovernanceAction(tx, action);
    case 'TREASURY_ACCOUNT_SETUP':
    case 'TREASURY_CUTOVER':
    case 'TREASURY_MOVEMENT_REVERSAL':
      return applyTreasuryGovernanceAction(tx, action);
    default:
      throw new ApiError(409, 'Loại yêu cầu không thuộc nhóm tiền trực tiếp');
  }
};
