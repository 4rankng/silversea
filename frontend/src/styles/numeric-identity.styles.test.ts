import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

describe('QA-AUDIT-UI-22 numeric identity values', () => {
  it('keeps money cells on one line without clipping — numeric cells are atomic', () => {
    const css = read('styles/record-table.css');
    const rule = css.match(/\.record-table \.num\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/overflow-wrap:\s*normal/);
    expect(rule).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
    const page = read('pages/AccountingInvoiceTrackingPage.css');
    const stack = page.match(/\.ivt-stack__sub\s*\{([^}]*)\}/)?.[1];
    expect(stack).toBeDefined();
    expect(stack).toMatch(/white-space:\s*nowrap/);
    expect(stack).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
  });

  // The source-level pin above held while PRODUCTION broke: a page-level rule
  // (higher specificity than the shared law) re-allowed wrapping on the two
  // amount cells, and minification/chunk-splitting meant the built sheets were
  // the only place the conflict was visible. This contract reads the BUILT
  // assets: the shared law must survive minification, and NO rule in the
  // page's emitted CSS may set a numeric cell to anything but nowrap.
  it('the production bundle holds the numeric law on the amount cells', () => {
    const distAssets = resolve(process.cwd(), 'dist/assets');
    if (!existsSync(distAssets)) {
      throw new Error('dist/assets missing — run `pnpm --dir frontend build` first; this contract pins the production CSS, not the source.');
    }
    const sharedChunk = readdirSync(distAssets).find((f) => f.startsWith('record-table-') && f.endsWith('.css'));
    expect(sharedChunk).toBeDefined();
    const sharedCss = readFileSync(resolve(distAssets, sharedChunk!), 'utf8');
    const numRule = sharedCss.match(/\.record-table \.num\s*\{[^}]*\}/);
    expect(numRule).toBeTruthy();
    expect(numRule![0]).toMatch(/white-space:\s*nowrap/);
    expect(numRule![0]).toMatch(/overflow-wrap:\s*normal/);

    const pageChunks = readdirSync(distAssets).filter((f) => f.startsWith('AccountingInvoiceTrackingPage') && f.endsWith('.css'));
    expect(pageChunks.length).toBeGreaterThan(0);
    for (const chunk of pageChunks) {
      const css = readFileSync(resolve(distAssets, chunk), 'utf8');
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = m[1];
        const body = m[2];
        const targetsNumericCell = /data-label=["']?(Số tiền trả|Chênh lệch)/.test(selector) || /\.ivt-stack__sub/.test(selector);
        if (!targetsNumericCell) continue;
        if (/white-space:\s*(?!nowrap)/.test(body)) {
          throw new Error(`built rule un-wraps a numeric cell in ${chunk}: ${selector.trim()} { ${body.slice(0, 140)} }`);
        }
      }
    }
  });

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
