import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsDetailPage.css'), 'utf8');

describe('shipment detail workboard styling', () => {
  it('uses a compact hierarchy and explicitly downsizes the filter controls', () => {
    expect(css).toMatch(/\.shipments-detail-page > \.d-breadcrumbs\s*\{[^}]*font-size:\s*var\(--fs-xs\);/);
    expect(css).toMatch(/\.shipments-detail-page \.page-title\s*\{[^}]*font-size:\s*var\(--fs-2xl\);/);
    expect(css).toMatch(/\.shipments-detail-page \.page-subtitle\s*\{[^}]*font-size:\s*var\(--fs-xs\);/);
    expect(css).toMatch(/\.shipments-detail-workspace__intro h2\s*\{[^}]*font-size:\s*var\(--fs-md\);/);
    expect(css).toMatch(/\.shipments-detail-workspace__intro p\s*\{[^}]*font-size:\s*var\(--fs-xs\);/);
    expect(css).toMatch(/\.shipments-detail-filter \[data-label\],[\s\S]*?\.shipments-detail-filter > label\s*\{[^}]*font-size:\s*11px;/);
    expect(css).toMatch(/\.shipments-detail-filter input,\s*\.shipments-detail-filter select,\s*\.shipments-detail-filter \[data-input-wrapper\]\s*\{[^}]*font-size:\s*var\(--fs-xs\);/);
    expect(css).toMatch(/\.shipments-detail-filter input::placeholder\s*\{[^}]*font-size:\s*inherit;/);
    expect(css).toMatch(/\.shipments-detail-filters__actions button\s*\{[^}]*font-size:\s*var\(--fs-xs\);/);
    expect(css).toMatch(/\.shipment-container-summary dd\s*\{[^}]*font-size:\s*var\(--fs-sm\);/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*font-size:\s*10px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*font-size:\s*11px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipments-detail-page \.page-title\s*\{[^}]*font-size:\s*var\(--fs-xl\);/);
  });

  it('keeps filter controls visibly bounded and usable as a responsive grid', () => {
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    expect(css).toMatch(/\.shipments-detail-filter input,[^{]+\{[^}]*min-height:\s*40px;[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipments-detail-filters__actions button\s*\{[^}]*min-height:\s*44px;/);
  });

  it('fits desktop columns to the workspace and lets headings wrap instead of forcing horizontal scroll', () => {
    expect(css).toMatch(/\.shipment-container-ledger table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*white-space:\s*normal;/);
    expect(css).not.toMatch(/\.shipment-container-ledger table\s*\{[^}]*min-width:\s*980px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/\.shipment-container-ledger__route\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__multiline > small\s*\{[^}]*word-break:\s*break-word;/);
    expect(css).toMatch(/tbody > tr > td::before\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*tbody > tr > td\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
  });

  it('turns editable values into restrained cell triggers without persistent edit-button chrome', () => {
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*background:\s*transparent;[^}]*text-align:\s*left;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > \.shipment-container-ledger__editor-row > td\s*\{[^}]*background:\s*var\(--surface-2\);/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-row \.shipment-container-ledger__inline-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__editor-row \.shipment-container-ledger__inline-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).not.toMatch(/shipment-container-ledger__edit-trigger/);
  });

  it('defines warning states with both row and vehicle-specific treatments', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-guidance/);
  });
});
