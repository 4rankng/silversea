// Card 071026141600 — the CSS half of the by-construction guarantee
// (NumericUnit.test.tsx pins the DOM half). A percent/count token is ONE text
// node inside ONE nowrap unit; the unit must therefore refuse every soft-wrap
// opportunity AND every clip — the numeric law of
// numeric-identity.styles.test.ts applied to the fleet-productivity screen.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/FleetProductivityPage.css'), 'utf8');

describe('fleet-productivity numeric units never wrap mid-token (card 071026141600)', () => {
  it('every numeric-token surface is a nowrap unit without any clip', () => {
    const rule = css.match(
      /\.fleet-badge,\s*\.fleet-pct,\s*\.fleet-num-unit,\s*\.fleet-kpi-card__value\s*\{([^}]*)\}/,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    // Numeric law: the unit EXPANDS into the table's horizontal scroll — it
    // never ellipsizes, clips or maxes out (law book §11).
    expect(rule).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
  });

  it('header labels expand to their full text — nowrap on th keeps in-cell truncation impossible', () => {
    const th = css.match(/\.fleet-productivity-table th\s*\{([^}]*)\}/)?.[1];
    expect(th).toBeDefined();
    expect(th).toMatch(/white-space:\s*nowrap/);
  });

  it('no rule may un-wrap a numeric unit', () => {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1];
      const body = match[2];
      if (!selector.includes('.fleet-num-unit')) continue;
      if (/white-space:/.test(body) && !/white-space:\s*nowrap/.test(body)) {
        throw new Error(`rule un-wraps .fleet-num-unit: ${selector.trim()} { ${body.trim()} }`);
      }
    }
  });
});
