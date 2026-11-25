import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* SIL-828 (id 957, UAT 14/11) — màn Lương & Chấm công (Kế toán) phải là bố
 * cục master-detail 2 cột: trái ~240px là DANH SÁCH lái xe, phải là lưới
 * chấm công + "Tổng kết lương tháng". Bảng lái xe toàn chiều rộng (SIL-809)
 * không phải bố cục mà khách yêu cầu.
 *
 * @media behavior isn't reliably testable through jsdom, so this asserts on
 * the raw CSS text — same pattern as driver-density.styles.test.ts.
 */
describe('SIL-828 — salary attendance master-detail layout contract', () => {
  const calendar = readFileSync(resolve(process.cwd(), 'src/pages/salary-attendance/calendar.css'), 'utf8');

  it('desktop grid: 240px master column + fluid detail; sidebar becomes the 3rd column when selected', () => {
    const desktop = calendar.slice(calendar.indexOf('@media (min-width: 1025px)'));
    expect(desktop).toMatch(/\.salary-page-layout\s*\{[^}]*grid-template-columns:\s*240px\s+minmax\(0,\s*1fr\);/s);
    expect(desktop).toMatch(/\.salary-page-layout\.has-selected\s*\{[^}]*grid-template-columns:\s*240px\s+minmax\(0,\s*1fr\)\s+320px;/s);
    // Master list owns column 1; calendar (main) column 2; sidebar column 3.
    expect(desktop).toMatch(/\.salary-page-layout > \.salary-master-list\s*\{[^}]*grid-column:\s*1;/s);
    expect(desktop).toMatch(/\.salary-page-layout > \.salary-page-layout__main\s*\{[^}]*grid-column:\s*2;/s);
    expect(desktop).toMatch(/\.salary-page-layout\.has-selected > \.salary-page-layout__sidebar\s*\{[^}]*grid-column:\s*3;/s);
  });

  it('layout columns are fluid inside the shell canvas, no hard cap', () => {
    const baseBlock = calendar.slice(
      calendar.indexOf('.salary-page-layout {'),
      calendar.indexOf('@media (min-width: 1025px)'),
    );
    expect(baseBlock).not.toMatch(/max-width/);
  });

  it('master list is a vertical list, never a card-wall track grid', () => {
    const listBlock = calendar.slice(
      calendar.indexOf('.salary-master-list__items'),
      calendar.indexOf('.salary-master-list__item {'),
    );
    expect(listBlock).toMatch(/flex-direction:\s*column/);
    expect(listBlock).not.toMatch(/grid-template-columns/);
  });

  it('the dead full-width roster selectors are gone from every salary sheet', () => {
    for (const sheet of [
      'src/pages/salary-attendance/calendar.css',
      'src/pages/salary-attendance/hero-metrics.css',
      'src/pages/salary-attendance/month-nav.css',
      'src/pages/salary-attendance/responsive.css',
    ]) {
      expect(readFileSync(resolve(process.cwd(), sheet), 'utf8'), sheet).not.toMatch(/driver-select-row|driver-select-card/);
    }
  });

  // SIL-1003 — ở 390px danh sách lái xe chỉ rộng 143px và bên phải để trống
  // 231px. Lý do: luật gốc đặt `align-items: start` cho LƯỚI; ở ≤1023px bố cục
  // đổi thành flex CỘT, mà trong flex cột align-items là trục NGANG, nên các
  // phần tử không còn giãn ra hết chiều ngang.
  it('SIL-1003 — the phone column layout stretches its children to the full width', () => {
    const phone = calendar.slice(calendar.indexOf('@media (max-width: 1023px)'));
    expect(phone).toMatch(
      /\.salary-page-layout\.salary-page-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/s,
    );
  });
});
