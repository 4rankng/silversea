import type { ShipmentContainerDraft } from './shipment-create-model';

export function hasDateDraft(scope: ParentNode | null | undefined, invalidOnly = false) {
  if (!scope) return false;
  const selector = '[data-date-input], [data-split-datetime] input:not([type="hidden"]), [data-seg-part] input:not([type="hidden"])';
  const inputs = Array.from(
    scope instanceof Element && scope.matches('[data-split-datetime], [data-seg-part]')
      ? scope.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')
      : scope.querySelectorAll<HTMLInputElement>(selector)
  );
  return inputs.some((input) => input.value.trim() !== '' && (!invalidOnly || !input.validity.valid));
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
