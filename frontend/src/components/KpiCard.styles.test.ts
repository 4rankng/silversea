import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KPI value/unit spacing — "71 người", never "71người".
 *
 * `src/styles/responsive.css` is imported after `src/components/KpiCard.css`
 * (see src/index.css) and restates `.kpi__value` / `.kpi__value-unit` at every
 * breakpoint, so both files are read in that load order and rules nested in a
 * media query are treated as if they applied unconditionally: whatever spacing
 * a rule declares has to survive the narrowest breakpoint too.
 */
const LOAD_ORDER = ['components/KpiCard.css', 'styles/responsive.css'];

/** A gap has to read as a word space, not as a hairline the eye skips. */
const VISIBLE_RELATIVE = 0.25;
const VISIBLE_ABSOLUTE_PX = 4;

/**
 * Every declaration of `prop` from rules whose selector targets `selector`,
 * in load order — the last entry is the winner under the strictest reading.
 */
function declarations(selector: string, prop: string): string[] {
  const found: string[] = [];
  for (const file of LOAD_ORDER) {
    const css = readFileSync(resolve(process.cwd(), 'src', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors.split(',').some((part) => part.trim().endsWith(selector))) continue;
      for (const [, value] of body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'g'))) {
        found.push(value.trim());
      }
    }
  }
  return found;
}

/** `0.3em` / `0.25rem` scale with the metric font; `4px` is the same gap in absolute terms. */
function isVisibleGap(declaration: string): boolean {
  const [, amount, unit] = /^([\d.]+)(em|rem|px)$/.exec(declaration) ?? [];
  if (!amount) return false;
  return unit === 'px' ? Number(amount) >= VISIBLE_ABSOLUTE_PX : Number(amount) >= VISIBLE_RELATIVE;
}

describe('KPI value/unit spacing', () => {
  it('keeps the value and its unit apart at every breakpoint', () => {
    const gapWinner = declarations('.kpi__value', 'gap').at(-1) ?? '';
    const unitMarginWinner = declarations('.kpi__value-unit', 'margin-left').at(-1) ?? '';

    expect(
      [gapWinner, unitMarginWinner].some(isVisibleGap),
      `value/unit spacing (gap "${gapWinner}", unit margin "${unitMarginWinner}") is not visible`,
    ).toBe(true);

    // A flex gap only renders when the value row is a flex container — never
    // let a later rule (or a media query) block it.
    if (isVisibleGap(gapWinner)) {
      expect(declarations('.kpi__value', 'display').at(-1), 'a gap on a non-flex value row never renders').toMatch(
        /^(inline-)?flex$/,
      );
    }
  });

  it('keeps the unit the quieter half of the pair', () => {
    const unitSizes = declarations('.kpi__value-unit', 'font-size');

    expect(unitSizes.length, '.kpi__value-unit declares its own font-size').toBeGreaterThan(0);
    expect(unitSizes).not.toContain('var(--text-metric-size)');
  });
});
