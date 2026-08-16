import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.css'), 'utf8');

describe('debt customer-list filter hierarchy', () => {
  it('uses the data card as the sole surface and a divider for its filter toolbar', () => {
    const filterBar = css.match(/\.debt-filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(filterBar).toMatch(/border-bottom:\s*1px solid var\(--line\);/);
    expect(filterBar).not.toMatch(/(?:border-radius|background|box-shadow)\s*:/);
  });

  it('keeps filter controls flat without decorative gradients or default shadows', () => {
    const pill = css.match(/\.debt-filter-bar \.filter-pill\s*\{([^}]*)\}/)?.[1] ?? '';
    const activePill = css.match(/\.debt-filter-bar \.filter-pill\.is-active\s*\{([^}]*)\}/)?.[1] ?? '';
    const search = css.match(/\.debt-filter-search\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(pill).not.toMatch(/(?:linear-gradient|box-shadow\s*:)/);
    expect(activePill).not.toMatch(/(?:linear-gradient|box-shadow\s*:)/);
    expect(search).not.toMatch(/(?:linear-gradient|box-shadow\s*:)/);
  });
});
