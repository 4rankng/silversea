import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1175 — the "Phiếu hoàn ứng" KPI strip holds TWO cards (Đã ghi nhận ·
// Tồn tạm ứng). The track list was pinned to three columns, so at 1440px the
// row ran 1144px wide with only two cards in it: the third column (x≈1035 →
// 1417) showed bare page background — an empty sage band beside the cards.
// The strip must fill its row with the cards it actually has, and the column
// count must follow the rendered card count so a card added or removed can
// never leave a hole.
const css = readFileSync(resolve(process.cwd(), 'src/pages/AdminAdvanceSettlementsPage.css'), 'utf8');

describe('AdminAdvanceSettlementsPage — the KPI strip fills its row (SIL-1175)', () => {
  it('derives the desktop column count from the cards (auto-fit), not a fixed 3', () => {
    expect(css).toMatch(
      /\.as-page \.as-kpi-row \{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\)/s,
    );
  });

  it('keeps no fixed column count for the strip in any band', () => {
    // A fixed track list is the pitfall: 2 cards in 3 columns left the third
    // cell empty, and the same list would leave a hole the moment the strip
    // grows a card. (The ledger grid below keeps its own fixed tracks — that
    // is a table, not the KPI strip.)
    expect(css).not.toMatch(/\.as-page \.as-kpi-row \{[^}]*grid-template-columns:\s*repeat\(\d/s);
  });

  it('keeps the phone band card-driven — one column per rendered card', () => {
    expect(css).toMatch(
      /\.as-page \.as-kpi-row \{[^}]*grid-auto-flow:\s*column;[^}]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/s,
    );
  });

  it('still lays the strip out as a grid that spans the row', () => {
    expect(css).toMatch(/\.as-page \.as-kpi-row \{[^}]*display:\s*grid;/s);
    expect(css).toMatch(/\.as-page \.as-kpi \{[^}]*min-width:\s*0;/s);
  });
});
