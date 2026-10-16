import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MOBFOOT-1016 (owner phone report 2026-10-16, issue #8): on the phone band
 * `/shipments` painted a solid empty grey band below the last lot card — the
 * shell's ≤640 trailing clearance (responsive.css `.app-body` padding) painted
 * in page tone under the worksheet's white pagination, plus iOS
 * dynamic-viewport growth the inner scroller does not re-absorb. It read as a
 * stray footer.
 *
 * The law after the fix (amending the 2026-10-09 "counted-once trailing band"
 * ruling): on this page the terminal worksheet block owns the bottom edge —
 * the shell band is scoped out for `.shipments-page` only, and the safe-area
 * clearance lives INSIDE the pagination surface. The browser-measured proof is
 * the rung driver; these pins stop the rules drifting back.
 */
const rawCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

/** Every `@media (<condition>)` body — the phone tier legitimately splits
 * across blocks (the page-root rule keeps its own block so the fill-contract
 * test's first-match extraction stays stable). */
const mediaBlocks = (source: string, condition: string): string[] => {
  const blocks: string[] = [];
  let rest = source;
  for (let block = mediaBlock(rest, condition); block; block = mediaBlock(rest, condition)) {
    blocks.push(block);
    rest = rest.slice(rest.indexOf(block) + block.length);
  }
  return blocks;
};

const phoneBlocks = mediaBlocks(css, 'max-width: 640px');
const phone = phoneBlocks.join('\n');

describe('/shipments phone trailing band (MOBFOOT-1016)', () => {
  it('scopes the shell trailing clearance off this page in the phone band', () => {
    // The shell band stays the shell's own rule (see the responsive.css pin
    // below); this page opts its scrollport out via the 2026-10-09 law's
    // own-surface clause (the `.csc-page` pattern) — and only while the
    // worksheet's pagination is mounted, so empty/loading states keep the
    // standard shell band like every sibling page.
    expect(phone).toMatch(
      /\.app-main:not\(\.driver-mode\) \.app-body:has\(> \.shipments-page \.cus-dashboard-viewport > \.ds-pagination\)\s*\{\s*padding-bottom:\s*0;\s*\}/,
    );
  });

  it('carries the safe-area clearance inside the terminal pagination surface', () => {
    // The pagination is the terminal block of the populated worksheet; its
    // own surface paints through the clearance instead of page tone.
    expect(phone).toMatch(
      /\.cus-dashboard-viewport > \.ds-pagination\s*\{\s*padding-bottom:\s*calc\(12px \+ max\(0px, env\(safe-area-inset-bottom, 0px\)\)\);\s*\}/,
    );
  });

  it('places the clearance override AFTER the base rule it amends (cascade order)', () => {
    // Same selector + same specificity: a media query adds none, so source
    // order decides. The base `padding: 12px` shorthand sits later in the
    // file than the ≤640 block once — which silently killed the env() term
    // (the dead-rule defect the independent review caught). The ≤640
    // override must come after the base rule.
    const phoneBlockIndex = css.indexOf('@media (max-width: 640px)');
    const baseRule = css.match(/\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*padding:\s*12px;[^}]*\}/);
    expect(baseRule, 'base pagination rule with padding: 12px exists').not.toBeNull();
    expect(phoneBlockIndex).toBeGreaterThan(-1);
    // The FIRST ≤640 block carrying the pagination override (this file also
    // has an unrelated early ≤640 block for the page root).
    const override = phone.match(/\.cus-dashboard-viewport > \.ds-pagination\s*\{[^}]*env\(safe-area-inset-bottom/);
    expect(override).not.toBeNull();
    const overrideIndex = css.indexOf(override![0]);
    const baseIndex = css.indexOf(baseRule![0]);
    expect(overrideIndex).toBeGreaterThan(baseIndex);
  });

  it('counts the trailing band once — the page never re-adds its own phone padding', () => {
    expect(phone).toMatch(/\.shipments-page\s*\{\s*padding-bottom:\s*0;\s*\}/);
    const pageRules = phone.match(/\.shipments-page\s*\{[^}]*\}/g) ?? [];
    for (const rule of pageRules) {
      expect(rule).not.toMatch(/padding-bottom:\s*(?!0)[0-9]/);
    }
  });

  it('keeps the shell band intact for every other page', () => {
    // The fix must not bleed into the shared rule: `.app-body` still carries
    // the phone clearance for pages that did not opt out.
    const shellPhone = mediaBlocks(responsiveCss, 'max-width: 640px').join('\n');
    expect(shellPhone).toMatch(/\.app-body, \.content\s*\{[^}]*max\(16px, env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it('does not resurrect the 20261004_327 viewport-locked fill class', () => {
    // `min-height: 100dvh` on the page measured as a 130–180px scrollable
    // void below the last card at phone sizes — the fill stays
    // scrollport-relative (`100%`), never viewport-locked.
    expect(css).not.toMatch(/\.shipments-page\s*\{[^}]*min-height:\s*100d[vh]/);
    expect(css).not.toMatch(/\.shipments-page\s*\{[^}]*height:\s*100d[vh]/);
  });
});
