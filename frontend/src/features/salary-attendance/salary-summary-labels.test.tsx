// Card 061026172808 (FB round-3 report: "( 3ngày)"): the salary summary labels
// render the day counts with the unit space — "(3 ngày)", never "( 3ngày)".
// The reported state does not exist at HEAD (the rung drove the real page);
// this pin locks the contract against regressions.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SalarySummaryCard } from './salary-attendance-components';
import { SALARY_MODE_LABELS } from '../timesheet/salary-modes';

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

  // FB-103 (ticket 171026215600) — dòng "Hình thức lương" trên card tổng kết:
  // kế toán thấy chế độ ngay tại trang lương, nhãn đúng enum.
  it('FB-103 — renders the salary-mode row with the enum label', () => {
    render(<SalarySummaryCard salary={salary} salaryMode="FLAT_MONTHLY" />);
    expect(screen.getByText(SALARY_MODE_LABELS.FLAT_MONTHLY)).toBeTruthy();
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    expect(rows.some((row) => row.textContent?.includes('Hình thức lương'))).toBe(true);
  });

  it('FB-103 — thiếu chế độ (chưa tải xong) hiển thị "—"', () => {
    render(<SalarySummaryCard salary={salary} />);
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    const modeRow = rows.find((row) => row.textContent?.includes('Hình thức lương'));
    expect(modeRow?.textContent?.trim()).toBe('Hình thức lương—');
  });
});
