import React from 'react';
import { Wallet } from 'lucide-react';
import { Money } from '../../../components/shared/Money';
import type { TripDerivedData } from '../types';

interface FinancialCardProps {
  derived: TripDerivedData;
  customerCommission?: number;
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

export function FinancialCard({ derived, customerCommission = 0 }: FinancialCardProps) {
  const {
    revenue, fuelCost, roadAllowance, tollCost, tollsDiscount, driverSalary,
    twoPointDeliveryBonus, vehicleShiftAllowance,
    totalCost, grossProfit,
  } = derived;

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
            <span className="k">Doanh thu</span>
            <span className="v"><Money value={revenue} /></span>
          </div>
          {showCommission && (
            <div className="pl-row">
              <span className="k"><span className="swatch swatch--commission" />Hoa hồng khách hàng</span>
              <span className="v neg"><NegMoney value={customerCommission} /></span>
            </div>
          )}
          <div className="pl-divider dashed" />
          <div className="pl-row">
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
          <div className="pl-row">
            <span className="k"><span className="swatch swatch--road" />Tiền lương lái xe</span>
            <span className={`v ${driverSalary === 0 ? 'zero' : ''}`}><NegMoney value={driverSalary} /></span>
          </div>
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
          <div className="pl-divider" />
          <div className="pl-row subtotal">
            <span className="k">Tổng chi phí</span>
            <span className="v"><Money value={totalCost} /></span>
          </div>
          <div className="pl-total">
            <span className="k">Lợi nhuận gộp</span>
            <span className="v"><Money value={Math.abs(grossProfit)} sign={grossProfit > 0 ? '+' : grossProfit < 0 ? '−' : undefined} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}
