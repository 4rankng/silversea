import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// FB-063 — header của bảng report ("T2 01", …) xuống dòng hai dòng trong khi
// mọi bảng khác trong app đều một dòng. record-table.css cố ý ghim
// `thead th { white-space: normal }` làm hợp đồng cho CÁC TRANG KHÁC, nên
// fix nằm ở sheet scoped của trang này — không được sửa record-table.css.
const css = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetMonthlyReportPage.css'), 'utf8');

describe('ts-report header nowrap contract (FB-063)', () => {
  it('keeps the report table headers on one line via a page-scoped rule', () => {
    const rule = css.match(/\.ts-report thead th \{[\s\S]*?\}/)?.[0];
    expect(rule).toBeDefined();
    expect(rule).toContain('white-space: nowrap');
  });
});
