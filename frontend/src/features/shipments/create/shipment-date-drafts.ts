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

/** Rows a bulk appointment copy may fill = every row without a committed
 * customerAppointmentAt. A typed partial segment draft is incomplete invalid
 * input ("Nhập đủ giờ và ngày hợp lệ"), never a schedule: case
 * 2026-10-11-R14-03 (FB-009 round 14, owner re-report "mất hẳn") amends card
 * 20261010_3 — an explicit copy click replaces such a draft (the split field
 * re-syncs its segments visibly from the written value, so the click is never
 * dead), matching the CUS ledger's 20260917_1 rule. Rows holding a set
 * appointment are never overwritten. */
export function emptyAppointmentKeys(rows: ShipmentContainerDraft[]) {
  return new Set(rows.filter((row) => !row.customerAppointmentAt).map((row) => row.key));
}
