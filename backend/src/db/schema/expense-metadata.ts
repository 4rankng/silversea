import { jsonb, numeric, text, date } from 'drizzle-orm/pg-core';
import type { ExpenseCostGroup } from '@tingting/shared';

/** Native expense owners hold classification and negotiated recovery, never the registry. */
export function expenseMetadataColumns() {
  return {
    payerKind: text('payer_kind').$type<'USER' | 'COMPANY'>(),
    costGroup: text('cost_group').$type<ExpenseCostGroup>(),
    feeName: text('fee_name'),
    customerChargeAmount: numeric('customer_charge_amount', { precision: 15, scale: 0 }),
    invoiceNumber: text('invoice_number'),
    invoiceDate: date('invoice_date'),
    recoveryNote: text('recovery_note'),
    photoStorageKeys: jsonb('photo_storage_keys').$type<string[]>().notNull().default([]),
  };
}
