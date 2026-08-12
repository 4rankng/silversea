import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');

describe('shipment container editor density', () => {
  it('fits the desktop drawer and keeps its controls on one compact scale', () => {
    expect(css).toMatch(/\.cus-shipment-drawer\s*\{[^}]*width:\s*min\(960px, 100vw\);[^}]*max-width:\s*min\(960px, 100vw\);/);
    expect(css).toMatch(/\.cus-container__facts,[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.cus-container__facts input,[\s\S]*?box-sizing:\s*border-box;[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?height:\s*38px;/);
    expect(css).toMatch(/\.cus-container__facts \.searchable-select__trigger\s*\{[^}]*height:\s*38px;[^}]*min-height:\s*38px;[^}]*font-size:\s*13px;/);
  });

  it('retains touch-sized, zoom-safe controls on narrow screens', () => {
    expect(css).toMatch(/@media \(max-width: 900px\)[\s\S]*?\.cus-shipment-drawer \.searchable-select__trigger,[\s\S]*?height:\s*44px;[\s\S]*?min-height:\s*44px;/);
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*?\.cus-shipment-drawer \.searchable-select__trigger\s*\{[^}]*font-size:\s*16px;/);
  });
});
