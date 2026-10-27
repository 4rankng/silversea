import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-523 (owner 27/10): the sage #E3E8E5 page canvas is GLOBAL again,
// reversing the SIL-496 white ruling (that ticket is canceled). The
// customers routes are the reference screens: html/body/.app-main/.app-body
// read the global tokens with NO page-scoped canvas override, and the
// content card stays white on --surface. Both failure directions this file
// guards against already happened once each: a page-local :has() ladder
// silently lost to the global token upstream (SIL-496 round 2), and the
// global white flip of SIL-496 silently undid the owner sage ruling
// (SIL-523 reverses it back). Token source and page-local absence are
// pinned separately so neither can regress silently.
const css = readFileSync(resolve(process.cwd(), 'src/pages/CustomersPage.css'), 'utf8');
const tokens = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

describe('customers screens sit on the global sage canvas (SIL-523)', () => {
  it('the GLOBAL canvas tokens are sage and the card surface stays white', () => {
    expect(tokens).toMatch(/--bg:\s*#E3E8E5;/);
    expect(tokens).toMatch(/--bg-1:\s*#E3E8E5;/);
    expect(tokens).toMatch(/--surface:\s*#FFFFFF;/);
  });

  it('CustomersPage.css carries no page-canvas white override', () => {
    // The SIL-496 :has() ladder and the .cfg-page--customers white root were
    // canvas paints over html/body/.app-main/.app-body and the page root —
    // under a global sage token they pin both routes white again. Gone, and
    // they must not come back: the card surface is the only white this file
    // paints.
    expect(css).not.toMatch(/html:has\(\.customers-page\)/);
    expect(css).not.toMatch(/body:has\(\.customers-page\)/);
    expect(css).not.toMatch(/\.cfg-page--customers\s*\{[^}]*background/);
  });

  it('the content card keeps its white --surface with hairline edge', () => {
    expect(css).toMatch(/\.customers-page\s*\{[^}]*background:\s*var\(--surface\)/);
  });
});
