import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Card 20260926_5 (content-shaped grid, Chief 09:34): the mobile record card
// never renders a lone '—' slot. The Nâng/Trả port pair pairs 2-up ONLY when
// both sides have values; an empty side is hidden and the populated side
// spans the full row. The component must emit the data-empty signal; the
// narrow-container CSS must act on it.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('trip-card content-shaped pair logic (card 20260926_5)', () => {
  it('component emits data-empty on both port cells', () => {
    const src = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    const lift = src.match(/cell--ports" data-label="Nâng hàng"([^>]*)>/);
    const drop = src.match(/cell--ports" data-label="Trả hàng"([^>]*)>/);
    expect(lift?.[1] ?? '').toContain('data-empty');
    expect(drop?.[1] ?? '').toContain('data-empty');
  });

  it('container CSS hides empty ports and full-spans the survivor', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.detailed-plan-grid__cell--ports\[data-empty='true'\]\s*\{\s*display:\s*none/);
    expect(css).toMatch(/:has\(\.detailed-plan-grid__cell--ports\[data-empty='true'\]\)[^{]*\.detailed-plan-grid__cell--ports:not\(\[data-empty='true'\]\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});
