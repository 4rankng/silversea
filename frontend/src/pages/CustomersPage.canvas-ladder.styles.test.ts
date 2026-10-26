import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-496 (QA retests 26/10, builds 52ee6443 → round 2 FAIL): the customers
// screens' white canvas must read #FFFFFF on EVERY layer of the page ladder
// — html, body, .app-main, .app-body, and both page roots. Round 1 (438e87fb)
// painted only .app-body; round 2's page-scoped :has() block still measured
// sage rgb(227,232,229) on the whole ladder of BOTH routes — the root cause
// was upstream of every override: the GLOBAL tokens --bg and --bg-1 stayed
// sage (#E3E8E5) in styles/tokens.css. The source is white now (owner
// 26/10); the page-scoped :has() block below stays as a belt-and-suspenders
// pin so a future token regression can never repaint this ladder silently.
const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

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
  it('the GLOBAL canvas tokens are white — the sage source is gone (round-2 root cause)', () => {
    // Round 2's lesson: every page-scoped override is worthless while the
    // global token upstream stays sage. These two pins are the regression
    // guard for the actual fix.
    expect(tokens).toMatch(/--bg:\s*#FFFFFF;/);
    expect(tokens).toMatch(/--bg-1:\s*#FFFFFF;/);
    expect(tokens).not.toMatch(/E3E8E5/i);
  });

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

  it('both routes carry the page-root class the :has() ladder keys on (SIL-496 wiring pin)', () => {
    // The ladder is keyed on the page roots: if either page renames its
    // class, every :has() layer above goes inert on that route — the
    // CSS-text pins above cannot catch a rename on the TSX side, so the two
    // wirings are pinned here verbatim.
    const customers = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.tsx'), 'utf8');
    const config = readFileSync(resolve(process.cwd(), 'src/pages/config/CustomersConfigPage.tsx'), 'utf8');
    expect(customers).toMatch(/className="customers-page"/);
    expect(config).toMatch(/className="cfg-page cfg-page--customers"/);
  });
});
