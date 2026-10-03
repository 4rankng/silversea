import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FilterBar } from './FilterBar';

/**
 * Card 20261002_283 — "the filter toolbar must not change height when a
 * validation error appears".
 *
 * The product change landed before this card did: `FilterBar.css` already
 * carries the ruling verbatim — "Validation is an anchored popover: it never
 * changes toolbar geometry" — and both error surfaces (the search cell and a
 * date field's hint) are absolutely positioned against a `position: relative`
 * host. So the behaviour is right and what was missing was anything holding it
 * there: a future edit could drop the positioning, or add a third error surface
 * that nobody remembered to float, and the bar would silently start growing a
 * row and pushing the table down.
 *
 * The contract is therefore pinned twice: structurally in the DOM (an error
 * never adds a child to the band itself) and in the stylesheet (every error
 * surface shares ONE absolute rule and has a positioned host to anchor to).
 */

const css = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');
const hintCss = readFileSync(resolve(process.cwd(), 'src/design-system/forms/BufferedUuiDateInput.css'), 'utf8');

function renderBar(error?: string) {
  const { container } = render(
    <FilterBar search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm chuyến', error }} />,
  );
  return container;
}

describe('filter bar validation never changes the band geometry (card 20261002_283)', () => {
  it('AC4 — an error adds no child to the band itself, so no row can be added', () => {
    const { container, rerender } = render(
      <FilterBar search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm chuyến' }} />,
    );
    const childrenWithout = container.querySelector('.filter-bar')!.children.length;

    rerender(
      <FilterBar search={{ value: '', onChange: () => {}, placeholder: 'Tìm…', ariaLabel: 'Tìm chuyến', error: 'Ngày không hợp lệ' }} />,
    );
    const childrenWith = container.querySelector('.filter-bar')!.children.length;

    // The alert lives INSIDE the search cell, which is one of the cells the
    // band already had. If this ever changes, the band grows a row.
    expect(childrenWith).toBe(childrenWithout);
  });

  it('AC2 — the error is announced, and linked to the input it belongs to', () => {
    renderBar('Ngày không hợp lệ');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Ngày không hợp lệ');

    const input = screen.getByLabelText('Tìm chuyến');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // `aria-describedby` must actually point at the alert's id, not just exist.
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(alert.id).toBeTruthy();
    expect(describedBy!.split(' ')).toContain(alert.id);
  });

  it('no error, no alert and no invalid state', () => {
    renderBar();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Tìm chuyến').getAttribute('aria-invalid')).toBeNull();
  });

  it('AC1 + AC3 — every error surface shares ONE absolute rule with a danger border', () => {
    // One rule, both surfaces: a new error surface that is not listed here
    // would fall back to normal flow and inflate the toolbar.
    const rule = css.match(/\.filter-bar \.uui-date-hint--error,\s*\.filter-bar__search-error\s*\{([^}]*)\}/);
    expect(rule, 'the anchored-popover rule for both error surfaces is missing from FilterBar.css').toBeTruthy();
    expect(rule![1]).toMatch(/position:\s*absolute/);
    expect(rule![1]).toMatch(/border:[^;]*var\(--danger-text\)/);
    // A popover with no positioned host anchors to the page, not the field.
    expect(rule![1]).toMatch(/z-index:\s*var\(--z-popover\)/);
    expect(css).toMatch(/\.filter-bar \[data-input-wrapper\],\s*\.filter-bar__search-cell \{\s*position:\s*relative;/);
  });

  it('AC1 — a plain (non-error) helper keeps normal flow, so the rule cannot be over-applied', () => {
    // The absolute rule is scoped to `--error`. Widening it to the base hint
    // would float every advisory helper out of its field, so pin that the base
    // class is never given a position inside the band, and that the base rule
    // itself is an ordinary flow declaration.
    expect(css).not.toMatch(/\.filter-bar \.uui-date-hint\s*[,{]/);
    const base = hintCss.match(/\.uui-date-hint \{([^}]*)\}/);
    expect(base, 'the base hint rule moved').toBeTruthy();
    expect(base![1]).not.toMatch(/position:\s*absolute/);
  });
});
