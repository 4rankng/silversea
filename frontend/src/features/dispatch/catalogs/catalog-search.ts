import { removeDiacritics } from '../../../lib/format';

const normalize = (value: string) => removeDiacritics(value).toLowerCase().trim().replace(/\s+/g, ' ');
const compactIdentifier = (value: string) => normalize(value).replace(/[\s.-]/g, '');

/** Search visible catalog text; plate, phone and code may omit separators. */
export function matchesCatalogSearch(
  query: string,
  fields: readonly (string | null | undefined)[],
  identifiers: readonly (string | null | undefined)[] = [],
): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  const text = normalize(fields.filter(Boolean).join(' '));
  if (needle.split(' ').every((word) => text.includes(word))) return true;
  const compact = compactIdentifier(needle);
  return compact.length > 0 && identifiers.some((value) => compactIdentifier(value ?? '').includes(compact));
}
