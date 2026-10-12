/**
 * Card 111026175000 (FB-007): the shipment-create factory picker only searched
 * code, name and address, so a factory could not be found by the phone number
 * even when it was on file. Keeping the string build here (rather than inline
 * in the row) makes the searchable surface testable on its own.
 */

export interface FactorySearchInput {
  code?: string | null;
  name?: string | null;
  shortName?: string | null;
  address?: string | null;
  contactPhone?: string | null;
}

/** Everything a dispatcher might type to find a factory. Nulls collapse so the
 *  option never carries a double space from an empty column. */
export function buildFactoryOptionSearchText(site: FactorySearchInput): string {
  return [site.code, site.name, site.shortName, site.address, site.contactPhone]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}