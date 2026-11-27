import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1210 (QA wave a8f059c0, 1440px) — in an e-POD card head the
// "Bắt buộc" badge and the state chip ("Chưa có" / "Đã lưu") were 8px out
// of vertical alignment: the badge was CENTRED inside the (two-line) title
// block, so a wrapped title pushed it below the chip's top edge, and a stale
// override pinned the badge to 20px against the state chip's 28px — the two
// centres sat 4px apart even when the tops matched.
//
// The law: the two badges of a card head are ONE row — same top edge, same
// height — at 1440px, 390px and 360px. The alignment comes from the head
// row's align-items; no absolute offset may fake it.

const rawCss = readFileSync(resolve(process.cwd(), 'src/components/trip/TripPodSubmission.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/components/trip/TripPodSubmission.tsx'), 'utf8');
// Rule parsing ignores the comments — the invariants live in the declarations.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const match = css.match(pattern);
  expect(match, `expected a rule for ${selector}`).toBeTruthy();
  return match![1];
}

/** Every declaration body that targets `className` (a selector list counts
 *  for each of its members). */
function declarations(className: string): string[] {
  const bodies: string[] = [];
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.some((part) => part.endsWith(className))) bodies.push(match[2]);
  }
  return bodies;
}

/** The chip band a class declares — exactly one entry means one owner, and a
 *  re-introduced override shows up as a second entry. */
function chipBand(className: string): string[] {
  return declarations(className)
    .map((body) => body.match(/min-height:\s*(\d+)px/)?.[1])
    .filter((value): value is string => Boolean(value));
}

describe('TripPodSubmission — the two badges of a card head are one row (SIL-1210)', () => {
  it('the head row and the title row are top-aligned', () => {
    // The state chip rides the head row's top edge...
    expect(ruleBody('.trip-pod__card-head')).toMatch(/align-items:\s*flex-start/);
    // ...and the "Bắt buộc" badge rides the title's FIRST line, so a
    // two-line title can never push it below the chip.
    expect(ruleBody('.trip-pod__card-title')).toMatch(/align-items:\s*flex-start/);
    expect(ruleBody('.trip-pod__card-title')).not.toMatch(/align-items:\s*center/);
  });

  it('the badge and the state chip share ONE chip band', () => {
    expect(chipBand('.trip-pod__required')).toEqual(['28']);
    expect(chipBand('.trip-pod__state-ok')).toEqual(['28']);
    expect(chipBand('.trip-pod__state-missing')).toEqual(['28']);
    expect(chipBand('.trip-pod__state-unreadable')).toEqual(['28']);
  });

  it('the badge carries no absolute offset — the row aligns it', () => {
    const required = declarations('.trip-pod__required').join('\n');
    expect(required).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(required).not.toMatch(/(^|;)\s*top:/);
    expect(required).not.toMatch(/transform:/);
    expect(required).not.toMatch(/margin-/);
  });

  it('the markup keeps both badges inside one card-head row, badge first', () => {
    const start = tsx.indexOf('className="trip-pod__card-head"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = tsx.slice(start, tsx.indexOf('</article>', start));
    expect(block).toContain('trip-pod__card-title-text');
    expect(block).toContain('trip-pod__required');
    expect(block).toContain('trip-pod__state');
    // The badge belongs to the title row, the chip to the head row's end —
    // one row, so one top edge for both.
    expect(block.indexOf('trip-pod__required')).toBeLessThan(block.indexOf('trip-pod__state'));
  });
});
