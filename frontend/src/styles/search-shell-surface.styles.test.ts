import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260926_7 (Director law line 26/09): search shells (header + per-page)
// follow the control-surface law — opaque surface token, no tint/canvas
// transparency. QA cut #10 measured rgb(237,241,238) (--surface-2) on every
// ListFilterBar host: the shell's `var(--control-bg, var(--surface-2))`
// fallback always fired because --control-bg was never defined.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('search shells follow the control-surface law (card 20260926_7)', () => {
  it('filter-bar search shell fills opaque with var(--surface), never the tint', () => {
    const css = read('src/components/FilterBar.css');
    const rule = css.match(/\.filter-bar__search\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface)');
    expect(rule).not.toContain('--surface-2');
    expect(rule).not.toContain('--control-bg');
  });
});
