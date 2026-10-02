import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OpsSettlementSheet } from './OpsSettlementsPanel';

const grouping = (over: Record<string, unknown> = {}): Parameters<typeof OpsSettlementSheet>[0]['grouping'] => ({
  groups: [{
    shipmentId: 123,
    shipmentCode: 'SHP-2609-00123',
    customerName: 'Khách QA',
    billRef: 'QA-BILL-1',
    withInvoice: { items: [], total: '0' },
    withoutInvoice: { items: [], total: '0' },
    total: '0',
    ...over,
  }],
  totals: { withInvoice: '0', withoutInvoice: '0', grand: '0' },
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

describe('OpsSettlementSheet display keys (internal ids never render)', () => {
  it('QA-AUDIT-UI59 exposes both complete signed basket records and source subtotals on phone', () => {
    viewport(390);
    const basket = { items: [{ containerNumber: 'MSCU1234567', expenseTypeName: 'Cân lốp', amount: '-20000' }], total: '0' };
    const { container } = render(<OpsSettlementSheet grouping={grouping({ withInvoice: basket, withoutInvoice: basket })} meta={meta} />);
    const records = screen.getAllByRole('article', { name: 'MSCU1234567' });
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(within(record).getByText('Cân lốp')).toBeVisible();
      expect(within(record).getByText('-20.000 ₫')).toBeVisible();
      expect(within(record).queryByText('Chi tiết')).toBeNull();
    }
    for (const name of ['Tổng có hóa đơn', 'Tổng không hóa đơn']) {
      expect(within(screen.getByRole('article', { name })).getByText('0 ₫')).toBeVisible();
    }
    expect(container.querySelectorAll('.ledger-desktop.ds-table-scroll > table')).toHaveLength(2);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelectorAll('.ops-settlement-sheet__signatures')).toHaveLength(1);
    expect(container.querySelector('.ops-settlement-sheet__grand')).toHaveTextContent('TỔNG CỘNG: 0 (Có HĐ: 0 · Không HĐ: 0)');
  });

  it.each([768, 1440])('QA-AUDIT-UI59 retains the same original tables without phone records at%s', (width) => {
    viewport(width);
    const basket = { items: [{ containerNumber: null, expenseTypeName: 'Cân lốp', amount: '-20000' }], total: '0' };
    const { container } = render(<OpsSettlementSheet grouping={grouping({ withInvoice: basket, withoutInvoice: basket })} meta={meta} />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(container.querySelectorAll('.ledger-desktop.ds-table-scroll > table')).toHaveLength(2);
    expect(screen.getAllByText('Phí chung lô')).toHaveLength(2);
    expect(screen.getAllByText('-20.000 ₫')).toHaveLength(2);
  });

  it('QA-AUDIT-UI59 keeps the source basket subtotal visible on every charge page', () => {
    viewport(390);
    const item = { containerNumber: 'MSCU1234567', expenseTypeName: 'Cân lốp', amount: '-20000' };
    // Repeat the existing item fixture to exercise the real shared20-row seam;
    // this is not a new live business record or a recomputed basket total.
    const basket = { items: Array.from({ length: 21 }, () => item), total: '0' };
    render(<OpsSettlementSheet grouping={grouping({ withInvoice: basket })} meta={meta} />);
    expect(screen.getAllByRole('article', { name: 'MSCU1234567' })).toHaveLength(20);
    expect(within(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).getByText('0 ₫')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getAllByRole('article', { name: 'MSCU1234567' })).toHaveLength(1);
    expect(within(screen.getByRole('article', { name: 'MSCU1234567' })).getByText('-20.000 ₫')).toBeVisible();
    expect(within(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).getByText('0 ₫')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(screen.getAllByRole('article', { name: 'MSCU1234567' })).toHaveLength(20);
    expect(screen.getByRole('article', { name: 'Tổng có hóa đơn' })).toBeVisible();
  });

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

  it('QA-AUDIT-UI-07 contains each basket table inside the house scroll rail', () => {
    const basket = { items: [{ containerNumber: 'MSCU1234567', expenseTypeName: 'Cân lốp', amount: '-20000' }], total: '0' };
    const { container } = render(<OpsSettlementSheet grouping={grouping({ withInvoice: basket, withoutInvoice: basket })} meta={meta} />);
    expect(container.querySelectorAll('.ds-table-scroll > table')).toHaveLength(2);
    expect(container.querySelector('.ds-table-scroll h4')).toBeNull();
    expect(container.querySelector('.ds-table-scroll .ops-settlement-sheet__signatures')).toBeNull();
  });

  it('uses the bill/booking reference even when an internal code exists', () => {
    render(<OpsSettlementSheet grouping={grouping()} meta={meta} />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('QA-BILL-1');
    expect(sheet.textContent).not.toContain('123');
    expect(sheet.textContent).not.toContain('SHP-');
  });

  it('names the missing business key instead of using an internal code', () => {
    render(<OpsSettlementSheet
      grouping={grouping({ billRef: null })}
      meta={meta}
    />);
    const sheet = document.querySelector('.ops-settlement-sheet')!;
    expect(sheet.textContent).toContain('Chưa có số Bill/Booking');
    expect(sheet.textContent).not.toContain('123');
    expect(sheet.textContent).not.toContain('SHP-');
  });
});
