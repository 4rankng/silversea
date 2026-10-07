// Card 061026172808 (FB round-3 report: "( 3ngày)"): the salary summary labels
// render the day counts with the unit space — "(3 ngày)", never "( 3ngày)".
// The reported state does not exist at HEAD (the rung drove the real page);
// this pin locks the contract against regressions.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalarySummaryCard } from './salary-attendance-components';

const salary = {
  tripDays: 3,
  standbyDays: 25,
} as unknown as Parameters<typeof SalarySummaryCard>[0]['salary'];

describe('SalarySummaryCard day-count labels (card 061026172808)', () => {
  it('renders "(3 ngày)" and "(25 ngày)" — spaced, no stray space after the paren', () => {
    render(<SalarySummaryCard salary={salary} />);
    expect(screen.getByText('Lương chuyến (3 ngày)')).toBeTruthy();
    expect(screen.getByText('Lương chờ việc (25 ngày)')).toBeTruthy();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\(\s*\d+ngày\)/);
  });
});
