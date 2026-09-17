import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { ExpenseVoucherInput } from '@tingting/shared';
import * as s from '../db/schema';
import { db } from '../db';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import type { ExpenseActor } from './expense-accounting-write.service';
import { getExpenseAccountingEntry } from './expense-accounting-reads.service';
import { IDEMPOTENCY_ENDPOINTS } from './idempotency.service';
import { receiptCommandIdentity, vendorCommandIdentity, driverCommandIdentity } from './cash-command-identity.service';
import { normalizeTreasuryPhysicalReference } from './treasury.service';
import { requestPaymentReceiptGovernance } from './payment-allocation.service';
import { requestDriverPayoutGovernance, requestVendorPaymentGovernance } from './financial.service';
import { autoApplyGovernanceAction } from './adjustment-governance.service';
import { applyDirectMoneyGovernanceAction } from './governance-transition.service';
import type { GovernanceActionRow } from './governance-action-core.service';

export function expenseVoucherCode(input: Pick<ExpenseVoucherInput, 'treasuryAccountId' | 'direction' | 'physicalReference'>) {
  const reference = normalizeTreasuryPhysicalReference(input.physicalReference)!;
  const code = `CP-${input.treasuryAccountId}-${input.direction}-${reference}`;
  return code.length <= 100 ? code : `CP-${createHash('sha256').update(code).digest('hex')}`;
}

/** Adapt the expense screen to the same command identity and response used by legacy money APIs. */
export async function prepareExpenseCashCommand(actor: ExpenseActor, input: ExpenseVoucherInput) {
  const first = await getExpenseAccountingEntry(actor, input.entries[0].sourceKind, input.entries[0].sourceId);
  const amount = input.entries.reduce((sum, e) => sum + e.amount, 0);
  const fund = { treasuryAccountId: input.treasuryAccountId, valueDate: input.valueDate,
    physicalReference: normalizeTreasuryPhysicalReference(input.physicalReference)! };
  const receiptId = expenseVoucherCode(input);
  const apply = (tx: Tx, make: (tx: Tx) => Promise<GovernanceActionRow>) => autoApplyGovernanceAction({
    make, apply: applyDirectMoneyGovernanceAction, actorId: actor.userId, actorRole: actor.role, transaction: tx,
  });
  if (input.direction === 'IN') {
    const payment = { customerId: first.customerId, amount, receiptId, unappliedOnly: true, ...fund };
    return { endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_RECEIVE, payload: receiptCommandIdentity(payment),
      create: (tx: Tx) => apply(tx, tx => requestPaymentReceiptGovernance({ payment, makerId: actor.userId, makerRole: actor.role, transaction: tx })) };
  }
  if (first.payableEntityType === 'FORWARDER') return null; // Reimbursement is not creation of an OPS settlement.
  if (!first.payableEntityId) throw new ApiError(409, 'Khoản chi chưa xác định người nhận.');
  if (first.payableEntityType === 'DRIVER') {
    const [account] = await db.select().from(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, input.treasuryAccountId));
    if (!account) throw new ApiError(404, 'Không tìm thấy quỹ.');
    const payout = { driverId: first.payableEntityId, amount, receiptId, payoutDate: input.valueDate, note: input.note,
      method: account.type === 'BANK' ? 'BANK' as const : 'CASH' as const, ...fund };
    return { endpoint: IDEMPOTENCY_ENDPOINTS.DRIVER_PAYOUT, payload: driverCommandIdentity(payout),
      create: (tx: Tx) => apply(tx, tx => requestDriverPayoutGovernance({ payout, makerId: actor.userId, makerRole: actor.role, transaction: tx })) };
  }
  if (first.payableEntityType !== 'VENDOR') throw new ApiError(409, 'Khoản chi không có nguồn phải trả được hỗ trợ.');
  const payment = { supplierId: first.payableEntityId, amount: String(amount), receiptId, date: input.valueDate, note: input.note, ...fund };
  return { endpoint: IDEMPOTENCY_ENDPOINTS.PAYMENTS_VENDOR, payload: vendorCommandIdentity(payment),
    create: (tx: Tx) => apply(tx, tx => requestVendorPaymentGovernance({ payment, makerId: actor.userId, makerRole: actor.role, transaction: tx })) };
}
