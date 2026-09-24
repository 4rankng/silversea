const SEED_ID_SUFFIX = /\s+[0-9]{13}-[A-Za-z0-9][A-Za-z0-9-]{1,23}$/;

/**
 * Standing law internal-ids-never-user-facing (case QA-2026-09-24-01): board
 * rows show business names only. QA seed fixtures stamp a trailing
 * `<epoch-ms>-<rand>` onto customer/route/driver names; those id-like suffixes
 * never render. Names without a matching suffix pass through untouched.
 */
export function businessName(label: string | null | undefined): string {
  if (!label) return '';
  let out = label.trim();
  while (SEED_ID_SUFFIX.test(out)) out = out.replace(SEED_ID_SUFFIX, '');
  return out;
}
