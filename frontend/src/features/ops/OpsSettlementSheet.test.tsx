import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpsSettlementSheet } from './OpsSettlementsPanel';

const item = (over: Record<string, unknown> = {}) => ({
  shipmentId: 123,
  shipmentCode: 'SHP-2609-00123',
  customerName: 'Khách QA',
  billRef: 'QA-BILL-1',
  containerNumber: 'MSCU456789',
  containerLabel: 'MSCU456789',
  expenseTypeName: 'Cân lốp',
  requiresInvoice: true,
  amount: '20000',
  approvalStatus: 'RECORDED',
  ...over,
});

const basket = (items: ReturnType<typeof item>[] = [], total = '0') => ({ items, total });

const group = (over: Record<string, unknown> = {}) => ({
  shipmentId: 123,
  shipmentCode: 'SHP-2609-00123',
  customerName: 'Khách QA',
  billRef: 'QA-BILL-1',
  withInvoice: basket(),
  withoutInvoice: basket(),
  total: '0',
  ...over,
});

type SheetGroupingFixture = Parameters<typeof OpsSettlementSheet>[0]['grouping'];

const grouping = (
  groupOver: Record<string, unknown> = {},
  totalsOver: Record<string, string> = {},
  groupsOver?: SheetGroupingFixture['groups'],
): SheetGroupingFixture => ({
  groups: groupsOver ?? ([group(groupOver)] as SheetGroupingFixture['groups']),
  totals: { withInvoice: '0', withoutInvoice: '0', grand: '0', rawGrand: '0', excludedNegative: '0', ...totalsOver },
});

const meta = {
  code: 'OS-TEST-0001',
  createdAt: '2026-09-21T00:00:00.000Z',
  opsName: 'Ops QA',
  note: null,
};

const originalMedia = window.matchMedia;
/** jsdom has no viewport media engine; use the existing browser API polyfill. */
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

describe('OpsSettlementSheet — SIL-845 flat 6-column bảng', () => {
  it('ONE table for the whole phiếu — no per-lot/per-customer frames', () => {
    viewport(1440);
    const { container } = render(<OpsSettlementSheet grouping={grouping({}, {}, [
      group({ shipmentId: 1, withInvoice: basket([item()]) }),
      group({ shipmentId: 2, customerName: 'Khách khác', withoutInvoice: basket([item({ amount: '70000', requiresInvoice: false })]) }),
    ])} meta={meta} />);
    expect(container.querySelectorAll('.ds-table-scroll > table')).toHaveLength(1);
    expect(document.querySelectorAll('.ops-settlement-sheet h4')).toHaveLength(0);
    expect(screen.queryByText(/Tổng lô/)).toBeNull();
    expect(screen.queryByText(/Tổng có hóa đơn — Cont|Không hóa đơn — Cont/)).toBeNull();
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).not.toContain('SHP-');
    // "tối đa 2 mục": both A/B markers live INSIDE the one table.
    expect(screen.getByText('A — Chi phí có hóa đơn')).toBeVisible();
    expect(screen.getByText('B — Chi phí không hóa đơn')).toBeVisible();
  });

  it('every data row carries the full 6-cell line: công ty | bill | tờ khai | cont | chi phí | tiền', () => {
    viewport(1440);
    render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item({
        declarationNumber: '10859073650',
        expenseTypeName: 'Cân lốp',
        amount: '20000',
      })]),
      withoutInvoice: basket([item({
        containerNumber: null,
        containerLabel: 'Phí chung lô',
        declarationNumber: null,
        lotDeclarationNumbers: ['10859073650', '10859073651'],
        billRef: null,
        expenseTypeName: 'Bốc xếp',
        amount: '70000',
        requiresInvoice: false,
      })]),
    }, { withInvoice: '20000', withoutInvoice: '70000', grand: '90000' })} meta={meta} />);
    const rows = Array.from(document.querySelectorAll('.ops-settlement-sheet__table tbody tr'))
      .map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent));
    // A marker + its rows, then B marker + its rows.
    expect(rows[0]).toEqual(['A — Chi phí có hóa đơn']);
    expect(rows[1]).toEqual(['Khách QA', 'QA-BILL-1', '10859073650', 'MSCU456789', 'Cân lốp', '20.000 ₫']);
    expect(rows[2]).toEqual(['B — Chi phí không hóa đơn']);
    expect(rows[3]).toEqual(['Khách QA', 'Chưa có số Bill/Booking', '10859073650, 10859073651', 'Phí chung lô', 'Bốc xếp', '70.000 ₫']);
  });

  it('closes with the 3 total rows: Tổng có HĐ X · Tổng không HĐ Y · TỔNG CỘNG QUYẾT TOÁN (X+Y)', () => {
    viewport(1440);
    render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item()]),
    }, { withInvoice: '20000', withoutInvoice: '70000', grand: '90000' })} meta={meta} />);
    const grandRow = Array.from(document.querySelectorAll('.ops-settlement-sheet__grand-row th, .ops-settlement-sheet__grand-row td')).map((cell) => cell.textContent);
    expect(grandRow).toEqual(['TỔNG CỘNG QUYẾT TOÁN', '90.000 ₫']);
    const totalRow = Array.from(document.querySelectorAll('.ops-settlement-sheet__total')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent));
    expect(totalRow).toEqual([
      ['Tổng có hóa đơn', '20.000 ₫'],
      ['Tổng không hóa đơn', '70.000 ₫'],
    ]);
    // No per-basket subtotal rows and no per-lot total line remain.
    expect(document.querySelectorAll('.ops-settlement-sheet__subtotal')).toHaveLength(0);
    expect(screen.queryByText(/Tổng lô/)).toBeNull();
  });

  it('an empty basket prints no marker ("tối đa 2 mục")', () => {
    viewport(1440);
    render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item()]),
    })} meta={meta} />);
    expect(screen.getByText('A — Chi phí có hóa đơn')).toBeVisible();
    expect(screen.queryByText('B — Chi phí không hóa đơn')).toBeNull();
  });

  it('uses the bill/booking reference even when an internal code exists', () => {
    viewport(1440);
    render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item()]),
      withoutInvoice: basket([item({ containerNumber: null, containerLabel: 'Phí chung lô', requiresInvoice: false })]),
    })} meta={meta} />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('QA-BILL-1');
    expect(sheet.textContent).not.toContain('123');
    expect(sheet.textContent).not.toContain('SHP-');
  });

  it('names the missing business key instead of using an internal code', () => {
    viewport(1440);
    render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item({ billRef: null })]),
    })} meta={meta} />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('Chưa có số Bill/Booking');
    expect(sheet.textContent).not.toContain('123');
    expect(sheet.textContent).not.toContain('SHP-');
  });

  it('QA-AUDIT-UI59 exposes complete signed records and the three totals on phone', () => {
    viewport(390);
    const { container } = render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item({ amount: '-20000' })]),
      withoutInvoice: basket([item({ amount: '-20000', requiresInvoice: false, declarationNumber: null, lotDeclarationNumbers: ['10859073650'] })]),
    })} meta={meta} />);
    const records = screen.getAllByRole('article', { name: 'MSCU456789' });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(within(record).getByText('Khách QA · QA-BILL-1')).toBeVisible();
      expect(within(record).getByText('Cân lốp')).toBeVisible();
      expect(within(record).getByText('-20.000 ₫')).toBeVisible();
      expect(within(record).queryByText('Chi tiết')).toBeNull();
    }
    for (const name of ['Tổng có hóa đơn', 'Tổng không hóa đơn', 'TỔNG CỘNG QUYẾT TOÁN']) {
      expect(within(screen.getByRole('article', { name })).getByText('0 ₫')).toBeVisible();
    }
    expect(container.querySelectorAll('.ledger-desktop.ds-table-scroll > table')).toHaveLength(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelectorAll('.ops-settlement-sheet__signatures')).toHaveLength(1);
  });

  it('QA-AUDIT-UI59 keeps the phiếu totals visible on every charge page', () => {
    viewport(390);
    // Repeat the existing item fixture to exercise the real shared 20-row seam;
    // this is not a new live business record or a recomputed total.
    const rows = basket(Array.from({ length: 21 }, () => item()));
    render(<OpsSettlementSheet grouping={grouping({ withInvoice: rows })} meta={meta} />);
    expect(screen.getAllByRole('article', { name: 'MSCU456789' })).toHaveLength(20);
    expect(within(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).getByText('0 ₫')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getAllByRole('article', { name: 'MSCU456789' })).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'MSCU456789' })).getByText('20.000 ₫')).toBeVisible();
    expect(within(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).getByText('0 ₫')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(screen.getAllByRole('article', { name: 'MSCU456789' })).toHaveLength(20);
    expect(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).toBeVisible();
  });

  // SIL-751 — the totals drop negative rows (card 20260928_197), so a phiếu
  // with one used to print rows that visibly do not add up to TỔNG CỘNG.
  // The sheet must state the exclusion with both reconciliation numbers
  // (OS-2610-0001: grand 320.000, rows 270.000, excluded −50.000).
  it('SIL-751 — phiếu có dòng âm in rõ phần loại trừ để tổng kiểm chứng được', () => {
    render(<OpsSettlementSheet
      grouping={grouping({}, {
        withInvoice: '0',
        withoutInvoice: '320000',
        grand: '320000',
        rawGrand: '270000',
        excludedNegative: '-50000',
      })}
      meta={meta}
    />);
    const note = screen.getByText(/Dòng âm đã loại trừ/);
    expect(note).toHaveTextContent('-50.000');
    expect(note).toHaveTextContent('270.000');
    expect(note).toHaveTextContent('tổng phiếu không cộng dòng âm');
  });

  it('SIL-751 — phiếu không có dòng âm thì không in dòng giải thích', () => {
    render(<OpsSettlementSheet grouping={grouping()} meta={meta} />);
    expect(screen.queryByText(/Dòng âm đã loại trừ/)).toBeNull();
  });
});

describe('OpsSettlementSheet print/CSS ownership (QA-AUDIT-UI59)', () => {
  it('QA-AUDIT-UI59 restores the original table in print and removes the phone counterpart', () => {
    const css = readFileSync('src/components/shared/LedgerRecordList.css', 'utf8');
    expect(css).toMatch(/@media print\s*\{\s*\.ledger-record-list\s*\{\s*display:\s*none\s*!important;/);
    expect(css).toMatch(/@media print\s*\{[^}]*\}[^}]*\.ledger-desktop\s*\{\s*display:\s*revert\s*!important;/);
  });

  it('QA-AUDIT-UI59 owns shared styles for fresh accountant entry and isolates only a mounted printable sheet', () => {
    const source = readFileSync('src/features/ops/OpsSettlementsPanel.tsx', 'utf8');
    const css = readFileSync('src/features/ops/OpsSettlementSheet.css', 'utf8');
    const wallet = readFileSync('src/pages/OpsWalletPage.css', 'utf8');
    expect(source).toContain("import './OpsSettlementSheet.css'");
    expect(wallet).not.toContain('.ops-settlement-sheet');
    // The isolation condition must add zero specificity: a bare body:has
    // outranks the sheet's visibility class and would make the PDF blank.
    expect(css).toMatch(/@media print\s*\{\s*:where\(body:has\(\.ops-settlement-sheet\)\) \*\s*\{\s*visibility:\s*hidden;/);
    expect(css).not.toMatch(/(?:^|\{)\s*body:has\(\.ops-settlement-sheet\) \*/);
    expect(css).not.toMatch(/(?:^|\})\s*body\s+\*\s*\{/);
    expect(css).toContain('overflow: visible');
    expect(css).toContain('.ops-settlement-sheet__signatures');
  });

  it('QA-AUDIT-UI59 uses opaque house paper only for a mounted settlement in print', () => {
    const css = readFileSync('src/features/ops/OpsSettlementSheet.css', 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/body:has\(\.ops-settlement-sheet\)\s*\{\s*background:\s*var\(--surface\);\s*\}/);
    expect(print).toMatch(/\.ops-settlement-sheet\s*\{[^}]*background:\s*var\(--surface\);/);
    expect(css.slice(0, css.indexOf('@media print'))).not.toMatch(/(?:^|\})\s*body\b|background\s*:/);
    // The mounted-only paint must not become an unrelated-page body reset.
    expect(print).not.toMatch(/(?:^|\})\s*body\s*\{/);
  });

  it('QA-AUDIT-UI-07 contains the flat bảng inside the house scroll rail', () => {
    viewport(1440);
    const { container } = render(<OpsSettlementSheet grouping={grouping({
      withInvoice: basket([item()]),
    })} meta={meta} />);
    expect(container.querySelectorAll('.ds-table-scroll > table')).toHaveLength(1);
    expect(container.querySelector('.ds-table-scroll h4')).toBeNull();
    expect(container.querySelector('.ds-table-scroll .ops-settlement-sheet__signatures')).toBeNull();
  });
});
