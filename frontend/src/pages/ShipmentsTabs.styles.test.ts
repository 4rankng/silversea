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
 * Equal shares then compressed the live Vietnamese labels into overlapping
 * cells; allowing labels to wrap inside those shares made controls taller
 * than the 40px touch ceiling. Content-sized shared boxed cells scroll locally as one row.
 * Every option stays reachable, with the selected cell revealed by the primitive.
 *
 * These pin where the full-row treatment lives and that scroll ownership stays in the shared primitive; pages never
 * add a mask or equal-width cell variant. The measurement that proves it works is the
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
const tabsCss = readFileSync(resolve(process.cwd(), 'src/design-system/Tabs.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

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

  it('places the shared group on a full narrow row without redefining its cells', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).toMatch(/flex:\s*1 1 100%/);
    expect(narrow).toMatch(/\.shipments-control__tabs\s*\{[^}]*width:\s*100%/);
    expect(narrow).not.toMatch(/\.ds-tabs__(?:btn|label|count)/);
    // The primitive owns scrolling; the page never masks or resizes a live tab.
    expect(narrow).not.toMatch(/overflow-x/);
    expect(narrow).not.toMatch(/mask-image/);
  });

  it('never lets a tab cell shrink below its content, at any width', () => {
    expect(tabsCss).toMatch(/\.ds-tabs__btn\s*\{[^}]*flex-shrink:\s*0;/);
    expect(tabsCss).toMatch(/\.ds-tabs\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(tabsCss).toMatch(/\.ds-tabs--boxed\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/);
    expect(tabsCss).toMatch(/\.ds-tabs__label\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipments-control__tabs \.ds-tabs__btn/);
  });

  it('is a plain width rule — no raw hex, no pill radius', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(narrow).not.toMatch(/border-radius:\s*999/);
  });
});
