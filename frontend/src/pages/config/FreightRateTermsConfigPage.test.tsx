import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

let lastRenderForm: ((p: any) => ReactNode) | null = null;
let lastCrudProps: any = null;

vi.mock('../../components/config/CrudTable', async () => {
  const React = await import('react');
  return {
    CrudTable: (props: any) => {
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
      {lastRenderForm({ saving: false, onSave: vi.fn(), onCancel: vi.fn(), ...props } as any) as ReactNode}
    </div>,
  );
}

const SAVE = 'Thêm';
const EDIT_SAVE = 'Cập nhật';

describe('FreightRateTermsConfigPage — TC-CUOC-003/004 rate terms', () => {
  it('renders the CrudTable surface with desc sort by effectiveDate', () => {
    renderPage();
    expect(screen.getByTestId('crud-table')).toBeTruthy();
    const sortFn = lastCrudProps.sortFn as (a: any, b: any) => number;
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

