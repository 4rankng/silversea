import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-990 — the KPI strip holds THREE cards (Đã ghi nhận · Đã hủy · Tồn tạm
// ứng). The old fixed column counts left the row with an EMPTY cell: at the
// 768px tablet band the rule was `repeat(2, 1fr)`, so the void showed as a
// ~370×80px gray hole under the third card, and above 1280px it was a dead
// quarter of the ruled band. `auto-fit` collapses the unused tracks, so the
// cards always fill the row.
const css = readFileSync(resolve(process.cwd(), 'src/pages/AdminAdvancesPage.css'), 'utf8');

describe('AdminAdvancesPage — the KPI strip fills its row (SIL-990)', () => {
  it('uses an auto-fit track list so no column can stay empty', () => {
    expect(css).toMatch(/\.adv-page \.adv-kpi-row \{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\)/s);
  });

  it('keeps no fixed 2- or 4-column grid in any band', () => {
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    expect(css).not.toMatch(/grid-template-columns:\s*repeat\(4,\s*1fr\)/);
  });

  it('still pins three equal cells on the phone band', () => {
    expect(css).toMatch(/\.adv-page \.adv-kpi-row \{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  });
});
