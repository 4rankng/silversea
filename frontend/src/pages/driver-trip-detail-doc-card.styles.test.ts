// Card 081026072302 (FB-055 follow-up) — the CSS half of the one-row contract
// (DriverTripDetailPage.test.tsx pins the DOM half; the puppeteer sweep in
// testplan/qa/scripts/qa-20261008-fb055-followup-width-sweep.mjs is the pixel
// truth). The ~80px regression was pure CSS: the closed card's button auto
// track (~202px max-content) always won, the minmax(0, 1fr) title column
// absorbed the squeeze, and 'Chuyến đã hoàn thành' wrapped to three lines at
// the 320px stop — 3 × 21px + 16px padding + 2px border = the 81px QA measured.
// These pins make that state unrepresentable again.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DriverTripDetailPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

// Media-block extraction with brace matching (repo precedent:
// legacy-trip-control-ceiling.styles.test.ts) — a bare regex would match past
// the block's close and merge every later tier into the assertion. The file
// carries two `(max-width: 640px)` tiers, so a selector can pin the intended
// one.
const mediaBlock = (query: string, containing?: string): string => {
  const scanner = new RegExp(`@media ${query.replace(/[()]/g, '\\$&')} \\{`, 'g');
  for (const match of css.matchAll(scanner)) {
    let depth = 1;
    let cursor = match.index! + match[0].length;
    const start = cursor;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const block = css.slice(start, cursor - 1);
    if (!containing || block.includes(containing)) return block;
  }
  throw new Error(`@media ${query}${containing ? ` containing ${containing}` : ''} must exist`);
};

// The top-level source with every @media block cut out, so "base rule" queries
// cannot be answered by a tier-conditional rule that happens to appear earlier
// in the file (the 320px stop's closed-button rule does).
const base = (() => {
  let out = '';
  let cursor = 0;
  for (const match of css.matchAll(/@media[^{]*\{/g)) {
    out += css.slice(cursor, match.index);
    let depth = 1;
    cursor = match.index! + match[0].length;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
  }
  return out + css.slice(cursor);
})();

const rule = (source: string, selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
};

const px = (value: string | undefined, label: string): number => {
  const n = Number(value?.match(/^(\d+(?:\.\d+)?)(?:px)?$/)?.[1]);
  expect(Number.isFinite(n), label).toBe(true);
  return n;
};

describe('driver closed-trip document card height contract (card 081026072302 — FB-055 follow-up)', () => {
  it('the phone tier swaps the flex roles so the title can never re-inflate the card to ~81px', () => {
    // The regression cause: title in the squeezing minmax(0, 1fr) track. The
    // roles swap below the tablet tier — title takes the auto track held to
    // one nowrap line, the button becomes the flexing column whose label may
    // wrap INSIDE the 40px control (responsive wrapping without clipping).
    const phone = mediaBlock('(max-width: 640px)', '.driver-task-footer__body--closed');
    const body = rule(phone, '.driver-task-footer__body--closed');
    expect(body).toBeDefined();
    expect(body).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/);

    const strong = rule(phone, '.driver-task-footer__body--closed .driver-task-footer__summary strong');
    expect(strong).toBeDefined();
    expect(strong).toMatch(/white-space:\s*nowrap/);

    const button = rule(phone, '.driver-task-footer__body--closed .driver-task-complete');
    expect(button).toBeDefined();
    expect(button).toMatch(/width:\s*100%/);
  });

  it('the 320px ladder stop holds the button label at two lines inside the 40px control', () => {
    // Measured: the flexing button gets 121px at 320px and its label needs
    // 77px of text measure for two lines — 14px inline padding left 72px and
    // the label broke to three, re-inflating the control to 56px (74px card).
    const stop320 = mediaBlock('(max-width: 320px)');
    const button = rule(stop320, '.driver-task-footer__body--closed .driver-task-complete');
    expect(button).toBeDefined();
    expect(button).toMatch(/padding-left:\s*8px/);
    expect(button).toMatch(/padding-right:\s*8px/);
  });

  it('the desktop band is width-independent and unchanged — 1280 and 1440 render the same one-row card', () => {
    const body = rule(base, '.driver-task-footer__body--closed');
    expect(body).toBeDefined();
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    expect(body).toMatch(/align-items:\s*center/);
    expect(rule(base, '.driver-task-footer__body--closed .driver-task-complete')).toMatch(/width:\s*auto/);

    // No tier above the tablet cutoff may touch the closed card, so every
    // desktop stop — the repo's standard 1280/1440 sweep widths included —
    // is the same 62px one-row card round 6 accepted.
    for (const match of css.matchAll(/@media \(min-width:\s*(\d+)px\)\s*\{/g)) {
      const min = Number(match[1]);
      let depth = 1;
      let cursor = match.index! + match[0].length;
      const start = cursor;
      while (cursor < css.length && depth > 0) {
        if (css[cursor] === '{') depth += 1;
        if (css[cursor] === '}') depth -= 1;
        cursor += 1;
      }
      expect(
        css.slice(start, cursor - 1).includes('.driver-task-footer__body--closed'),
        `a min-width: ${min}px tier re-declares the closed card`,
      ).toBe(false);
    }
  });

  it('the height budget is one 40px control row + card padding + borders: 58px phone, 62px desktop', () => {
    // Matches the pixel rung (qa/2026-10-08_card081026072302-fb055-followup_*.log):
    // 58px at 320/326/360/390/430, 62px at 768/1440. The red state measured
    // 81px because the title took 3 lines (3 × 21px > the 40px control row);
    // the nowrap title above pins it back to one line at every phone width.
    expect(tokens).toMatch(/--control-max-h:\s*40px/);
    expect(tokens).toMatch(/--control-h:\s*var\(--control-max-h\)/);
    const controlH = 40;
    const border = px(rule(base, '.driver-task-footer__body')?.match(/border:\s*(\d+)px/)?.[1], 'body border');
    // The 430px tier lists the selector last in its comma run
    // (`.driver-task-section, .driver-task-footer__body`), so anchor on it.
    const padPhone = px(rule(mediaBlock('(max-width: 430px)'), '.driver-task-footer__body')?.match(/padding:\s*(\d+)px/)?.[1], 'phone body padding');
    const padDesktop = px(rule(base, '.driver-task-footer__body')?.match(/padding:\s*(\d+)px/)?.[1], 'desktop body padding');

    expect(controlH + 2 * padPhone + 2 * border).toBeLessThanOrEqual(60);
    expect(controlH + 2 * padDesktop + 2 * border).toBe(62);
  });
});
