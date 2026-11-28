/**
 * UX-01 + UX-02 + UX-06 (date half) — staging UI audit 2026-11-27, source
 * pins on the Ghép bộ Debit page css and the mobile card list css (the
 * house styles-test idiom: readFileSync + rule-body regex, per
 * DriverTripDetailPage.styles.test.ts).
 *
 * UX-01 — one desktop toolbar row (36px single-line controls), the ≤1023px
 *   'Bộ lọc' disclosure with the active count, phone touch floors.
 * UX-02 — ≤767px the grid pane + pager hide, the card list shows.
 *   (The UX-06 date-segment font-size override is gone: shared control
 *   density owns every UUI field dimension — control-density.styles.test.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/DebitMergePage.css'), 'utf8');
const listCss = readFileSync(resolve(process.cwd(), 'src/features/accounting/DebitMergeMobileList.css'), 'utf8');

describe('DebitMergePage — UX-01 filter toolbar (styles)', () => {
  it('desktop: the secondary panel joins the row via display:contents and the toggle is hidden', () => {
    expect(css).toMatch(/\.debit-merge-filterbar__panel\s*\{\s*display:\s*contents;/);
    expect(css).toMatch(/\.debit-merge-filterbar__toggle\s*\{\s*display:\s*none;/);
  });

  it('desktop: every toolbar control shares the 36px single-line height', () => {
    // The UUI select trigger + date boundary through the control-height var…
    expect(css).toMatch(/\.debit-merge-page \.debit-merge-filterbar \[data-uui-control\]\s*\{\s*--uui-control-h:\s*36px;/);
    // …the bare search/route inputs through the box floor.
    expect(css).toMatch(/\.debit-merge-page \.debit-merge-filterbar \.debit-merge-filter input\[type='search'\]\s*\{\s*min-height:\s*36px;/);
  });

  it('≤1023px: the disclosure shows, the panel folds, open state unrolls it', () => {
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.debit-merge-filterbar__toggle\s*\{[^}]*display:\s*inline-flex;/);
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.debit-merge-filterbar__panel\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.debit-merge-filterbar__panel--open\s*\{[^}]*display:\s*grid;/);
  });

  it('≤767px: phone keeps the 44px touch floor on the search row and the trigger', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.debit-merge-page \.debit-merge-filterbar \[data-uui-control\]\s*\{\s*--uui-control-h:\s*var\(--control-touch-h\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.debit-merge-filterbar \.debit-merge-filter input\[type='search'\],\s*\n\s*\.debit-merge-filterbar__toggle\s*\{[^}]*min-height:\s*var\(--control-touch-h\);/,
    );
  });
});

describe('DebitMergePage — SIL-1004 date stack (styles)', () => {
  it('≤400px: the pair stacks one field per row inside the panel (SIL-1004 page-scoped)', () => {
    expect(css).toMatch(
      /@media \(max-width: 400px\)[\s\S]*?\.debit-merge-filterbar__panel \.date-range-fields\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 400px\)[\s\S]*?\.debit-merge-filterbar__panel \.date-range-fields__arrow\s*\{\s*display:\s*none;/,
    );
  });
});

describe('DebitMergePage — UX-02 mobile card band (styles)', () => {
  it('≤767px: the desktop pane and the pager hide so the card list owns the viewport', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.debit-merge-page \.debit-merge__pane,\s*\n\s*\.debit-merge-page \.ds-pagination\s*\{\s*display:\s*none;/,
    );
  });

  it('the card list is desktop-hidden and grid-shown only below 768px', () => {
    expect(listCss).toMatch(/\.debit-merge-mobile\s*\{\s*display:\s*none;/);
    expect(listCss).toMatch(/@media \(max-width: 767px\)\s*\{\s*\.debit-merge-mobile\s*\{\s*display:\s*grid;/);
  });

  it('cards stay fluid (no horizontal scroll): the card floor is min-width: 0 and pick rides the 44px card law', () => {
    expect(listCss).toMatch(/\.debit-merge-card\s*\{[^}]*min-width:\s*0;/);
    expect(listCss).toMatch(/\.debit-merge-card__pick\s*\{[^}]*min-height:\s*var\(--control-touch-h\);/);
    expect(listCss).not.toMatch(/\.debit-merge-card\s*\{[^}]*width:\s*\d{3,}px/);
  });
});
