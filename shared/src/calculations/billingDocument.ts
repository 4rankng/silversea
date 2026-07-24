import type { BillingDocumentLine } from '../types';

type FreightDescriptionInput = Pick<
  BillingDocumentLine,
  'sourceType' | 'lineType' | 'description' | 'routeName'
>;

const GENERATED_FREIGHT_DESCRIPTION = [
  /^Cước vận chuyển$/i,
  /^Cước vận chuyển\s*\(\s*TRP-[^)]+\s*\)$/i,
  /^Cước vận chuyển\s+TRP-\S+$/i,
  /^Cước vận chuyển\s*[—–-]\s*.+$/i,
];

/**
 * Upgrade system-generated freight labels to the route-based wording used on
 * debit notes. Accountant-authored descriptions are deliberately preserved.
 */
export function canonicalFreightDescription(line: FreightDescriptionInput): string {
  if (line.sourceType !== 'TRIP' || line.lineType !== 'FREIGHT') return line.description;
  const routeName = line.routeName?.replace(/\s+/g, ' ').trim();
  const description = line.description.replace(/\s+/g, ' ').trim();
  if (!routeName || !GENERATED_FREIGHT_DESCRIPTION.some((pattern) => pattern.test(description))) {
    return line.description;
  }
  return `Cước vận chuyển — ${routeName}`;
}
