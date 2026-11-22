import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-858 (QA retest build 061739f9, 1440×900) — the Chi phí Ops header law:
 *
 * The global `.tt-table thead th` base pins `white-space: nowrap`, which kept
 * the SIL-877 wrap-guard inert: 'BILL / BOOKING' (96.8px vs a 60px budget)
 * clipped to "BILL / BOOKIN" and bled onto CONT; 'KHÁCH HÀNG / NHÀ MÁY'
 * (149.4px vs 102px) bled onto SỐ TỜ KHAI. The two identity headers now wrap
 * at word boundaries only (BILL / 36.4 · BOOKING 57.3 · KHÁCH HÀNG / 90.8 ·
 * NHÀ MÁY 55.6) — full label, two lines, no bleed, no mid-token break.
 *
 * No share moved: SIL-877's 11% / 8.5% identity shares stay, so the SIL-875
 * 1440px no-horizontal-overflow fit carries over unchanged.
 */
describe('Chi phí Ops header wrap law (SIL-858)', () => {
  const tsx = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsAccountantTab.tsx'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/features/ops/ops-accountant-tab.css'), 'utf8');

  it('the two identity header cells carry the wrap-law classes', () => {
    expect(tsx).toMatch(/<th className="ops-wallet__col--bill">Bill \/ Booking<\/th>/);
    expect(tsx).toMatch(/<th className="ops-wallet__col--customer">Khách hàng \/ Nhà máy<\/th>/);
  });

  it('identity headers wrap at word boundaries instead of bleeding onto the neighbour', () => {
    const rule = css.match(
      /\.ops-acc thead th\.ops-wallet__col--bill,\s*\.ops-acc thead th\.ops-wallet__col--customer\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
  });

  it('keeps the SIL-877 word-boundary guard — data cells keep overflow-wrap: anywhere, headers never break mid-token', () => {
    const rule = css.match(/\.ops-acc \.ops-wallet__table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('overflow-wrap: normal');
    expect(rule).toContain('word-break: keep-all');
  });

  it('keeps the SIL-877 shares — the 1440px fit (SIL-875) needs no width rebalance', () => {
    expect(css).toContain('.ops-acc .ops-wallet__col--customer { width: 11%; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--declaration { width: 8.5%; }');
    expect(css).not.toContain('ops-wallet__col--bill { width');
  });
});
