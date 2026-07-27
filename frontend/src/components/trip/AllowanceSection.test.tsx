import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useTripFormContextMock, setHasReturnCargoMock } = vi.hoisted(() => ({
  useTripFormContextMock: vi.fn(),
  setHasReturnCargoMock: vi.fn(),
}));

vi.mock('../../hooks/useTripFormContext', () => ({
  useTripFormContext: useTripFormContextMock,
}));

import { AllowanceSection } from './AllowanceSection';

describe('AllowanceSection return-cargo control', () => {
  beforeEach(() => {
    setHasReturnCargoMock.mockReset();
    useTripFormContextMock.mockReturnValue({
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
});
