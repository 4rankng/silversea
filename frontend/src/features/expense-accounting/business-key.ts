/** System-code patterns are banned from display text (id-leak ruling):
 *  legacy rows can still ride a shipmentCode that carries an id-derived
 *  code instead of the business key, and those render as the em-dash
 *  placeholder — the row's date/customer name carry the context. */
const SYSTEM_CODE = /^(SHP|TRP|TRIP|DSP|GBN)-/;

/** The wire value when it is a presentable business key, else null. */
export function businessKey(value: string | null | undefined): string | null {
  return value && !SYSTEM_CODE.test(value) ? value : null;
}

/** Display form: the business key, or the em-dash placeholder. */
export function displayKey(value: string | null | undefined): string {
  return businessKey(value) ?? '—';
}
