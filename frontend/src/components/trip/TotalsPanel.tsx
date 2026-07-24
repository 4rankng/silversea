import React, { useMemo, useState } from "react";
import './TripSummaryCard.css';
import { Clock, Users, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, MapPin } from "lucide-react";
import { computeTripTotals } from "@tingting/shared";
import { useTripFormContext } from "../../hooks/useTripFormContext";
import { useFuelConfig } from '../../hooks/useQueries';
import { Money } from '../shared/Money';

/**
 * Deep-luxe right-rail finance card for the trip edit page.
 *
 * Visual hierarchy:
 *   1. Header band       (eyebrow + title)
 *   2. Revenue hero      (inset surface, 32px number, brass unit)
 *   3. Allocation bar    (brass spectrum, brass legend)
 *   4. Cost rows + profit (clickable road breakdown, brass/copper profit)
 */
export function TotalsPanel() {
  const form = useTripFormContext();
  const { data: fuelConfig } = useFuelConfig();
  const {
    legs, fuelMode, fuelLitersOverride, fuelSupplementLiters,
    tollsDiscount, tollsAddition, tollsStations,
    hasReturnCargo, driverSalary, revenue,
    customerCommission,
    revenueEmptyReturn, revenueCombine,
    selectedRouteData, roadAllowanceBaseApplied, fuelActualUnitPrice,
    roadAllowanceOverride, tollPerStationApplied, returnCargoBonusApplied,
  } = form;
  const [showRoadBreakdown, setShowRoadBreakdown] = useState(true);

  const isMountainRoute = selectedRouteData?.isMountain ?? false;
  const mountainFixedAllowance = selectedRouteData?.fixedFuelAllowance ? Number(selectedRouteData.fixedFuelAllowance) : null;

  const totals = useMemo(() => {
    const formattedLegs = legs.map((leg) => ({
      sequence: leg.sequence,
      km: Number(leg.km) || 0,
      loadingType: leg.loadingType,
    }));

    return computeTripTotals({
      legs: formattedLegs,
      fuelMode: fuelMode,
      fuelLitersOverride: fuelLitersOverride ? Number(fuelLitersOverride) : null,
      fuelSupplementLiters: fuelSupplementLiters ? Number(fuelSupplementLiters) : 0,
      fuelLoadedNorm: 43,
      fuelEmptyNorm: 25,
      fuelPerTripSupplement: 3,
      fuelUnitPrice: fuelConfig ? Number(fuelConfig.unitPrice) : 25000,
      fuelActualUnitPrice: fuelActualUnitPrice !== '' ? Number(fuelActualUnitPrice) : null,
      isMountainRoute,
      mountainFixedAllowance,
      roadAllowanceBase: roadAllowanceBaseApplied ?? 0,
      tollsDiscount: tollsDiscount ? Number(tollsDiscount) : 0,
      tollsAddition: tollsAddition ? Number(tollsAddition) : 0,
      tollsStations: tollsStations ? Number(tollsStations) : 0,
      tollPerStation: tollPerStationApplied ?? 0,
      hasReturnCargo,
      returnCargoBonus: returnCargoBonusApplied ?? 0,
      revenue: revenue ? Number(revenue) : 0,
      driverSalary: driverSalary ? Number(driverSalary) : 0,
      twoPointDeliveryBonus: Number(form.twoPointDeliveryBonus) || 0,
      vehicleShiftAllowance: Number(form.vehicleShiftAllowance) || 0,
      customerCommission: Number(customerCommission) || 0,
    });
  }, [
    legs, fuelMode, fuelLitersOverride, fuelSupplementLiters,
    isMountainRoute, mountainFixedAllowance, roadAllowanceBaseApplied,
    tollsDiscount, tollsAddition, tollsStations, tollPerStationApplied, returnCargoBonusApplied,
    hasReturnCargo, revenue, driverSalary, fuelConfig, fuelActualUnitPrice,
    form.twoPointDeliveryBonus, form.vehicleShiftAllowance, customerCommission,
  ]);

  // Road-allowance breakdown — what makes up "Tiền đi đường thực nhận"
  const roadBreakdown = useMemo(() => {
    const base = Number(roadAllowanceBaseApplied) || 0;
    const discount = Number(tollsDiscount) || 0;
    const addition = Number(tollsAddition) || 0;
    const stations = Number(tollsStations) || 0;
    const perStation = Number(tollPerStationApplied) || 0;
    const stationCost = stations * perStation;
    const returnBonus = hasReturnCargo ? (Number(returnCargoBonusApplied) || 0) : 0;
    const overrideRaw = roadAllowanceOverride !== '' && roadAllowanceOverride != null
      ? Number(roadAllowanceOverride)
      : null;
    const overridden = overrideRaw != null && Number.isFinite(overrideRaw);
    return { base, discount, addition, stations, perStation, stationCost, returnBonus, overrideRaw, overridden };
  }, [roadAllowanceBaseApplied, tollsDiscount, tollsAddition, tollsStations, tollPerStationApplied, returnCargoBonusApplied, hasReturnCargo, roadAllowanceOverride]);

  // Revenue split — used by accountant when reviewing combined trips.
  const revenueEmpty = Number(revenueEmptyReturn) || 0;
  const revenueComb = Number(revenueCombine) || 0;
  const revenueNum = Number(revenue) || (revenueEmpty + revenueComb);
  const isProfitPositive = totals.grossProfit >= 0;

  const twoPointAmount = Number(form.twoPointDeliveryBonus) || 0;
  const vehicleShiftAmount = Number(form.vehicleShiftAllowance) || 0;
  const totalCost = totals.totalCost;
  const fuelPct = totalCost > 0 ? (totals.totalFuelCost / totalCost) * 100 : 0;
  const fullRoadCost = totals.totalRoadAllowance + totals.tollCost + (Number(tollsDiscount) || 0);
  const roadPct = totalCost > 0 ? (fullRoadCost / totalCost) * 100 : 0;
  const salaryPct = totalCost > 0 ? ((Number(driverSalary) || 0) / totalCost) * 100 : 0;
  const otherPct = totalCost > 0 ? ((twoPointAmount + vehicleShiftAmount) / totalCost) * 100 : 0;

  return (
    <article className="tc-totals">
      {/* 1. Header band */}
      <header className="tc-totals__head">
        <h3 className="tc-totals__title">Doanh thu &amp; Lợi nhuận</h3>
      </header>

      {/* 2. Revenue hero (inset) */}
      <section className="tc-totals__revenue">
        <p className="tc-totals__revenue-label">Doanh thu</p>
        <p className="tc-totals__revenue-value">
          <Money value={revenueNum} />
        </p>
        {(revenueEmpty > 0 || revenueComb > 0) && (
          <dl className="tc-totals__revenue-split">
            <div>
              <dt>DT trả hàng</dt>
              <dd><Money value={revenueEmpty} /></dd>
            </div>
            <div>
              <dt>+ DT kết hợp đóng hàng</dt>
              <dd>
                <Money value={Math.abs(revenueComb)} sign={revenueComb >= 0 ? "+" : undefined} />
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* 3. Allocation bar */}
      <section className="tc-totals__alloc">
        <div className="tc-totals__alloc-head">
          <span>Phân bổ chi phí</span>
          <Money value={totalCost} />
        </div>
        <div className="tc-totals__alloc-bar" role="img" aria-label="Phân bổ chi phí">
          <span
            className="tc-totals__alloc-seg tc-totals__alloc-seg--fuel"
            style={{ width: `${fuelPct}%` }}
            title={`Dầu: ${Math.round(fuelPct)}%`}
          />
          <span
            className="tc-totals__alloc-seg tc-totals__alloc-seg--road"
            style={{ width: `${roadPct}%` }}
            title={`Đường bộ: ${Math.round(roadPct)}%`}
          />
          <span
            className="tc-totals__alloc-seg tc-totals__alloc-seg--salary"
            style={{ width: `${salaryPct}%` }}
            title={`Lương tài: ${Math.round(salaryPct)}%`}
          />
          {otherPct > 0 && (
            <span
              className="tc-totals__alloc-seg tc-totals__alloc-seg--other"
              style={{ width: `${otherPct}%` }}
              title={`Khác: ${Math.round(otherPct)}%`}
            />
          )}
        </div>
        <ul className="tc-totals__alloc-legend">
          <li>
            <i className="tc-totals__legend-dot--fuel" />
            Dầu ({Math.round(totals.totalFuelLiters)}L) · <strong>{Math.round(fuelPct)}%</strong>
          </li>
          <li>
            <i className="tc-totals__legend-dot--road" />
            Đường · <strong>{Math.round(roadPct)}%</strong>
          </li>
          <li>
            <i className="tc-totals__legend-dot--salary" />
            Lương tài · <strong>{Math.round(salaryPct)}%</strong>
          </li>
          {otherPct > 0 && (
            <li>
              <i className="tc-totals__legend-dot--other" />
              Khác · <strong>{Math.round(otherPct)}%</strong>
            </li>
          )}
        </ul>
      </section>

      {/* 4. Cost rows + profit */}
      <section className="tc-totals__rows">
        <div className="tc-totals-row">
          <span className="tc-totals-row__lbl">
            <Clock size={13} /> Chi phí nhiên liệu
          </span>
          <span className="tc-totals-row__val">
            <Money value={Math.abs(totals.totalFuelCost)} sign="−" />
          </span>
        </div>

        <div
          className="tc-totals-row tc-totals-row--clickable"
          onClick={() => setShowRoadBreakdown(v => !v)}
          role="button"
          aria-expanded={showRoadBreakdown}
          title="Bấm để xem chi tiết"
        >
          <span className="tc-totals-row__lbl">
            <span aria-hidden style={{ display: 'inline-flex' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18" />
                <path d="M5 21V8l4-3 4 3v13" />
                <path d="M13 21V12l4-2 4 2v9" />
              </svg>
            </span>
            Chi phí đường bộ
            {showRoadBreakdown ? <ChevronUp size={12} className="tc-totals-row__chev" /> : <ChevronDown size={12} className="tc-totals-row__chev" />}
            {roadBreakdown.overridden && (
              <span className="tc-totals-row__adjusted-pill">Đã điều chỉnh</span>
            )}
          </span>
          <span className="tc-totals-row__val">
            <Money value={Math.abs(fullRoadCost)} sign="−" />
          </span>
        </div>

        {showRoadBreakdown && (
          <div className="tc-totals-breakdown">
            {roadBreakdown.returnBonus > 0 && (
              <div className="tc-totals-breakdown__row">
                <span>Chuyến về có hàng</span>
                <Money value={Math.abs(roadBreakdown.returnBonus)} sign="−" />
              </div>
            )}
            {roadBreakdown.discount > 0 && (
              <div className="tc-totals-breakdown__row">
                <span>Tiền vé (công ty) đã thanh toán</span>
                <Money value={Math.abs(roadBreakdown.discount)} sign="−" />
              </div>
            )}
            {roadBreakdown.stations > 0 && (
              <div className="tc-totals-breakdown__row">
                <span>Trạm BOT ({roadBreakdown.stations} × {Math.round(roadBreakdown.perStation).toLocaleString('vi-VN')})</span>
                <Money value={Math.abs(roadBreakdown.stationCost)} sign="−" />
              </div>
            )}
            {roadBreakdown.overridden && (
              <div className="tc-totals-breakdown__row tc-totals-breakdown__row--override">
                <span>Đã điều chỉnh tay tổng chi phí</span>
                <Money value={Math.abs(roadBreakdown.overrideRaw!)} />
              </div>
            )}
          </div>
        )}

        <div className="tc-totals-row">
          <span className="tc-totals-row__lbl">
            <Users size={13} /> Tiền lương lái xe
          </span>
          <span className="tc-totals-row__val">
            <Money value={Math.abs(Number(driverSalary) || 0)} sign="−" />
          </span>
        </div>

        {twoPointAmount > 0 && (
          <div className="tc-totals-row">
            <span className="tc-totals-row__lbl">
              <MapPin size={13} /> Trả hàng 2 điểm
            </span>
            <span className="tc-totals-row__val">
              <Money value={Math.abs(twoPointAmount)} sign="−" />
            </span>
          </div>
        )}

        {vehicleShiftAmount > 0 && (
          <div className="tc-totals-row">
            <span className="tc-totals-row__lbl">
              <Clock size={13} /> Lưu ca xe
            </span>
            <span className="tc-totals-row__val">
              <Money value={Math.abs(vehicleShiftAmount)} sign="−" />
            </span>
          </div>
        )}

        <div className="tc-totals__profit">
          <span className="tc-totals__profit-label">Lợi nhuận dự kiến</span>
          <span
            className={`tc-totals__profit-val ${isProfitPositive ? 'is-pos' : 'is-neg'}`}
          >
            <span className="tc-totals__profit-pill" aria-hidden>
              {isProfitPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            </span>
            <Money value={Math.abs(totals.grossProfit)} sign={isProfitPositive ? '+' : '−'} />
          </span>
        </div>
      </section>
    </article>
  );
}
