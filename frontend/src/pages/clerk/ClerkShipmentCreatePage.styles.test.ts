import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/clerk/ClerkShipmentCreatePage.css'), 'utf8');
const source = readFileSync(
  resolve(process.cwd(), 'src/features/shipments/create/ShipmentCreateWorkspace.tsx'),
  'utf8',
);

describe('shipment create responsive layout', () => {
  it('keeps container fields shrinkable inside the page workspace', () => {
    expect(source).toContain('className="csc-container-grid"');
    expect(css).toMatch(/\.csc-container-record\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-editor\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0;/);
    expect(css).toMatch(/\.csc-container-grid\s+select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('collapses the container grid to one column on narrow screens', () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-container-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important;/,
    );
  });
});
