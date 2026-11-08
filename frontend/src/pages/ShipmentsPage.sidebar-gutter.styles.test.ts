import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-749 (owner 08/11) — /shipments workboard padding is SYMMETRIC at the
 * standard page padding on BOTH sides, at every width.
 *
 * Law history: SIL-603 (30/10) rendered the board edge-to-edge (both-side
 * bleed); SIL-615 (31/10) restored the LEFT gutter at ≥1024px for the fixed
 * sidebar rail — which is exactly the asymmetry the owner reported (gap on
 * the left, flush on the right). SIL-749 supersedes both bleed edges: the
 * board sits inside the page's own `padding-inline` (24px default / 20px in
 * the 1024–1280 compact band) with NO negative margin on the worksheet
 * wrapper. The canvas stays uncapped (width 100%, no 1800px ledger cap).
 * The browser-measured proof is the rung driver; these pins stop the rules
 * drifting back.
 */
const rawCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const createCss = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('/shipments symmetric workboard padding (SIL-749)', () => {
  const worksheetRule = css.match(
    /\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet\s*\{([^}]*)\}/,
  )?.[1] ?? '';

  it('the board wrapper carries NO bleed — margin-inline: 0 at every width', () => {
    expect(worksheetRule, 'the worksheet wrapper rule must exist').not.toBe('');
    expect(worksheetRule).toContain('margin-inline: 0');
    expect(worksheetRule).not.toContain('calc(-1 *');
    // No media band reintroduces a margin on the wrapper.
    const bandRules = css.match(
      /@media[^(]*\([^)]*\)[^{]*\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet\s*\{[^}]*\}/g,
    ) ?? [];
    for (const rule of bandRules) {
      expect(rule).not.toMatch(/margin(-(left|right)|-inline):\s*(?!0)[^\s;]/);
    }
  });

  it('the page re-owns the shared shell gutter and keeps the uncapped canvas', () => {
    const pageRule = css.match(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pageRule, 'the worksheet page rule must exist').not.toBe('');
    expect(pageRule).toContain('padding-inline: max(var(--app-body-pad-x)');
    expect(pageRule).toContain('max-width: none');
    expect(pageRule).toContain('margin-inline: 0');
  });

  it('the shell-gutter drop stays scoped to this page — every sibling keeps its gutter', () => {
    // The :has rule zeroes .app-body's inline padding ONLY under a
    // .shipments-page--worksheet child; an unscoped `.app-body` padding
    // kill would break every other page (and the SIL-612 form breakout
    // doctrine depends on that scoping).
    expect(css).toMatch(/\.app-main:not\(\.driver-mode\) \.app-body:has\(> \.shipments-page--worksheet\)\s*\{\s*padding-inline:\s*0;\s*\}/);
    expect(css).not.toMatch(/(^|\})\s*\.app-body\s*\{[^}]*padding-inline:\s*0/);
  });

  it('SIL-612 non-regression: the create-shipment breakout stays page-local and untouched', () => {
    // The Thông tin hàng table's edge-to-edge breakout lives in the create
    // page's own sheet (`.csc-container-table-scroll`) and must keep its
    // own geometry; the /shipments padding law may not reach into it.
    expect(createCss).toMatch(/\.csc-container-table-scroll\s*\{[^}]*margin-inline:\s*-14px;[^}]*width:\s*calc\(100% \+ 28px\)/);
    // …and the /shipments sheet never grew create-page selectors.
    expect(css).not.toContain('.csc');
  });
});
