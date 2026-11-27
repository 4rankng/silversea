// SIL-1184 — the Đối chiếu day grid is a RECORD LIST, not the calendar
// editing sheet. `ts-grid` is TimesheetGridPage's vocabulary: in the ≤1100px
// card band it restores table mode + a 720px floor while the shared
// data-label eyebrows still fire inline, so a record list riding it shows
// BOTH the header row AND inline labels (duplication) and its column-3
// header is cut at the 390px edge. This file pins the class boundary in
// source (jsdom has no layout engine).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const tsx = readFileSync(resolve(process.cwd(), 'src/pages/TimesheetReconciliationPage.tsx'), 'utf8');

describe('Đối chiếu day grid rides the shared record-card band, never the calendar vocabulary', () => {
  it('renders both tables on the shared recipe — no `ts-grid` anywhere on this page', () => {
    // The calendar class must never come back on a data-label record list:
    // it re-enables thead + the 720px floor inside the card band where the
    // inline eyebrows are the ONE labeling form. (The page's comment names
    // the class on purpose; only applied classNames are asserted.)
    expect(tsx).not.toMatch(/className="[^"]*\bts-grid\b/);
    expect(tsx).toContain("import '../styles/record-table.css'");
    expect(tsx).toContain("import '../styles/operational-table-typography.css'");
    expect(tsx).toContain('className="record-table ops-table"');
  });

  it('carries data-label on every data cell so the card band stays labelled', () => {
    const cells = tsx.match(/<td[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell, `${cell} must carry data-label`).toContain('data-label');
    }
    // The day grid's five facts.
    for (const label of ['Ngày', 'Ký hiệu', 'Chuyến', 'Chỉnh lệch', 'Ngày công']) {
      expect(tsx, `${label} cell label`).toContain(`data-label="${label}"`);
    }
  });
});
