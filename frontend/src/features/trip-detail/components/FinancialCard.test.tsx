import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TripStatus, type TripDetail } from '@tingting/shared';
import { FinancialCard } from './FinancialCard';
import type { TripDerivedData } from '../types';

const derived = { revenue: 10800000, totalCost: 5550000, grossProfit: 3950000, fuelCost: 69000,
  roadAllowance: 300000, tollCost: 55000, tollsDiscount: 0, driverSalary: 800000,
  twoPointDeliveryBonus: 0, vehicleShiftAllowance: 0 } as TripDerivedData;
const trip = { carrierType: 'EXTERNAL', revenue: '10800000', externalFreightCost: '5400000',
  vatRate: '0.08', customerCommission: '500000', reconciledExtraCost: '150000' } as TripDetail;

describe('FIN01 rendered detail breakdown', () => {
  it('shows inclusive external hire and ex-VAT revenue without inactive OWN cost rows', () => {
    render(<FinancialCard derived={derived} trip={trip} customerCommission={500000} />);
    expect(screen.getByText('Doanh thu chưa VAT')).toBeVisible();
    expect(screen.getByText('Cước thuê ngoài (gồm VAT)')).toBeVisible();
    expect(screen.getByText('Chi phí phát sinh đã đối soát')).toBeVisible();
    expect(screen.getByText('10.000.000 ₫')).toBeVisible();
    expect(screen.getByText('−5.400.000 ₫')).toBeVisible();
    expect(screen.getByText(/5\.550\.000/)).toBeVisible();
    expect(screen.getByText('+3.950.000 ₫')).toBeVisible();
    expect(screen.queryByText('Chi phí nhiên liệu')).toBeNull();
    expect(screen.queryByText('Tiền lương lái xe')).toBeNull();
  });
  it('retains the OWN fuel, road and driver rows', () => {
    render(<FinancialCard derived={derived} trip={{ ...trip, carrierType: 'OWN' }} />);
    expect(screen.getByText('Chi phí nhiên liệu')).toBeVisible();
    expect(screen.getByText('−69.000 ₫')).toBeVisible();
    expect(screen.getByText('Tiền lương lái xe')).toBeVisible();
    expect(screen.queryByText('Cước thuê ngoài (gồm VAT)')).toBeNull();
  });

  it('keeps negative, positive and zero gross totals in their truthful tone without changing costs', () => {
    const { rerender } = render(<FinancialCard derived={{ ...derived, grossProfit: -50_000 }} trip={trip} />);
    const total = () => screen.getByText('Lợi nhuận gộp').closest('.pl-total') as HTMLElement;
    expect(total()).toHaveClass('pl-total--loss');
    expect(within(total()).getByText('−50.000 ₫')).toBeVisible();
    expect(screen.getByText(/5\.550\.000/)).toBeVisible();
    rerender(<FinancialCard derived={derived} trip={trip} />);
    expect(total()).toHaveClass('pl-total--profit');
    expect(within(total()).getByText('+3.950.000 ₫')).toBeVisible();
    rerender(<FinancialCard derived={{ ...derived, grossProfit: 0 }} trip={trip} />);
    expect(total()).toHaveClass('pl-total--neutral');
    expect(within(total()).getByText('0 ₫')).toBeVisible();
    expect(within(total()).queryByText('+')).toBeNull();
    expect(within(total()).queryByText('−')).toBeNull();
  });

  // SIL-942 (K8.14) — a computed 0 ₫ never stands bare: the P&L names the
  // reason. The precedence mirrors netTollForCompletedLeg: reconciled fact
  // first, then the unconfigured VETC route (owner-verbatim), then the
  // once-per-pair Kẹp dedup, then the missing rate.
  it('names the reason under a 0 ₫ toll — reconciled, VETC-unconfigured, pair dedup, then rate', () => {
    const zeroToll = { ...derived, tollCost: 0 };
    const { rerender } = render(
      <FinancialCard derived={zeroToll} trip={{ ...trip, carrierType: 'OWN', reconciledTollCost: '0' }} />,
    );
    expect(screen.getByText('Đã đối soát — phí cầu đường xác nhận 0 ₫.')).toBeVisible();

    rerender(<FinancialCard
      derived={zeroToll}
      trip={{ ...trip, carrierType: 'OWN', reconciledTollCost: null, tollsStations: 0 }}
    />);
    expect(screen.getByText('Route chưa cấu hình trạm thu VETC — cần nhập để tính')).toBeVisible();

    rerender(<FinancialCard
      derived={zeroToll}
      trip={{ ...trip, carrierType: 'OWN', reconciledTollCost: null, tollsStations: 6, tollDeduction: '600000' }}
    />);
    expect(screen.getByText('Phí cầu đường tính 1 lần cho cả cặp Kẹp/Kết hợp — khấu trừ ở chân còn lại.')).toBeVisible();

    rerender(<FinancialCard
      derived={zeroToll}
      trip={{ ...trip, carrierType: 'OWN', reconciledTollCost: null, tollsStations: 6, tollDeduction: '0' }}
    />);
    expect(screen.getByText('Chưa cấu hình đơn giá trạm thu — cần nhập để tính.')).toBeVisible();
  });

  it('names the reason under a 0 ₫ wage — unfinished trip vs completed with no norm', () => {
    const zeroSalary = { ...derived, driverSalary: 0 };
    const { rerender } = render(
      <FinancialCard derived={zeroSalary} trip={{ ...trip, carrierType: 'OWN', status: TripStatus.IN_TRANSIT }} />,
    );
    expect(screen.getByText('Chưa nhập số liệu lương — chuyến chưa hoàn thành.')).toBeVisible();

    rerender(<FinancialCard
      derived={zeroSalary}
      trip={{ ...trip, carrierType: 'OWN', status: TripStatus.COMPLETED }}
    />);
    expect(screen.getByText('Chưa cấu hình định mức lương (hồ sơ tài xế / tuyến) — cần nhập để tính.')).toBeVisible();
  });

  it('non-zero toll and wage rows carry no reason line', () => {
    const { container } = render(<FinancialCard
      derived={derived}
      trip={{ ...trip, carrierType: 'OWN', status: TripStatus.COMPLETED, tollsStations: 0 }}
    />);
    expect(container.querySelector('.pl-reason')).toBeNull();
    expect(screen.getByText('−55.000 ₫')).toBeVisible();
    expect(screen.getByText('−800.000 ₫')).toBeVisible();
  });
});
