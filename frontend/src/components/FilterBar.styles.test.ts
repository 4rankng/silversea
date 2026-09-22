import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');

describe('shared filter bar styling', () => {
  it('stays flat chrome — no card, no divider bands (case QA-2026-09-22-02)', () => {
    // Operator 2026-09-22: the border-block bands + 12px padding + 20px margin
    // read as unfinished scaffolding around the search field. The nepocorp
    // reference bar is borderless (gap rhythm + 16px margin carry separation).
    // Still not a card: no radius, no border.
    const filterBar = css.match(/\.filter-bar\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(filterBar).toMatch(/background:\s*transparent;/);
    expect(filterBar).toMatch(/border:\s*0;/);
    expect(filterBar).not.toMatch(/border-block/);
    expect(filterBar).not.toMatch(/border-radius\s*:/);
    expect(filterBar).not.toMatch(/border:\s*1px/);
  });

  it('keeps count badges rectangular — the §1 pill ban pins this file (card _48)', () => {
    // Review round 20260922_38 nit T2: the quick-filter count badge was a
    // 999px pill. The fix (0d51e334) made it a small-radius rectangle; this
    // pin keeps it that way.
    expect(css).not.toContain('999px');
    const count = css.match(/\.filter-pill__count\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(count).toContain('border-radius: 4px');
  });
});
