// Card 20260929_ivt (redesign) + SIL-762 REV2 — the board rides the shared
// record-table base and the 8-column multi-line grid. This file pins the
// CONTRACT in source (jsdom has no layout engine); the base owns containment,
// wrapping and the card band, and the page declares no table shape of its own.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { getNavItems } from '../components/Layout';

const cwd = process.cwd();
const read = (relativePath: string) => readFileSync(resolve(cwd, relativePath), 'utf8');

const css = read('src/pages/AccountingInvoiceTrackingPage.css');
const tsx = read('src/pages/AccountingInvoiceTrackingPage.tsx');
/** Comments name the retired rules on purpose; only rule bodies are asserted. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('invoice-tracking board adopts the shared record-table base', () => {
  it('renders the shared recipe — record-table-wrap + `record-table ops-table`, no page skin class', () => {
    expect(tsx).toContain('record-table-wrap');
    expect(tsx).toContain('className="record-table ops-table"');
    expect(tsx).toContain("import '../styles/record-table.css'");
    expect(tsx).toContain("import '../styles/operational-table-typography.css'");
    expect(rules).not.toMatch(/\.invoice-tracking-table/);
  });

  it('SIL-873: the horizontal-scroll escape is the SHARED --scroll modifier, never a private wrapper — sticky thead stays base-owned', () => {
    expect(tsx).not.toContain('table-scroll');
    expect(tsx).toContain('record-table-wrap record-table-wrap--scroll');
    // The containment comes from the shared base; the page declares no
    // container-type of its own.
    expect(rules).not.toMatch(/container-type/);
  });

  it('SIL-873: the chốt ladder owns the width — fixed layout, per-col floors + % shares, rendered-set vars', () => {
    // The shell's readability cap centered the board as a 1440px strip at
    // 1920+ (QA: x=356–1795, ~124px white) and the auto table overflowed its
    // 1129px wrapper at 1440×900 (measured 1292px, Tiến độ xử lý clipped).
    // The family law (2bbf1664 / e6f00827 / 41902fb1) replaces both: fixed
    // layout binds the % shares; every col carries its share + px floor;
    // the TSX derives --itv-min / --itv-scale from the RENDERED set.
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table\s*\{[^}]*table-layout:\s*fixed;[^}]*min-width:\s*var\(--itv-min, 1117px\);/s);
    expect(tsx).toContain("'--itv-min'");
    expect(tsx).toContain("'--itv-scale'");
    expect(tsx).toContain('invoice-tracking-page data-workspace');
    // Shares are floor ÷ the 1117px nine-column base and MUST re-sum to 100%
    // with the CUS scale — an off-by-one share phantom-scrolls every width.
    // The base itself must stay ≤ the 1129px 1440×900 canvas (QA r2 verdict
    // 27c47c66: base 1220 pushed Tiến độ xử lý out at scrollLeft=0).
    const shares = [...rules.matchAll(/col\.ivt-col--([a-z]+)\s*\{\s*width:\s*calc\(([\d.]+)%\s*\*\s*var\(--itv-scale, 1\)\);\s*min-width:\s*(\d+)px;/g)];
    expect(shares).toHaveLength(9);
    const floorsTsx = read('src/pages/AccountingInvoiceTrackingPage.tsx');
    const sum = shares.reduce((total, [, , , floor]) => total + Number(floor), 0);
    expect(sum).toBe(1117);
    expect(sum).toBeLessThanOrEqual(1129);
    for (const [, key, share, floor] of shares) {
      // TSX floors and CSS floors must agree (the two can never drift).
      expect(floorsTsx).toContain(`${key}: ${floor},`);
      // share ≈ floor ÷ base, pinned to 2dp.
      expect(Number(share)).toBeCloseTo((Number(floor) / 1117) * 100, 1);
    }
    // The TSX rendered set drops exactly the Chọn-dòng column for read-only roles.
    expect(floorsTsx).toMatch(/key !== 'select' \|\| canWrite/);
    // Sub-lines obey the shared break-anywhere law (the ladder's floors are
    // control/header floors, never data widths).
    expect(rules).toMatch(/\.ivt-stack__sub\s*\{[^}]*white-space:\s*normal;/);
    // The ≤1100px record-card band resets the floor — cards own that band.
    expect(rules).toMatch(/@container \(max-width: 1100px\)\s*\{\s*\.invoice-tracking-page \.record-table\s*\{\s*min-width:\s*0;\s*\}\s*\}/);
    // Laws that survive the ladder unchanged:
    expect(rules).not.toMatch(/nth-child\(/);
    expect(rules).not.toMatch(/min-width:\s*1350px|min-width:\s*1180px/);
    // The TWO sanctioned @media bands still form a closed set:
    // (1) the ≤640 phone trailing safe-area clearance on the page root;
    // (2) the add/edit modal form grid's pattern-B phone collapse.
    expect((rules.match(/@media/g) ?? []).length).toBe(2);
    expect(rules).toMatch(
      /@media \(max-width: 640px\) \{\s*\.invoice-tracking-page \{ padding-bottom: 0; \}\s*\}/,
    );
    expect(rules).toMatch(
      /@media \(max-width: 640px\) \{\s*\.invoice-tracking-form__grid \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/,
    );
  });

  it('ticket 18/11 + SIL-863: KHÁCH HÀNG & LÔ holds a 320px floor via its data-label hook — no nth-child, no overflow', () => {
    // The longest live customer name ('CÔNG TY TNHH MỘT THÀNH VIÊN LONG
    // MINH') orphan-wrapped its last word at 1440 even on the 280px floor
    // (name ≈290px + 12px padding); 320px holds it whole. The hook is the
    // td's data-label attribute — the no-nth-child and no-td-overflow
    // prohibitions above stay true.
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table td\[data-label='Khách hàng & Lô'\]\s*\{[^}]*min-width:\s*320px;/);
    expect(rules).not.toMatch(/data-label='Khách hàng & Lô'\]\s*\{[^}]*overflow/);
  });

  it('never clips or ellipsises a data cell — design law §4 no-truncation doctrine', () => {
    const cellRules = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selector]) => /\b(td|th)\b/.test(selector))
      .map(([, selector, body]) => `${selector.trim()} {${body.trim()}}`);
    expect(cellRules.join('\n')).not.toContain('overflow: hidden');
    expect(cellRules.join('\n')).not.toContain('text-overflow: ellipsis');
  });

  it('carries data-label on every data cell so the card band stays labelled', () => {
    const body = tsx.slice(tsx.indexOf('<tbody>'));
    const cells = body.match(/<td[^>]*>/g) ?? [];
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell, `${cell} must carry data-label`).toContain('data-label');
    }
    // SIL-762 rev2 — the 8 grouped columns.
    for (const label of ['Khách hàng & Lô', 'Cont & Chứng từ', 'Đầu vào (Mua HĐ)', 'Đối soát số tiền', 'Chênh lệch', 'Ghi chú & ĐNTT', 'Tiến độ xử lý']) {
      expect(tsx, `${label} cell label`).toContain(`data-label="${label}"`);
    }
  });

  it('marks the auto Chênh lệch cell with the bold diff class — one house recipe', () => {
    expect(tsx).toMatch(/data-label="Chênh lệch" className="ivt-diff"/);
    expect(rules).toMatch(/\.ivt-diff\s*\{[^}]*font-weight:\s*700/);
    expect(rules).toMatch(/\.ivt-diff\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('keeps the select column on one line — actions live inline, never a Thao tác column', () => {
    expect(tsx).not.toContain('invoice-tracking-actions');
    expect(tsx).toContain('ivt-col--select');
    expect(rules).toMatch(/\.ivt-col--select\s*\{[^}]*white-space:\s*nowrap/);
    expect(rules).toMatch(/\.ivt-col--select input\[type='checkbox'\]/);
  });

  it('keeps every header label on ONE line — FB-063 (card 181026021137)', () => {
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table thead th\s*\{[^}]*white-space:\s*nowrap;/);
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table thead th\s*\{[^}]*padding-inline:\s*8px;/);
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table tbody td:not\(\.record-table__action\)\s*\{[^}]*padding-inline:\s*6px;/);
    expect(rules).not.toMatch(/\.invoice-tracking-page \.record-table thead th\s*\{[^}]*white-space:\s*normal;/);
  });

  it('inline edit inputs ride the house quiet-cell recipe (focus ring + revert)', () => {
    expect(rules).toMatch(/\.ivt-inline-input:focus\s*\{[^}]*outline:\s*2px solid var\(--color-accent\)/);
    expect(rules).toMatch(/\.ivt-inline-input--num\s*\{[^}]*text-align:\s*right/);
    // The status badge rides the house warning pair — never an invented tint.
    expect(rules).toMatch(/\.ivt-badge\s*\{[^}]*background:\s*var\(--warning-soft\)/);
    expect(rules).toMatch(/\.ivt-badge\s*\{[^}]*color:\s*var\(--warning-text\)/);
  });

  it('keeps the Cột 5 pair inputs on the compact budget (SIL-816 UI-02, r2 scope: doisoat pairs only)', () => {
    // Measured at the 1440 workboard (1144px canvas, 2026-11-13 drive): the
    // paired inputs at the old 104px budget drove the board to 1252px —
    // TIẾN ĐỘ XỬ LÝ hung 80px past the viewport edge. 72px (56px floor) pays
    // the fit with the labels and cells untouched. SIL-873 r2 (QA 27c47c66):
    // Cột 4 stacks its three inputs one per row and Cột 5 stacks its three
    // label+input pairs — their column floors drop to their one-line header
    // minima (135/127px) because min-width: 0 lets a pair shrink inside its
    // track (input falls to its 56px floor and scrolls its value; the nowrap
    // row never pokes past the cell edge).
    expect(rules).toMatch(/\.ivt-inline-pair\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;/s);
    expect(rules).toMatch(/\.ivt-inline-pair \.ivt-inline-input\s*\{[^}]*width:\s*72px;[^}]*min-width:\s*56px;/);
    // The stacked Cột 4/5 inputs keep the quiet-cell budget — 88px floor.
    expect(rules).toMatch(/\.ivt-inline-input\s*\{[^}]*min-width:\s*88px;/);
  });

  it('SIL-877 (CR-009.1): the pair-input columns Cột 4/5 take a 2px inline gutter — data-label hook, every other column keeps its gutter', () => {
    // Cột 4/5 are wholly control-owned (their min-content IS the SIL-816
    // pair budgets), so the 6px board gutter there is dead width at the
    // 1440×900 workboard in both sidebar states — 2×8px back across the
    // pair. The hook is the td data-label (same idiom as the cột 2 floor)
    // — no nth-child, no skin; `tbody` ties the 6px rule's specificity so
    // the later lighter rule wins the cascade.
    expect(rules).toMatch(
      /\.invoice-tracking-page \.record-table tbody td\[data-label='Đầu vào \(Mua HĐ\)'\],\s*\.invoice-tracking-page \.record-table tbody td\[data-label='Đối soát số tiền'\]\s*\{[^}]*padding-inline:\s*2px;/,
    );
    // The board gutters stay untouched for every other column — 6px body, 8px head.
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table tbody td:not\(\.record-table__action\)\s*\{[^}]*padding-inline:\s*6px;/);
    expect(rules).toMatch(/\.invoice-tracking-page \.record-table thead th\s*\{[^}]*padding-inline:\s*8px;/);
  });
});

describe('invoice-tracking command strip (shared primitives)', () => {
  it('names the screen once, with the sidebar label, through the shared PageHeader', () => {
    const roles = [Role.ADMIN, Role.ACCOUNTANT, Role.CUS];
    const labels = new Set(roles.map((role) =>
      getNavItems(role).find((item) => item.path === '/accounting/invoice-tracking')?.label,
    ));
    expect(labels.size, `nav labels disagree: ${[...labels].join(' | ')}`).toBe(1);
    const navLabel = [...labels][0];
    expect(navLabel).toBe('Theo dõi hóa đơn');

    expect(tsx).toContain('<PageHeader');
    expect(tsx).toContain(`title="${navLabel}"`);
    expect(tsx).not.toMatch(/invoice-tracking-header/);
    expect(tsx).not.toMatch(/invoice-tracking-kpi/);
    expect(tsx).not.toMatch(/<h1>/);
  });

  it('renders the Σ strip on the shared SummaryRail, not a page-local KPI block', () => {
    expect(tsx).toContain('<SummaryRail');
    expect(tsx).toContain('ariaLabel="Tổng cộng theo kỳ"');
    expect(tsx).toContain("label: 'Số tiền thu'");
    expect(tsx).toContain("label: 'Số tiền trả'");
    expect(tsx).toContain("label: 'Số tiền trả KH'");
    expect(tsx).toContain("label: 'Chênh lệch'");
    expect(rules).not.toMatch(/\.invoice-tracking-kpi/);
  });

  it('header actions are the shared buttons, not a page-local action row', () => {
    expect(tsx).toContain('Xuất Excel');
    expect(tsx).toContain('downloadCSV');
    expect(tsx).toContain('Thêm chi phí lô hàng');
    expect(rules).not.toMatch(/\.invoice-tracking-header__actions/);
    expect(tsx).not.toMatch(/>Loc<|>Lọc</);
  });

  it('loading and empty render the shared primitives, never a page-local row', () => {
    expect(tsx).toContain('<SkeletonTable');
    expect(tsx).toContain('<EmptyState');
    expect(tsx).toMatch(/context="finance"/);
    expect(tsx).not.toMatch(/invoice-tracking-empty/);
    expect(rules).not.toMatch(/invoice-tracking-empty/);
  });

  it('row 2: the shared bar owns the strip — period fields, quick ranges, search slot, Bộ lọc dialog', () => {
    expect(tsx).toContain('<FilterBar');
    expect(tsx).toContain('<DateRangeFields');
    expect(tsx).toContain('<DateRangePresets');
    expect(tsx).toContain('<FilterDropdown');
    expect(tsx).not.toContain('DateRangePopover');
    expect(tsx).toContain('Tháng này');
    expect(tsx).toContain('Tháng trước');
    expect(tsx).toContain('Quý này');
    expect(tsx).toMatch(/Khách, Số HĐ, MST, Bill, Lô, Cont/);
    expect(tsx).toContain('Chỉ xem dòng có lệch');
    expect(tsx).toContain('Hiện cả dòng đã ẩn (Không lấy hóa đơn)');
    expect(tsx).toContain('Xóa lọc');
    expect(tsx).toContain('dialogLabel="Bộ lọc hóa đơn"');
  });

  it('empty state keeps the period copy and the clear-filters sub-link', () => {
    expect(tsx).toContain('Không tìm thấy hóa đơn nào trong kỳ đã chọn');
    expect(tsx).toContain('Xóa bộ lọc');
  });

  it('scrollbar thumb is neutral ink — the green table-scroll thumb is gone', () => {
    const tableCss = read('src/components/Table.css');
    expect(tableCss).not.toMatch(/scrollbar-thumb[^}]*rgba\(0,\s*90,\s*45/);
  });
});
