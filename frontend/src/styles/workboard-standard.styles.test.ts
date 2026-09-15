import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Workboard golden standard — the /shipments table + summary rail anatomy is
 * the app-wide default for data tables (docs/design-guidelines.md
 * §"Workboard table & summary rail"). These pins guard the shared layers so
 * drift fails CI instead of shipping as per-route variants.
 */
const recordTableCss = readFileSync(resolve(process.cwd(), 'src/styles/record-table.css'), 'utf8');
const tableCss = readFileSync(resolve(process.cwd(), 'src/components/Table.css'), 'utf8');
const railCss = readFileSync(resolve(process.cwd(), 'src/design-system/SummaryRail.css'), 'utf8');

/**
 * Surfaces whose th rules legitimately predate or sit outside the standard.
 * Every entry needs a reason; shrinking this list is backlog.
 */
const THEAD_CASE_ALLOWLIST = [
  'src/pages/ShipmentsPage.css', // frozen workboard family (drawer container table)
  'src/pages/ShipmentDetailPage.css', // frozen /shipments/:id family
  'src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css', // dialog contract
  'src/features/recoverable-costs/RecoverableCostsWorkspace.css', // group-head band (tbody brand separator, not a column thead)
  'src/components/billing/BillingDocumentBuilder.css', // pre-existing document builder surface
  'src/components/work-inbox/RoleWorkInbox.css', // pre-existing inbox surface
  'src/pages/config/config-page.css', // pre-existing CrudTable family skin
  'src/pages/config/debit-note-template-editor.css', // pre-existing editor preview
  'src/pages/ForwarderTripsPage.css', // dead CSS kept by a stale test (see memory) — fork is moot
];

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

describe('workboard table & summary rail (golden standard)', () => {
  it('record-table thead wears the standard skin', () => {
    const thead = recordTableCss.match(/\.record-table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('padding: 10px 12px');
    expect(thead).toContain('color: var(--ink-2)');
    expect(thead).toContain('background: var(--surface-2)');
    expect(thead).toContain('border-bottom: 1px solid var(--line-strong)');
    expect(thead).toContain('position: sticky');
    // Case and tracking are owned by the global thead rule, never re-declared
    // per surface — a text-transform here would fork the standard.
    expect(thead).not.toMatch(/text-transform|letter-spacing/);
  });

  it('the global table base owns header case and tracking exactly once', () => {
    const globalThead = tableCss.match(/^thead th\s*\{([^}]*)\}/m)?.[1] ?? '';
    expect(globalThead).toContain('text-transform: uppercase');
    expect(globalThead).toContain('letter-spacing: 0.08em');
  });

  it('no surface re-declares header case or tracking outside the allowlist', () => {
    const forks: string[] = [];
    for (const file of cssFiles(resolve(process.cwd(), 'src'))) {
      const rel = file.slice(file.indexOf('src' + '')).replace(/^.*?(src\/)/, 'src/');
      if (file.endsWith('components/Table.css')) continue; // the authority
      if (THEAD_CASE_ALLOWLIST.some((p) => rel === p || file.endsWith(p))) continue;
      const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const match of css.matchAll(/[^}{]*\bth\s*(?:::[a-z-]+)?\s*\{[^}]*\b(?:text-transform|letter-spacing)\s*:[^}]*\}/g)) {
        forks.push(`${rel}: ${match[0].trim().slice(0, 90)}`);
      }
    }
    expect(forks).toEqual([]);
  }, 15000);

  it('the shared card collapse keeps labelled record cards', () => {
    expect(recordTableCss).toMatch(
      /@container \(max-width:\s*1100px\)[\s\S]*?\.record-table thead\s*\{[^}]*display:\s*none;/,
    );
    expect(recordTableCss).toContain("content: attr(data-label);");
  });

  it('the summary rail is a ruled decision rail, not cards', () => {
    expect(railCss).toMatch(/\.summary-rail\s*\{[^}]*border-block:\s*1px solid var\(--line\);/);
    expect(railCss).toMatch(/\.summary-rail__item\s*\{[^}]*border-right:\s*1px solid var\(--line\);/);
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-size:\s*var\(--text-section-size\);/);
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-family:\s*var\(--font-data\);/);
    // Tones color the number only — never a filled container.
    expect(railCss).toMatch(/\.summary-rail__item--warning dd\s*\{\s*color:\s*var\(--warning-text\);/);
    expect(railCss).not.toMatch(/\.summary-rail__item--warning\s*\{[^}]*background/);
    const item = railCss.match(/\.summary-rail__item\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(item).not.toMatch(/border-radius|background|box-shadow/);
  });
});
