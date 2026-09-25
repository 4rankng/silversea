import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep verify-only check on
 * MasterPlanGrid `.master-plan-filters__date-range`. The Từ / Đến
 * inputs sit in `.master-plan-filters__date-inputs`, a 3-track grid
 * (1fr | separator | 1fr) inside the parent 9-col filter grid. The
 * date shortcuts live in `.master-plan-filters__date-actions`, an
 * inline grid row in their own cell — they share one row with the
 * dates so the row never splits into two orphan-strip rows.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/MasterPlanGrid.css'), 'utf8');

describe('MasterPlanGrid date-range regression guard (card 20260925_6 verify)', () => {
  it('the date range is a single grid cell with an internal 3-track row', () => {
    expect(css).toMatch(/\.master-plan-filters__date-range\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.master-plan-filters__date-inputs\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.master-plan-filters__date-inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\);/);
  });

  it('the pair rides the surface — no shadow / no background on the cell', () => {
    const block = css.match(/\.master-plan-filters__date-range\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).not.toMatch(/box-shadow/);
    expect(block).not.toMatch(/background/);
  });

  it('label sits above the inputs (grid-column 1/-1), not floating at the edge', () => {
    expect(css).toMatch(/\.master-plan-filters__date-range > \.master-plan-filters__label\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
  });
});
