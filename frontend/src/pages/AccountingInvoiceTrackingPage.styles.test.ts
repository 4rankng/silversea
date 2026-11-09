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

  it('keeps no scroll wrapper — the base is overflow: visible so the sticky thead pins to the app scrollport', () => {
    expect(tsx).not.toContain('table-scroll');
    expect(rules).not.toMatch(/container-type/);
  });

  it('declares no column floor, no private breakpoint and no private card collapse', () => {
    expect(rules).not.toMatch(/nth-child\(/);
    expect(rules).not.toMatch(/min-width:\s*1350px|min-width:\s*1180px/);
    expect(rules).not.toMatch(/@container/);
    // The TWO sanctioned @media bands form a closed set:
    // (1) the ≤640 phone trailing safe-area clearance on the page root;
    // (2) the add/edit modal form grid's pattern-B phone collapse.
    expect((rules.match(/@media/g) ?? []).length).toBe(2);
    expect(rules).toMatch(
      /@media \(max-width: 640px\) \{\s*\.invoice-tracking-page \{ padding-bottom: 0; \}\s*\}/,
    );
    expect(rules).toMatch(
      /@media \(max-width: 640px\) \{\s*\.invoice-tracking-form__grid \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\}/,
    );
    expect(rules).not.toMatch(/table-layout/);
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
