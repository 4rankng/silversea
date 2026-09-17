import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Shape of the CrudTable props the mock captures — an open record so the
// tests can read page-specific props (sortFn etc.) without importing the
// real component's prop type.
type CapturedCrudProps = { renderForm: (p: Record<string, unknown>) => ReactNode } & Record<string, unknown>;

let lastRenderForm: ((p: Record<string, unknown>) => ReactNode) | null = null;
let lastCrudProps: CapturedCrudProps | null = null;

vi.mock('../../components/config/CrudTable', async () => {
  const React = await import('react');
  return {
    CrudTable: (props: CapturedCrudProps) => {
      lastRenderForm = props.renderForm;
      lastCrudProps = props;
      return React.createElement('div', { 'data-testid': 'crud-table' });
    },
  };
});

vi.mock('../../hooks/animations', () => ({
  usePageAnimations: () => ({ rootRef: { current: null } }),
}));

vi.mock('../../hooks/useCatalogQueries', () => ({
  useAllCustomers: () => ({ data: [{ id: 7, name: 'NEWEB' }] }),
  useRoutesDropdown: () => ({ data: [{ id: 3, name: 'Hải Phòng – Hà Nội' }] }),
}));

import FreightRateTermsConfigPage from './FreightRateTermsConfigPage';
import type { FreightRateTermRow } from '../../api/pricingClient';

const PCT_ROW: Partial<FreightRateTermRow> = {
  id: 11,
  customerId: 7,
  routeId: 3,
  sharePct: '2',
  billingKmOneWay: 86,
  billingKmMultiplier: '2',
  baseFuelPrice: '17842.5926',
  fuelLagDays: 1,
  surchargeThresholdPct: '3',
  surchargeThresholdAbs: null,
  effectiveDate: '2026-09-01',
  note: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <FreightRateTermsConfigPage />
    </MemoryRouter>,
  );
}

function renderForm(props: Record<string, unknown> = {}) {
  if (!lastRenderForm) throw new Error('renderForm not captured');
  return render(
    <div data-testid="form-host">
      {lastRenderForm({ saving: false, onSave: vi.fn(), onCancel: vi.fn(), ...props }) as ReactNode}
    </div>,
  );
}

const SAVE = 'Thêm';
const EDIT_SAVE = 'Cập nhật';

afterEach(() => { vi.useRealTimers(); });

describe('FreightRateTermsConfigPage — TC-CUOC-003/004 rate terms', () => {
  it('renders the CrudTable surface with desc sort by effectiveDate', () => {
    renderPage();
    expect(screen.getByTestId('crud-table')).toBeTruthy();
    if (!lastCrudProps) throw new Error('CrudTable props not captured');
    const sortFn = lastCrudProps.sortFn as (a: Record<string, unknown>, b: Record<string, unknown>) => number;
    const newer = { effectiveDate: '2026-09-02' };
    const older = { effectiveDate: '2026-09-01' };
    expect(sortFn(newer, older)).toBeLessThan(0);
  });

  it('blocks save when customer/route missing (fresh form)', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave });

    fireEvent.click(screen.getByText(SAVE));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not pre-agree a zero delay or no threshold for a new contract', () => {
    renderPage();
    renderForm();
    const lag = screen.getByLabelText('Trễ ngày (lag)') as HTMLInputElement;
    expect(lag.value).toBe('');
    expect(lag.required).toBe(true);
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).checked).toBe(false);
    }
    expect((screen.getByLabelText('Ngưỡng theo tỷ lệ phần trăm') as HTMLInputElement).required).toBe(true);
  });

  it('rejects a cleared delay and saves an explicitly entered zero', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });
    const lag = screen.getByLabelText('Trễ ngày (lag)');
    fireEvent.change(lag, { target: { value: '' } });
    fireEvent.click(screen.getByText(EDIT_SAVE));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(lag, { target: { value: '0' } });
    fireEvent.click(screen.getByText(EDIT_SAVE));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fuelLagDays: 0 }));
  });

  it('defaults a new effective date to the Vietnam business day across UTC midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    renderPage();
    renderForm();
    expect(screen.getByLabelText('Ngày hiệu lực')).toHaveValue('01/10/2026');
  });

  it('keeps an existing effective date when another term changes', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });
    expect(screen.getByLabelText('Ngày hiệu lực')).toHaveValue('01/09/2026');
    fireEvent.change(screen.getByLabelText('% chia sẻ'), { target: { value: '3' } });
    fireEvent.click(screen.getByText(EDIT_SAVE));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: '2026-09-01', sharePct: 3 }));
  });

  it.each(['', '31/02/2027', '20/10'])('blocks an empty or invalid effective date (%s) without losing the draft', (value) => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });
    const date = screen.getByLabelText('Ngày hiệu lực') as HTMLInputElement;
    fireEvent.change(date, { target: { value } });
    fireEvent.click(screen.getByText(EDIT_SAVE));
    expect(onSave).not.toHaveBeenCalled();
    expect(date).toHaveFocus();
    expect(date).toHaveValue(value);
    expect(date.checkValidity()).toBe(false);
    expect(screen.getByLabelText('Giá dầu mốc (đ/lít)')).toHaveValue(17842.5926);
    if (value) expect(screen.getByRole('alert')).toHaveTextContent('Nhập ngày hợp lệ');
  });

  it('sends a future effective date and dismisses its calendar without cancelling the form', () => {
    renderPage();
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderForm({ onSave, onCancel, item: PCT_ROW as FreightRateTermRow });
    const date = screen.getByLabelText('Ngày hiệu lực');
    fireEvent.change(date, { target: { value: '20/10/2027' } });
    fireEvent.click(date);
    expect(screen.getByRole('dialog', { name: 'Chọn ngày' })).toBeInTheDocument();
    fireEvent.keyDown(date, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chọn ngày' })).not.toBeInTheDocument();
    expect(date).toHaveValue('20/10/2027');
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(EDIT_SAVE));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ effectiveDate: '2027-10-20' }));
  });

  it('radio disables the non-selected threshold input (XOR)', () => {
    renderPage();
    renderForm({ onSave: vi.fn(), item: PCT_ROW as FreightRateTermRow });

    const pctInput = screen.getByLabelText('Giá trị ngưỡng phần trăm') as HTMLInputElement;
    const absInput = screen.getByLabelText('Giá trị ngưỡng VNĐ trên lít') as HTMLInputElement;
    expect(pctInput.disabled).toBe(false);
    expect(absInput.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText('Ngưỡng theo số tiền'));
    expect(pctInput.disabled).toBe(true);
    expect(absInput.disabled).toBe(false);
  });

  it('clearing to "Không áp dụng" sends explicit nulls so the update persists', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });

    fireEvent.click(screen.getByLabelText('Không áp dụng ngưỡng'));
    fireEvent.click(screen.getByText(EDIT_SAVE));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      surchargeThresholdPct: null,
      surchargeThresholdAbs: null,
    }));
  });

  it('switching pct→abs sends null pct + numeric abs', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });

    fireEvent.click(screen.getByLabelText('Ngưỡng theo số tiền'));
    const absInput = screen.getByLabelText('Giá trị ngưỡng VNĐ trên lít') as HTMLInputElement;
    fireEvent.change(absInput, { target: { value: '500' } });
    fireEvent.click(screen.getByText(EDIT_SAVE));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      surchargeThresholdPct: null,
      surchargeThresholdAbs: 500,
    }));
  });

  it('never edits or sends billingKmMultiplier (fixed ×2, Câu 4=A)', () => {
    renderPage();
    const onSave = vi.fn();
    renderForm({ onSave, item: PCT_ROW as FreightRateTermRow });

    fireEvent.click(screen.getByText(EDIT_SAVE));
    const payload = onSave.mock.calls[0][0] as Record<string, unknown>;
    expect('billingKmMultiplier' in payload).toBe(false);

    const numInputs = document.body.querySelectorAll('input[type="number"]');
    expect(numInputs.length).toBe(6); // sharePct, km, baseFuel, lag, pct, abs — no multiplier input
  });
});
