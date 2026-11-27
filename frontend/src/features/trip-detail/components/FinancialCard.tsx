import React from 'react';
import { Wallet } from 'lucide-react';
import { Money } from '../../../components/shared/Money';
import { TripStatus, type TripDetail } from '@tingting/shared';
import type { TripDerivedData } from '../types';
import { getExternalTripDisplayTotals } from '../../trips/tripHelpers';

interface FinancialCardProps {
  derived: TripDerivedData;
  trip: TripDetail;
  customerCommission?: number;
}

/** SIL-942 (K8.14) — owner-verbatim VETC warning. The BE completion law
 *  (trip-pair-rules.service `VETC_ROUTE_UNCONFIGURED_WARNING`) is the copy
 *  source; /api/trips does not carry the reason marker, so the P&L mirrors
 *  the law's precedence from the trip fields it already reads. */
const VETC_ROUTE_UNCONFIGURED_WARNING = 'Route chưa cấu hình trạm thu VETC — cần nhập để tính';

/**
 * SIL-942 (K8.14) — why a computed 0 ₫ VETC toll is 0. Mirrors
 * netTollForCompletedLeg's precedence on the fields the trip payload carries:
 * a reconciled claim wins first (0 stays a reviewed fact), then the
 * unconfigured route, then the once-per-pair backhaul dedup, then a missing
 * rate. Called only when `derived.tollCost === 0`.
 */
function tollZeroReason(trip: TripDetail): string {
  if (trip.reconciledTollCost != null && Number(trip.reconciledTollCost) === 0) {
    return 'Đã đối soát — phí cầu đường xác nhận 0 ₫.';
  }
  if (Number(trip.tollsStations ?? 0) === 0) return VETC_ROUTE_UNCONFIGURED_WARNING;
  if (Number(trip.tollDeduction ?? 0) > 0) {
    return 'Phí cầu đường tính 1 lần cho cả cặp Kẹp/Kết hợp — khấu trừ ở chân còn lại.';
  }
  return 'Chưa cấu hình đơn giá trạm thu — cần nhập để tính.';
}

/**
 * SIL-942 (K8.14) — why a 0 ₫ wage is 0. The completion materializes the
 * wage (completedLegSalaryLaw: stored → pair phụ phí → base allocation), so
 * a COMPLETED 0 means no norm is configured anywhere; an unfinished trip
 * simply has no figures yet. Called only when `derived.driverSalary === 0`.
 */
function salaryZeroReason(trip: TripDetail): string {
  if (trip.status !== TripStatus.COMPLETED) {
    return 'Chưa nhập số liệu lương — chuyến chưa hoàn thành.';
  }
  return 'Chưa cấu hình định mức lương (hồ sơ tài xế / tuyến) — cần nhập để tính.';
}

/**
 * A cost-row amount: renders the negative sign + styled ₫ when the value is
 * > 0, and a muted "0 ₫" when it is zero. Encapsulates the duplicate
 * `Math.abs(x)` + `<Money sign="−">` pattern that was repeated 5 times in
 * FinancialCard's body.
 */
function NegMoney({ value }: { value: number }) {
  if (value > 0) return <Money value={value} sign="−" />;
  return <Money value={0} />;
}

export function FinancialCard({ derived, trip, customerCommission = 0 }: FinancialCardProps) {
  const {
    revenue, fuelCost, roadAllowance, tollCost, tollsDiscount, driverSalary,
    twoPointDeliveryBonus, vehicleShiftAllowance,
    totalCost, grossProfit,
  } = derived;

  const external = trip.carrierType === 'EXTERNAL' ? getExternalTripDisplayTotals(trip) : null;
  const extraCost = Number(trip.reconciledExtraCost ?? 0);
  const showCommission = customerCommission > 0;
  const showTwoPointBonus = twoPointDeliveryBonus > 0;
  const showShiftAllowance = vehicleShiftAllowance > 0;

  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="hicon"><Wallet size={15} /></span>Phân tích tài chính</h2>
      </div>
      <div className="card-body">
        <div className="pl">
          <div className="pl-row">
            <span className="k">{external ? 'Doanh thu chưa VAT' : 'Doanh thu'}</span>
            <span className="v"><Money value={external?.freightExVat ?? revenue} /></span>
          </div>
          {showCommission && (
            <div className="pl-row">
              <span className="k"><span className="swatch swatch--commission" />Hoa hồng khách hàng</span>
              <span className="v neg"><NegMoney value={customerCommission} /></span>
            </div>
          )}
          <div className="pl-divider dashed" />
          {external ? (
            <div className="pl-row">
              <span className="k">Cước thuê ngoài (gồm VAT)</span>
              <span className="v neg"><NegMoney value={Number(trip.externalFreightCost ?? 0)} /></span>
            </div>
          ) : <>          <div className="pl-row">
            <span className="k"><span className="swatch swatch--fuel" />Chi phí nhiên liệu</span>
            <span className="v neg"><NegMoney value={fuelCost} /></span>
          </div>
          <div className="pl-row">
            <span className="k"><span className="swatch swatch--road" />Tiền đi đường</span>
            <span className={`v ${roadAllowance === 0 ? 'zero' : 'neg'}`}><NegMoney value={roadAllowance} /></span>
          </div>
          {tollsDiscount > 0 && (
            <div className="pl-row">
              <span className="k"><span className="swatch swatch--road" />Tiền vé (công ty thanh toán)</span>
              <span className="v neg"><NegMoney value={tollsDiscount} /></span>
            </div>
          )}
          <div className="pl-row">
            <span className="k"><span className="swatch swatch--road" />Tiền vé (trạm thu phí)</span>
            <span className={`v ${tollCost === 0 ? 'zero' : ''}`}><NegMoney value={tollCost} /></span>
          </div>
          {tollCost === 0 && <p className="pl-reason">{tollZeroReason(trip)}</p>}
          <div className="pl-row">
            <span className="k"><span className="swatch swatch--road" />Tiền lương lái xe</span>
            <span className={`v ${driverSalary === 0 ? 'zero' : ''}`}><NegMoney value={driverSalary} /></span>
          </div>
          {driverSalary === 0 && <p className="pl-reason">{salaryZeroReason(trip)}</p>}
          {showTwoPointBonus && (
            <div className="pl-row">
              <span className="k"><span className="swatch swatch--road" />Thưởng giao 2 điểm</span>
              <span className="v neg"><NegMoney value={twoPointDeliveryBonus} /></span>
            </div>
          )}
          {showShiftAllowance && (
            <div className="pl-row">
              <span className="k"><span className="swatch swatch--road" />Lưu ca xe</span>
              <span className="v neg"><NegMoney value={vehicleShiftAllowance} /></span>
            </div>
          )}
</>}
          {extraCost > 0 && (
            <div className="pl-row">
              <span className="k">Chi phí phát sinh đã đối soát</span>
              <span className="v neg"><NegMoney value={extraCost} /></span>
            </div>
          )}
          <div className="pl-divider" />
          <div className="pl-row subtotal">
            <span className="k">Tổng chi phí</span>
            <span className="v">{totalCost == null ? '—' : <Money value={totalCost} />}</span>
          </div>
          <div className={`pl-total pl-total--${grossProfit == null ? 'neutral' : grossProfit > 0 ? 'profit' : grossProfit < 0 ? 'loss' : 'neutral'}`}>
            <span className="k">Lợi nhuận gộp</span>
            <span className="v">{grossProfit == null
              ? '—'
              : <Money value={Math.abs(grossProfit)} sign={grossProfit > 0 ? '+' : grossProfit < 0 ? '−' : undefined} />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
