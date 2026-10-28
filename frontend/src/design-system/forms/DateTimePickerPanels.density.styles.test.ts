import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/DateTimePickerPanels.css'), 'utf8');

/* Combined ngày+giờ picker density (owner report 11/10). Measured on the dev
 * server before this rework: the popup was 680×273 with a 146px calendar
 * column and 496px of time pane (two 244px columns holding 2-digit numbers,
 * 32px option rows).
 *
 * Root cause: `DatePickerSurface.css` sets `.date-picker__popup .dtp-date
 * { width: 100%; min-width: 0 }`, so the calendar's width resolved against a
 * CONTENT-sized flex item (`flex: 0 0 auto`) and collapsed; `.combined-
 * datetime__time { flex: 1 1 auto }` then absorbed the rest of the 680px.
 * The rules below pin the fixed two-pane replacement: a designed 220px
 * calendar, a capped time pane, and 22px option rows with a coarse-pointer
 * touch floor. */

const rule = (selector: string) => {
  const index = css.indexOf(`\n${selector} {`);
  const start = index === -1 ? css.indexOf(`${selector} {`) : index + (index === -1 ? 0 : 1);
  expect(start, `rule missing: ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start) + 1);
};

describe('combined date-time popup density (owner report 11/10)', () => {
  it('shrinks the popup to the compact two-pane width', () => {
    expect(rule('.date-picker__popup.combined-datetime__popup')).toMatch(
      /width:\s*min\(424px,\s*calc\(100vw - 16px\)\);/,
    );
  });

  it('gives the calendar a designed column instead of a content-sized collapse', () => {
    expect(rule('.combined-datetime__date')).toMatch(/flex:\s*0 0 220px;/);
    expect(rule('.combined-datetime__date')).toMatch(/min-width:\s*0;/);
  });

  it('caps the time pane so its two columns stay dense', () => {
    const time = rule('.combined-datetime__time');
    expect(time).toMatch(/flex:\s*1 1 168px;/);
    expect(time).toMatch(/max-width:\s*200px;/);
  });

  it('keeps the hour/minute option rows compact, with a coarse-pointer floor', () => {
    expect(rule('.combined-datetime__time .dtp-time__option')).toMatch(/min-height:\s*22px;/);
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(coarse).toMatch(
      /\.combined-datetime__time \.dtp-time__option\s*\{\s*min-height:\s*var\(--control-max-h\);/,
    );
  });

  it('keeps the exact-time entry a compact inline row, never a full-width bar', () => {
    // Owner report 11/10: a full-width text box for five characters, plus a
    // redundant "Giờ chính xác" caption. The row is a content-sized field and
    // a small confirm; the input keeps its accessible name.
    const exact = rule('.dtp-time__exact');
    expect(exact).toMatch(/display:\s*flex;/);
    expect(exact).not.toMatch(/grid-template-columns/);
    expect(rule('.dtp-time__exact > input')).toMatch(/width:\s*78px;/);
    expect(rule('.dtp-time__exact > input')).not.toMatch(/width:\s*100%;/);
    expect(css).not.toContain('.dtp-time__exact > label');
  });

  it('frames both hour/minute lists so the options read as a picker', () => {
    const list = rule('.dtp-time__list');
    expect(list).toMatch(/border:\s*1px solid var\(--line\);/);
    expect(list).toMatch(/border-radius:\s*8px;/);
    expect(list).toMatch(/background:\s*var\(--surface\);/);
  });

  it('keeps the shared exact-time surface on the --surface token', () => {
    // The base rule is a registered floating surface (overlay-surface registry):
    // the density pass scopes NEW rules under `.combined-datetime__time` and
    // must never replace the base fill.
    expect(rule('.dtp-time__exact > input')).toMatch(/background:\s*var\(--surface-2\);/);
    expect(css).not.toMatch(/background:\s*(?:#fff|white|rgb\(\s*255)/i);
  });

  it('SIL-565: selected states use --brand fill for WCAG AA contrast (8.4:1 with white)', () => {
    expect(rule('.dtp-time__option[data-selected]')).toMatch(/background:\s*var\(--brand\);/);
    expect(rule('.dtp-time__option[data-selected]')).toMatch(/color:\s*var\(--white,\s*#fff\);/);
    expect(rule('.dtp-pill.is-active')).toMatch(/background:\s*var\(--brand\);/);
    expect(rule('.dtp-pill.is-active')).toMatch(/color:\s*var\(--white,\s*#fff\);/);
    expect(rule('.dtp-time__exact > button')).toMatch(/background:\s*var\(--brand\);/);
    expect(rule('.dtp-time__exact > button')).toMatch(/color:\s*var\(--white,\s*#fff\);/);
  });
});
