import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('the shared card collapse keeps labelled record cards', () => {
    expect(recordTableCss).toMatch(
      /@container \(max-width:\s*1100px\)[\s\S]*?\.record-table thead\s*\{[^}]*display:\s*none;/,
    );
    expect(recordTableCss).toContain("content: attr(data-label);");
  });

  it('the summary rail is a ruled decision rail, not cards', () => {
    expect(railCss).toMatch(/\.summary-rail\s*\{[^}]*border-block:\s*1px solid var\(--line\);/);
    expect(railCss).toMatch(/\.summary-rail__item\s*\{[^}]*border-right:\s*1px solid var\(--line\);/);
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-size:\s*20px;/);
    expect(railCss).toMatch(/\.summary-rail dd\s*\{[^}]*font-family:\s*var\(--font-data\);/);
    // Tones color the number only — never a filled container.
    expect(railCss).toMatch(/\.summary-rail__item--warning dd\s*\{\s*color:\s*var\(--warning-text\);/);
    expect(railCss).not.toMatch(/\.summary-rail__item--warning\s*\{[^}]*background/);
    const item = railCss.match(/\.summary-rail__item\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(item).not.toMatch(/border-radius|background|box-shadow/);
  });
});
