import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

// Routes keep their tabular tablet layout. The 13-column customer catalog
// uses the shared labelled records once the complete table no longer fits.
describe('config catalog tables stay tabular below the shared card fold', () => {
  const css = read('src/pages/config/config-page.css');

  it('keeps routes tabular across 680-1100px without forcing the wider customer catalog', () => {
    expect(css).toContain('@container (min-width: 680px) and (max-width: 1100px)');
    expect(css).toContain('.cfg-page .routes-table {\n    display: table;\n  }');
    const tabletBlock = css.slice(css.indexOf('@container (min-width: 680px)'), css.indexOf('/* Hover re-arm:'));
    expect(tabletBlock).not.toContain('.cfg-customer-table');
    // The full display-chain restoration — dropping any one of these re-folds
    // the table while leaving the rest of the block looking correct.
    expect(css).toContain('display: table-header-group;');
    expect(css).toContain('display: table-row-group;');
    expect(css).toContain('display: table-row;');
    expect(css).toContain('display: table-cell;');
    // The card fold's data-label eyebrows must be off in the tabular window.
    expect(css).toContain('.cfg-page .routes-table tbody td::before {\n    content: none;\n  }');
  });

  it('re-arms the row hover wash the counter-block would otherwise outrank', () => {
    // .cfg-page …tbody tr { background: transparent } ties the shared
    // tr:hover wash on cascade order, killing hover in-window; the explicit
    // re-arm must exist and out-specify it.
    expect(css).toContain('@media (hover: hover) and (pointer: fine)');
    expect(css).toContain('.cfg-page .cfg-customer-table tbody tr:hover,\n  .cfg-page .routes-table tbody tr:hover {\n    background: color-mix(in srgb, var(--fg-1) 2%, var(--surface));\n  }');
  });

  it('restores the routes kebab padding without relying on import order', () => {
    // The shared base zeroes .record-table tbody td.record-table__action at
    // the same specificity the counter-block uses for td; the explicit
    // (0,3,2) rule removes the source-order dependency.
    expect(css).toContain('.cfg-page .routes-table tbody td.record-table__action {\n    padding: 10px 12px;\n  }');
  });

  it('keeps routes fixed-layout geometry (minus the 980px floor) in the window', () => {
    expect(css).toContain('.cfg-page .routes-table {\n    min-width: 0;\n    table-layout: fixed;\n  }');
  });

  it('leaves the shared base owning cards below 680px', () => {
    const base = read('src/styles/record-table.css');
    expect(base).toContain('@container (max-width: 1100px)');
    // 2026-09-09 space-utilisation audit: the base now pairs facts two-up
    // across the WHOLE card band (≤1100px) instead of phones-only, so the
    // fold never renders single-column stacks at tablet widths.
    expect(base).toContain('repeat(2, minmax(0, 1fr))');
    // Sub-360px keeps the single-column fallback — the base still owns the
    // narrowest band outright.
    expect(base).toContain('@container (max-width: 360px)');
  });

  it('pins the catalogs to content-sized auto layout without width shares (card 20260922_22)', () => {
    // Both config catalogs size columns to real content; persistently-empty
    // columns hide at the component level (colPresence), so no equal-split
    // nth-child width share may re-enter the routes block, and the customers
    // table carries the same auto-layout contract.
    expect(css).toContain('.cfg-customer-table { min-width: 0; table-layout: auto; width: 100%; }');
    const routesBlock = css.slice(
      css.indexOf('.routes-table { min-width: 0;'),
      css.indexOf('/* When the shared record-table base collapses'),
    );
    expect(routesBlock).not.toMatch(/nth-child\(\d+\)\s*\{\s*width:/);
  });
});

describe('customer catalog uses compact scoped summary and record layouts', () => {
  const css = read('src/pages/config/customer-config-density.css');

  it('keeps four tablet metrics in one flat strip and two phone columns', () => {
    expect(css).toMatch(/\.cfg-page--customers \.cfg-customer-summary\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cfg-page--customers \.cfg-customer-summary > \.kpi\s*\{[^}]*min-height: 0;[^}]*border: 0;[^}]*border-radius: 0;/);
    expect(css).toMatch(/@media \(max-width: 640px\)\s*\{\s*\.cfg-page--customers \.cfg-customer-summary\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\.cfg-page--customers \.cfg-customer-summary \.kpi__watermark\s*\{\s*display: none;/);
    expect(css).toContain('font-size: var(--text-metric-size);');
    expect(css).toContain('font-size: var(--text-caption-size);');
  });

  it('keeps a compact identity row with accessible two-column details on tablet and phone', () => {
    const responsiveRecords = css.slice(css.indexOf('@container (max-width: 1100px)'));
    expect(responsiveRecords).toMatch(/\.cfg-page--customers \.cfg-customer-table tbody tr\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) 44px;/);
    expect(responsiveRecords).toMatch(/td\.record-table__action\s*\{[^}]*grid-column: 2;[^}]*grid-row: 1;/);
    expect(responsiveRecords).toMatch(/\.cfg-customer-details dl\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(responsiveRecords).toMatch(/\.cfg-customer-details dd\s*\{[^}]*overflow-wrap: anywhere;/);
    expect(responsiveRecords).toMatch(/\.cfg-customer-details > summary:focus-visible\s*\{[^}]*outline: 2px solid var\(--focus\);/);
    expect(responsiveRecords).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.cfg-customer-details > summary\s*\{\s*min-height: 44px;/);
    expect(responsiveRecords).toContain('min-width: 44px; min-height: 44px;');
  });
});

// Card 20260930_222 — at 360/390 the stacked route cards inherited the DESKTOP
// column budgets, so the "Tên tuyến rút gọn" cell stayed 200px inside a ~156px
// grid track and pushed past the viewport: measured l=188 r=388 at 360 and
// l=203 r=403 at 390. A plain `width: auto` is not enough — the budgets carry
// one more class-level token and are declared later in the file — so the reset
// has to go through a selector that outranks them.
describe('route cards stop inheriting the desktop column budgets (card 20260930_222)', () => {
  const routes = read('src/pages/config/RoutesConfigPage.css');

  it('resets the fixed widths inside the stacked container, outranking the budgets', () => {
    const container = routes.match(/@container \(max-width: 640px\)\s*\{([\s\S]*)\}/)?.[1] ?? '';
    expect(container).not.toBe('');
    // Scoped to `tbody tr` so it beats `.routes-config-page .routes-table
    // td:nth-child(3)` on element count — the reason a bare td reset would lose.
    const reset = container.match(
      /\.routes-config-page \.routes-table tbody tr td:nth-child\(3\)[\s\S]*?\{([^}]*)\}/)?.[1] ?? '';
    expect(reset).not.toBe('');
    expect(reset).toMatch(/width:\s*auto/);
  });

  it('keeps the 200px budget for the wide layout — the reset is phone-band only', () => {
    expect(routes).toMatch(
      /\.routes-config-page \.routes-table td:nth-child\(3\)\s*\{[^}]*width:\s*200px/);
  });
});
