import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LedgerRecordList, type LedgerRecord } from './LedgerRecordList';
import { LedgerMatrix } from './LedgerMatrix';

const originalMedia = window.matchMedia;
/** jsdom has no viewport media engine; this is the browser API polyfill. */
function viewport(width: number) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: width <= Number(query.match(/max-width:\s*(\d+)/)?.[1] ?? 0),
    media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  });
}
afterEach(() => { window.matchMedia = originalMedia; });

function Harness({ count = 1 }: { count?: number }) {
  const [selected, setSelected] = useState(false);
  const [actionCount, setActionCount] = useState(0);
  const rows: LedgerRecord[] = Array.from({ length: count }, (_, index) => ({
    key: index, title: <>Bill <strong>{index + 1}</strong></>,
    selected: index === 0 && selected, selectable: index === 0,
    onSelect: (value) => setSelected(value), facts: [
      { key: 'amount', label: 'Phải thu', value: '12.000 ₫', primary: true },
      { key: 'note', label: 'Ghi chú', value: 'Giao tại kho theo lệnh' },
      { key: 'action', label: 'Chứng từ', value: <button onClick={() => setActionCount(actionCount + 1)}>Xem chứng từ</button> },
    ],
  }));
  return <><output aria-label="Lựa chọn">{String(selected)}</output><output aria-label="Số hành động">{actionCount}</output><LedgerRecordList rows={rows} /></>;
}

describe('QA-AUDIT-UI-31 phone ledger records', () => {
  it('mounts only on phone, preserving desktop without duplicate controls', () => {
    viewport(768); render(<Harness />);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('separates checkbox selection from disclosure and nested actions', () => {
    viewport(390); render(<Harness />);
    const record = screen.getByRole('article', { name: 'Bill 1' });
    expect(within(record).getByText('12.000 ₫')).toBeVisible();
    const checkbox = screen.getByRole('checkbox', { name: 'Chọn Bill 1' });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(within(record).getByText('Chi tiết'));
    fireEvent.click(within(record).getByRole('button', { name: 'Xem chứng từ', hidden: true }));
    expect(screen.getByLabelText('Số hành động')).toHaveTextContent('1');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
  it('keeps all21 records reachable and returns selection intact after paging', () => {
    viewport(390); const view = render(<Harness count={21} />);
    expect(screen.getAllByRole('article')).toHaveLength(20);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chọn Bill 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Bill 21' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(screen.getByRole('checkbox', { name: 'Chọn Bill 1' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Trang sau' }));
    view.rerender(<Harness count={1} />);
    expect(screen.getByRole('article', { name: 'Bill 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Trang sau' })).toBeNull();
  });
});

describe('QA-AUDIT-UI-65 explicit composite facts', () => {
  it('gives only an opted-in composite the full record lane, preserving selection and action identity', () => {
    viewport(390);
    const selections: boolean[] = [], actions: number[] = [];
    render(<LedgerRecordList rows={[{ key: 273, title: 'QA22-DISPATCH-220922-A', selected: true,
      selectable: true, onSelect: next => selections.push(next), facts: [
        { key: 'amount', label: 'Phải thu', value: '12.000 ₫', primary: true },
        { key: 'workspace', label: 'Quyết toán lô', layout: 'full-width', primary: true,
          value: <section><button onClick={() => actions.push(273)}>Mở chi tiết lô</button><p>QAQU2209220</p></section> },
      ] }]} />);
    const record = screen.getByRole('article', { name: 'QA22-DISPATCH-220922-A' });
    expect(within(record).getByText('12.000 ₫').closest('.ledger-record__fact')).not.toHaveAttribute('data-layout');
    const action = within(record).getByRole('button', { name: 'Mở chi tiết lô' });
    expect(action.closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
    expect(within(record).getByText('QAQU2209220')).toBeVisible();
    fireEvent.click(action); expect(actions).toEqual([273]);
    expect(within(record).getByRole('checkbox')).toBeChecked();
    fireEvent.click(within(record).getByRole('checkbox')); expect(selections).toEqual([false]);
    const css = readFileSync('src/components/shared/LedgerRecordList.css', 'utf8');
    const rule = css.match(/\.ledger-record__fact\[data-layout='full-width'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*grid/);
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule).not.toMatch(/overflow:\s*hidden|max-height|text-overflow/);
  });
  it('propagates explicit matrix column layout while scalar values stay paired', () => {
    viewport(390);
    render(<LedgerMatrix caption="Chi phí theo container" columns={[
      { key: 'amount', label: 'Phải trả', primary: true },
      { key: 'fees', label: 'Phí khác', primary: true, layout: 'full-width' },
    ]} rows={[{ key: 196, title: 'QAQU2209220', cells: ['80.000', <button>Thêm chi phí</button>] }]} />);
    expect(screen.getByText('80.000').closest('.ledger-record__fact')).not.toHaveAttribute('data-layout');
    expect(screen.getByRole('button', { name: 'Thêm chi phí' }).closest('.ledger-record__fact')).toHaveAttribute('data-layout', 'full-width');
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('retains the desktop matrix cells without a phone composite wrapper', () => {
    viewport(768);
    render(<LedgerMatrix caption="Chi phí theo container" columns={[
      { key: 'fees', label: 'Phí khác', layout: 'full-width' },
    ]} rows={[{ key: 196, title: 'QAQU2209220', cells: ['80.000'] }]} />);
    expect(screen.getByRole('table', { name: 'Chi phí theo container' })).toBeVisible();
    expect(screen.getByRole('cell', { name: '80.000' })).toBeVisible();
    expect(screen.queryByRole('article')).toBeNull();
  });
});
