// SIL-590 (owner 27/10 — "Chỉnh sửa điều phối" chưa dense): the desktop
// fields grid packs Phân loại + Cước thu + Cước trả on ONE row (Đóng kết hợp
// on the last track) and the money inputs size to their CONTENT (≤200px cap)
// instead of stretching across a half dialog. The SIL-520 dialog WIDTH is
// untouched — density within the width, not the width itself.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css'), 'utf8');

describe('DispatchPlanEditorCell dense fields grid (SIL-590)', () => {
  it('at ≥900px Phân loại + Cước thu + Cước trả share ONE row (combined on the last track)', () => {
    const block = css.match(/@media \(min-width:\s*900px\)\s*\{\s*\.dispatch-assignment-dialog__fields\s*\{([\s\S]*?)\}\s*\}/)?.[1] ?? '';
    expect(block, 'the ≥900px fields template must exist').not.toBe('');
    expect(block).toContain("'classification revenue cost combined'");
    expect(block).toContain('repeat(4, minmax(0, 1fr))');
    // SIL-520's row pair laws survive: carrier+vehicle on row 1, the run/end
    // datetime pair still shares its own row.
    expect(block).toContain("'carrier carrier vehicle vehicle'");
    expect(block).toContain("'run run end end'");
  });

  it('the money fields are content-sized — never a half-dialog stretch', () => {
    const money = css.match(/\.dispatch-assignment-dialog__money\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(money, 'the money rule must exist').not.toBe('');
    expect(money).toContain('width: min(200px, 100%)');
    expect(money).toContain('justify-self: start');
  });

  it('the sub-900 layouts keep their stacked fallback (phone/tablet unchanged)', () => {
    // Base template: run/end stacked full-width rows; ≤640 keeps the
    // carrier/vehicle stack and the classification+combined pair.
    expect(css).toMatch(/grid-template-areas:\s*'carrier vehicle'\s*\n\s*'classification combined'\s*\n\s*'revenue cost'\s*\n\s*'run run'\s*\n\s*'end end';/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.dispatch-assignment-dialog__fields\s*\{[\s\S]*?'carrier carrier'/);
  });
});
