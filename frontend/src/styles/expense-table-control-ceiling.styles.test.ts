import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const accounting = readFileSync(resolve(process.cwd(), 'src/features/expense-accounting/ExpenseAccounting.css'), 'utf8');
const table = readFileSync(resolve(process.cwd(), 'src/components/Table.css'), 'utf8');

describe('expense table action geometry owners', () => {
  it('keeps every existing title and money action caller on the shared button recipe', () => {
    for (const name of ['ExpenseRegisterRows', 'ExpenseWorkRows', 'ExpenseReport', 'ExpenseReconciliationHistory', 'ExpenseHistory']) {
      const source = readFileSync(resolve(process.cwd(), `src/features/expense-accounting/${name}.tsx`), 'utf8');
      const callers = [...source.matchAll(/className="([^"]*expense-register-(?:open|money)[^"]*)"/g)];
      expect(callers.length, name).toBeGreaterThan(0);
      for (const caller of callers) expect(caller[1], name).toMatch(/^btn btn--ghost btn--sm expense-register-(?:open|money)$/);
    }
  });

  it('gives complete matrix action labels intrinsic tracks and the phone title its full record lane', () => {
    expect(accounting).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.expense-register-table td:has\(> \.expense-register-open\)\s*\{\s*min-width: max-content;/);
    expect(accounting).toMatch(/td\[data-label="Khoản chi"\][^{]*\{[^}]*grid-column: 1 \/ -1;/);
    expect(accounting).not.toMatch(/\.expense-register-open[^}]*font: inherit/);
  });

  it('keeps dormant fee-action geometry on the canonical control token', () => {
    const trigger = table.match(/\.fee-action-trigger\s*\{([^}]+)\}/)?.[1] ?? '';
    const item = table.match(/\.fee-action-dropdown__item\s*\{([^}]+)\}/)?.[1] ?? '';
    for (const property of ['width', 'height', 'min-width', 'min-height']) expect(trigger).toContain(`${property}: var(--control-h)`);
    expect(item).toContain('min-height: var(--control-h)');
    expect(trigger + item).not.toContain('44px');
  });
});
