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

  it('the four-card KPI strip is retired; metrics ride the header row (SIL-169)', () => {
    // The verdict collapsed the 4 KPI cards ("5 KH / 5 active / 0 suspended"
    // trivia) into three inline header metrics rendered by the shared
    // CustomerMetricsRow — the page sheet declares no summary strip at all.
    expect(css).not.toMatch(/\.cfg-customer-summary/);
    expect(css).not.toMatch(/\.kpi\b/);
  });

  it('narrow widths scroll the fixed verdict budget instead of hiding columns', () => {
    // The old container card-band stacked every row down to identity + kebab
    // and hid the rest behind a details disclosure. The 7-column verdict
    // budget is fixed geometry: the wrap scrolls, so no column silently
    // disappears (the SIL-169 supersession of the card-fold approach).
    expect(css).not.toContain('@container');
    expect(css).toMatch(/\.cfg-page--customers \.record-table-wrap\s*\{[^}]*overflow: auto;/);
    expect(css).not.toContain('display: grid;');
  });

  it('the identity row keeps the wrap doctrine at every width', () => {
    // Card 20261004_336's law survives the redesign: the catalog's business
    // name wraps in full — no clamp, no ellipsis, no tooltip crutch.
    expect(css).toMatch(/\.cfg-customer-identity \.cfg-customer-full-name\s*\{[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/\.cfg-customer-identity \.cfg-customer-full-name\s*\{[^}]*overflow-wrap:\s*anywhere;/);
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
