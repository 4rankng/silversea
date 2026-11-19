import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/salary-attendance/calendar.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/salary-attendance/salary-attendance-components.tsx'), 'utf8');

/**
 * Salary-calendar trip chip (REWRITTEN by card 20261004_338 — the old pin
 * froze the banned truncate+tooltip idiom: ellipsis overflow on the code with
 * a title crutch carrying the full code+route. Law book §4 no-truncation
 * doctrine, card 20260922_37: the trip code is a DATA VALUE and must display
 * in full at every cell width — it wraps (at its hyphens, or via the house
 * emergency break for hyphen-less codes), never ellipsizes, and carries no
 * title tooltip. The cell row may grow taller than square where a code wraps
 * ("wrap hoặc column giãn" per the card) — the 7-column grid sources are
 * untouched. */
describe('salary calendar trip chip contract', () => {
  const rule = (source: string, selector: string): string => {
    const found = source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`))?.[1];
    expect(found, `${selector} rule exists`).toBeTruthy();
    return found!;
  };

  it('the trip code wraps in full; every truncation idiom is gone', () => {
    const body = rule(css, '.cal-cell-trip-code');
    expect(body).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/-webkit-line-clamp/);
    expect(body).not.toMatch(/white-space:\s*nowrap/);
    expect(body).toMatch(/white-space:\s*normal/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('the chip renders its full code with no title crutch', () => {
    const span = tsx.match(/<span className="cal-cell-trip-code"[\s\S]*?<\/span>/)?.[0];
    expect(span, 'the trip-code span still renders').toBeTruthy();
    expect(span!).not.toMatch(/<span[^>]*\btitle=/);
    expect(span!).toContain('{workDay.trip.tripCode}');
    expect(span!).not.toMatch(/slice|substring|truncate|ellipsis/i);
  });
});

/**
 * Ticket 18/11 Task 3.5c — the day cell itself must grow with a wrapped trip
 * code: the fixed square (aspect-ratio: 1) plus overflow: hidden clipped the
 * wrapped codes card 20261004_338 requires to display in full. The cell now
 * rests on a min-height and its grid row stretches to the tallest cell.
 */
describe('salary calendar day-cell growth contract (ticket 18/11 Task 3.5c)', () => {
  const responsive = readFileSync(resolve(process.cwd(), 'src/pages/salary-attendance/responsive.css'), 'utf8');

  it('the day cell rests on min-height; no fixed square, no clipping', () => {
    // `rule` above is scoped to the chip describe — extract the block here.
    const body = css.match(/\.cal-cell\s*\{([^}]*)\}/)?.[1];
    expect(body, '.cal-cell rule exists').toBeTruthy();
    expect(body).toMatch(/min-height:/);
    expect(body).not.toMatch(/aspect-ratio/);
    expect(body).not.toMatch(/overflow:\s*hidden/);
  });

  it('no responsive override reintroduces the square or a clip on day cells', () => {
    const blocks = responsive.match(/\.cal-cell\s*\{[^}]*\}/g) ?? [];
    expect(blocks.length, 'the responsive sheet still tightens .cal-cell').toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/aspect-ratio/);
      expect(block).not.toMatch(/overflow:\s*hidden/);
      expect(block).toMatch(/min-height:/);
    }
  });
});
