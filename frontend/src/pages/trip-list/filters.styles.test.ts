import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = ['filters.css', 'responsive.css'];
const sheets = FILES.map((name) => ({
  name,
  css: readFileSync(resolve(process.cwd(), `src/pages/trip-list/${name}`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}));

/** Every flat `selector { body }` pair, comments already stripped. */
function rules(css: string): Array<[string, string]> {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [match[1].trim(), match[2]] as [string, string]);
}

describe('trip filter strip — the page declares no filter layout (card 20260927_152)', () => {
  it('keeps none of the retired hand-rolled plane selectors', () => {
    // The whole card is gone: `/trips` renders the shared `ListFilterBar`, so a
    // page rule that names the old card, its rows, its divider, its search shell
    // or its select pill is a page-local filter plane coming back — the exact
    // regression the 2026-09-27 ruling banned.
    const retired = [
      'filters-card', 'filters-row-top', 'filters-row-bottom', 'filters-divider',
      'filters-search', 'filter-chip', 'filter-lbl-wrap', 'filter-lbl-cap', 'filter-chev',
    ];
    for (const { name, css } of sheets) {
      for (const selector of retired) {
        expect(css, `${selector} is still declared in ${name}`).not.toMatch(new RegExp(`\\.${selector}(?![\\w-])`));
      }
    }
  });

  it('declares no display, width, flex or height for anything in the strip', () => {
    // Width follows the value and the shared sheet owns every height (law §3/§5):
    // the page's one remaining page-local filter rule is a tint on the
    // search-bypass note.
    for (const { name, css } of sheets) {
      for (const [selector, body] of rules(css)) {
        if (!/\.trip-list-page\s+\.filter/.test(selector)) continue;
        expect(body, `${name}: ${selector}`).not.toMatch(
          /(^|;|\s)(display|width|min-width|max-width|height|min-height|flex|flex-grow|flex-basis|grid-template-columns|grid-column)\s*:/,
        );
      }
    }
  });

  it('caps the two criteria at the UuiSelectField family ceiling, in the bar and in the dialog', () => {
    const cap = rules(sheets[0].css).find(([selector]) => selector.includes('.trip-criterion')) ?? ['', ''];
    // The dialog is portalled to <body>, so a bar-only scope would leave the
    // criterion uncapped behind `Bộ lọc`.
    expect(cap[0]).toContain('.filter-bar');
    expect(cap[0]).toContain('.filter-dropdown__body');
    expect(cap[1]).toContain('max-width: 280px');
  });

  it('tints the search-bypass note with tokens and nothing else', () => {
    const hint = rules(sheets[0].css).find(([selector]) => selector === '.trip-list-page .filters-search-hint')?.[1] ?? '';
    expect(hint).not.toBe('');
    expect(hint).toContain('var(--success-text)');
    expect(hint).toContain('var(--success-soft)');
    // Flat law §6: no raw colour, no shadow, no radius here.
    expect(hint).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|box-shadow|border-radius/);
  });
});
