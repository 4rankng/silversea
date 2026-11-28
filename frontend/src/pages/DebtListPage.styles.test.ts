import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// AUI-01 (audit 2026-11-27) — /debt: the conditional bucket-share column
// shifted every nth-child track rule, crushing the numeric columns. Tracks
// key on the data label instead (both th and td), the board scrolls inside
// its shared wrap, and numeric/date tokens never wrap mid-number.
const css = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/pages/DebtListPage.tsx'), 'utf8');

describe('DebtListPage — attribute-keyed column tracks (audit 2026-11-27 AUI-01)', () => {
  it('adopts the shared scroll wrap on the desktop table', () => {
    expect(tsx).toContain('className="record-table-wrap record-table-wrap--scroll"');
  });

  it('never sizes tracks by nth-child', () => {
    expect(css).not.toMatch(/debt-list-table thead th:nth-child/);
  });

  it('keys each value track on its data label, header and body alike', () => {
    const tracks: Array<[string, number]> = [
      ['Loại hình xe', 110],
      ['Tổng nợ', 130],
      ['Net công nợ', 130],
      ['Tiền quá hạn', 130],
      ['Quá hạn', 90],
      ['Ngày thanh toán gần nhất', 150],
    ];
    for (const [label, px] of tracks) {
      const rule = css.match(new RegExp(String.raw`\.debt-list-table \[data-label='${label}'\]\s*\{([^}]*)\}`));
      expect(rule, `track for ${label}`).toBeTruthy();
      expect(rule![1]).toContain(`width: ${px}px`);
      expect(rule![1]).toContain(`min-width: ${px}px`);
    }
    // The conditional bucket track keys on its class (its label is dynamic).
    const bucket = css.match(/\.debt-list-table \.debt-list-table__bucket\s*\{([^}]*)\}/);
    expect(bucket).toBeTruthy();
    expect(bucket![1]).toContain('width: 110px');
    // Four plain <th> cells carry the literal data-label (SortHeaders pass
    // theirs through the dataLabel prop).
    expect(tsx.match(/<th[^>]*data-label=/g)?.length).toBe(4);
  });

  it('keeps numbers on one line; the last-payment cell wraps its placeholder', () => {
    expect(css).toMatch(/\.debt-list-table td\.num \{ white-space: nowrap; \}/);
    // The date string itself has no spaces (stays one line); the 'Chưa có
    // phiếu thu' placeholder wraps instead of clipping at the column edge.
    expect(css).toMatch(/\.debt-list-table td\[data-label='Ngày thanh toán gần nhất'\] \{ white-space: normal; \}/);
    // The total cell re-allows its ' · status' suffix to wrap at the dot.
    expect(css).toMatch(/\.debt-list-table td\.num\.debt-list-table__total-cell \{ white-space: normal; \}/);
  });

  it('gives the board a floor so the wrap owns the overflow', () => {
    const rule = css.match(/\.record-table\.debt-list-table\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/min-width:\s*920px/);
    expect(rule![1]).toMatch(/table-layout:\s*fixed/);
    // The double class must outrank styles/responsive.css's ≤1500px
    // `.record-table-wrap > table { min-width: 0 }` reset (0,1,1) — the
    // floor matters exactly on those canvases.
    expect(css).not.toMatch(/^\.debt-list-table\s*\{/m);
  });
});
