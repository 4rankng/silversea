import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kiểm toán 28/11 (§2.2) — "Thêm khoản chi": hai nhóm chi phí dựng lại thành
 * thanh tab phân đoạn "Chi phí lô hàng (n) | Tiền đường (n)" (bỏ chia đôi
 * 50/50 của SIL-1028/K6.9 vốn ép dòng nháp còn ~272px), drawer siết
 * min(640px, 100vw), ngày DD/MM/YYYY giữ sàn 160px (SIL-1253), giá trị select
 * không xuống dòng, lưới field ≤2 cột (1 cột dưới 540px), chú giải chuyển
 * xuống footer sticky cùng Đóng/Lưu.
 */

const css = readFileSync(resolve(process.cwd(), 'src/features/expense-accounting/ExpenseAccounting.css'), 'utf8');
const drawerCss = readFileSync(resolve(process.cwd(), 'src/components/Drawer.css'), 'utf8');

const blockOf = (scope: RegExp, source: string = css) => source.match(scope)?.[1] ?? '';

describe('SIL-1349 — kiểm toán 28/11 §2.2: drawer "Thêm khoản chi"', () => {
  it('drawer width clamps to min(640px, 100vw) — host ceiling through the shared formula', () => {
    // Shared `.drawer` chặn 580px; drawer khai chi nâng trần lên 640px qua
    // đúng công thức min(<px>, 100vw) của geometry law.
    expect(css).toContain('.expense-accounting-drawer { max-width: min(640px, 100vw); }');
  });

  it('sticky geometry stays the shared Drawer primitive law — head/foot fixed, only the body scrolls', () => {
    // The expense sheet must NOT re-declare the primitive's sticky layout:
    // .drawer__head/.drawer__foot are flex-shrink: 0, .drawer__body owns
    // overflow-y: auto (title + lot context + × and the footer stay put).
    expect(blockOf(/\.drawer__head\s*\{([\s\S]*?)\}/, drawerCss)).toContain('flex-shrink: 0');
    expect(blockOf(/\.drawer__foot\s*\{([\s\S]*?)\}/, drawerCss)).toContain('flex-shrink: 0');
    expect(blockOf(/\.drawer__body\s*\{([\s\S]*?)\}/, drawerCss)).toContain('overflow-y: auto');
    // The expense sheet only retunes body padding, never the scroll/sticky law.
    expect(css).not.toMatch(/\.expense-accounting-drawer\s*\{[^}]*overflow/);
  });

  it('group tabs fill the bar as two equal segments, one row, no label wrap', () => {
    expect(blockOf(/\.expense-accounting-group-tabs\s*\{([\s\S]*?)\}/)).toContain('width: 100%');
    const btns = blockOf(/\.expense-accounting-group-tabs \.ds-tabs__btn\s*\{([\s\S]*?)\}/);
    expect(btns).toContain('flex: 1 1 0');
    expect(btns).toContain('white-space: nowrap');
    // The old 50/50 split is gone with its selectors.
    expect(css).not.toContain('expense-accounting-group-panels');
  });

  it('date keeps a 160px floor so DD/MM/YYYY never clips (SIL-1253)', () => {
    expect(blockOf(/\.expense-accounting-drawer input\[data-date-input\]\s*\{([\s\S]*?)\}/)).toContain('min-width: 160px');
  });

  it('select values stay on one line with ellipsis — never the 3-line "Công ty trả trực tiếp"', () => {
    // The override must carry the shared law's full guard chain (incl.
    // :not(.filter-bar …)) so its specificity beats UuiSelectField.css's
    // wrap-for-forms rule instead of losing to it.
    const guard = '.ds-uui-select:has([data-label]):not(.ds-uui-select--inline):not(.ds-uui-select--content):not(.filter-bar .ds-uui-select)';
    const law = css.match(new RegExp(`\\.expense-accounting-drawer ${guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\[data-uui-select-value][^\\n]*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
    expect(law).toContain('white-space: nowrap');
    expect(law).toContain('text-overflow: ellipsis');
    expect(law).toContain('overflow: hidden');
  });

  it('field grid keeps ≤2 columns and collapses to one below 540px, scoped to this drawer', () => {
    expect(blockOf(/(?:^|\n)\.expense-accounting-fields\s*\{([\s\S]*?)\}/).match(/grid-template-columns:\s*([^;]+);/)?.[1]).toBe('repeat(2, minmax(0, 1fr))');
    expect(css).toMatch(/@media \(max-width: 540px\) \{\s*\.expense-accounting-drawer \.expense-accounting-fields \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\}/);
    // The removed panel-scoped one-column force stays gone — the tabbed panel
    // owns the full drawer width now.
    expect(css).not.toContain('.expense-group-panel .expense-accounting-fields');
  });

  it('the quỹ footnote lives in the sticky footer, pushing the buttons right', () => {
    expect(blockOf(/\.expense-accounting-footnote\s*\{([\s\S]*?)\}/)).toContain('margin: 0 auto 0 0');
  });
});
