import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Pagination } from './Pagination';

describe('Pagination', () => {
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
