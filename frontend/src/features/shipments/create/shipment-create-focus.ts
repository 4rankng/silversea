/** Bring the first validation issue into view without moving the page twice. */
export function focusShipmentCreateIssue(fieldId: string) {
  const field = document.querySelector(`[data-field-id="${fieldId}"]`);
  if (!(field instanceof HTMLElement)) return;
  const reduceMotion = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  field.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  const control = field.matches('button, input, select, textarea, [tabindex]')
    ? field
    : field.querySelector('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  if (control instanceof HTMLElement) control.focus({ preventScroll: true });
}
