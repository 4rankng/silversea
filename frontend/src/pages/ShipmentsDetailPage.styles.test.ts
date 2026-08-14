import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsDetailPage.css'), 'utf8');

describe('shipment detail workboard styling', () => {
  it('keeps filter controls visibly bounded and usable as a responsive grid', () => {
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    expect(css).toMatch(/\.shipments-detail-filter input,[^{]+\{[^}]*min-height:\s*40px;[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipments-detail-filters__actions button\s*\{[^}]*min-height:\s*44px;/);
  });

  it('fits desktop columns to the workspace and lets headings wrap instead of forcing horizontal scroll', () => {
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*min-width:\s*980px;/);
  });

  it('defines warning states with both row and vehicle-specific treatments', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-guidance/);
  });
});
