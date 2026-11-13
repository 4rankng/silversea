import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetMonthlyReportPage.css'), 'utf8');

/* SIL-810 (AC 2) — Bảng Tổng Hợp Xếp Lệnh tháng: sticky cột trái, ô ngày
 * 28–32px, wrap tự cuộn ngang đủ 31 ngày + 10 cột tổng (cũ: overflow visible
 * để thead ghim scrollport app-body → shell cắt bảng ở ngày ~19).
 *
 * @media/@container behavior isn't reliably testable through jsdom, so this
 * asserts on the raw CSS text — same pattern as driver-density.styles.test.ts.
 */
describe('SIL-810 — monthly dispatch table sticky/scroll contract', () => {
  it('wrap is its own horizontal scrollport and never collapses into cards', () => {
    const wrap = css.slice(
      css.indexOf('.record-table-wrap.ts-report-wrap {'),
      css.indexOf('.record-table-wrap.ts-report-wrap .ts-report thead th'),
    );
    expect(wrap).toMatch(/overflow:\s*auto/);
    expect(wrap).toMatch(/container-type:\s*normal/);
    expect(wrap).toMatch(/max-height:\s*calc\(100vh/);
    // (0,2,0) — phải thắng bản duplicate `.record-table-wrap{overflow:visible}`
    // xuất hiện SAU sheet này vì record-table.css bị import hai lần (FB-063).
    expect(wrap).toMatch(/\.record-table-wrap\.ts-report-wrap \{/);
    expect(css).toMatch(/\.record-table-wrap\.ts-report-wrap \.ts-report thead th \{\s*top:\s*0;\s*\}/);
  });

  it('day cells stay in the 28–32px band', () => {
    const dayBlock = css.slice(
      css.indexOf('.ts-report .ts-report__day,\n.ts-report .ts-report__cell'),
      css.indexOf('/* Bề rộng tường minh'),
    );
    expect(dayBlock).toMatch(/min-width:\s*28px/);
    expect(dayBlock).toMatch(/max-width:\s*32px/);
  });

  it('five lead columns pin left on an explicit 0/44/120/224/334 chain', () => {
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/td:nth-child\(1\) \{ width: 44px;\s*min-width: 44px;\s*max-width: 44px;\s*left: 0;/);
    expect(css).toMatch(/td:nth-child\(2\) \{ width: 76px;\s*min-width: 76px;\s*max-width: 76px;\s*left: 44px;/);
    expect(css).toMatch(/td:nth-child\(3\) \{ width: 104px; min-width: 104px; max-width: 104px; left: 120px;/);
    expect(css).toMatch(/td:nth-child\(4\) \{ width: 110px; min-width: 110px; max-width: 110px; left: 224px;/);
    expect(css).toMatch(/td:nth-child\(5\) \{ width: 160px; min-width: 160px; max-width: 160px; left: 334px;/);
    // Pinned cells carry an opaque surface or they smear the grid beneath.
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*background:\s*var\(--surface\)/s);
  });

  it('header lead cells stack above pinned body cells (z 4 > z 2)', () => {
    expect(css).toMatch(/\.ts-report thead th:nth-child\(-n \+ 5\) \{\s*z-index:\s*4;\s*\}/);
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*z-index:\s*2;/s);
  });
});
