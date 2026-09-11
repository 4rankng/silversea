/**
 * Driver task-note format v2 (ticket 851e8f7d, TODO/20260911_3 BUG4): the
 * driver note ("Ghi chú lái xe") stores task tags and free text as TWO
 * parts — line 1 = selected tag labels joined by '; ', the remainder after
 * the first newline = free text. Empty parts are skipped, so a tags-only or
 * text-only note is a single line.
 *
 * Legacy v1 notes ('; '-joined single line, no newline — the old frontend
 * composeNote format) parse identically to the previous frontend lib and
 * migrate to v2 on the next composer save: compose ∘ parse is the identity
 * on well-formed notes, so an untouched reopen+save round-trips
 * byte-identical and never bumps the shipment version.
 */

/** Tags first as line 1, trimmed manual text after the first newline. */
export function composeDriverTaskNote(
  selectedLabels: ReadonlyArray<string>,
  manualText: string,
): string {
  const tagLine = selectedLabels
    .map((label) => label.trim())
    .filter(Boolean)
    .join('; ');
  const text = manualText.trim();
  return [tagLine, text].filter(Boolean).join('\n');
}

/**
 * Line 1 is split on '; ' and each exact segment equal to a known tag label
 * pre-selects that chip; unmatched segments and everything after the first
 * newline re-join as manual text. Hand-written notes (or legacy v1 notes)
 * contain no matching segments — they degrade to all-manual, never
 * destroyed.
 */
export function parseDriverTaskNote(
  value: string | null | undefined,
  knownLabels: ReadonlyArray<string>,
): { selectedLabels: string[]; manualText: string } {
  if (!value) return { selectedLabels: [], manualText: '' };
  const knownSet = new Set(knownLabels);
  const newlineIndex = value.indexOf('\n');
  const head = newlineIndex === -1 ? value : value.slice(0, newlineIndex);
  const tail = newlineIndex === -1 ? '' : value.slice(newlineIndex + 1);
  const selectedLabels: string[] = [];
  const manual: string[] = [];
  for (const segment of head.split('; ')) {
    if (knownSet.has(segment)) selectedLabels.push(segment);
    else manual.push(segment);
  }
  const manualText = [manual.join('; '), tail].filter(Boolean).join('\n');
  return { selectedLabels, manualText };
}
