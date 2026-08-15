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
    expect(css).not.toContain('.shipments-detail-filters__actions');
    expect(css).toMatch(/\.shipment-container-summary dd\s*\{[^}]*font-size:\s*var\(--fs-sm\);/);
    expect(css).toMatch(/\.shipment-container-ledger thead th\s*\{[^}]*font-size:\s*10px;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > tr > td\s*\{[^}]*font-size:\s*11px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipments-detail-page \.page-title\s*\{[^}]*font-size:\s*var\(--fs-xl\);/);
  });

  it('keeps filter controls visibly bounded and usable as a responsive grid', () => {
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:/);
    expect(css).toMatch(/\.shipments-detail-filters\s*\{[^}]*border:\s*1px solid var\(--line-2\);[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.shipments-detail-filter input,[^{]+\{[^}]*min-height:\s*40px;[^}]*box-shadow:\s*none;/);
    expect(css).toMatch(/\.shipments-detail-filter input\s*\{[^}]*background:\s*transparent;/);
    expect(css).toMatch(/\.shipments-detail-filter select\s*\{[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.shipments-detail-filter > \*,\s*\.shipments-detail-filter input,\s*\.shipments-detail-filter select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?\.shipments-detail-filters\s*\{[^}]*grid-template-columns:\s*1fr;/);
  });

  it('separates the workspace from the page canvas without decorative shadows', () => {
    expect(css).toMatch(/\.shipments-detail-workspace\s*\{[^}]*border:\s*1px solid var\(--line-strong\);[^}]*border-top:\s*3px solid var\(--brand\);[^}]*background:\s*var\(--surface\);/);
    expect(css).toMatch(/\.shipments-detail-workspace__header\s*\{[^}]*background:\s*var\(--surface-3\);/);
    expect(css).not.toMatch(/\.shipments-detail-workspace\s*\{[^}]*box-shadow:/);
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

  it('uses a dense intermediate ledger grid without empty half-width bands', () => {
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?tbody > tr > td\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*8px 10px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*?tbody > tr > :nth-child\(7\)\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).not.toContain('tbody > tr > :nth-child(4),');
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?\.shipment-container-ledger tbody > tr\s*\{[^}]*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?tbody > tr > td\s*\{[^}]*grid-template-columns:\s*88px minmax\(0, 1fr\);/);
    expect(css).toMatch(/@media \(max-width:\s*390px\)[\s\S]*?\.shipment-container-ledger__cell-trigger\s*\{[^}]*grid-column:\s*2;/);
  });

  it('makes editable values the cell trigger without pencil controls and keeps bounded editor trays', () => {
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*display:\s*block;[^}]*background:\s*transparent;[^}]*cursor:\s*text;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger\s*\{[^}]*touch-action:\s*manipulation;/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:not\(\.shipment-container-ledger__cell-trigger--read-only\):not\(\[disabled\]\):hover/);
    expect(css).toMatch(/\.shipment-container-ledger__cell-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/);
    expect(css).not.toContain('.shipment-container-ledger__edit-button');
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__editing-cell\s*\{[^}]*grid-column:\s*1 \/ -1;/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > \.shipment-container-ledger__editor-row > td\s*\{[^}]*background:\s*var\(--surface-2\);/);
    expect(css).toMatch(/\.shipment-container-ledger tbody > \.shipment-container-ledger__editor-row > td\s*\{[^}]*overflow:\s*visible;/);
    expect(css).toMatch(/\.shipment-container-ledger__editor-row \.shipment-container-ledger__inline-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0, 760px\) auto;[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;/);
    expect(css).toMatch(/\.shipment-container-ledger__inline-editor\[data-mode="appointment"\]\s*\{[^}]*grid-template-columns:\s*minmax\(280px, 420px\) auto;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__editor-row \.shipment-container-ledger__inline-editor\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*32px;[^}]*font-size:\s*11px;/);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*\.shipment-container-ledger__cell-trigger,[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/@container shipments-detail \(max-width:\s*900px\)[\s\S]*\.shipment-container-ledger__cell-trigger,[\s\S]*?\.shipment-container-ledger__edit-action\s*\{[^}]*min-height:\s*40px;/);
  });

  it('uses a distinct, non-destructive pending state when today still needs vehicle allocation', () => {
    expect(css).toMatch(/shipment-container-ledger__row--missing-date/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-pending/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-state/);
    expect(css).toMatch(/shipment-container-ledger__plate--missing/);
    expect(css).toMatch(/shipment-container-ledger__vehicle-guidance/);
    expect(css).toMatch(/shipment-container-ledger__multiline > span:not\(\.shipment-container-ledger__combined\):not\(\.shipment-container-ledger__plate\):not\(\.shipment-container-ledger__dispatch-badge\):not\(\.shipment-container-ledger__vehicle-state\)/);
    expect(css).toMatch(/\.shipment-container-ledger__vehicle-state\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*white-space:\s*nowrap;/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-alert/);
    expect(css).not.toMatch(/shipment-container-ledger__vehicle-guidance\s*\{[^}]*var\(--danger\)/);
  });
});
