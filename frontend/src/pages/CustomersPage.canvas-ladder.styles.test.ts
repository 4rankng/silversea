import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-496 (QA retest 26/10, build 52ee6443): the customers screens' white
// canvas must read #FFFFFF on EVERY layer of the page ladder — html, body,
// .app-main, .app-body, and both page roots. The first round (438e87fb)
// painted only .app-body, and QA's computed-style probe still measured the
// sage token var(--bg) #E3E8E5 = rgb(227,232,229) on html/body — the canvas
// beneath the scroll surface never went white. The override stays
// page-scoped (:has on the two page roots) so no other surface loses the
// house tint.
const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');

const LAYERS = [
  'html:has(.customers-page)',
  'html:has(.cfg-page--customers)',
  'body:has(.customers-page)',
  'body:has(.cfg-page--customers)',
  '.app-main:has(.customers-page)',
  '.app-main:has(.cfg-page--customers)',
  '.app-body:has(.customers-page)',
  '.app-body:has(.cfg-page--customers)',
];

describe('customers screens paint the whole page ladder #FFFFFF (SIL-496)', () => {
  it('the page-scoped :has() block covers every ladder layer and pins #FFFFFF', () => {
    const block = css.match(/html:has\(\.customers-page\)[\s\S]*?\{([^}]*)\}/)?.[1];
    expect(block, 'the ladder rule exists').toBeTruthy();
    const selectorList = css.slice(css.indexOf('html:has(.customers-page)'), css.indexOf('html:has(.customers-page)') + 400);
    for (const layer of LAYERS) {
      expect(selectorList).toContain(layer);
    }
    expect(block!.replace(/\s+/g, '')).toContain('background:#FFFFFF');
  });

  it('both page roots paint white — the content no longer sits on sage', () => {
    expect(css).toMatch(/\.cfg-page--customers\s*\{[^}]*background:\s*#FFFFFF/);
    // The /customers root keeps its own white surface (existing law, line
    // pinned so a refactor cannot silently drop one side of the pair).
    expect(css).toMatch(/\.customers-page\s*\{[^}]*background:\s*var\(--surface\)/);
  });
});
