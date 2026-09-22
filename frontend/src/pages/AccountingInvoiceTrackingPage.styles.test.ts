import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/AccountingInvoiceTrackingPage.css'), 'utf8');

describe('invoice-tracking 14-column board anti-wrap contract (card 20260922_52)', () => {
  it('table never compresses below the card floor — .table-scroll scrolls it instead', () => {
    expect(css).toMatch(/\.invoice-tracking-table\s*\{\s*min-width:\s*1350px/);
  });

  it('every column carries an explicit width track — min-width alone is inert under table-layout: fixed', () => {
    const trackWidth = (nth: number): number | null => {
      const match = css.match(
        new RegExp(`thead th:nth-child\\(${nth}\\)\\s*\\{[^}]*?(?:^|[^-])width:\\s*(\\d+)px`, 'm'),
      );
      return match ? Number(match[1]) : null;
    };
    const widths = Array.from({ length: 14 }, (_, i) => trackWidth(i + 1));
    expect(widths.every((w) => w != null)).toBe(true);
    // Card floors: lô ≥160, Cont ≥120, hóa đơn ≥130.
    expect(widths[2]).toBeGreaterThanOrEqual(160);
    expect(widths[3]).toBeGreaterThanOrEqual(120);
    expect(widths[6]).toBeGreaterThanOrEqual(130);
  });

  it('thead wraps at spaces only — the _54 header contract, never a mid-word fracture', () => {
    const thead = css.match(/\.invoice-tracking-table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('word-break: keep-all');
    expect(thead).toContain('overflow-wrap: normal');
    expect(thead).not.toContain('overflow-wrap: anywhere');
    expect(thead).not.toContain('overflow-wrap: break-word');
    expect(thead).toContain('white-space: normal');
  });

  it('token and money columns never break; money right-aligns', () => {
    const nowrapGroup = css.match(/tbody td:nth-child\(1\),[\s\S]*?white-space: nowrap;/)?.[0] ?? '';
    for (const nth of [1, 2, 4, 5, 8, 10, 11]) {
      expect(nowrapGroup).toContain(`nth-child(${nth})`);
    }
    expect(css).toMatch(/tbody td:nth-child\(8\),[\s\S]*?nth-child\(10\)\s*\{\s*text-align:\s*right/);
  });
});
