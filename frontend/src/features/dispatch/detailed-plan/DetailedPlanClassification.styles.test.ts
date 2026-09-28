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
    // The workboard text convention rides the fg ramp: a saved value is
    // `--fg-2` (body ink), never a chip/border. Contrast intent unchanged —
    // the classification value must stay readable as text, not a badge.
    expect(block).toMatch(/color:\s*var\(--fg-2\);/);
  });

  it('keeps the unclassified variant on the same text convention', () => {
    const block = css.match(/\.detailed-plan-grid__classification--unclassified \{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/border/);
    // Unclassified is one step down the same ramp (`--fg-3`, the muted ink
    // tier) — still plain text, still WCAG-passing against white.
    expect(block).toMatch(/color:\s*var\(--fg-3\);/);
  });
});
