import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

// SIL-993 — phone card band (/shipments, 390/360px): the row's eyebrow label
// and the schedule status are ONE fact each and must read whole.
//
// Measured at 390px before the fix: the "Chứng từ" cell rendered
//   line 1  CHỨNG
//   line 2  TỪ MSCU851REPRO002-
//   line 3  UIR4
// because the cell's `overflow-wrap: anywhere` only offers CONDITIONAL breaks
// inside the value token, and an ordinary break point (the label's own space)
// always wins over a conditional one. The same rule split "Chưa chốt lịch"
// into "Chưa chốt" / "lịch" at 360px.
//
// The fix removes the ordinary break point (nowrap), so the LABEL is whole and
// the value token is the thing that yields.
describe('shipments phone card band labels (SIL-993)', () => {
  it('keeps the fact eyebrow label on one line', () => {
    expect(css).toMatch(
      /\.cus-dashboard-table \.cus-inline-trigger::before\s*\{[^}]*white-space:\s*nowrap;/,
    );
  });

  it('keeps the "Chưa chốt lịch" status on one line', () => {
    expect(css).toMatch(/\.cus-schedule-missing\s*\{[^}]*white-space:\s*nowrap;/);
  });

  it('does not hide the value that shares the label line', () => {
    // nowrap is scoped to the label pseudo — the value keeps its own wrap law
    // (the base "words wrap whole" rule on .cus-multiline-cell stays).
    const eyebrow = css.match(
      /\.cus-dashboard-table \.cus-inline-trigger::before\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(eyebrow).not.toMatch(/display:\s*none/);
    expect(css).toMatch(
      /\.cus-multiline-cell strong,\s*\n\.cus-multiline-cell span\s*\{[^}]*overflow-wrap:\s*anywhere;/,
    );
  });
});

// SIL-1167 (r43b, QA retest 27/11 @360px, vai tiepvv): the eyebrow label and
// the nowrap "Chưa chốt lịch" share one line on the phone card ("LỊCH TRÌNH
// Chưa chốt lịch"). At 360px that line's text room is smaller than label +
// phrase, the phrase overflowed its half-cell, and the viewport's
// `overflow-x: clip` shaved the trailing "h" (QA-measured rectRight 353px vs
// clip edge 352px; 16 identical spots). WebKit offers no soft-wrap
// opportunity between the ::before label and the phrase (driven sweep
// 2026-11-27: phrase stays beside the label at 365–389px), so the own-line
// break is forced at LAYOUT level — `display: block` in the ≤374px band, the
// content-fit boundary (label run ~71–75px + phrase 87px needs a half-track
// the band below 375px cannot give). The value then ends inside the cell's
// own padding; ≥375px — 390px measured correct — keeps the shared-line
// layout. The phrase itself stays nowrap (SIL-993 law above): the LINE
// wraps, the phrase never splits mid-way, nothing truncates.
describe('shipments phone card band waiting-schedule value (SIL-1167)', () => {
  const bandText = (breakpoint: string) =>
    css.match(new RegExp(`@media \\(max-width: ${breakpoint}\\)\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`))?.[1] ?? '';

  it('drops the whole "Chưa chốt lịch" phrase onto its own line at ≤374px', () => {
    expect(bandText('374px')).toMatch(
      /\.cus-dashboard-table \.cus-inline-trigger > \.cus-schedule-missing\s*\{\s*display:\s*block;\s*\}/,
    );
  });

  it('scopes the own-line override to ≤374px — the ≤999 card band never touches it', () => {
    expect(bandText('999px')).not.toMatch(/\.cus-schedule-missing/);
  });
});
