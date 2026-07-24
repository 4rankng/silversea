import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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
});
