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
      /\.ops-acc thead th\.ops-wallet__col--bill,\s*\.ops-acc thead th\.ops-wallet__col--customer,\s*\.ops-acc thead th\.ops-acc__col--payer,\s*\.ops-acc thead th\.ops-wallet__col--declaration,\s*\.ops-acc thead th\.ops-acc__col--invoice,\s*\.ops-acc thead th\.ops-acc__col--fee,\s*\.ops-acc thead th\.ops-acc__col--receipt,\s*\.ops-acc thead th\.ops-acc__col--settlement-code,\s*\.ops-acc thead th\.ops-acc__col--note\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
  });

  it('keeps the SIL-877 word-boundary guard — data cells keep overflow-wrap: anywhere, headers never break mid-token', () => {
    const rule = css.match(/\.ops-acc \.ops-wallet__table thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('overflow-wrap: normal');
    expect(rule).toContain('word-break: keep-all');
  });

  it('keeps the SIL-877 shares for the identity columns and adds the SIL-895 cont share', () => {
    expect(css).toContain('.ops-acc .ops-wallet__col--customer { width: 10.4%; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--bill { width: 13.9%; }');
    expect(css).toContain('.ops-acc .ops-acc__col--cont { width: 10.1%; }');
  });

  it('CR-010.1 BUG-09 round 10 (SIL-904) — the three identity tracks carry REAL px widths (fixed layout ignores min-width)', () => {
    // CSS 2.1 §17.5.2.1: under table-layout:fixed ONLY a specified width
    // sizes the track. The round-9 law's `min-width` th floors were inert —
    // SỐ TỜ KHAI stayed at its ≈53px share and the nowrap '309183503920'
    // painted over SỐ HĐ ('309183503920402', '36' hidden). px widths win
    // verbatim; the table grows past 100% (used table width = max(specified
    // width, sum of column widths)) and the scroll wrapper takes the rest.
    expect(css).toContain('.ops-acc th.ops-wallet__col--declaration {\n  width: 124px;\n}');
    expect(css).toContain('.ops-acc th.ops-acc__col--invoice {\n  width: 126px;\n}');
    expect(css).toContain('.ops-acc th.ops-acc__col--fee {\n  width: 120px;\n}');
    // a % share under a px width is dead weight — none may survive
    expect(css).not.toContain('.ops-wallet__col--declaration { width:');
    expect(css).not.toContain('.ops-acc__col--invoice { width:');
    expect(css).not.toContain('.ops-acc__col--fee { width:');
    // identity numbers stay ONE token; LOẠI PHÍ wraps at word boundaries only
    const nowrapRule = css.match(/\.ops-acc td\.ops-acc__cell--declaration,\s*\.ops-acc td\.ops-acc__cell--invoice\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(nowrapRule).toContain('white-space: nowrap');
    const feeRule = css.match(/\.ops-acc td\.ops-acc__cell--fee\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(feeRule).toContain('overflow-wrap: normal');
    expect(feeRule).toContain('word-break: normal');
    // the board scrolls instead of squeezing the floors back
    const scrollRule = css.match(/\.ops-acc \.ops-wallet__scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scrollRule).toContain('overflow-x: auto');
    // floors hold the QA tokens one line (Inter Digits 7.78px/digit + 24px chrome)
    expect(124 - 24).toBeGreaterThanOrEqual(12 * 7.78); // tờ khai '309183503920'
    expect(126 - 24).toBeGreaterThanOrEqual(97.5); // Số HĐ 'TEST-QA-CR0101' ≈97.5px rendered
  });

  it('SIL-895 round 4 — every board column carries its measured share (BUG-09: 3 tracks are px floors, board scrolls)', () => {
    // The 1440px sidebar-open canvas gives the table ~1144px: these floors
    // (rendered with the app's real faces loaded explicitly) leave the QA
    // bill tokens + a 16-char worst case one line, keep cont/date/money
    // whole, and hold every header inside its own cell under the wrap law.
    // CR-010.1 BUG-09 (SIL-904) moved SỐ TỜ KHAI / SỐ HĐ / LOẠI PHÍ off %
    // shares onto px track widths (124 + 126 + 120px) — the remaining shares
    // resolve against the canvas and the table grows past 100% into the
    // scroll wrapper (used table width = max(specified width, sum of columns)).
    const shares: Array<[string, string]> = [
      ['ops-acc__col--date', '8.85%'],
      ['ops-wallet__col--bill', '13.9%'],
      ['ops-acc__col--cont', '10.1%'],
      ['ops-wallet__col--customer', '10.4%'],
      ['ops-acc__col--amount', '9.83%'],
      ['ops-acc__col--payer', '5.7%'],
      ['ops-acc__col--receipt', '6.2%'],
      ['ops-acc__col--settlement-code', '5.4%'],
      ['ops-acc__col--confirm', '8.8%'],
      ['ops-acc__col--note', '4.53%'],
    ];
    let shareSum = 0;
    for (const [cls, width] of shares) {
      expect(css).toContain(`.ops-acc .${cls} { width: ${width}; }`);
      shareSum += Number.parseFloat(width);
    }
    // rail 34px + identity floors 370px + the measured shares cover the
    // canvas — the overflow rides the scroll wrapper, never a squeezed track.
    expect(34 + 370 + (shareSum / 100) * 1144).toBeGreaterThanOrEqual(1144);
  });

  it('SIL-895 round 4 — the QA bill literals and the 16-char worst case hold ONE line at the 1440 canvas', () => {
    // Rendered one-line widths (Playwright, the app's Inter Digits/Be
    // Vietnam Pro faces loaded explicitly — Inter Digits digits run 7.78px
    // at 12px so fallback-width measurements under-report every digit
    // token). Cell chrome: 12px data + 10px/12px padding.
    // contentPx = share% × 1144px table − 24px cell padding.
    const billContent = (13.9 / 100) * 1144 - 24;
    const renderedBillTokens: Array<[string, number]> = [
      ['QATEST-CUOC-001', 123.08],
      ['R4B-RG-CUS-LCL1', 119.8],
      ['NOSTC26HF67971', 112.92],
      ['QA-D-1411-01', 96.02],
      ['QATEST-CUOC-001X (16 chars)', 131.72],
    ];
    for (const [token, width] of renderedBillTokens) {
      expect(billContent, `${token} one line in bill column`).toBeGreaterThanOrEqual(width + 3);
    }
    // Cont keeps the canonical 11-char ISO whole; dates and money never shed
    // a character; the Duyệt/Từ chối run yields inside its own cell.
    expect((10.1 / 100) * 1144 - 24).toBeGreaterThanOrEqual(89.19 + 2); // cont 'MSKU1245657'
    expect((8.85 / 100) * 1144 - 24).toBeGreaterThanOrEqual(74.33 + 2.5); // Ngày '23/11/2026'
    expect((9.83 / 100) * 1144 - 24).toBeGreaterThanOrEqual(86.34 + 2); // '125.500.000 ₫' ≤ '999.999.999 ₫'
    expect((8.8 / 100) * 1144 - 24).toBeGreaterThanOrEqual(74.33 + 2); // Duyệt KT 'Đã duyệt 23/11/2026' date line
    const yieldRule = css.match(/\.ops-acc \.ops-acc__row-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(yieldRule).toContain('flex-wrap: wrap');
    // inline edit inputs never paint over the neighbour on the narrow columns
    const inputRule = css.match(/\.ops-acc \.ops-acc__edit-input\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(inputRule).toContain('min-width: 0');
  });
});
