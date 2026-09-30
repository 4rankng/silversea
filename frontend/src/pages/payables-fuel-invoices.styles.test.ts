import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/payables-fuel-invoices.css'), 'utf8');
const page = readFileSync(resolve(process.cwd(), 'src/pages/payables-fuel-invoices.tsx'), 'utf8');
const plane = readFileSync(resolve(process.cwd(), 'src/features/payables/FuelInvoiceFilters.tsx'), 'utf8');
// Selector assertions read the RULES, not the prose: the sheet's comment names
// the deleted selectors on purpose (the record of what left and why).
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('fuel-invoice filter strip (card 20260927_152)', () => {
  it('renders the shared bar through the extracted filter plane', () => {
    // The panel is 1000+ lines; the plane lives in its own ≤400-line file and
    // the page only hands it values and writers.
    expect(page).toContain('<FuelInvoiceFilters');
    expect(page).not.toContain('className="fuel-invoices-toolbar"');
    expect(plane).toContain('<FilterBar');
    expect(plane).toContain('<FilterDropdown');
  });

  it('keeps every criterion label and its writer', () => {
    expect(plane).toContain("placeholder: 'Tìm theo số hóa đơn hoặc nhà cung cấp…'");
    expect(plane).toContain("ariaLabel: 'Tìm hóa đơn nhiên liệu'");
    expect(plane).toContain('label="Lọc nhà cung cấp nhiên liệu"');
    expect(plane).toContain('aria-label="Lọc nhà cung cấp nhiên liệu"');
    expect(plane).toContain('onSupplierChange(event.target.value)');
    expect(plane).toContain('label="Lọc trạng thái hóa đơn nhiên liệu"');
    expect(plane).toContain('aria-label="Lọc trạng thái hóa đơn nhiên liệu"');
    expect(plane).toContain('onStatusChange(event.target.value as FuelInvoiceStatus');
    // The criteria render inline while the strip fits two rows and fold into
    // `Bộ lọc` when it does not — the count feeds the trigger badge.
    expect(plane).toContain('const secondaryCount = (supplier ? 1 : 0) + (status ? 1 : 0)');
    expect(plane).toContain('onReset={resetSecondary}');
  });

  it('declares no filter layout and no filter width of its own', () => {
    // The page-local toolbar (a 3-track `minmax` grid, a `width: 100%` search
    // shell and a page-local control height on the search input) is exactly how
    // the operator's 2026-09-27 "why the fuck it does take full row" regression
    // returned twice: a page rule outranks the shared band. The bar owns all
    // three.
    expect(rules).not.toContain('fuel-invoices-toolbar');
    expect(rules).not.toContain('minmax(0, 1.6fr)');
    expect(rules).not.toMatch(/\.payables-toolbar/);
    expect(rules).not.toMatch(/flex\s*:\s*1 1/);
    // The metric/editor grids the panel legitimately keeps are untouched; what
    // may not return is a rule that lays out a FILTER container.
    expect(rules).not.toMatch(/(?:toolbar|filter)[^{,]*\{[^}]*(?:display:\s*(?:flex|grid)|grid-template-columns|grid-column)/);
  });
});
