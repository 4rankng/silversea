import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SupplierListPage dispatch worksheet styling', () => {
  it('uses the compact operational-table typography and a sticky worksheet footer', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');

    expect(page).toContain("import '../styles/operational-table-typography.css'");
    expect(page).toContain('className="suppliers-page__grid ops-table"');
    expect(page).toContain('className="desktop-only table-wrap suppliers-page__workspace"');
    expect(css).toContain('.suppliers-page__grid th {');
    expect(css).toContain('position: sticky');
    expect(css).toContain('font-size: var(--ops-table-primary-size)');
    expect(css).toContain('.suppliers-page__workspace > .ds-pagination {');
  });

  it('keeps supplier values visible by wrapping instead of ellipsizing cells', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');
    const cellRule = css.match(/\.suppliers-page__grid \.suppliers-page__cell \{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(cellRule).toContain('overflow-wrap: anywhere');
    expect(cellRule).toContain('text-overflow: clip !important');
    expect(cellRule).toContain('white-space: normal !important');
  });

  it('uses a four-column form grid with the Dispatch compact control contract', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/\./g, '\\.')} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';

    expect(page).toContain('maxWidth={960}');
    expect(page).toContain('className="supplier-form__profile"');
    expect(page).toContain('className="supplier-form__terms"');
    expect(page).toContain('className="supplier-form__service-grid"');

    // The two field groups share one grouped 4-column rule.
    expect(css).toMatch(/\.supplier-form__profile,\s*\n\.supplier-form__terms \{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/);
    expect(css).toContain('grid-column: span 2');
    // Row rhythm: supplier name takes half the canvas, the reporting group
    // spans two columns, the note owns the full closing row. (Selectors with
    // parens are matched with hand-escaped regexes — the rule() helper only
    // escapes dots.)
    const spanRule = (re: RegExp) => css.match(re)?.[1] ?? '';
    expect(spanRule(/\.supplier-form__profile > :first-child \{([\s\S]*?)\n\}/)).toContain('grid-column: span 2');
    expect(spanRule(/\.supplier-form__terms > :nth-child\(3\) \{([\s\S]*?)\n\}/)).toContain('grid-column: span 2');
    expect(spanRule(/\.supplier-form__terms > :last-child \{([\s\S]*?)\n\}/)).toContain('grid-column: 1 / -1');
    // Grid gap owns vertical rhythm — no per-field bottom margin inside the groups.
    expect(rule('.supplier-form .field')).toContain('margin-bottom: 0');
    expect(rule('.supplier-form .field > label')).toContain('margin-bottom: 8px');
    expect(rule('.supplier-form .input')).toContain('min-height: var(--control-compact-h)');
    expect(rule('.supplier-form .input')).toContain('font-size: var(--control-compact-font-size)');
    expect(page).toContain('<UuiSelectField');
    expect(rule('.supplier-form__service-option')).toContain('min-height: var(--control-compact-h)');
    expect(rule('.supplier-form__service-option')).toContain('height: var(--control-compact-h)');
    expect(css).toContain('--supplier-form-row-gap: 24px');
    expect(css).toContain('--supplier-form-section-gap: 32px');
    expect(page).toContain('placeholder="Ví dụ: 0312…"');
    expect(page).toContain('placeholder="Ví dụ: 15"');
    expect(css).toContain('.supplier-form .input::placeholder');
    expect(page).toContain('<textarea id="supp-note"');
    expect(css).toContain('.supplier-form__terms textarea.input');
    expect(page).toContain('btn btn--secondary btn--sm');

    // The seven canonical service groups read as one strip; the checkbox box
    // is drawn by the app so its optical center matches the 12px label.
    expect(rule('.supplier-form__service-grid')).toContain('repeat(7, minmax(0, 1fr))');
    expect(rule('.supplier-form__service-option input')).toContain('appearance: none');
    expect(rule('.supplier-form__service-option input:checked')).toContain('var(--accent)');
    expect(rule('.supplier-form__service-option span')).toContain('white-space: nowrap');
    expect(rule('.supplier-form__service-option span')).toContain('line-height: var(--control-compact-line-height)');

    // Collapse ladder: strip folds at 1023px, fields at 960px, single column
    // plus touch targets at 640px.
    const stripFold = css.match(/@media \(max-width: 1023px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const tabletBlock = css.match(/@media \(max-width: 960px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const phoneBlock = css.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(stripFold).toContain('repeat(4, minmax(0, 1fr))');
    expect(tabletBlock).toContain('repeat(2, minmax(0, 1fr))');
    expect(phoneBlock).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(phoneBlock).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(css).toContain('min-height: var(--control-touch-h)');
    expect(phoneBlock).toContain('height: var(--control-touch-h)');
    // Compact form controls keep the shared 8px (--r-sm) radius from the base
    // rules; the phone block only lifts heights to touch size.
    expect(css).toContain('border-radius: var(--r-sm)');
    expect(css).toContain('@media (min-width: 641px) and (max-width: 900px)');
    expect(css).toContain('min-height: var(--control-compact-h) !important');
  });
});
