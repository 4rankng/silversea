/**
 * Internal system codes — the ONE owner of "this string is an internal code".
 *
 * House law (internal-ids): a system code is an id-derived key, never a
 * business reference. Số Bill / Số Booking / biển số / container number ARE
 * business references and must keep rendering.
 *
 * The prefix set is the house definition already used by the accounting
 * register (features/expense-accounting/business-key.ts) — SHP / TRP / TRIP /
 * DSP / GBN — plus the two shapes the platform also stores:
 *   BULK-TR-  bulk-seed trip code (backend/src/seed/seed-bulk-data.ts)
 *   CN-       legacy container-shaped trip code (historic rows)
 *
 * `CN-` is deliberately NOT a plain prefix match: the same prefix appears in
 * Vietnamese addresses ("Lô CN-09, Khu công nghiệp Vân Trung" —
 * backend/src/seed/data/factories.ts), so matching it blindly would eat
 * address text. The CODE form always carries a trailing dash-digit group
 * ("CN-MSCU1234561-1"); the address form never does.
 */

/** The house system-code prefixes (shared with the accounting register). */
export const SYSTEM_CODE_PREFIXES = ['SHP', 'TRP', 'TRIP', 'DSP', 'GBN', 'BULK-TR'] as const;

/**
 * A code token: the prefix, a dash, then the code body. The body excludes
 * '.' so sentence punctuation and the file extension survive, and stops at
 * whitespace so only the code itself is removed from prose.
 */
const CODE_BODY = '[A-Za-z0-9][A-Za-z0-9_-]*';

/** A code token standing alone in prose. */
const PROSE_CODE_TOKEN = new RegExp(`\\b(?:${SYSTEM_CODE_PREFIXES.join('|')})-${CODE_BODY}`, 'g');

/** Legacy container-shaped trip code — needs its dash-digit group to qualify. */
const LEGACY_CN_CODE = /\bCN-[A-Za-z0-9]+(?:-\d+)+\b/g;

/** True when the text carries an internal system code. */
export function containsInternalCode(text: string | null | undefined): boolean {
  if (!text) return false;
  PROSE_CODE_TOKEN.lastIndex = 0;
  LEGACY_CN_CODE.lastIndex = 0;
  return PROSE_CODE_TOKEN.test(text) || LEGACY_CN_CODE.test(text);
}

/**
 * Remove every internal code from free prose, collapsing the whitespace the
 * removal leaves behind. Returns null when nothing is left, so callers hide the
 * row instead of rendering a code-shaped remnant.
 */
export function stripInternalCodes(text: string | null | undefined): string | null {
  if (!text) return null;
  const stripped = text
    .replace(PROSE_CODE_TOKEN, ' ')
    .replace(LEGACY_CN_CODE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return stripped === '' ? null : stripped;
}

/** A file-name segment that carries a digit belongs to the code, not the label. */
const CODE_SEGMENT = /\d/;

/**
 * The driver-facing name of an uploaded document: the stored file name with
 * its leading internal code removed (the seeded e-POD shape names files
 * "<tripCode>-<FILE_TYPE>.pdf"). The file itself keeps its stored name — only
 * what the driver SEES is cleaned, per the internal-ids ruling.
 *
 * The code is read as the prefix plus the dash-separated segments that carry
 * a digit ("TRP-202609-0001" of "TRP-202609-0001-YARD_OR_DROP_RECEIPT"); the
 * document label that follows keeps its own segments. A trailing fragment
 * without an underscore belongs to the code too (the legacy shape
 * "TRP-C12-53-1791212851260-gvr4vb"), while an underscore label (the
 * document-type enum) is always kept.
 *
 * Returns null when the name IS a code, so the caller renders the document's
 * own label instead of a code-shaped remnant.
 */
export function stripInternalCodeFromFileName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  const dot = trimmed.lastIndexOf('.');
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const extension = dot > 0 ? trimmed.slice(dot) : '';
  const segments = base.split('-');
  const prefix = segments[0];
  const isKnownPrefix = (SYSTEM_CODE_PREFIXES as readonly string[]).includes(prefix);
  // "CN-" needs the legacy two-group shape ("CN-MSCU1234561-1"); a bare
  // "CN-09" is an address lot, not a code.
  const isLegacyCn = prefix === 'CN' && segments.length >= 3;
  if (!isKnownPrefix && !isLegacyCn) return trimmed;

  let consumed = 1;
  while (consumed < segments.length && CODE_SEGMENT.test(segments[consumed])) consumed += 1;
  // A single trailing segment without an underscore is the tail of a legacy
  // code ("…-gvr4vb"), not a document label.
  if (
    consumed === segments.length - 1
    && consumed > 1
    && !segments[consumed].includes('_')
  ) {
    consumed += 1;
  }
  const remaining = segments.slice(consumed).join('-');
  if (!remaining) return null;
  // Safety net: a name that STILL carries a code after the leading run was
  // removed (two codes in one name) is not driver-facing text — the caller
  // renders the document's own label instead.
  if (containsInternalCode(remaining)) return null;
  return remaining + extension;
}
