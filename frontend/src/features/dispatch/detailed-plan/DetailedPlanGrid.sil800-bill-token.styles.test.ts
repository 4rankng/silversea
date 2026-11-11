// SIL-800 — the Bill/Booking identifier line never breaks mid-token.
// EGLV260100019409 rendered as "EGLV26010001940"/"9" because the shared
// `.detailed-plan-grid__line` wrap law (overflow-wrap: anywhere) split the
// unbreakable code at the column edge. The owner ruling for this cell is
// nowrap + ellipsis + tooltip: one unbroken token, an honest "…" at the cut,
// the full value in the JSX title. Prose lines keep the wrap law untouched.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');

describe('DetailedPlanGrid bill identifier line (SIL-800)', () => {
  const billRule = css.match(/\.detailed-plan-grid__route-bill\s*\{([^}]*)\}/)?.[1] ?? '';

  it('the bill line overrides the wrap-anywhere law with the nowrap+ellipsis+tooltip trio', () => {
    expect(billRule, 'the bill-line rule must exist').not.toBe('');
    expect(billRule).toContain('white-space: nowrap');
    expect(billRule).toContain('overflow: hidden');
    expect(billRule).toContain('text-overflow: ellipsis');
    // The pressure valve that splits identifiers is off for this line.
    expect(billRule).toContain('overflow-wrap: normal');
    expect(billRule).toContain('word-break: normal');
  });

  it('the shared value-line wrap law still governs prose (the override is scoped, not global)', () => {
    const lineRule = css.match(/\.detailed-plan-grid__line,\s*\n\s*\.detailed-plan-grid \.ops-schedule__datetime\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(lineRule).toContain('overflow-wrap: anywhere');
  });
});
