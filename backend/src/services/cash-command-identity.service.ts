import { normalizeTreasuryPhysicalReference, type TreasuryPaymentFields } from './treasury.service';
import type { PaymentReceiptInput } from './payment-allocation.service';
import type { DriverPayoutInput, VendorPaymentInput } from './financial.service';

function fund(input: TreasuryPaymentFields) {
  return { treasuryAccountId: input.treasuryAccountId ?? null, valueDate: input.valueDate ?? null,
    physicalReference: normalizeTreasuryPhysicalReference(input.physicalReference) };
}
/** Stable business identity shared by every HTTP adapter for the same money command. */
export function receiptCommandIdentity(input: PaymentReceiptInput) {
  const payments = input.payments?.length ? [...input.payments].map(p => ({ tripId: Number(p.tripId), amount: Number(p.amount) }))
    .sort((a, b) => a.tripId - b.tripId) : null;
  return { customerId: Number(input.customerId), receiptId: input.receiptId.trim(),
    amount: Number(input.amount ?? payments?.reduce((sum, p) => sum + p.amount, 0)), payments,
    unappliedOnly: input.unappliedOnly ?? false, ...fund(input) };
}
export function vendorCommandIdentity(input: VendorPaymentInput) {
  return { supplierId: Number(input.supplierId), receiptId: input.receiptId?.trim() ?? '', amount: Number(input.amount),
    date: input.date, note: input.note?.trim() ?? '', confirmOverpay: input.confirmOverpay ?? false,
    allocations: [...(input.allocations ?? [])].map(item => ({ expenseId: Number(item.expenseId), amount: Number(item.amount) })).sort((a, b) => a.expenseId - b.expenseId), ...fund(input) };
}
export function driverCommandIdentity(input: DriverPayoutInput & TreasuryPaymentFields) {
  return { driverId: Number(input.driverId), receiptId: input.receiptId?.trim() ?? '', amount: Number(input.amount),
    method: input.method, payoutDate: input.payoutDate, note: input.note?.trim() ?? '', ...fund(input) };
}
