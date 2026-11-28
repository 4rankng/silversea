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
 * No share moved: SIL-877's 11% / 8.5% identity shares stayed through
 * SIL-895's measured floors, until SIL-921 replaced every remaining share
 * with a REAL px track (next to px tracks Chromium squeezes % columns to
 * keep the table at its specified width — the squeeze starved NGƯỜI CHI to
 * 40px and stacked names per character). The wrap
 * law this file pins still holds for every header that may run two lines. */
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

  it('SIL-921 — the six squeezed columns carry REAL px tracks (the BUG-09 law, generalized)', () => {
    // The SIL-877 % shares died the moment SIL-904/SIL-908 added 584px of
    // px tracks: Chromium keeps the table at its SPECIFIED width (100% =
    // the 1144px sidebar-open canvas, measured live) and proportionally
    // shrinks the % columns to fit — NGƯỜI CHI landed at 40.31px, SỐ PHIẾU
    // at 38.17px, NGÀY at 62.58px and names/vouchers stacked per character
    // (QA 24/11). Only a px width is safe next to px tracks.
    expect(css).toContain('.ops-acc .ops-acc__col--date { width: 102px; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--bill { width: 160px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--cont { width: 116px; }');
    expect(css).toContain('.ops-acc .ops-wallet__col--customer { width: 120px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--payer { width: 96px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--receipt { width: 118px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--settlement-code { width: 112px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--confirm { width: 102px; }');
    expect(css).toContain('.ops-acc .ops-acc__col--amount { width: 113px; }');
    // the dead % shares are gone — none may survive
    expect(css).not.toContain('{ width: 8.85%');
    expect(css).not.toContain('{ width: 13.9%');
    expect(css).not.toContain('{ width: 10.1%');
    expect(css).not.toContain('{ width: 10.4%');
    expect(css).not.toContain('{ width: 9.83%');
    expect(css).not.toContain('{ width: 5.7%');
    expect(css).not.toContain('{ width: 6.2%');
    expect(css).not.toContain('{ width: 5.4%');
    expect(css).not.toContain('{ width: 8.8%');
    // reading cells wrap at WORD boundaries; atomic tokens pin nowrap
    const reading = css.match(/\.ops-acc td\.ops-acc__cell--customer,\s*\.ops-acc td\.ops-acc__cell--payer,\s*\.ops-acc td\.ops-acc__cell--receipt,\s*\.ops-acc td\.ops-acc__cell--settlement-code,\s*\.ops-acc td\.ops-acc__cell--confirm\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(reading).toContain('overflow-wrap: normal');
    expect(reading).toContain('word-break: normal');
    const atomic = css.match(/\.ops-acc td\.ops-acc__cell--date,\s*\.ops-acc td\.ops-money\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(atomic).toContain('white-space: nowrap');
    expect(atomic).toContain('overflow-wrap: normal');
    // the cells carry their classes in the TSX
    expect(tsx).toMatch(/<td className="ops-acc__cell--date">/);
    expect(tsx).toMatch(/<td className="ops-acc__cell--customer">/);
    expect(tsx).toMatch(/<td className="ops-acc__cell--payer">/);
    expect(tsx).toMatch(/<td className="ops-acc__cell--receipt">/);
    expect(tsx).toMatch(/<td className="ops-acc__cell--settlement-code">/);
    expect(tsx).toMatch(/<td className="ops-acc__cell--confirm">/);
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
    // identity numbers stay ONE token on SỐ TỜ KHAI; SỐ HĐ wraps inside its
    // px track (long live tokens painted over LOẠI PHÍ under nowrap)
    const nowrapRule = css.match(/\.ops-acc td\.ops-acc__cell--declaration\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(nowrapRule).toContain('white-space: nowrap');
    const invoiceRule = css.match(/\.ops-acc td\.ops-acc__cell--invoice\s*\{([^}]*)\}/)?.[1] ?? '';
    // AstraQA3 finding 16 / consolidated UX-04 supersedes the anywhere-wrap
    // law (lost in a concurrent-session clobber once already): ONE
    // selectable line; the fixed track can't grow so the cell scrolls.
    expect(invoiceRule).toContain('white-space: nowrap');
    expect(invoiceRule).toContain('overflow-x: auto');
    expect(invoiceRule).not.toContain('overflow-wrap: anywhere');
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

  it('SIL-895 round 4 — every board column carries its measured share (SIL-921: all tracks are px, board scrolls)', () => {
    // The 1440px sidebar-open canvas gives the table ~1144px. CR-010.1
    // BUG-09 (SIL-904) moved SỐ TỜ KHAI / SỐ HĐ / LOẠI PHÍ onto px track
    // widths (124 + 126 + 120px); SIL-908 gave GHI CHÚ its own 180px
    // track; SIL-921 moved the remaining columns onto REAL px tracks too —
    // next to px tracks Chromium squeezes % columns to keep the table at
    // its specified width, so a % share can never protect its column.
    // Tracks are sized content + 24px cell chrome off the measured tokens;
    // the 1613px sum overflows the 1144px canvas into the scroll wrapper
    // (the SIL-904-accepted bound), never a squeezed track.
    const tracks: Array<[string, number]> = [
      ['ops-acc__col--date', 102], // 'DD/MM/YYYY' 74.33 + 24 + margin
      ['ops-wallet__col--bill', 160], // QA tokens ≤ 123.08 + 3, one line
      ['ops-acc__col--cont', 116], // ISO 'MSKU1245657' 89.19 + 24
      ['ops-wallet__col--customer', 120], // 'KHÁCH HÀNG /' 95.66 header line
      ['ops-acc__col--amount', 113], // '999.999.999 ₫' 86.34 + 24 + margin
      ['ops-acc__col--payer', 96], // 'Nguyễn Huy' ≈71 line one, word wrap
      ['ops-acc__col--receipt', 118], // receipt pill 92.58 one line
      ['ops-acc__col--settlement-code', 112], // 'OS-2611-0009' 86.81 + 24
      ['ops-acc__col--confirm', 102], // '23/11/2026' line 74.33 whole
    ];
    let trackSum = 34 + 124 + 126 + 120 + 180; // select + the pinned tracks
    for (const [cls, width] of tracks) {
      expect(css).toContain(`.ops-acc .${cls} { width: ${width}px; }`);
      trackSum += width;
    }
    // the board scrolls instead of squeezing the floors back
    expect(trackSum).toBe(1623);
    expect(trackSum).toBeGreaterThan(1144);
    const scrollRule = css.match(/\.ops-acc \.ops-wallet__scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(scrollRule).toContain('overflow-x: auto');
    // SIL-908 — GHI CHÚ is a REAL px track (fixed layout ignores min-width,
    // the BUG-09 law) and the note cell wraps at word boundaries only; the
    // 4.53% share and its mid-token `anywhere` break are gone.
    expect(css).toContain('.ops-acc th.ops-acc__col--note {\n  width: 180px;\n}');
    expect(css).not.toContain('.ops-acc__col--note { width:');
    const noteRule = css.match(/\.ops-acc td\.ops-acc__cell--note\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(noteRule).toContain('overflow-wrap: normal');
    expect(noteRule).toContain('word-break: normal');
  });

  it('SIL-895 round 4 — the QA bill literals and the 16-char worst case hold ONE line at the 1440 canvas', () => {
    // Rendered one-line widths (Playwright, the app's Inter Digits/Be
    // Vietnam Pro faces loaded explicitly — Inter Digits digits run 7.78px
    // at 12px so fallback-width measurements under-report every digit
    // token). Cell chrome: 12px data + 10px/12px padding.
    // contentPx = the px track − 24px cell padding (SIL-921: px tracks).
    const billContent = 160 - 24;
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
    expect(116 - 24).toBeGreaterThanOrEqual(89.19 + 2); // cont 'MSKU1245657'
    expect(102 - 24).toBeGreaterThanOrEqual(74.33 + 2.5); // Ngày '23/11/2026'
    expect(113 - 24).toBeGreaterThanOrEqual(86.34 + 2); // '125.500.000 ₫' ≤ '999.999.999 ₫'
    expect(102 - 24).toBeGreaterThanOrEqual(74.33 + 2); // Duyệt KT 'Đã duyệt 23/11/2026' date line
    const yieldRule = css.match(/\.ops-acc \.ops-acc__row-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(yieldRule).toContain('flex-wrap: wrap');
    // inline edit inputs never paint over the neighbour on the narrow columns
    const inputRule = css.match(/\.ops-acc \.ops-acc__edit-input\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(inputRule).toContain('min-width: 0');
  });
});
