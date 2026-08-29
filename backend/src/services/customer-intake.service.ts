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

/**
 * Intake creates stamp the acting CUS/Dispatcher user on the customer row
 * (`created_by`). The stamp is scope-following: the creator's own
 * `loadClerkShipmentScope` admits customers they created, so an inline
 * customer becomes a working customer immediately. Admin-created rows stay
 * NULL — their visibility is governed solely by user_customer_links. The
 * stamp never writes link rows, so the creator's JWT scope snapshot
 * (links-only exact-equality) stays valid and the session survives.
 */
export function intakeCreatedBy(role: Role, actorId: number): number | null {
  return role === Role.CUS || role === Role.DISPATCHER ? actorId : null;
}
