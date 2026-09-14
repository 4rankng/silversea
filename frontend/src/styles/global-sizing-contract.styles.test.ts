import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * Global sizing contract — the /shipments + điều vận golden standard applies
 * app-wide, not per route. Tokens live on :root, a zero-specificity base
 * carries the table type scale to every table, and filter density stays on
 * the compact 34px desktop / 44px touch contract.
 */
describe('global sizing contract', () => {
  const opsCss = read('src/styles/operational-table-typography.css');

  it('promotes the operational type scale to :root so every page inherits it', () => {
    expect(opsCss).toMatch(/:root\s*\{[^}]*--ops-table-header-size:\s*var\(--text-label-size\)/);
    expect(opsCss).toMatch(/:root\s*\{[^}]*--ops-table-primary-size:\s*var\(--text-data-size\)/);
    expect(opsCss).toMatch(/:root\s*\{[^}]*--ops-table-supporting-size:\s*var\(--text-data-size\)/);
    expect(opsCss).toMatch(/:root\s*\{[^}]*--ops-table-meta-size:\s*var\(--text-label-size\)/);
  });

  it('keeps a zero-specificity base so unstyled tables adopt the scale', () => {
    expect(opsCss).toContain(':where(table thead th)');
    expect(opsCss).toContain(':where(table tbody td)');
    expect(opsCss).toContain(':where(table tbody strong)');
  });

  it('imports the global table base ahead of component styles', () => {
    const index = read('src/index.css');
    const opsImport = index.indexOf('styles/operational-table-typography.css');
    const firstComponent = index.indexOf('components/');
    expect(opsImport).toBeGreaterThan(-1);
    expect(firstComponent).toBeGreaterThan(opsImport);
  });

  it('keeps filter density on the compact desktop / mobile contract', () => {
    const tokens = read('src/styles/tokens.css');
    expect(tokens).toContain('--filter-control-h: var(--control-compact-h);');
    // Compact geometry remains independent from the readable text scale.
    expect(tokens).toMatch(/@media \(max-width: 640px\)\s*\{[^]*--filter-control-h: var\(--control-mobile-h\)/);
  });
});
