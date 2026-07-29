import type { CompanyInfo } from './types';
import { companyInfoSchema } from './schemas';

/**
 * Company setup is complete only when every field required by
 * `companyInfoSchema` has a non-blank value. Seeded white-label installations
 * contain empty `company.*` rows, so row timestamps cannot distinguish a
 * configured profile from untouched placeholders.
 */
export function isCompanyInfoConfigured(
  companyInfo: CompanyInfo | null | undefined,
): boolean {
  return !!companyInfo && companyInfoSchema.safeParse(companyInfo).success;
}
