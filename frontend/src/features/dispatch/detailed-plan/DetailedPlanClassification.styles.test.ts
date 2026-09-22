import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

// Card 20260922_27: classification is a value, not a chip — the pill
// (border + full rounding) read as a button and contradicted the workboard
// text convention. Empty/missing values stay plain muted text.
describe('detailed plan classification styling contract', () => {
  it('renders classification as plain text without a pill body', () => {
    const block = css.match(/\.detailed-plan-grid__classification \{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/border-radius\s*:\s*999/);
    expect(block).not.toMatch(/border\s*:\s*1px/);
    expect(block).not.toMatch(/padding\s*:/);
    expect(block).toMatch(/color:\s*var\(--text-secondary/);
  });

  it('keeps the unclassified variant on the same text convention', () => {
    const block = css.match(/\.detailed-plan-grid__classification--unclassified \{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/border/);
    expect(block).toMatch(/color:\s*var\(--text-tertiary/);
  });
});
