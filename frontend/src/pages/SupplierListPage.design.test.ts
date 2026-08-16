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
});
