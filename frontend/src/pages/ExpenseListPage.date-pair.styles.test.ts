import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Card 20260925_6 — site-wide pairing sweep (date Từ/Đến pair on
 * /expenses). The two date inputs used to render as two independent
 * `<label class="expense-filter-bar__field">` cells, each owning its
 * own column with its own label. At ≥1280px viewport the row of
 * controls + the row of two date fields floated up beside the selects
 * as separate panels (one label above each input → two stepped labels,
 * `rect.top` offset >2px between Từ and Đến, label clipping the right
 * edge when the wrap row landed). The fix: the two date inputs are
 * one filter cell — a shared label above + an internal 2-col grid row
 * with a separator, sharing the bar's surface and baseline with the
 * three selects.
 */

const css = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseListPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/ExpenseListPage.tsx'), 'utf8');

describe('ExpenseListPage date-pair / group filter (card 20260925_6)', () => {
  it('the pair is ONE filter cell — single JSX wrapper around both DateInputs', () => {
    // The two <DateInput> nodes live inside ONE pair container, not in
    // two separate `expense-filter-bar__field` cells.
    const pairStart = source.indexOf('className="expense-filter-bar__date-pair"');
    expect(pairStart, 'pair wrapper missing').toBeGreaterThan(0);
    const fromDateIdx = source.indexOf('name="expenseDateFrom"', pairStart);
    const toDateIdx = source.indexOf('name="expenseDateTo"', pairStart);
    expect(fromDateIdx).toBeGreaterThan(pairStart);
    expect(toDateIdx).toBeGreaterThan(fromDateIdx);
    // No two-cell regression — the old per-input label wrappers are gone.
    expect(source).not.toMatch(/<label className="expense-filter-bar__field">\s*<span>Từ ngày<\/span>/);
    expect(source).not.toMatch(/<label className="expense-filter-bar__field">\s*<span>Đến ngày<\/span>/);
  });

  it('the pair participates in the 5-col bar grid as ONE cell', () => {
    // The pair spans exactly two track cells of the bar's repeat(5, 1fr).
    expect(css).toMatch(/\.expense-filter-bar__date-pair\s*\{[^}]*grid-column:\s*span 2;/);
    // The pair itself is grid-template-rows with the label row + inputs row.
    expect(css).toMatch(/\.expense-filter-bar__date-pair\s*\{[^}]*display:\s*grid;/);
  });

  it('the internal row is a 2-col grid with an arrow separator between the inputs', () => {
    // Two inputs share one row, separated by an arrow.
    expect(css).toMatch(/\.expense-filter-bar__date-pair-row\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.expense-filter-bar__date-pair-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\);/);
    // Each input is sized by the grid track, not its intrinsic width.
    expect(css).toMatch(/\.expense-filter-bar__date-pair-row \.expense-filter-bar__date\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    // Separator is rendered with a class we can style / a11y-hide on mobile.
    expect(css).toMatch(/\.expense-filter-bar__date-pair-sep\s*\{[^}]*color:\s*var\(--ink-4\);/);
  });

  it('flat chrome — no white panel, no shadow, no elevated border on the pair', () => {
    // The pair rides the bar surface — no background-color, no box-shadow,
    // no border, no border-radius on the pair shell itself.
    const pairBlock = css.match(/\.expense-filter-bar__date-pair\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(pairBlock).not.toMatch(/background/);
    expect(pairBlock).not.toMatch(/box-shadow/);
    expect(pairBlock).not.toMatch(/border/);
    expect(pairBlock).not.toMatch(/border-radius/);
  });

  it('label is shared and never overflows the cell edge', () => {
    // One label for the pair, not two. nowrap keeps the label on one line
    // and inside its cell.
    expect(css).toMatch(/\.expense-filter-bar__date-pair-label\s*\{[^}]*white-space:\s*nowrap;/);
    // Mobile keeps the label above its row, never flows it past the edge.
    expect(source).toContain('expense-filter-bar__date-pair-label');
  });

  it('phones keep both inputs on one inline row (no stacked 60+60 stack)', () => {
    // The pair owns the full row width on phones (grid-column: 1 / -1) and
    // keeps the two inputs on one row inside its own 2-col grid — only the
    // arrow separator hides to save vertical room.
    expect(css).toMatch(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.expense-list-page \.expense-filter-bar__date-pair\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.expense-list-page \.expense-filter-bar__date-pair-sep\s*\{[^}]*display:\s*none;/);
  });
});
