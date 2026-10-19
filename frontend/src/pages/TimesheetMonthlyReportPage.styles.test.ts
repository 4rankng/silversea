import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// FB-063 — header của bảng report ("T2 01", …) xuống dòng hai dòng trong khi
// mọi bảng khác trong app đều một dòng. record-table.css cố ý ghim
// `thead th { white-space: normal }` làm hợp đồng cho CÁC TRANG KHÁC — và nó
// bị import hai lần (recipe @import), lần trùng vào SAU sheet trang này, nên
// fix phải dùng selector đủ độ  ưu tiên `table.ts-report thead th` (0,1,3)
// thắng cả hai lần import — không được sửa record-table.css.
const css = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetMonthlyReportPage.css'), 'utf8');

describe('ts-report header nowrap contract (FB-063)', () => {
  it('keeps the report table headers on one line via a page-scoped rule', () => {
    const rule = css.match(/table\.ts-report thead th \{[\s\S]*?\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain('white-space: nowrap');
  });
});
