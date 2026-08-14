import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

describe('shipment container editor density', () => {
  it('keeps Untitled toolbar inputs inside a single outlined control shell', () => {
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control__input\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*inherit;[^}]*outline:\s*0;/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control__input:focus-visible\s*\{[^}]*outline:\s*0;/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control\s*,[\s\S]*?border:\s*1px solid var\(--line-strong\);/);
    expect(css).toMatch(/\.cus-worksheet-toolbar \.shipment-uui-control:focus-within,[\s\S]*?outline:\s*2px solid/);
  });

  it('wraps note-editor guidance inside its fixed table column', () => {
    expect(css).toMatch(/\.cus-note-editor-group\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
    expect(css).toMatch(/\.cus-note-editor-group > small\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('keeps inline edit affordances visible in the stacked and touch layouts', () => {
    expect(css).toMatch(/@container \(max-width: 1000px\)[\s\S]*?\.cus-inline-trigger:not\(:disabled\) \.cus-inline-edit-affordance\s*\{[^}]*opacity:\s*1;/);
    expect(css).toMatch(/@media \(hover: none\)[\s\S]*?\.cus-inline-trigger:not\(:disabled\) \.cus-inline-edit-affordance\s*\{[^}]*opacity:\s*1;/);
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
