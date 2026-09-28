import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260928_196 — the /shipments status tab strip.
 *
 * The strip used to take a full row at EVERY width under 1024px, while its
 * content is a constant 429px. At 1024 that stretched a 429px group across a
 * 921px container, and the trailing-edge `mask-image` (a "there is more this
 * way" affordance) faded the empty remainder — so the control plane appeared to
 * end in a broken, empty fifth tab cell.
 *
 * These pin where the full-row treatment lives. The measurement that proves it
 * works is the design-lock run; this test is what stops the rule drifting back
 * up the breakpoint range.
 */
const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

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

  it('gives the full row, the scroll and the mask to the narrow band only', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).toMatch(/flex:\s*1 1 100%/);
    expect(narrow).toMatch(/overflow-x:\s*auto/);
    expect(narrow).toMatch(/mask-image/);
  });

  it('never lets a tab cell shrink, at any width', () => {
    // Card 20260928_160: compressing the cells clipped every count numeral
    // inside its own cell. The strip scrolls; each cell keeps its width.
    const wide = mediaBlock('max-width: 1024px');
    expect(wide).toMatch(/\.shipments-control__tabs \.ds-tabs__btn\s*\{[^}]*flex:\s*0 0 auto;/);
  });

  it('is a plain width rule — no raw hex, no pill radius', () => {
    const narrow = mediaBlock('max-width: 815px');
    expect(narrow).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(narrow).not.toMatch(/border-radius:\s*999/);
  });
});
