/**
 * Pure helpers for the dispatch-plan note composer ("Ghi chú tác vụ"): the
 * note is a `'; '`-joined composition of selected tag labels + trailing
 * manual text. compose ∘ parse is the identity on well-formed notes, so an
 * untouched reopen+save round-trips byte-identical and never bumps shipment
 * version.
 */

/** Tags first, then trimmed manual text; empty parts skipped. */
export function composeNote(selectedLabels: ReadonlyArray<string>, manualText: string): string {
  return [...selectedLabels, manualText.trim()].filter(Boolean).join('; ');
}

/**
 * Exact-segment reverse of compose: a segment equal to a known tag label
 * pre-selects that chip; everything else re-joins as manual text. Notes
 * written by hand (or via the master-plan inline editor) contain no exact
 * tag segments — they degrade to all-manual, never destroyed.
 */
export function parseNote(value: string | null | undefined, knownLabels: ReadonlyArray<string>): {
  selectedLabels: string[];
  manualText: string;
} {
  if (!value) return { selectedLabels: [], manualText: '' };
  const knownSet = new Set(knownLabels);
  const selectedLabels: string[] = [];
  const manual: string[] = [];
  for (const segment of value.split('; ')) {
    if (knownSet.has(segment)) selectedLabels.push(segment);
    else manual.push(segment);
  }
  return { selectedLabels, manualText: manual.join('; ') };
}
