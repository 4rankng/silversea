import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tripFormContextMock, setHasReturnCargoMock } = vi.hoisted(() => ({
  tripFormContextMock: vi.fn(),
  setHasReturnCargoMock: vi.fn(),
}));

vi.mock('../../hooks/useTripFormContext', () => ({
  useTripFormContext: tripFormContextMock,
}));

import { AllowanceSection } from './AllowanceSection';
import { TripSummaryCard } from './TripSummaryCard';
import { TotalsPanel } from './TotalsPanel';
import { Money } from '../shared/Money';
import { computeTripTotals } from '@tingting/shared';

describe('AllowanceSection return-cargo control', () => {
  beforeEach(() => {
    setHasReturnCargoMock.mockReset();
    tripFormContextMock.mockReturnValue({
      tollsDiscount: '0',
      setTollsDiscount: vi.fn(),
      tollsAddition: '0',
      setTollsAddition: vi.fn(),
      tollsStations: '8',
      setTollsStations: vi.fn(),
      hasReturnCargo: true,
      setHasReturnCargo: setHasReturnCargoMock,
      driverSalary: '1500000',
      setDriverSalary: vi.fn(),
      twoPointDeliveryBonus: '',
      setTwoPointDeliveryBonus: vi.fn(),
      vehicleShiftAllowance: '',
      setVehicleShiftAllowance: vi.fn(),
      twoPointDeliveryDefault: 200000,
      vehicleShiftDefault: 200000,
      revenueEmptyReturn: '0',
      setRevenueEmptyReturn: vi.fn(),
      revenueCombine: '0',
      setRevenueCombine: vi.fn(),
      customerCommission: '0',
      setCustomerCommission: vi.fn(),
      tripWageDays: '1',
      setTripWageDays: vi.fn(),
      driverBaseSalary: 5000000,
      suggestedPrice: 6800000,
      containerCount: '1',
      roadAllowanceOverride: '',
      setRoadAllowanceOverride: vi.fn(),
      roadAllowanceBaseApplied: 1650000,
      tollPerStationApplied: 55000,
      returnCargoBonusApplied: 200000,
    });
  });

  function summaryForm(carrierType: 'OWN' | 'EXTERNAL', cost: number) {
    const current = tripFormContextMock();
    const totals = computeTripTotals({ legs: [], fuelMode: 'AUTO', fuelLitersOverride: null,
      fuelSupplementLiters: 0, fuelLoadedNorm: 0, fuelEmptyNorm: 0,
      fuelPerTripSupplement: 0, fuelUnitPrice: 0, isMountainRoute: false,
      mountainFixedAllowance: null, roadAllowanceBase: 0, tollsDiscount: 0,
      tollsAddition: 0, tollsStations: 1, tollPerStation: cost,
      hasReturnCargo: false, returnCargoBonus: 0, revenue: 0, driverSalary: cost,
      twoPointDeliveryBonus: 0, vehicleShiftAllowance: 0, carrierType,
      externalFreightCost: cost });
    return { ...current, carrierType, driverSalary: String(cost), externalFreightCost: String(cost),
      tollsDiscount: '0', tollsAddition: '0', tollsStations: '1', hasReturnCargo: false,
      vatRate: 0, revenue: '0', roadAllowanceBaseApplied: 0, tollPerStationApplied: cost,
      returnCargoBonusApplied: 0, estimatedFuelCost: totals.totalFuelCost,
      estimatedTollCost: totals.tollCost, estimatedProfit: totals.grossProfit, previewTotals: totals };
  }

  it('renders OWN zero costs neutral and unsigned while keeping nonzero deductions and actual profit', () => {
    tripFormContextMock.mockReturnValue(summaryForm('OWN', 0));
    const { rerender } = render(<><TripSummaryCard /><TotalsPanel /></>);
    for (const label of ['Vé đường (1 trạm)', 'Tiền kết hợp', 'Chi phí nhiên liệu', 'Chi phí đường bộ', 'Tiền lương lái xe']) {
      const row = screen.getByText(label).closest('.tc-summary-row,.tc-totals-row')!;
      const amount = row.querySelector('.money')!;
      expect(within(amount as HTMLElement).getByText('0 ₫')).toBeVisible();
      expect(amount.textContent?.trim()).toBe('0 ₫');
      expect(row.querySelector('.tc-summary-row__val--neutral,.tc-totals-row__val--neutral')).not.toBeNull();
    }
    const station = screen.getByText(/Trạm BOT/).closest('.tc-totals-breakdown__row')!;
    expect((station.querySelector('.money')?.textContent ?? '').startsWith('−')).toBe(false);
    expect(station.querySelector('.tc-totals-row__val--neutral')).not.toBeNull();
    tripFormContextMock.mockReturnValue(summaryForm('OWN', 55_000));
    rerender(<><TripSummaryCard /><TotalsPanel /></>);
    for (const label of ['Vé đường (1 trạm)', 'Tiền kết hợp', 'Tiền lương lái xe']) {
      const row = screen.getByText(label).closest('.tc-summary-row,.tc-totals-row')!;
      expect(within(row as HTMLElement).getByText('−55.000 ₫')).toBeVisible();
    }
    const profit = screen.getByText('Lợi nhuận dự kiến', { selector: '.tc-summary-row__lbl' }).closest('.tc-summary-row')!;
    expect(within(profit as HTMLElement).getByText('−110.000 ₫')).toBeVisible();
    expect(profit.querySelector('.tc-summary-row__val--neg')).not.toBeNull();
  });

  it('keeps external zero hire unsigned and neutral in both consumers without changing nonzero hire', () => {
    tripFormContextMock.mockReturnValue(summaryForm('EXTERNAL', 0));
    const { rerender } = render(<><TripSummaryCard /><TotalsPanel /></>);
    const rows = () => screen.getAllByText('Cước thuê ngoài (gồm VAT)').map(label => label.closest('.tc-summary-row,.tc-totals-row')!);
    for (const row of rows()) {
      expect((row.querySelector('.money')?.textContent ?? '').startsWith('−')).toBe(false);
      expect(row.querySelector('.tc-summary-row__val--neutral,.tc-totals-row__val--neutral')).not.toBeNull();
    }
    tripFormContextMock.mockReturnValue(summaryForm('EXTERNAL', 55_000));
    rerender(<><TripSummaryCard /><TotalsPanel /></>);
    for (const row of rows()) {
      expect(within(row as HTMLElement).getByText('−55.000 ₫')).toBeVisible();
    }
  });

  it('preserves Money explicit sign even for zero; its caller owns subtraction semantics', () => {
    const { container } = render(<Money value={0} sign="−" />);
    expect(container.querySelector('.money')?.textContent).toBe('−0 ₫');
  });

  it('uses the compact shared checkbox card instead of an oversized inline control', () => {
    render(<AllowanceSection />);

    const checkbox = screen.getByRole('checkbox', { name: /Chuyến về có hàng/ });
    expect(checkbox.id).toBe('cb-return');
    expect(checkbox.closest('.tc-checkbox-card')).not.toBeNull();
    expect(checkbox.closest('.as-return-cargo-field')).not.toBeNull();
    expect((checkbox as HTMLElement).style.width).not.toBe('36px');
    expect((checkbox as HTMLElement).style.height).not.toBe('36px');
    expect(screen.getByText('Cộng 200.000 đ vào tiền đi đường')).toBeTruthy();
  });

  it('keeps the return-cargo state change wired to the trip form', () => {
    render(<AllowanceSection />);

    fireEvent.click(screen.getByRole('checkbox', { name: /Chuyến về có hàng/ }));

    expect(setHasReturnCargoMock).toHaveBeenCalledWith(false);
  });

  it.each([null, undefined])('keeps the native return-cargo control when its bonus description is %s', (bonus) => {
    const form = tripFormContextMock();
    tripFormContextMock.mockReturnValue({ ...form, returnCargoBonusApplied: bonus });

    render(<AllowanceSection />);

    const checkbox = screen.getByRole('checkbox', { name: 'Chuyến về có hàng' });
    expect(checkbox.id).toBe('cb-return');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(checkbox.closest('.tc-checkbox-card')?.querySelector('.tc-checkbox-card__desc')).toBeNull();
    fireEvent.click(checkbox);
    expect(setHasReturnCargoMock).toHaveBeenCalledOnce();
    expect(setHasReturnCargoMock).toHaveBeenCalledWith(false);
  });
});
