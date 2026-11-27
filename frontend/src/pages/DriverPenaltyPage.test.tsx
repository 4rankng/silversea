import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const queries = vi.hoisted(() => ({ useSalaryPeriod: vi.fn(), useDriverPenalties: vi.fn() }));
vi.mock('../hooks/useQueries', () => queries);
vi.mock('../hooks/animations', () => ({ usePageAnimations: () => ({ rootRef: { current: null } }), useListAnimations: () => ({ rootRef: { current: null } }) }));
vi.mock('../components/UI', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
import DriverPenaltyPage from './DriverPenaltyPage';

describe('driver deduction summary known versus unavailable amount', () => {
  beforeEach(() => {
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, isError: false });
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' }, isLoading: false, isError: false });
  });
  function deductionValue() {
    return screen.getByText(/^Khấu trừ T/).closest('.kpi')?.querySelector('.kpi__value');
  }
  it('renders zero currency for a successfully loaded period with no deductions', () => {
    render(<DriverPenaltyPage />);
    expect(deductionValue()?.textContent).toBe('0 ₫');
  });
  it('keeps an unknown amount distinct when the period read fails', () => {
    queries.useSalaryPeriod.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() });
    render(<DriverPenaltyPage />);
    expect(deductionValue()?.textContent).toBe('—');
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

// The KPI labels compose a static word and the `T<month>/<year>` period as two
// JSX text nodes; the separator space lives at the tail of the first node. A
// refactor that drops it renders "VI PHẠMT10/2026" (FB-049) — pin the exact
// composed text so the space cannot silently disappear again.
describe('penalty KPI labels keep the separator space before the salary period', () => {
  beforeEach(() => {
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, isError: false });
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' }, isLoading: false, isError: false });
  });
  it('composes the period labels with the space intact', () => {
    render(<DriverPenaltyPage />);
    const texts = [...document.querySelectorAll('.kpi__label')].map((el) => el.textContent);
    expect(texts.some((t) => /^Vi phạm T\d{2}\/\d{4}$/.test(t ?? ''))).toBe(true);
    expect(texts.some((t) => /^Khấu trừ T\d{2}\/\d{4}$/.test(t ?? ''))).toBe(true);
    expect(texts.some((t) => /phạmT\d|trừT\d/i.test(t ?? ''))).toBe(false);
  });
});

// Card 261022201006c: the app lái xe BỎ hiển thị mã chuyến (REQ-07 cũ) —
// the violation-row meta names the date only; the wire's tripCode never
// reaches the DOM (raw or formatted).
describe('penalty violation rows never show the trip code (261022201006c)', () => {
  beforeEach(() => {
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' }, isLoading: false, isError: false });
  });
  it('renders date + reason only, whatever code the penalty carries', () => {
    queries.useDriverPenalties.mockReturnValue({
      data: [
        { id: 1, driverId: 7, tripId: 55, tripCode: 'TRP-202610-0007', reasonId: null, customReason: 'Không đội mũ', amount: '100000', date: '2026-10-01' },
        { id: 2, driverId: 7, tripId: null, tripCode: null, reasonId: null, customReason: 'Đi nhầm tuyến', amount: '50000', date: '2026-10-02' },
      ],
      isLoading: false,
      isError: false,
    });
    render(<DriverPenaltyPage />);
    const meta = [...document.querySelectorAll('.penalty-violation-row__meta')].map((el) => el.textContent);
    expect(meta[0]).toContain('01/10/2026');
    expect(meta.join(' ')).not.toMatch(/TRP|Mã chuyến/);
  });
});

// SIL-1207: the "Tất cả thời gian" filter is the driver's only way into the
// month-scoped ledger. The closed control carried no chevron, so nothing said
// it opens — the month list has 13 entries, so the shared control renders its
// searchable combobox, whose trigger owns the affordance.
describe('penalty month filter shows the dropdown affordance (SIL-1207)', () => {
  beforeEach(() => {
    queries.useDriverPenalties.mockReturnValue({ data: [], isLoading: false, isError: false });
    queries.useSalaryPeriod.mockReturnValue({ data: { start: '2026-09-01', end: '2026-09-30' }, isLoading: false, isError: false });
  });

  it('renders a chevron at the right end of the closed month filter', () => {
    render(<DriverPenaltyPage />);
    const filter = document.querySelector('#penalty-month-filter') as HTMLInputElement | null;
    expect(filter).toBeTruthy();
    expect(filter?.getAttribute('role')).toBe('combobox');
    const chevron = filter?.closest('.uui-combobox')?.querySelector('[data-combobox-chevron]');
    expect(chevron).toBeTruthy();
    expect(chevron?.tagName.toLowerCase()).toBe('svg');
    // The right end of the trigger row — the last child of that row.
    expect(chevron?.closest('[data-combobox-value]')?.lastElementChild).toBe(chevron);
    // The committed label still rides the control; the glyph only marks it.
    // "Tất cả thời gian" is the empty-option label, shown as the trigger's
    // placeholder while no month is picked.
    expect(filter?.getAttribute('placeholder')).toBe('Tất cả thời gian');
  });
});
