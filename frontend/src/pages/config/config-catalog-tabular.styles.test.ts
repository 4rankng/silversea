import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

// Product call (2026-09-06): the customers/routes master-data catalogs must
// stay tabular down to a 680px container — the shared record-table card fold
// (≤1100px) is the LAST resort, not the laptop default. These pins keep the
// re-arm block in config-page.css from silently disappearing.
describe('config catalog tables stay tabular below the shared card fold', () => {
  const css = read('src/pages/config/config-page.css');

  it('re-arms tabular display for the two catalogs across 680-1100px', () => {
    expect(css).toContain('@container (min-width: 680px) and (max-width: 1100px)');
    expect(css).toContain('.cfg-page .cfg-customer-table,\n  .cfg-page .routes-table {\n    display: table;\n  }');
    // The card fold's data-label eyebrows must be off in the tabular window.
    expect(css).toContain('.cfg-page .cfg-customer-table tbody td::before,\n  .cfg-page .routes-table tbody td::before {\n    content: none;\n  }');
  });

  it('keeps routes fixed-layout geometry (minus the 980px floor) in the window', () => {
    expect(css).toContain('.cfg-page .routes-table {\n    min-width: 0;\n    table-layout: fixed;\n  }');
  });

  it('leaves the shared base owning cards below 680px', () => {
    const base = read('src/styles/record-table.css');
    expect(base).toContain('@container (max-width: 1100px)');
    expect(base).toContain('@container (max-width: 640px)');
  });
});
