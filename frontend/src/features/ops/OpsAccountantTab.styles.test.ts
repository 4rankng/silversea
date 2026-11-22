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
 * 1440px no-horizontal-overflow fit carries over unchanged. (SIL-895
 * superseded the even shares below with measured per-column floors; the wrap
 * law this file pins still holds for every header that may run two lines.)
 */
describe('Chi phí Ops header wrap law (SIL-858)', () => {
  const tsx = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsAccountantTab.tsx'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src/features/ops/ops-accountant-tab.css'), 'utf8');

  it('the identity header cells carry the wrap-law classes', () => {
    expect(tsx).toMatch(/<th className="ops-wallet__col--bill">Bill \/ Booking<\/th>/);
    expect(tsx).toMatch(/<th className="ops-wallet__col--customer">Khách hàng \/ Nhà máy<\/th>/);
    expect(tsx).toMatch(/<th className="ops-acc__col--payer">Người chi<\/th>/);
  });

  it('identity headers wrap at word boundaries instead of bleeding onto the neighbour', () => {
    const rule = css.match(
      /\.ops-acc thead th\.ops-wallet__col--bill,\s*\.ops-acc thead th\.ops-wallet__col--customer,\s*\.ops-acc thead th\.ops-acc__col--payer\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
  });

  it('keeps the SIL-877 word-boundary guard — data cells keep overflow-wrap: anywhere, headers never break mid-token', () => {
    const rule = css.match(/\.ops-acc \.ops-wallet__table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('overflow-wrap: normal');
    expect(rule).toContain('word-break: keep-all');
  });

  it('keeps the SIL-877 shares for the identity columns and adds the SIL-895 cont share', () => {
    expect(css).toContain('.ops-acc .ops-wallet__col--customer { width: 10.15%; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--declaration { width: 8.4%; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--bill { width: 9.6%; }');
    expect(css).toContain('.ops-acc .ops-acc__col--cont { width: 9.6%; }');
  });

  it('SIL-895 — every board column carries its measured share (sums to 100% with the 34px select rail)', () => {
    // The 1440px sidebar-open canvas gives the table ~1144px: these floors
    // (measured with the app's real faces) leave Bill + Cont one line for an
    // 11-char ISO number and keep every header inside its own cell.
    const shares: Array<[string, string]> = [
      ['ops-acc__col--date', '5.23%'],
      ['ops-wallet__col--bill', '9.6%'],
      ['ops-acc__col--cont', '9.6%'],
      ['ops-wallet__col--customer', '10.15%'],
      ['ops-wallet__col--declaration', '8.4%'],
      ['ops-acc__col--invoice', '5.65%'],
      ['ops-acc__col--fee', '6.85%'],
      ['ops-acc__col--amount', '8.4%'],
      ['ops-acc__col--payer', '6.2%'],
      ['ops-acc__col--receipt', '4.85%'],
      ['ops-acc__col--settlement-code', '7.3%'],
      ['ops-acc__col--confirm', '7.75%'],
      ['ops-acc__col--note', '7.05%'],
    ];
    let sum = 34 / 1144 * 100;
    for (const [cls, width] of shares) {
      expect(css).toContain(`.ops-acc .${cls} { width: ${width}; }`);
      sum += Number.parseFloat(width);
    }
    expect(sum).toBeCloseTo(100, 1);
  });
});
