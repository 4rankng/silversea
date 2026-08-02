import { Download, Pencil, Plus, X } from 'lucide-react';
import { TripStatus } from '@tingting/shared';
import { formatMoney, type StatusCounts } from '../features/trips';
import type { tripClient } from '../api/tripClient';

type Summary = Awaited<ReturnType<typeof tripClient.getTripsSummary>>;
interface TripListHeroProps { todayLabel: string; statusCounts: StatusCounts; summary?: Summary; quickEdit: boolean; toggleQuickEdit: () => void; handleExport: () => void; onAdd: () => void; breakdownPct: { chot: number; htth: number; dang: number; moi: number; huy: number }; warnThreshold: number; month: number }
export function TripListHero({ todayLabel, statusCounts, summary, quickEdit, toggleQuickEdit, handleExport, onAdd, breakdownPct, warnThreshold, month }: TripListHeroProps) {
 return (
        <section className="hero hero--route-network">
          <div className="hero-top">
            <div className="hero-title-block">
              <div className="hero-eyebrow">Sổ chuyến · {todayLabel}</div>
              <h1 className="hero-h1" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src="/assets/icons/03-trip-log-so-chuyen-chuyen-xe.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
                Sổ chuyến đi
              </h1>
              <div className="hero-sub">
                {statusCounts.all} chuyến đã ghi nhận
                {statusCounts[TripStatus.COMPLETED] > 0 && (
                  <span title="Chờ khóa: chuyến đã hoàn thành, chờ kế toán xác nhận khóa sổ kế toán"> · {statusCounts[TripStatus.COMPLETED]} chờ khóa</span>
                )}
                {(summary?.missingFuel ?? 0) > 0 && <> · {summary?.missingFuel} chưa khai báo dầu</>}
              </div>
            </div>
            <div className="hero-actions">
              <button type="button" className={`btn hero-action--quick ${quickEdit ? 'btn--primary' : 'btn--secondary'}`} onClick={toggleQuickEdit} aria-label={quickEdit ? 'Thoát chế độ sửa nhanh' : 'Bật chế độ sửa nhanh'}>
                {quickEdit ? <X size={15} /> : <Pencil size={15} />}
                <span className="hero-action-label">{quickEdit ? 'Thoát sửa nhanh' : 'Sửa nhanh'}</span>
              </button>
              <button type="button" className="btn btn--secondary hero-action--export" onClick={handleExport} aria-label="Xuất danh sách chuyến ra Excel">
                <Download size={15} />
                <span className="hero-action-label">Xuất Excel</span>
              </button>
            <button type="button" className="btn btn--primary hero-action--add" onClick={onAdd}>
                <Plus size={15} strokeWidth={2.4} />
                Thêm chuyến
              </button>
            </div>
          </div>

          <div className="metrics">
            <div className="metric featured">
              <div className="metric-label">Tổng chuyến · phân loại</div>
              <div className="metric-value d-mono">{statusCounts.all}</div>
              <div className="breakdown-bar">
                <div className="bb-seg bb-chot" style={{ width: `${breakdownPct.chot}%` }} />
                <div className="bb-seg bb-htth" style={{ width: `${breakdownPct.htth}%` }} />
                <div className="bb-seg bb-dang" style={{ width: `${breakdownPct.dang}%` }} />
                <div className="bb-seg bb-moi"  style={{ width: `${breakdownPct.moi}%` }} />
                <div className="bb-seg bb-huy"  style={{ width: `${breakdownPct.huy}%` }} />
              </div>
              <div className="breakdown-legend">
                <span className="legend-item"><span className="legend-dot bb-htth" />Hoàn thành {statusCounts[TripStatus.COMPLETED]}</span>
                <span className="legend-item"><span className="legend-dot bb-dang" />Đang chạy {statusCounts[TripStatus.IN_TRANSIT]}</span>
                <span className="legend-item"><span className="legend-dot bb-moi"  />Mới tạo {statusCounts[TripStatus.CREATED]}</span>
                <span className="legend-item"><span className="legend-dot bb-huy"  />Đã hủy {statusCounts[TripStatus.CANCELED]}</span>
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Tổng KM tháng này</div>
              <div className="metric-value d-mono">
                {(summary?.totalKm ?? 0).toLocaleString('vi-VN')}
                <span className="metric-unit">km</span>
              </div>
              <div className="metric-delta delta-flat">{statusCounts.all} chuyến tháng này</div>
            </div>
            <div className="metric">
              <div className="metric-label">Tổng dầu tiêu thụ</div>
              <div className="metric-value d-mono">
                {(summary?.totalFuel ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}
                <span className="metric-unit">L</span>
              </div>
              <div className={`metric-delta ${(summary?.totalKm ?? 0) > 0 && (summary?.avgPer100 ?? 0) > warnThreshold ? 'delta-warn' : 'delta-flat'}`}>
                {(summary?.totalKm ?? 0) > 0 ? (
                  <>TB {(summary?.avgPer100 ?? 0).toFixed(1).replace('.', ',')} L/100km · ngưỡng {warnThreshold.toFixed(1).replace('.', ',')}</>
                ) : <>TB không khả dụng (0 km)</>}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">Tiền đi đường</div>
              <div className="metric-value d-mono">
                {formatMoney(summary?.totalRoad ?? 0)}
                <span className="metric-unit">₫</span>
              </div>
              <div className="metric-delta delta-flat">
                {(summary?.missingFuel ?? 0) > 0
                  ? `${summary?.missingFuel} chuyến chưa cập nhật`
                  : 'Đã cập nhật đầy đủ'}
              </div>
            </div>
            <div className="metric">
              <div className="metric-label">
                Tổng giá trị lệnh{' '}
                <span style={{ fontWeight: 500, fontSize: 'var(--fs-xs)', lineHeight: 1.35, opacity: 0.75 }}>
                  (tất cả trạng thái)
                </span>
              </div>
              <div className="metric-value d-mono">
                {formatMoney(summary?.totalRevenue ?? 0)}
                <span className="metric-unit">₫</span>
              </div>
              <div className="metric-delta delta-flat">Tháng {month} · bao gồm tất cả trạng thái chuyến</div>
            </div>
          </div>
        </section>
 );
}
