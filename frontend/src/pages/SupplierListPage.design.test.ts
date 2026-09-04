import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SupplierListPage dispatch worksheet styling', () => {
  it('uses the compact operational-table typography and a sticky worksheet footer', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');

    expect(page).toContain("import '../styles/operational-table-typography.css'");
    // record-table base adoption: shared skin + card collapse ride these classes.
    expect(page).toContain('className="record-table ops-table suppliers-page__grid"');
    expect(page).toContain('className="desktop-only table-wrap suppliers-page__workspace"');
    // Workboard standard: the thead skin is owned by the shared record-table
    // base — the page must not re-declare it (conformance invariant).
    expect(css).not.toContain('.suppliers-page__grid th {');
    expect(css).toContain('position: sticky');
    expect(css).toContain('font-size: var(--ops-table-primary-size)');
    expect(css).toContain('.suppliers-page__workspace > .ds-pagination {');
  });

  it('keeps supplier values visible by wrapping instead of ellipsizing cells', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.css'), 'utf8');
    const recordTableCss = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');

    // Wrapping is owned by the shared record-table base; the page only
    // un-clips the linked-supplier spans it stacks.
    expect(recordTableCss).toMatch(/\.record-table tbody td\s*\{[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/__cell--linked > span[\s\S]*?white-space:\s*normal !important;/);
  });

  it('uses the shared paired-field modal grid (CustomersPage form contract)', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/SupplierListPage.tsx'), 'utf8');

    expect(page).toContain('maxWidth={960}');
    // Auto-fit paired-field grid — the same contract as CustomersPage's
    // modal: fields pair up on wide canvases and stack one-per-row on narrow
    // ones without a bespoke per-page breakpoint ladder.
    expect(page).toMatch(/const pairedFieldGridStyle = \{[\s\S]*?repeat\(auto-fit, minmax\(220px, 1fr\)\)/);
    expect(page).toMatch(/const pairedFieldGridStyle = \{[\s\S]*?gap: 12,/);
    expect((page.match(/<div style=\{pairedFieldGridStyle\}>/g) ?? []).length).toBe(4);
    // Shared field skin + the formStyles label contract, not page-local CSS.
    expect(page).toContain("import { labelStyle } from '../utils/formStyles';");
    expect(page).toContain('className="field"');
    expect(page).toContain('className="input"');
    expect(page).toContain('placeholder="Ví dụ: 0312…"');
    expect(page).toContain('placeholder="Ví dụ: 15"');
    expect(page).toContain('<textarea id="supp-note"');
    expect(page).toContain('btn btn--secondary btn--sm');
  });
});
