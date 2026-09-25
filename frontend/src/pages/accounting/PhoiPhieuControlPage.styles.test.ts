import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.css'), 'utf8');
const source = readFileSync(resolve(process.cwd(), 'src/pages/accounting/PhoiPhieuControlPage.tsx'), 'utf8');

describe('phôi phiếu board header contract (card 20260922_54)', () => {
  it('thead headers wrap at spaces only — never a mid-word fracture like CONTAINE/R', () => {
    const thead = css.match(/\.ppc-board thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(thead).toContain('word-break: keep-all');
    expect(thead).toContain('overflow-wrap: normal');
    expect(thead).not.toContain('overflow-wrap: anywhere');
    expect(thead).toContain('white-space: normal');
  });
});

describe('phôi phiếu board cell discipline (card 20260923_8 group B)', () => {
  it('atomic cells never fracture — date column and chi hộ/tiền đường value tokens pin nowrap (design law §4)', () => {
    expect(css).toMatch(/\.ppc-board td\.ppc-col--date\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.ppc-board \.ppc-value\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('atomic columns are budgeted explicitly — the fixed-layout board no longer equal-shares every column', () => {
    expect(css).toMatch(/\.ppc-board th\.ppc-col--select\s*\{[^}]*width:\s*3%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--chiho\s*\{[^}]*width:\s*14%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--money\s*\{[^}]*width: 11%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--status\s*\{[^}]*width:\s*8%/);
    expect(css).toMatch(/\.ppc-board th\.ppc-col--date\s*\{[^}]*width:\s*10%/);
  });

  it('chi hộ affordance is an icon-only button with a ≥24px hit area (09-18 icon-action ruling, §5)', () => {
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*width:\s*26px/);
    expect(css).toMatch(/\.ppc-board \.ppc-icon-btn\s*\{[^}]*height:\s*26px/);
  });
});

describe('báo cáo tháng report header (card 20260924_1, image11)', () => {
  it('report headers wrap inside the fixed-layout tt-table and draw sub-column separator lines', () => {
    // tt-table ships white-space: nowrap under table-layout: fixed — a long
    // header paints over its neighbour instead of wrapping (the image11
    // "gộp cột" look). The report tables re-declare wrapping and add the
    // vertical separator the audit asked for; law book §4.
    const reportHead = css.match(/\.ppc-report thead th\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(reportHead).toContain('white-space: normal');
    expect(reportHead).toContain('border-right:');
  });
});

// Card 20260924_12 (CHIEF 15:40): the "Trạng thái" / "Sắp xếp" dropdowns each
// claimed a whole ~1100px desktop row — the bespoke bar rode inline flex-wrap
// plus the borrowed .shipments-detail-filters class, and the shared
// .ds-uui-select { width: 100% } gave every select a full-row flex basis.
// RED-first: all six asserts below fail at HEAD (no .ppc-filters markup/CSS).
describe('phôi phiếu filter row-packing (card 20260924_12, filter-bar law §5)', () => {
  it('desktop bar row-packs on an auto-fit grid banded 220–320px — no dropdown owns a full row', () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*320px\)\)/);
  });

  it('page owns its filter markup — no borrowed shipments class, no inline flex layout on either bar', () => {
    expect(source).toContain('className="ppc-filters"');
    expect(source).toContain('className="ppc-filter-actions"');
    expect(source).not.toContain('shipments-detail-filters');
    expect(source).not.toContain("flexWrap: 'wrap'");
    expect(source).not.toContain("style={{ display: 'flex', gap: 12, alignItems: 'end'");
    // The dead wrapper class had no stylesheet anywhere — dropped with the rewrap.
    expect(source).not.toContain('phoi-phieu-filter');
  });

  it('the Lập phiếu button rides its own right-aligned final row — never over the selects', () => {
    const actions = css.match(/\.ppc-filter-actions > \.btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actions).toContain('grid-column: 1 / -1');
    expect(actions).toContain('justify-self: end');
  });

  it('Từ/Đến stay the first two adjacent cells (one row), labels stack above their controls', () => {
    // Capture up to the message paragraph — the bar's own </div> would cut
    // the slice before "Trạng thái" and silently order-check an empty tail.
    const bar = source.match(/className="ppc-filters"([\s\S]*?)\{message/)?.[1] ?? '';
    expect(bar.indexOf('Từ ngày')).toBeGreaterThan(-1);
    expect(bar.indexOf('Từ ngày')).toBeLessThan(bar.indexOf('Đến ngày'));
    expect(bar.indexOf('Đến ngày')).toBeLessThan(bar.indexOf('label="Trạng thái"'));
    const label = css.match(/\.ppc-filters > label\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(label).toContain('display: grid');
  });

  it('mobile ≤480 — Từ/Đến pair on one row, Trạng thái + Sắp xếp pair on one row (card 20260925_1 short-value pairing)', () => {
    const mobile = css.match(/@media \(max-width: 480px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    // The date pair rides the pair wrapper: 2-column grid, not 1fr stack.
    // (Selector may be combined with .ppc-filter-actions__pair.)
    expect(mobile).toMatch(/\.ppc-filters__pair[\s\S]*?display:\s*grid/);
    expect(mobile).toMatch(/\.ppc-filters__pair[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    // Mark-up: date pair wrapper carries Từ ngày + Đến ngày.
    expect(source).toMatch(/className="ppc-filters__pair"[\s\S]*?Từ ngày[\s\S]*?Đến ngày/);
    // The filter-actions bar (Loại phiếu + STK) pairs the two short selects too.
    expect(mobile).toMatch(/\.ppc-filter-actions__pair[\s\S]*?display:\s*grid/);
    expect(mobile).toMatch(/\.ppc-filter-actions__pair[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(source).toMatch(/className="ppc-filter-actions__pair"[\s\S]*?Loại phiếu[\s\S]*?Số tài khoản quỹ/);
    // One control height per context — coarse pointer rises to 44px touch floor.
    expect(mobile).toMatch(/min-height:\s*var\(--filter-control-h\)/);
  });

  it('one control height per context: inputs and UUI selects both read --filter-control-h, coarse rises to 44px', () => {
    expect(css).toMatch(/\.ppc-filters input\s*\{[^}]*height:\s*var\(--filter-control-h\)/);
    expect(css).toMatch(/\.ppc-filters \[data-uui-control\]\[data-control-size\]\s*\{[^}]*--uui-control-h:\s*var\(--filter-control-h\)/);
    expect(css).toMatch(/pointer:\s*coarse[\s\S]*?--filter-control-h:\s*var\(--control-touch-h\)/);
  });

  // Card 20260925_5 (CHIEF 19:09, wide viewport, class sweep mandate): on
  // accounting boards that borrow the date-pair pattern, the pair wrapper
  // defaulted to `display: block` so the two stacked labelled fields read
  // as a detached panel. Each pair is one inline flex-cell of the bar at
  // every pre-mobile breakpoint — flat (transparent bg, 0 border / radius
  // / shadow) so the wrapper never promotes to a card. The mobile ≤480
  // grid rule still owns phone pairing.
  it('desktop pair wrapper is one inline flex-cell of the bar — flat, not a panel (card 20260925_5 wide-pair)', () => {
    // The desktop default has to be a top-level rule that the mobile @media
    // block can override via source order.
    const ppcBlock = css.match(/\.ppc-filters__pair,\s*\.ppc-filter-actions__pair\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(ppcBlock, 'ppc pair default rule present at top level').not.toBe('');
    expect(ppcBlock).toMatch(/display:\s*flex/);
    expect(ppcBlock).toMatch(/align-items:\s*flex-end/);
    expect(ppcBlock).toMatch(/gap:\s*12px/);
    expect(ppcBlock).toMatch(/background:\s*transparent/);
    expect(ppcBlock).toMatch(/border:\s*0/);
    expect(ppcBlock).toMatch(/border-radius:\s*0/);
    // Mobile grid contract intact (card 20260925_1).
    const mobile = css.match(/@media \(max-width: 480px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toMatch(/\.ppc-filters__pair[\s\S]*?display:\s*grid/);
    expect(mobile).toMatch(/\.ppc-filters__pair[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(mobile).toMatch(/\.ppc-filter-actions__pair[\s\S]*?display:\s*grid/);
    expect(mobile).toMatch(/\.ppc-filter-actions__pair[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('flat sheet — no shadow, gradient, or 3D anywhere (design law §3)', () => {
    expect(css).not.toMatch(/box-shadow|gradient|perspective|rotate3d/);
  });
});
