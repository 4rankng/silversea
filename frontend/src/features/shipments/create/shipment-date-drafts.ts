import type { ShipmentContainerDraft } from './shipment-create-model';

export function hasDateDraft(scope: ParentNode | null | undefined, invalidOnly = false) {
  return Array.from(scope?.querySelectorAll<HTMLInputElement>('[data-date-input], [data-split-datetime] input:not([type="hidden"])') ?? []).some((input) => input.value.trim() !== '' && (!invalidOnly || !input.validity.valid));
}

/** Split fields keep incomplete text locally. A missing model timestamp alone
 * does not make a destination empty; snapshot its visible draft before copying. */
export function emptyAppointmentKeys(rows: ShipmentContainerDraft[], scope: ParentNode | null) {
  return new Set(rows.filter((row) => {
    if (row.customerAppointmentAt) return false;
    const field = scope?.querySelector(`[id="container-${row.key}-customer-appointment-time"]`)?.closest('[data-split-datetime]');
    return !hasDateDraft(field);
  }).map((row) => row.key));
}
