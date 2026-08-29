import { Role, customerSchema } from '@tingting/shared';
import type { z } from 'zod';

export type CustomerCreateInput = z.infer<typeof customerSchema>;

/** Customer fields CUS/Dispatchers may set when adding a customer from intake. */
export type CustomerIntakeData = Omit<CustomerCreateInput,
  | 'creditLimit' | 'creditWarningThreshold' | 'paymentTermDays' | 'paymentDatePolicy'
  | 'fuelSurchargeSharePct' | 'debitNoteMode' | 'debitNoteTemplateId' | 'linkedSupplierId'
  | 'status' | 'isCarrier'
>;

/**
 * CUS and Dispatchers may add a missing customer from shipment intake, but
 * they are not customer-credit administrators: identity fields only, with
 * credit terms and billing policy left to their database defaults. Omitting
 * the governed keys (rather than nulling them) also keeps the create out of
 * the maker-checker gate, so intake gets a selectable row back immediately.
 * `status`/`isCarrier` are stripped with them: lifecycle gating and the
 * external-carrier catalog membership are material fields, not identity.
 */
export function restrictCustomerCreateForIntake(data: CustomerCreateInput, role: Role): CustomerIntakeData {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  const {
    creditLimit, creditWarningThreshold, paymentTermDays, paymentDatePolicy,
    fuelSurchargeSharePct, debitNoteMode, debitNoteTemplateId, linkedSupplierId,
    status, isCarrier,
    ...identity
  } = data;
  return identity;
}
