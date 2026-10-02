import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('QA-AUDIT-UI-22 numeric identity values', () => {
  it('QA-AUDIT-UI-26 keeps semantic row ordinals whole without changing prose wrapping', () => {
    const css = read('styles/record-table.css');
    const rule = css.match(/\.record-table tbody td\[data-label=['"]STT['"]\]\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    expect(rule).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
    expect(css).toMatch(/\.record-table tbody td\s*\{[^}]*white-space:\s*normal/);
    expect(read('pages/config/FactoriesConfigPage.tsx')).toContain('data-label="STT">{index + 1}');
    expect(read('components/config/CrudTable.tsx')).toContain('data-label="STT">{i + 1}');
  });

  it('keeps the entire value atomic without clipping, while the outer fact can wrap', () => {
    const css = read('styles/utilities.css');
    const rule = css.match(/\.data-token\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    expect(rule).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
    const record = read('styles/record-table.css');
    expect(record).toMatch(/\.record-table tbody td\s*\{[^}]*white-space:\s*normal/);
  });

  it('uses the same inner boundary for customer, supplier and driver contacts', () => {
    const targets = [
      ['pages/config/CustomersConfigPage.tsx', 'c.taxCode', 'c.phone', 'c.accountantPhone', 'c.code'],
      ['pages/CustomersPage.tsx', 'c.taxCode', 'c.phone'],
      ['pages/SupplierListPage.tsx', 's.taxCode', 's.phone'],
      ['features/dispatch/catalogs/SuppliersView.tsx', 's.phone'],
      ['features/dispatch/catalogs/FleetDriversView.tsx', 'd.phone'],
      ['features/fleet/driver-card.tsx', 'd.phone'],
    ];
    for (const [path, ...values] of targets) {
      const source = read(path);
      for (const value of values) {
        expect(source, `${path}: ${value}`).toMatch(new RegExp(
          String.raw`className="[^"]*data-token[^"]*"[^>]*>\{${value.replace('.', String.raw`\.`)}(?:\}|\s*\|\|)`,
        ));
      }
    }
  });
});
