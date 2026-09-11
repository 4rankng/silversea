import { Role, customerSchema } from '@tingting/shared';
import type { z } from 'zod';

export type CustomerCreateInput = z.infer<typeof customerSchema>;

/** Customer fields CUS/Dispatchers may set when adding a customer from intake. */
export type CustomerIntakeData = Omit<CustomerCreateInput,
  | 'creditLimit' | 'creditWarningThreshold' | 'paymentTermDays' | 'paymentDatePolicy'
  | 'fuelSurchargeSharePct' | 'debitNoteMode' | 'debitNoteTemplateId' | 'linkedSupplierId'
  | 'status'
>;

/**
 * CUS and Dispatchers may add a missing customer from shipment intake, but
 * they are not customer-credit administrators: identity fields only, with
 * credit terms and billing policy left to their database defaults. Omitting
 * the governed keys (rather than nulling them) also keeps the create out of
 * the maker-checker gate, so intake gets a selectable row back immediately.
 * `status` is stripped with them: lifecycle gating is a material field, not
 * identity. `isCarrier` is preserved so carriers added via intake appear in
 * the external-carrier dropdown.
 */
export function restrictCustomerCreateForIntake(data: CustomerCreateInput, role: Role): CustomerIntakeData {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  // CUS/DISPATCHER intake must not set commercial-identity fields; strip them
  // explicitly so the restricted list stays visible at a glance. Keep in
  // sync with the `Omit<…, …>` type above; missing both sides lets a
  // material field through and breaks the gate-bypass guarantee.
  const restricted = new Set([
    'creditLimit', 'creditWarningThreshold', 'paymentTermDays', 'paymentDatePolicy',
    'fuelSurchargeSharePct', 'debitNoteMode', 'debitNoteTemplateId', 'linkedSupplierId',
    'status',
  ]);
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !restricted.has(key)),
  ) as unknown as CustomerIntakeData;
}

/** Financial/material fields CUS/Dispatchers may not set on update. */
const INTAKE_RESTRICTED_UPDATE_KEYS = new Set([
  'creditLimit', 'creditWarningThreshold', 'paymentTermDays', 'paymentDatePolicy',
  'fuelSurchargeSharePct', 'debitNoteMode', 'debitNoteTemplateId', 'linkedSupplierId',
  'status',
]);

/**
 * CUS may update a customer's identity fields (name, shortName, taxCode,
 * contactPerson, phone, address, etc.) but not financial-configuration
 * fields. `isCarrier` is preserved so carriers can be marked from intake.
 */
export function restrictCustomerUpdateForIntake(
  data: Partial<CustomerCreateInput>,
  role: Role,
): Partial<CustomerCreateInput> {
  if (role !== Role.CUS && role !== Role.DISPATCHER) return data;
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !INTAKE_RESTRICTED_UPDATE_KEYS.has(key)),
  ) as Partial<CustomerCreateInput>;
}

/**
 * Intake creates stamp the acting CUS/Dispatcher user on the customer row
 * (`created_by`). Admin-created rows stay NULL. The stamp is provenance
 * only — it does not affect visibility: every staff user sees the full
 * customer catalog. The stamp never writes link rows, so the creator's JWT
 * stays valid and the session survives.
 */
export function intakeCreatedBy(role: Role, actorId: number): number | null {
  return role === Role.CUS || role === Role.DISPATCHER ? actorId : null;
}
