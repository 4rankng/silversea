/**
 * Card 20260928_189: a BLOCKED verdict has to say WHICH environment blocked it.
 *
 * A BLOCKED result means "this env could not satisfy the precondition" — local
 * dev lacks a staging-only fixture, or a dataset is empty. Without the env in
 * the message, that sentence is unactionable: the reader cannot tell a genuinely
 * missing fixture from a case that would have passed on staging, and has to go
 * and re-derive which env produced the report.
 *
 * This is enforced HERE, at the boundary, rather than at each `return` site.
 * Ten case files held 24 BLOCKED returns between them and not one of them
 * carried the tag; patching 24 literals would have left the next case free to
 * forget again. Any future case is covered for free.
 *
 * Cases that already do it themselves (the 10 that follow the convention) are
 * left alone — the prefix is only added to messages that lack it.
 *
 * Prepending, not wrapping: the env goes FIRST so it survives log truncation
 * and any "first line only" viewer.
 */
export const ENV_TAG_PATTERN = /\[\s*(local|staging)\s*\]/;

/**
 * Prefix every error of a non-PASS verdict with the env tag when missing.
 *
 * Only non-PASS verdicts are touched. A PASS carries no reason, and a FAIL's
 * message is an assertion about the product that must read the same on every
 * env — tagging it would imply the expectation differs by environment, which is
 * never true. BLOCKED is the one verdict whose meaning IS environment-relative.
 *
 * @param {{verdict?: string, errors?: unknown}} result mutated in place
 * @param {{env?: string}} env the loaded env, which carries `.env` = 'local' | 'staging'
 * @returns {typeof result} the same object, for call-site convenience
 */
export function tagNonPassErrors(result, env) {
  if (!result || result.verdict === 'PASS' || result.verdict === 'ERROR') return result;
  const name = env?.env;
  if (!name) return result; // unknown env: tagging with "undefined" is worse than nothing
  const prefix = `[${name}]`;
  const errors = Array.isArray(result.errors) ? result.errors : [];
  result.errors = errors.map((e) => {
    const text = typeof e === 'string' ? e : String(e?.message ?? e);
    return ENV_TAG_PATTERN.test(text) ? text : `${prefix} ${text}`;
  });
  return result;
}
