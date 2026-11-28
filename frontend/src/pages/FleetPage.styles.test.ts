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

// SIL-1187 retest R5 (owner DOM, 1440): the boards measured 1254px against
// the 1129px canvas (125px hidden) with the last column clipped at the
// viewport edge at DEFAULT scroll. The squeeze: multi-word count labels wrap
// at spaces (the shared base pinned `th { white-space: nowrap }`, making
// every label an unbreakable min-content), gutters trim to the dense 8px
// family, and the last daily column keeps its one-line header + 150px floor.
describe('FleetPage productivity boards — SIL-1187 retest R5 no-scroll squeeze', () => {
  it('count-column labels wrap at spaces — never nowrap, never a mid-word break', () => {
    const rule = rules.find((r) => r.selector === '.fleet-page .fleet-productivity-table thead th');
    expect(rule, 'page-level header wrap rule').toBeDefined();
    expect(rule!.body).toMatch(/white-space:\s*normal/);
    expect(rule!.body).toMatch(/word-break:\s*keep-all/);
  });

  it("the daily last column's header stays one line inside its 150px floor", () => {
    const rule = rules.find((r) => r.selector === '.fleet-page .fleet-productivity-table th:nth-child(10):last-child');
    expect(rule, 'last-column header nowrap rule').toBeDefined();
    expect(rule!.body).toMatch(/white-space:\s*nowrap/);
  });

  it('cell gutters trim to the dense 8px family on both th and td', () => {
    const rule = rules.find(
      (r) =>
        r.selector.includes('.fleet-page .fleet-productivity-table th') &&
        r.selector.trimEnd().endsWith('.fleet-page .fleet-productivity-table td'),
    );
    expect(rule, 'dense gutter rule (th + td)').toBeDefined();
    expect(rule!.body).toMatch(/padding-inline:\s*8px/);
  });
});

// QA 28/11 — the monthly board (13 columns) had no width budget, so its
// count columns crushed below the two-line header need and labels like
// 'Lấy lẻ chuyển kho' folded onto three lines. The floor keys on the
// monthly header row (13th and last th) so the 10-column daily board and
// its R5 no-scroll squeeze stay untouched.
describe('FleetPage productivity boards — QA 28/11 monthly header width law', () => {
  it('the monthly board floors wide enough for two-line headers and scrolls inside its wrap', () => {
    const rule = rules.find((r) =>
      r.selector.includes(':has(> thead > tr > th:nth-child(13):last-child)'),
    );
    expect(rule, 'monthly board min-width rule').toBeDefined();
    expect(rule!.body).toMatch(/min-width:\s*1360px/);
  });

  it("the monthly board's last column (% Năng suất cao) floors on BOTH th and td", () => {
    const rule = rules.find(
      (r) =>
        r.selector.includes('.fleet-productivity-table th:nth-child(13):last-child') &&
        r.selector.includes('.fleet-productivity-table td:nth-child(13):last-child'),
    );
    expect(rule, 'floor rule for the monthly last column (th + td)').toBeDefined();
    expect(rule!.body).toMatch(/min-width:\s*96px/);
  });
});

// QA 28/11 — six metric cards in the auto-fit productivity grid landed as
// 5 + 1 orphan. The shared chrome (this sheet is imported by both FleetPage
// and the standalone productivity page) pins a fixed 3-column grid: the
// daily board is an even 3×2, the monthly board a single 1×3 row.
const productivityCss = readFileSync(resolve(process.cwd(), 'src/pages/FleetProductivityPage.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const productivityRules = [...productivityCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  body: m[2],
}));

describe('FleetPage productivity boards — QA 28/11 metric grid law', () => {
  it('the metric grid is a fixed 3-column grid, never the 5+1 orphan auto-fit', () => {
    const rule = productivityRules.find((r) => r.selector === '.fleet-productivity-kpis');
    expect(rule).toBeDefined();
    expect(rule!.body).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(rule!.body).not.toMatch(/auto-fit/);
  });

  it('narrow canvases fall back to two even columns', () => {
    // The naive rule parser flattens @media blocks: inside one, the inner
    // rule still parses with its own selector, so pin the 2-column body.
    const rule = productivityRules.find(
      (r) => r.selector === '.fleet-productivity-kpis' && /repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(r.body),
    );
    expect(rule).toBeDefined();
  });
});
