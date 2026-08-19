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

  it('uses neutral ink for bordered tab selection', () => {
    const activeBorderedTab = css.match(/\.ds-tabs--bordered \.ds-tabs__btn--active\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(activeBorderedTab).toContain('color: var(--ink);');
    expect(activeBorderedTab).toContain('border-bottom-color: var(--ink);');
    expect(activeBorderedTab).not.toMatch(/accent|brand/);
  });
});
