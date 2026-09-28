import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260928_195 / 20260928_190: the filter audit's rules are guard rails,
 * and a guard rail nobody can reason about is one somebody relaxes. These tests
 * pin the CONDITIONS of the audit's two carve-outs, not the current result:
 * a bar may only skip the two-row law when it has no fold affordance, and a bar
 * may only skip the anchor check when it renders inline. Both are allowed to be
 * narrow; neither may be widened without this file changing.
 */
const audit = readFileSync(
  resolve(process.cwd(), '../testplan/qa/scripts/ui-filter-audit-20260927.mjs'),
  'utf8',
);

describe('filter audit carve-outs', () => {
  it('exempts the two-row law ONLY when the bar has no Bộ lọc trigger to fold into', () => {
    // The exemption is the intersection, not a fallback: over the row floor AND
    // no fold affordance. If someone rewrites it so "no trigger" alone excuses a
    // tall bar, or so the floor stops mattering, these fail.
    expect(audit).toMatch(/const noFoldAffordance = !bar\.querySelector\('\.filter-dropdown__trigger'\);/);
    expect(audit).toMatch(/const overRowFloor = box\.width >= twoRowFloor && tops\.length > 2;/);
    expect(audit).toMatch(/const rowExempt = overRowFloor && noFoldAffordance;/);
    expect(audit).toMatch(/twoRowViolation: overRowFloor && !rowExempt,/);
  });

  it('keeps every other bar held to the two-row law', () => {
    // A foldable bar over the floor is still a failure — the exemption must not
    // become a general "tall bars are fine" escape hatch.
    expect(audit).not.toMatch(/twoRowViolation:\s*false\b/);
    expect(audit).toMatch(/row\.flagged = Boolean\(/);
    expect(audit).toMatch(/bar\.twoRowViolation \|\|/);
  });

  it('records the exemption with its reason instead of passing it silently', () => {
    expect(audit).toMatch(/rowExemptReason: rowExempt \? '3\+ rows and no Bộ lọc trigger to fold into' : null/);
    // The 'ok  ' case is space-padded to line its verdicts up in the audit
    // output. Those two spaces are written `{2}` rather than typed literally:
    // a run of bare spaces in a regex is invisible in review, and this is the
    // only part of the verdict string whose width matters.
    expect(audit).toMatch(/const mark = row\.flagged \? 'FAIL' : row\.rowExempt \? 'EXPT' : 'ok {2}';/);
    expect(audit).toMatch(/row-law exemptions: \$\{exempt\.length\} — reasoned, NOT clean passes/);
  });

  it('treats a missing Bộ lọc trigger as "anchor n/a", never as a verified pass', () => {
    // The original bug: `ok: true` plus a `skipped` reason, and rows flag on
    // `!ok` — so an unrun check counted as a clean pass. `applicable: false` and
    // a printed `anchor n/a` is the corrected shape.
    expect(audit).toMatch(/applicable: false/);
    expect(audit).not.toMatch(/return \{ ok: true, skipped: 'no Bộ lọc trigger/);
    expect(audit).toMatch(/anchor n\/a \(inline\)/);
  });

  it('fails the run on a real hole, and keeps holes separate from exemptions', () => {
    // An exemption must never satisfy the exit code, and an unmeasured surface
    // must never be satisfied by a flag count of zero.
    expect(audit).toMatch(/process\.exitCode = flagged\.length \|\| unverified\.length \? 1 : 0;/);
    expect(audit).toMatch(/UNVERIFIED — these are NOT passes/);
  });

  it('does not classify a data-gated bar as out of scope', () => {
    // `ForwarderSettlementsPage` / `ForwarderAdvancesPage` DO render
    // `ListFilterBar` behind `{totalCount > 0}`; with an empty demo dataset they
    // are unverified, not out of scope.
    expect(audit).toMatch(/dataGated \? 'unverified: bar gated on data, dataset empty' : 'out of scope: no shared \.filter-bar in this surface'/);
  });
});
