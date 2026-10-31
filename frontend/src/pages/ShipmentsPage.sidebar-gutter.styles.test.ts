import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-615 (id 719, owner 31/10): on /shipments the workboard touched the
 * sidebar with a 0px gap — the SIL-603 edge-to-edge bleed pulled the board
 * left past the page's own gutter, and at ≥1024px the content column's left
 * edge IS the sidebar's right edge (app-shell.css `.app` grid column 1).
 *
 * The law after the fix (amending the SIL-603 lane's left edge on the
 * desktop band only): <1024px keeps the original both-side bleed (the
 * sidebar is a slide-in overlay drawer there — responsive.css ≤1023px band —
 * so there is no fixed rail to gap from and the mobile layout is unchanged);
 * ≥1024px restores the LEFT shell gutter (`margin-left: 0`, so the board
 * sits on the page's own `padding-inline`, 24px/20px ≥ the ~12–16px
 * minimum) while the RIGHT edge keeps the full bleed at every width. The
 * browser-measured proof is the rung driver; these pins stop the rules
 * drifting back.
 */
const rawCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const createCss = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const mediaBlock = (source: string, condition: string): string => {
  const start = source.indexOf(`@media (${condition})`);
  if (start === -1) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
};

/** Every `@media (<condition>)` body — the file legitimately splits the
 * desktop band across several blocks (column floors, row heights, header
 * actions), so the gutter override may live in any of them. */
const mediaBlocks = (source: string, condition: string): string[] => {
  const blocks: string[] = [];
  let rest = source;
  for (let block = mediaBlock(rest, condition); block; block = mediaBlock(rest, condition)) {
    blocks.push(block);
    rest = rest.slice(rest.indexOf(block) + block.length);
  }
  return blocks;
};

const WORKSHEET_RULE_RE =
  /\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet[^{]*\{[^}]*\}/g;

const desktopOverrides = (): string[] => {
  const found: string[] = [];
  for (const block of mediaBlocks(css, 'min-width: 1024px')) {
    for (const match of block.matchAll(WORKSHEET_RULE_RE)) found.push(match[0]);
  }
  return found;
};

describe('/shipments sidebar gutter (SIL-615)', () => {
  it('restores the left shell gutter on the desktop band (≥1024px, sidebar is a fixed grid column)', () => {
    const override = desktopOverrides().find((rule) => rule.includes('margin-left: 0'));
    expect(override, 'a min-width:1024px block must set margin-left: 0 on the worksheet bleed rule').toBeTruthy();
  });

  it('keeps the original both-side bleed below the desktop band (mobile/tablet layout unchanged)', () => {
    const baseRule = css.match(
      /\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(baseRule, 'the base worksheet bleed rule must exist').not.toBe('');
    expect(baseRule).toContain('margin-inline: calc(-1 * max(var(--app-body-pad-x)');
    expect(baseRule).toContain('env(safe-area-inset-left, 0px)');
    expect(baseRule).toContain('env(safe-area-inset-right, 0px)');
  });

  it('places the ≥1024px override AFTER the base bleed rule it amends (cascade order)', () => {
    // Same selector + equal specificity: `margin-left: 0` wins over the
    // `margin-inline` shorthand per-property only by source order (a media
    // query adds no specificity), so the block must sit after the base.
    const baseIndex = css.search(
      /\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet\s*\{[^}]*margin-inline/,
    );
    expect(baseIndex, 'base bleed rule exists').toBeGreaterThan(-1);
    const overrideBlock = mediaBlocks(css, 'min-width: 1024px').find((block) =>
      /\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet \.cus-workspace--worksheet[^{]*\{[^}]*margin-left:\s*0;/.test(block),
    );
    expect(overrideBlock, 'override block exists').toBeTruthy();
    expect(css.indexOf(overrideBlock!)).toBeGreaterThan(baseIndex);
  });

  it('the right edge keeps the full bleed — the override touches the left side only', () => {
    const override = desktopOverrides().find((rule) => rule.includes('margin-left: 0'));
    expect(override).toBeTruthy();
    expect(override!).not.toMatch(/margin-right/);
    expect(override!).not.toMatch(/margin-inline/);
  });

  it('the gutter the board rides is the shared shell token, never a private number', () => {
    // The worksheet page rule re-owns the shell gutter the :has rule drops;
    // margin-left: 0 parks the board on that padding — 24px default / 20px
    // in the 1024–1280 compact band, both above the ~12–16px minimum.
    const pageRule = css.match(/\.app-main:not\(\.driver-mode\) \.app-body > \.shipments-page--worksheet\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pageRule, 'the worksheet page rule must exist').not.toBe('');
    expect(pageRule).toContain('padding-inline: max(var(--app-body-pad-x)');
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
    // own geometry; the /shipments gutter fix may not reach into it.
    expect(createCss).toMatch(/\.csc-container-table-scroll\s*\{[^}]*margin-inline:\s*-14px;[^}]*width:\s*calc\(100% \+ 28px\)/);
    // …and the /shipments sheet never grew create-page selectors.
    expect(css).not.toContain('.csc');
  });
});
