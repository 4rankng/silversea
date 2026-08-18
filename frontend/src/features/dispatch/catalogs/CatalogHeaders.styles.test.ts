import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const catalogDirectory = resolve(import.meta.dirname);
const css = readFileSync(resolve(catalogDirectory, 'catalogs.css'), 'utf8');

describe('dispatcher catalogue headers', () => {
  it.each(['FleetVehiclesView.tsx', 'FleetDriversView.tsx', 'SuppliersView.tsx'])(
    '%s opts into the shared action rail',
    (view) => {
      const source = readFileSync(resolve(catalogDirectory, view), 'utf8');
      expect(source).toContain('dispatch-catalogs__page-header');
      expect(source).toContain('dispatch-catalogs__page-heading');
      expect(source).toContain('<Button size="sm" color="primary"');
    },
  );

  it('keeps the action on the desktop right rail and stacks it only on phones', () => {
    expect(css).toMatch(/\.dispatch-catalogs__page-header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.dispatch-catalogs__page-header\s*\{[\s\S]*?flex-direction:\s*column;/);
  });

  it('reflows every catalogue row into labelled mobile records without horizontal overflow', () => {
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.dispatch-catalogs__table tbody\s*\{[\s\S]*?display:\s*grid;/);
    expect(css).toMatch(/\.dispatch-catalogs__table tbody tr\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.dispatch-catalogs__table td\[data-label\]::before\s*\{[\s\S]*?content:\s*attr\(data-label\);/);
    for (const view of ['FleetVehiclesView.tsx', 'FleetDriversView.tsx', 'SuppliersView.tsx']) {
      expect(readFileSync(resolve(catalogDirectory, view), 'utf8')).toContain('data-label=');
    }
  });
});
