import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pagination } from './Pagination';

const paginationSource = readFileSync(resolve(process.cwd(), 'src/design-system/Pagination.tsx'), 'utf8');

describe('Pagination', () => {
  beforeEach(() => {
    // React Aria measures the trigger during render; jsdom reports zeros.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 100, y: 200, width: 280, height: 34 }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing when totalPages <= 1 and no summary', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the page buttons when totalPages > 1', () => {
    const { getByText, getAllByRole } = render(
      <Pagination page={2} totalPages={5} onChange={() => {}} />,
    );
    expect(getByText('1')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    const buttons = getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(7); // ‹ 1 2 3 4 5 ›
  });

  // Rows-per-page selector (office request 2026-09-18: see up to 200 rows).
  it('offers the rows-per-page choices only when a handler is supplied', () => {
    const onPageSizeChange = vi.fn();
    const { unmount } = render(
      <Pagination page={1} totalPages={7} totalItems={144} pageSize={20} pageSizeOptions={[20, 50, 100, 200]} onPageSizeChange={onPageSizeChange} onChange={() => {}} />,
    );
    // The RAC trigger's accessible name is "<selected> <label>" — the
    // aria-labelledby refs (selected value + visible label span) outrank the
    // aria-label per the acc-name algorithm.
    fireEvent.click(screen.getByRole('button', { name: '20 Số dòng mỗi trang' }));
    for (const option of ['20', '50', '100', '200']) {
      expect(screen.getByRole('option', { name: option })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('option', { name: '200' }));
    expect(onPageSizeChange).toHaveBeenCalledWith(200);
    unmount();

    // Without a handler the selector is not offered at all.
    render(
      <Pagination page={1} totalPages={7} totalItems={144} pageSize={20} pageSizeOptions={[20, 200]} onChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Số dòng mỗi trang' })).toBeNull();
  });

  it('keeps the rows-per-page selector reachable on a single page', () => {
    // Staging 2026-09-18: choosing 200 left one page, the bar vanished and the
    // choice could not be changed back from the UI.
    const onPageSizeChange = vi.fn();
    const { container, getByRole } = render(
      <Pagination page={1} totalPages={1} totalItems={145} pageSize={200} pageSizeOptions={[20, 200]} onPageSizeChange={onPageSizeChange} onChange={() => {}} />,
    );
    expect(getByRole('button', { name: '200 Số dòng mỗi trang' })).toBeTruthy();
    expect(container.textContent).toContain('Hiển thị');
    expect(screen.queryAllByRole('button', { name: /Trang (trước|sau)/ })).toHaveLength(0);
  });

  it('renders the design-system select, never a raw native select (card _21)', () => {
    expect(paginationSource).not.toMatch(/<select/);
    expect(paginationSource).toContain('UuiSelectField');
  });

  it('renders summary when totalItems + pageSize are provided', () => {
    const { container } = render(
      <Pagination page={1} totalPages={2} totalItems={50} pageSize={25} onChange={() => {}} />,
    );
    expect(container.textContent).toContain('Hiển thị');
  });

  it('labels the navigation and disables every control while loading', () => {
    const { getByRole, getAllByRole } = render(
      <Pagination page={2} totalPages={3} onChange={() => {}} disabled />,
    );
    expect(getByRole('navigation', { name: 'Phân trang' })).toBeTruthy();
    expect(getAllByRole('button').every((button) => button.hasAttribute('disabled'))).toBe(true);
  });

  it('supports direct page entry without rendering one option for every page', () => {
    const onChange = vi.fn();
    const { getByRole, getAllByRole } = render(
      <Pagination page={2} totalPages={10000} onChange={onChange} />,
    );
    const input = getByRole('spinbutton', { name: 'Số trang' });
    fireEvent.change(input, { target: { value: '321' } });
    fireEvent.submit(getByRole('form', { name: 'Đến trang' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(321);
    expect(getAllByRole('button').length).toBeLessThan(12);
  });

  it('rejects out-of-range, fractional, empty and redundant direct jumps', () => {
    const onChange = vi.fn();
    const { getByRole } = render(<Pagination page={2} totalPages={100} onChange={onChange} />);
    const input = getByRole('spinbutton', { name: 'Số trang' });
    const form = getByRole('form', { name: 'Đến trang' });
    for (const value of ['0', '101', '1.5', '', '2']) {
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(form);
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refreshes the direct-entry value when a different page is loaded', () => {
    const { getByRole, rerender } = render(<Pagination page={2} totalPages={100} onChange={() => {}} />);
    fireEvent.change(getByRole('spinbutton', { name: 'Số trang' }), { target: { value: '99' } });
    rerender(<Pagination page={3} totalPages={100} onChange={() => {}} />);
    expect((getByRole('spinbutton', { name: 'Số trang' }) as HTMLInputElement).value).toBe('3');
  });
});
