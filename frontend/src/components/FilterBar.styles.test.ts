import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');

describe('shared filter bar styling', () => {
  it('uses divider-led layout instead of nesting a card inside list workspaces', () => {
    const filterBar = css.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(filterBar).toMatch(/background:\s*transparent;/);
    expect(filterBar).toMatch(/border-block:\s*1px solid var\(--line\);/);
    expect(filterBar).not.toMatch(/border-radius\s*:/);
    expect(filterBar).not.toMatch(/border:\s*1px/);
  });
});
