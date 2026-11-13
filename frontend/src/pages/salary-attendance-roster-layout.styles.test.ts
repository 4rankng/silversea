import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

/* SIL-809 (id 937, UAT 12/11) — màn Lương & Chấm công (Kế toán):
 * the roster wrapper still carried the dead card-wall track grid, dropping
 * the single DriverPayrollTable child into one ~140px auto-fill column —
 * narrow left strip + dead whitespace right, calendar pushed below the
 * stretched roster.
 *
 * @media behavior isn't reliably testable through jsdom, so this asserts on
 * the raw CSS text — same pattern as driver-density.styles.test.ts.
 */
describe('SIL-809 — salary attendance roster/layout contract', () => {
  const hero = read('src/pages/salary-attendance/hero-metrics.css');
  const responsive = read('src/pages/salary-attendance/responsive.css');
  const calendar = read('src/pages/salary-attendance/calendar.css');

  it('desktop roster wrapper is a block, not the card-wall track grid', () => {
    const base = hero.slice(
      hero.indexOf('.salary-page .driver-select-row__list'),
      hero.indexOf('/* ── Responsive: hero + metrics'),
    );
    expect(base).toMatch(/display:\s*block/);
    expect(base).not.toMatch(/grid-template-columns/);
    expect(base).not.toMatch(/display:\s*grid/);
    expect(base).not.toMatch(/display:\s*flex/);
  });

  it('tablet roster wrapper is a full-width block, no bounded 280px card strip', () => {
    const tabletBlock = responsive.slice(
      responsive.indexOf('.salary-page .driver-select-row__list'),
    );
    expect(tabletBlock).toMatch(/display:\s*block/);
    expect(tabletBlock).not.toMatch(/max-height:\s*280px/);
    expect(tabletBlock).not.toMatch(/grid-template-columns:\s*repeat\(2/);
    expect(tabletBlock).not.toMatch(/overflow-y:\s*auto/);
  });

  it('layout columns are fluid inside the shell canvas, no hard 1180px cap', () => {
    expect(calendar).toMatch(/\.salary-page-layout\.has-selected\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*320px/s);
    const baseBlock = calendar.slice(
      calendar.indexOf('.salary-page-layout {'),
      calendar.indexOf('@media (min-width: 1025px)'),
    );
    expect(baseBlock).not.toMatch(/max-width/);
  });
});
