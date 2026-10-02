import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/salary-attendance/calendar.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/salary-attendance/salary-attendance-components.tsx'), 'utf8');

/**
 * Salary-calendar trip chip: the code is a scannable identifier — it never
 * wraps mid-code. Overflow gets an ellipsis; the span's title carries the
 * full code (plus route) for hover.
 */
describe('salary calendar trip chip contract', () => {
  it('keeps the trip code on one line with an ellipsis overflow', () => {
    const start = css.indexOf('.cal-cell-trip-code');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(css.indexOf('{', start), css.indexOf('}', start));
    expect(block).toContain('white-space: nowrap');
    expect(block).toContain('text-overflow: ellipsis');
    expect(block).not.toMatch(/white-space:\s*normal/);
    expect(block).not.toContain('overflow-wrap');
  });

  it('tooltip carries the full code, not only the route', () => {
    expect(tsx).toMatch(/cal-cell-trip-code" title=\{workDay\.trip\.tripCode \+/);
  });
});
