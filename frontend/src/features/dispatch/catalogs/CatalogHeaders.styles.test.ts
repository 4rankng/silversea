import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const catalogDirectory = resolve(import.meta.dirname);
const css = readFileSync(resolve(catalogDirectory, 'catalogs.css'), 'utf8');

describe('dispatcher catalogue headers', () => {
  it.each(['FleetVehiclesView.tsx', 'FleetDriversView.tsx', 'SuppliersView.tsx'])(
    '%s keeps its primary create action in the header',
    (view) => {
      const source = readFileSync(resolve(catalogDirectory, view), 'utf8');
      expect(source).toContain('<Button size="sm" color="primary"');
    },
  );

  it.each(['FleetVehiclesView.tsx', 'FleetDriversView.tsx'])(
    '%s hosts row 1 through the shared command-strip shell',
    (view) => {
      const source = readFileSync(resolve(catalogDirectory, view), 'utf8');
      expect(source).toContain('title="Danh mục');
      // Row-1 segmented group is the shared Tabs primitive (operator ruling
      // 2026-09-27: the fleet-vehicle status group is the app-wide reference).
      expect(source).toContain("variant=\"boxed\"");
    },
  );

  it('keeps the action beside the title with compact phone spacing', () => {
    expect(css).toMatch(/\.dispatch-catalogs__page-header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?justify-content:\s*space-between;/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.dispatch-catalogs__page-header\s*\{[\s\S]*?align-items:\s*flex-start;[\s\S]*?gap:\s*8px;/);
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

describe('fleet catalog command strips (card 20260926_57 — chief spec)', () => {
  const vehicles = readFileSync(resolve(catalogDirectory, 'FleetVehiclesView.tsx'), 'utf8');
  const drivers = readFileSync(resolve(catalogDirectory, 'FleetDriversView.tsx'), 'utf8');
  const shell = readFileSync(resolve(catalogDirectory, 'CatalogTableShell.tsx'), 'utf8');

  it('cuts the header block: tutorial subtitles and KPI tiles are gone from both fleet views', () => {
    expect(vehicles).not.toContain('Tra cứu xe đầu kéo nội bộ');
    expect(drivers).not.toContain('Tra cứu tài xế nội bộ');
    expect(vehicles).not.toContain('dispatch-catalogs__summary');
    expect(drivers).not.toContain('dispatch-catalogs__summary');
    expect(vehicles).not.toMatch(/<KPI\b/);
    expect(drivers).not.toMatch(/<KPI\b/);
  });

  it('vehicles row 1 carries clickable segmented status tabs that filter', () => {
    expect(vehicles).toContain('<Tabs');
    expect(vehicles).toContain('statusFilter');
    expect(vehicles).toContain('Bảo trì / Ngưng');
  });

  it('row 2 shell carries the docked counter and conditional reset (no kbd badge)', () => {
    expect(shell).not.toContain('dispatch-catalogs__kbd');
    expect(shell).toMatch(/onReset/);
    expect(shell).toMatch(/hasActiveFilters/);
    expect(shell).toMatch(/metaKey|ctrlKey/);
  });

  it('row 2 IS the shared filter plane — no page-local toolbar anywhere (card 20260927_152)', () => {
    expect(shell).toContain("import { FilterBar } from '../../../design-system';");
    expect(shell).toContain('<FilterBar');
    // The bespoke toolbar, its search wrapper and the page-owned widths are gone
    // from BOTH the shell's markup and the sheet's rules: a page rule may not
    // size or lay out a filter control, and the search cap belongs to
    // ListFilterBar.css (300px). The deleted selectors survive only inside the
    // explanatory comments, so the assertions read rule headers.
    expect(shell).not.toMatch(/className="dispatch-catalogs__toolbar"/);
    expect(css).not.toMatch(/^\.dispatch-catalogs__toolbar\s*,?\s*\{/m);
    expect(css).not.toMatch(/^\.dispatch-catalogs__search(?:-wrap)?\s*\{/m);
    expect(css).not.toMatch(/^\.dispatch-catalogs__carrier-filter\s*\{/m);
    // Every catalog view renders through that ONE shell, so no route keeps a
    // second filter plane.
    for (const view of ['FleetVehiclesView.tsx', 'FleetDriversView.tsx', 'SuppliersView.tsx', 'ExternalFleetView.tsx']) {
      expect(readFileSync(resolve(catalogDirectory, view), 'utf8')).toContain('<CatalogTableShell');
    }
  });

  it('puts the one secondary criterion behind the shared Bộ lọc trigger', () => {
    expect(vehicles).toContain('<FilterDropdown');
    expect(vehicles).toContain('ariaLabel="Bộ lọc"');
    expect(vehicles).not.toContain('wrapperClassName="dispatch-catalogs__carrier-filter"');
  });

  it('carrier select reads "Nhà xe: Tất cả" as a chevron select', () => {
    expect(vehicles).toContain('Nhà xe: Tất cả');
  });
});
