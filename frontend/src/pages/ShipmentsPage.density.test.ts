import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.tsx'), 'utf8');

describe('shipment container editor density', () => {
  it('keeps Untitled toolbar inputs inside a single outlined control shell', () => {
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control__input\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*inherit;[^}]*outline:\s*0;/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control__input:focus-visible\s*\{[^}]*outline:\s*0;/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control\s*,[\s\S]*?border:\s*1px solid var\(--line-strong\);/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control:focus-within,[\s\S]*?outline:\s*2px solid/);
  });

  it('keeps edit fields in one bounded dialog instead of expanding a table column', () => {
    expect(css).toMatch(/\.cus-quick-edit-modal__fields\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-quick-edit-modal__help\s*\{[^}]*font-size:\s*11px;/);
  });

  it('uses one compact typography scale for table values and metadata', () => {
    expect(pageSource).toContain('cus-dashboard-table ops-table');
    expect(css).toMatch(/\.cus-dashboard-table\s*\{[^}]*font-size:\s*var\(--ops-table-supporting-size\);/);
    expect(css).toMatch(/\.cus-multiline-cell strong\s*\{[^}]*font-size:\s*var\(--ops-table-primary-size\);/);
    expect(css).toMatch(/\.cus-multiline-cell span\s*\{[^}]*font-size:\s*var\(--ops-table-meta-size\);/);
  });

  it('binds touch-friendly cell triggers to an explicit edit dialog', () => {
    expect(css).toMatch(/\.cus-inline-trigger\s*\{[^}]*min-height:\s*44px;[^}]*touch-action:\s*manipulation;/);
    expect(pageSource).toContain('aria-haspopup="dialog"');
    expect(pageSource).toContain("startQuickEdit(item, 'schedule')");
    expect(pageSource).toContain("startQuickEdit(item, 'notes')");
  });

  it('uses two compact operational tiers instead of form cards', () => {
    expect(css).toMatch(/\.cus-container-record__tier\s*\{[\s\S]*?grid-template-columns:\s*78px minmax\(0, 1fr\);/);
    expect(css).toMatch(/\.cus-container-record__facts--identity\s*\{\s*grid-template-columns:\s*1\.25fr repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-container-record__facts--operation\s*\{\s*grid-template-columns:\s*1\.3fr repeat\(4, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-container-fact input,[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*34px;/);
    expect(css).toMatch(/\.cus-container-ledger__head\s*\{/);
    expect(css).not.toMatch(/\.cus-container__facts\s*\{/);
  });

  it('reflows the ledger while retaining touch-sized controls in the mobile drawer', () => {
    expect(css).toMatch(/\.cus-shipment-drawer \.cus-container-record__tier\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(css).toMatch(/\.cus-shipment-drawer \.cus-container-record__facts--identity,[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-shipment-drawer \.cus-container-fact input,[\s\S]*?font-size:\s*16px;/);
    expect(css).toMatch(/\.cus-shipment-drawer \.cus-container-fact input,[\s\S]*?min-height:\s*44px;/);
    expect(css).toMatch(/\.shipments-page \.ds-pagination__controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  });
});
