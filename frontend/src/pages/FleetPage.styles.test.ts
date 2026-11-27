// SIL-1186 + SIL-1187 — the 'Báo cáo năng suất' boards FleetPage embeds
// (DailyProductivityView / MonthlyProductivityView; their base chrome lives
// in FleetProductivityPage.css, which FleetPage.tsx also imports). These
// pins guard the page-local overrides in FleetPage.css: the BIỂN SỐ XE
// column is ONE expandable token behind a per-column floor on th+td (the
// global `tbody td { overflow-wrap: anywhere }` may not shred a plate
// mid-string), and the daily table's last column (Số Bill/Booking) floors
// to its longest header/value so the visible edge can never crush a chip.
// No data cell may soft-clip.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/FleetPage.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
}));

describe('FleetPage productivity boards — SIL-1186 plate column law', () => {
  it('the plate column floors at 110px on BOTH th and td', () => {
    const rule = rules.find(
      (r) =>
        r.selector.includes('.fleet-productivity-table th:nth-child(2)') &&
        r.selector.includes('.fleet-productivity-table td:nth-child(2)'),
    );
    expect(rule, 'floor rule for the plate column (th + td)').toBeDefined();
    expect(rule!.body).toMatch(/min-width:\s*110px/);
  });

  it('the plate cell is a single-token expand — one line, no anywhere break, no clip', () => {
    const rule = rules.find(
      (r) => r.selector === '.fleet-page .fleet-productivity-table td:nth-child(2)',
    );
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/white-space:\s*nowrap/);
    expect(rule!.body).toMatch(/overflow-wrap:\s*normal/);
    expect(rule!.body).toMatch(/word-break:\s*keep-all/);
    expect(rule!.body).not.toMatch(/ellipsis|overflow:\s*hidden|max-width/);
  });
});

describe('FleetPage productivity boards — SIL-1187 last column law', () => {
  it("the daily table's last column (Số Bill/Booking) floors at 150px on BOTH th and td", () => {
    const rule = rules.find(
      (r) =>
        r.selector.includes('.fleet-productivity-table th:nth-child(10):last-child') &&
        r.selector.includes('.fleet-productivity-table td:nth-child(10):last-child'),
    );
    expect(rule, 'floor rule for the Số Bill/Booking column (th + td)').toBeDefined();
    expect(rule!.body).toMatch(/min-width:\s*150px/);
  });

  it('a trip chip never breaks mid-token; multi-word chip text wraps at spaces only', () => {
    const rule = rules.find((r) =>
      r.selector.endsWith('.fleet-page .fleet-productivity-table .fleet-trip-chip'),
    );
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/overflow-wrap:\s*normal/);
    expect(rule!.body).toMatch(/word-break:\s*keep-all/);
    // Chips stay wrappable AT SPACES (never nowrap): multi-word values wrap,
    // single-token references expand the column into the wrap's scroll.
    expect(rule!.body).not.toMatch(/white-space:\s*nowrap/);
  });

  it('headers never chop mid-word — a th rule never carries the anywhere/break-all break', () => {
    for (const { selector, body } of rules) {
      if (!/(^|[\s,>+~])th\b/.test(selector)) continue;
      expect(body, `rule ${selector}`).not.toMatch(
        /overflow-wrap:\s*anywhere|word-break:\s*break-all/,
      );
    }
  });
});
