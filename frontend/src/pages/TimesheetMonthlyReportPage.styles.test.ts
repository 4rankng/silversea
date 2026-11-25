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

  it('five lead columns pin left on an explicit 0/44/120/236/346 chain', () => {
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/td:nth-child\(1\) \{ width: 44px;\s*min-width: 44px;\s*max-width: 44px;\s*left: 0;/);
    expect(css).toMatch(/td:nth-child\(2\) \{ width: 76px;\s*min-width: 76px;\s*max-width: 76px;\s*left: 44px;/);
    // CR-010.1 (BUG-10) — cột 3 'Biển kiểm soát' 116px (trước 104px bị cắt
    // chữ 'T' khi sidebar mở), cột 4/5 dịch theo 236/346 để chuỗi khớp pixel.
    expect(css).toMatch(/td:nth-child\(3\) \{ width: 116px; min-width: 116px; max-width: 116px; left: 120px;/);
    expect(css).toMatch(/td:nth-child\(4\) \{ width: 110px; min-width: 110px; max-width: 110px; left: 236px;/);
    expect(css).toMatch(/td:nth-child\(5\) \{ width: 160px; min-width: 160px; max-width: 160px; left: 346px;/);
    // Header cells share the same grid — the nowrap 'Biển kiểm soát' th
    // never clips (FB-063's single-line header law stays).
    expect(css).toMatch(/th:nth-child\(3\):not\(\[colspan\]\) \{ width: 116px; min-width: 116px; max-width: 116px; left: 120px;/);
    expect(css).toMatch(/th:nth-child\(4\):not\(\[colspan\]\) \{ width: 110px; min-width: 110px; max-width: 110px; left: 236px;/);
    expect(css).toMatch(/th:nth-child\(5\):not\(\[colspan\]\) \{ width: 160px; min-width: 160px; max-width: 160px; left: 346px;/);
    // Pinned cells carry an opaque surface or they smear the grid beneath.
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*background:\s*var\(--surface\)/s);
  });

  it('header lead cells stack above pinned body cells (z 4 > z 2)', () => {
    expect(css).toMatch(/\.ts-report thead th:nth-child\(-n \+ 5\) \{\s*z-index:\s*4;\s*\}/);
    expect(css).toMatch(/\.ts-report tbody td:nth-child\(-n \+ 5\) \{[^}]*z-index:\s*2;/s);
  });
});

// SIL-990 — the pinned lead band must never eat the table. Audit tablet
// 25/11 (§8.1): the five pinned columns took 506px of the 744px scroll
// viewport (68%) and left a 238px hole — 8 day columns and 3 of the 10
// summary columns visible at a time. Below 1024px the band now pins the ROW
// IDENTITY only (STT · Biển kiểm soát · Lái xe = 320px = 43% of the
// viewport; the phone band drops 'Lái xe' too → 160px = 43% of 374px), so
// the scrollable area keeps the majority of the screen.
describe('SIL-990 — the pinned band keeps the scrollable area the majority', () => {
  it('leaves the desktop chain (0/44/120/236/346) untouched above 1024px', () => {
    expect(css).toMatch(/td:nth-child\(1\) \{ width: 44px;\s*min-width: 44px;\s*max-width: 44px;\s*left: 0;/);
    expect(css).toMatch(/td:nth-child\(5\) \{ width: 160px; min-width: 160px; max-width: 160px; left: 346px;/);
  });

  it('unpins Loại xe + Hình thức lương in the tablet band', () => {
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(tablet).toMatch(/\.ts-report thead th:nth-child\(2\):not\(\[colspan\]\),\s*\.ts-report thead th:nth-child\(4\):not\(\[colspan\]\) \{[^}]*left:\s*auto;/s);
    expect(tablet).toMatch(/\.ts-report tbody td:nth-child\(2\),\s*\.ts-report tbody td:nth-child\(4\) \{[^}]*position:\s*static;[^}]*left:\s*auto;/s);
  });

  it('unpins Lái xe in the phone band too', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'));
    expect(phone).toMatch(/\.ts-report thead th:nth-child\(5\):not\(\[colspan\]\) \{[^}]*left:\s*auto;/s);
    expect(phone).toMatch(/\.ts-report tbody td:nth-child\(5\) \{[^}]*position:\s*static;[^}]*left:\s*auto;/s);
  });

  it('keeps the vertical header pin — only the horizontal pin is dropped', () => {
    expect(css).toMatch(/\.record-table-wrap\.ts-report-wrap \.ts-report thead th \{\s*top:\s*0;\s*\}/);
  });
});

// SIL-989 — the surviving tablet chain must be recomputed over the ACTUAL
// pinned set. The desktop lefts (120/236/346) are cumulative over all five
// columns; once Loại xe + Hình thức lương unpin below 1024px, those numbers
// left 76px and 186px holes that day cells slid through, and the band still
// ended at 346+160 = 506px (68% of the 744px viewport). The tablet set is
// STT 44 + Biển kiểm soát 116 + Lái xe 160 → cumulative 0/44/160, band
// 320px of 744px (43%).
describe('SIL-989 — tablet band recomputes cumulative lefts over the actual pinned set', () => {
  it('repins Biển kiểm soát at 44px and Lái xe at 160px (chain 0/44/160)', () => {
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(tablet).toMatch(/th:nth-child\(3\):not\(\[colspan\]\),\s*\.ts-report tbody td:nth-child\(3\) \{\s*left:\s*44px;/s);
    expect(tablet).toMatch(/th:nth-child\(5\):not\(\[colspan\]\),\s*\.ts-report tbody td:nth-child\(5\) \{\s*left:\s*160px;/s);
  });

  it('drops the metric-row labels out of the horizontal pin (colspan=5 box cannot shrink)', () => {
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(tablet).toMatch(/\.ts-report thead th\[colspan='5'\] \{\s*left:\s*auto;/);
  });

  it('rides the unpinned lead headers under the pinned band (z 3 < 4)', () => {
    const tablet = css.slice(css.indexOf('@media (max-width: 1023px)'));
    expect(tablet).toMatch(/th:nth-child\(2\):not\(\[colspan\]\),\s*\.ts-report thead th:nth-child\(4\):not\(\[colspan\]\) \{[^}]*left:\s*auto;[^}]*z-index:\s*3;/s);
  });
});
