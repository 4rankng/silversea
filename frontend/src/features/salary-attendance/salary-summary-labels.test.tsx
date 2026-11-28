// Card 061026172808 (FB round-3 report: "( 3ngày)"): the salary summary labels
// render the day counts with the unit space — "(3 ngày)", never "( 3ngày)".
// The reported state does not exist at HEAD (the rung drove the real page);
// this pin locks the contract against regressions.
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

// SIL-841 (QA fail fd0f7f14) — /salary reads the NEW law: the card carries the
// 'Tiền chuyến' line (per-trip money from the chấm công board) + KPI vượt
// chuyến, and the mode row offers the pencil into the Trốn vé/Không trốn vé
// dialog. Old confirmed snapshots (no trip facts) keep their old law — rows hide.
describe('SIL-841 — SalarySummaryCard tiền chuyến + KPI', () => {
  const liveSalary = { ...salary, perTripPay: 100000, timesheetTrips: 1, extraTripBonus: 0 };

  it('renders the Tiền chuyến row with the board trip count', () => {
    render(<SalarySummaryCard salary={liveSalary} />);
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    const tripRow = rows.find((row) => row.textContent?.includes('Tiền chuyến'));
    expect(tripRow?.textContent).toContain('(1 chuyến)');
    expect(tripRow?.textContent).toContain('100.000');
  });

  it('hides the trip rows on an old confirmed snapshot without the facts', () => {
    render(<SalarySummaryCard salary={salary} />);
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    expect(rows.some((row) => row.textContent?.includes('Tiền chuyến'))).toBe(false);
    expect(rows.some((row) => row.textContent?.includes('KPI vượt chuyến'))).toBe(false);
  });

  it('KPI vượt chuyến row appears only with a nonzero bonus', () => {
    render(<SalarySummaryCard salary={{ ...liveSalary, extraTripBonus: 200000 }} />);
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    expect(rows.some((row) => row.textContent?.includes('KPI vượt chuyến'))).toBe(true);
  });

  it('FB-103/SIL-841 — the mode row carries the pencil into the mode dialog', () => {
    const onEdit = vi.fn();
    render(<SalarySummaryCard salary={liveSalary} onEditBaseSalary={onEdit} driverName="Bùi Ngọc Long" />);
    fireEvent.click(screen.getByRole('button', { name: /Sửa hình thức lương Bùi Ngọc Long/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

// SIL-1284 — "Hình thức lương" must stay on ONE line: the label span is
// never-wrap (it was squeezed to 2 lines at 71px by the long salary-mode
// value) and the long value adapts through its wrap modifier.
describe('SIL-1284 — salary summary label/value wrap contract', () => {
  it('the mode value carries the wrap modifier so the label keeps its full width', () => {
    render(<SalarySummaryCard salary={salary} salaryMode="PER_TRIP" />);
    const rows = [...document.querySelectorAll('.salary-summary-dark__row')];
    const modeRow = rows.find((row) => row.textContent?.includes('Hình thức lương'));
    const val = modeRow?.querySelector('.salary-summary-dark__row-val');
    expect(val?.classList.contains('salary-summary-dark__row-val--wrap')).toBe(true);
  });

  it('labels are nowrap and the wrap modifier lets long values wrap (CSS contract)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/salary-attendance/salary-summary.css'), 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).toMatch(/\.salary-summary-dark__row-lbl\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(rules).toMatch(/\.salary-summary-dark__row-val--wrap\s*\{[^}]*white-space:\s*normal;/s);
  });
});
