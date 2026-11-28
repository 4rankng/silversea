import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-1253 (id 1530) — "Thêm khoản chi" draft fields must not be squeezed to
 * half-cells inside the two group panels. The drawer canvas is capped at 580px
 * (Drawer.css), SIL-1028 splits the body into two ~272px panels, and the draft
 * row keeps ~220px — a 2-column field grid there computes 104px cells, below
 * the DD/MM/YYYY segmented run (~90px min-content + icon strip + padding), so
 * "Ngày chi" rendered "28/11/202" and the selects wrapped/truncated
 * ("Chọn nhâ…", "Công ty trả trực tiếp" on 3 lines). Inside a group panel the
 * field grid stacks to ONE column so every control takes the row's full width.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/expense-accounting/ExpenseAccounting.css'), 'utf8');

const fieldsIn = (scope: RegExp) => {
  const block = css.match(scope)?.[1] ?? '';
  return block.match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? '';
};

describe('SIL-1253 — group-panel draft fields get the full draft-row width', () => {
  it('stacks the field grid to one column inside a group panel (was 2×104px cells)', () => {
    expect(fieldsIn(/\.expense-group-panel \.expense-accounting-fields\s*\{([\s\S]*?)\}/)).toBe('minmax(0, 1fr)');
  });

  it('keeps the shared 2-column field grid for wide-canvas drawers', () => {
    // ExpenseEntryDrawer & friends host the same class at full drawer width —
    // the squeeze fix is scoped to the narrow panel, not painted over the base.
    expect(fieldsIn(/(?:^|\n)\.expense-accounting-fields\s*\{([\s\S]*?)\}/)).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('keeps the SIL-1028 two-up group panels (and their ≤900px collapse) intact', () => {
    // The owner ruling (KB K6.9): "Tiền đường" / "Chi phí lô hàng" display side
    // by side; only the field layer yields width, never the panel arrangement.
    expect(fieldsIn(/\.expense-accounting-group-panels\s*\{([\s\S]*?)\}/)).toBe('repeat(2, minmax(0, 1fr))');
    expect(css).toMatch(/@media \(max-width: 900px\) \{[^}]*\.expense-accounting-group-panels \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});
