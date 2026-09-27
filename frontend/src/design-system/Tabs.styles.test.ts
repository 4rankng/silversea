import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/design-system/Tabs.css'), 'utf8');

describe('shared tabs selection styling', () => {
  it('uses an edge and border for a plain selected tab instead of a semantic colour wash', () => {
    const activePlainTab = css.match(/\.ds-tabs--plain \.ds-tabs__btn--active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(activePlainTab).toMatch(/background:\s*transparent;/);
    expect(activePlainTab).toMatch(/border-color:\s*var\(--line-2\);/);
    expect(activePlainTab).toMatch(/box-shadow:\s*inset 0 -2px 0 var\(--ink\);/);
    expect(activePlainTab).not.toMatch(/accent-soft|brand-primary/);
  });

  // Operator ruling 2026-09-27 ("this is our existing working button group and
  // I like it, please use this consistently globally"): the fleet-vehicle
  // status group is the reference, and this variant is its one implementation.
  it('boxed is the canonical button group: hairline container, flat active pill, plain count numerals', () => {
    const boxed = css.match(/\.ds-tabs--boxed\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(boxed).toMatch(/background:\s*var\(--surface-2/);
    expect(boxed).toMatch(/border:\s*1px solid var\(--line\);/);
    expect(boxed).toMatch(/border-radius:\s*8px;/);
    expect(boxed).toMatch(/padding:\s*2px;/);
    // Content-sized: a group in a grid/flex cell must hug its cells.
    expect(boxed).toMatch(/width:\s*fit-content;/);

    const active = css.match(/\.ds-tabs--boxed \.ds-tabs__btn--active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(active).toMatch(/background:\s*var\(--surface\);/);
    expect(active).toMatch(/outline:\s*1px solid var\(--line-2/);
    expect(active).not.toMatch(/box-shadow:\s*var\(--sh/);

    // The count is a bare tone-coloured numeral — a pill would restart the
    // look the operator replaced.
    const count = css.match(/^\.ds-tabs__count\s*\{([\s\S]*?)\n\}/m)?.[1] ?? '';
    expect(count).not.toMatch(/border-radius|background:/);
    // The bundled font is proportional (see styles/font-family-contract.test.ts):
    // a tabular-numerals declaration here is a banned no-op.
    expect(count).not.toMatch(/font-variant-numeric/);
    expect(css).toMatch(/\.ds-tabs__count--accent \{\s*color:\s*var\(--accent/);
    expect(css).toMatch(/\.ds-tabs__count--warning \{\s*color:\s*var\(--warning/);
  });

  it('uses neutral ink for bordered tab selection', () => {
    const activeBorderedTab = css.match(/\.ds-tabs--bordered \.ds-tabs__btn--active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(activeBorderedTab).toContain('color: var(--ink);');
    expect(activeBorderedTab).toContain('border-bottom-color: var(--ink);');
    expect(activeBorderedTab).not.toMatch(/accent|brand/);
  });
});
