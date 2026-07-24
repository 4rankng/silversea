import React from 'react';
import { Fuel, AlertTriangle, Printer, FileSpreadsheet } from 'lucide-react';
import { FUEL_MODE_LABELS, roundInt } from '@tingting/shared';
import { Money } from '../../../components/shared/Money';
import { api } from '../../../lib/api';
import type { TripDetail } from '@tingting/shared';
import type { TripDerivedData } from '../types';

interface FuelCardProps {
  trip: TripDetail;
  derived: TripDerivedData;
  fuelPriceConfig: number | null;
}

// Fuel is dispatched in whole liters only (see shared/src/calculations/tripTotals.ts).
// Round on display so older trips persisted with sub-liter precision (e.g. 97.2 L)
// also render without decimals and stay consistent with newly created trips.
const fmtLiters = (v: number) => roundInt(v).toString();

export function FuelCard({ trip, derived, fuelPriceConfig }: FuelCardProps) {
  const { fuelLiters, computedLiters, ttbq, fuelVarianceLiters, fuelVarianceOver } = derived;

  // Effective price applied to this trip: the per-trip pump price when one was
  // recorded, else the trip's frozen config snapshot (fuelPriceApplied), else
  // the live config for legacy trips that never snapshotted. Falling back to the
  // snapshot — not the live config — keeps this card in lock-step with the phiếu
  // bốc dầu, whose "Giá áp dụng" reads that same snapshot. Using the live config
  // here would make the card and voucher disagree whenever the global fuel price
  // is changed after the trip was created.
  const actualPrice = trip.fuelActualUnitPrice != null ? Number(trip.fuelActualUnitPrice) : 0;
  const snapshotPrice = trip.fuelPriceApplied != null ? Number(trip.fuelPriceApplied) : null;
  const effectiveFuelPrice = actualPrice > 0
    ? actualPrice
    : (snapshotPrice != null ? snapshotPrice : fuelPriceConfig);

  const handlePrintVoucher = async () => {
    // Open window synchronously before await to avoid popup blocker
    const win = window.open('', '_blank');
    try {
      const html = await api.getForText(`/trips/${trip.id}/fuel-voucher/html`);
      if (win) {
        win.document.write(html);
        win.document.close();
      }
    } catch {
      win?.close();
    }
  };

  const handleExportXlsx = async () => {
    try {
      const blob = await api.getBlob(`/trips/${trip.id}/fuel-voucher/xlsx`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `phieu-cap-nhien-lieu-${trip.tripCode ?? trip.id}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { /* download failed */ }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2><span className="hicon"><Fuel size={15} /></span>Nhiên liệu</h2>
      </div>
      <div className="card-body">
        <div className="fuel-list">
          <div className="pl-row">
            <span className="k">Chế độ tính</span>
            <span className="v">{FUEL_MODE_LABELS[trip.fuelMode]}</span>
          </div>
          <div className="pl-row">
            <span className="k">Đơn giá áp dụng</span>
            <span className="v">
              {effectiveFuelPrice != null
                ? <><Money value={effectiveFuelPrice} /> <span className="v-unit">/lít</span></>
                : '—'}
            </span>
          </div>
          <div className="pl-row">
            <span className="k">Tiêu thụ bình quân</span>
            <span className="v">{ttbq > 0 ? `${ttbq.toFixed(1)} L/100km` : '—'}</span>
          </div>
          {trip.fuelSupplier && (
            <div className="pl-row">
              <span className="k">Nhà cung cấp</span>
              <span className="v fuel-supplier-name">{trip.fuelSupplier.name}</span>
            </div>
          )}
        </div>

        {trip.fuelSupplier && (
          <div className="fuel-actions">
            <button
              className="btn btn--secondary btn--sm"
              onClick={handlePrintVoucher}
              title="In phiếu cấp dầu"
            >
              <Printer size={14} /> In phiếu cấp dầu
            </button>
            <button
              className="btn btn--secondary btn--sm"
              onClick={handleExportXlsx}
              title="Xuất Excel"
            >
              <FileSpreadsheet size={14} /> Xuất Excel
            </button>
          </div>
        )}

        {fuelLiters > 0 && (
          <div className="fuel-compare">
            <div className="fc-title">So sánh nhiên liệu</div>
            <div className="bullet">
              <div className="bullet-head">
                <span className="bl">Phát hành</span>
                <span className="bv">{fmtLiters(fuelLiters)} L</span>
              </div>
              <div className="track">
                <div className="fill actual" style={{ width: `${Math.min((fuelLiters / (computedLiters || 1)) * 100, 100)}%` }} />
              </div>
            </div>
            {computedLiters > 0 && (
              <div className="bullet">
                <div className="bullet-head">
                  <span className="bl">Định mức</span>
                  <span className="bv">{fmtLiters(computedLiters)} L</span>
                </div>
                <div className="track">
                  <div className="fill norm" style={{ width: '100%' }} />
                </div>
              </div>
            )}
            {Math.abs(fuelVarianceLiters) > 0.5 && (
              <div className="fc-flag">
                <AlertTriangle size={15} />
                {fuelVarianceOver
                  ? `Vượt định mức +${fmtLiters(fuelVarianceLiters)} L`
                  : `Tiết kiệm ${fmtLiters(Math.abs(fuelVarianceLiters))} L`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
