import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsDetailPage.css'), 'utf8');

describe('shipment detail search styling', () => {
  it('keeps the search field visibly bounded in rest, focus, and invalid states', () => {
    expect(css).toMatch(/\.shipments-detail-search__control\s*\{[^}]*border:\s*1px solid var\(--line-strong\);[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.shipments-detail-search__control:focus-within\s*\{[^}]*border-color:\s*var\(--accent\);[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.shipments-detail-search__control\[data-invalid\]\s*\{[^}]*border-color:\s*var\(--danger\);/);
  });

  it('fits desktop columns to the workspace and lets headings wrap instead of forcing horizontal scroll', () => {
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*min-width:\s*980px;/);
  });
});
