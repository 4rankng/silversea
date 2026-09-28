import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The /shipments status tab strip.
 *
 * The strip once took a full row at EVERY width under 1024px while its content
 * is a constant 429px, so at 1024 a 429px group stretched across a 921px
 * container. Narrower still, it became a horizontally SCROLLING strip and a
 * trailing `mask-image` advertised the overflow.
 *
 * The scroll was then removed. Four cells of ~429px in a 370px strip means the
 * last tab is ALWAYS sliced mid-word, and the mask faded that live, clickable
 * tab's text — a real control reading as a disabled one. The reference for a
 * fixed set of 2-4 tabs is explicit: `a-c-tabs-07` "Pills Justified", evenly
 * distributed to fill the container, every option visible. So the narrow band
 * now JUSTIFIES the four cells instead of scrolling them.
 *
 * These pin where the full-row treatment lives and that the strip never
 * scrolls or masks again. The measurement that proves it works is the
 * design-lock run; this test is what stops the rule drifting back up the
 * breakpoint range.
 */
const rawCss = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

/**
 * Comments are stripped before matching. These rules DISCUSS the properties
 * they no longer declare ("this replaces a scrolling strip … mask-image"), and
 * a test that greps raw text then fails on its own explanation of the change.
 * A stylesheet contract is about declarations.
 */
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of one `@media` block, by its condition. */
const mediaBlock = (condition: string): string => {
  const start = css.indexOf(`@media (${condition})`);
  if (start === -1) return '';
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  return '';
};

describe('/shipments status tab strip', () => {
  it('keeps the full-row treatment out of the wide band where the group fits inline', () => {
    const wide = mediaBlock('max-width: 1024px');
    expect(wide).not.toBe('');
    // `flex: 1 1 100%` is what stretched 429px of tabs across 921px of row.
    expect(wide).not.toMatch(/flex:\s*1 1 100%/);
    // The mask fades the trailing edge to advertise overflow. Applying it where
    // there is no overflow fades EMPTY SPACE, which is what read as a phantom
    // cell — so it belongs only to the scrolling band.
    expect(wide).not.toMatch(/mask-image/);
  });

  it('justifies the four cells in the narrow band instead of scrolling them', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).toMatch(/flex:\s*1 1 100%/);
    // Equal shares of the row — the `a-c-tabs-07` reference for 2-4 tabs.
    expect(narrow).toMatch(/\.ds-tabs__btn\s*\{[^}]*flex:\s*1 1 0;/);
    // A long label wraps INSIDE its own cell (§4 no-truncation) rather than
    // being cut by the container edge.
    expect(narrow).toMatch(/\.ds-tabs__btn\s*\{[^}]*min-width:\s*0;/);
    // No scroll and no mask: either one puts a live tab half off-screen.
    expect(narrow).not.toMatch(/overflow-x/);
    expect(narrow).not.toMatch(/mask-image/);
  });

  it('never lets a tab cell shrink below its content, at any width', () => {
    // Card 20260928_160: compressing the cells clipped every count numeral
    // inside its own cell. In the wide band the cells keep their own width; in
    // the narrow band they take an equal share wide enough to hold the numeral.
    const wide = mediaBlock('max-width: 1024px');
    expect(wide).toMatch(/\.shipments-control__tabs \.ds-tabs__btn\s*\{[^}]*flex:\s*0 0 auto;/);
  });

  it('is a plain width rule — no raw hex, no pill radius', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(narrow).not.toMatch(/border-radius:\s*999/);
  });
});
