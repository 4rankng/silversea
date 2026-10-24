/**
 * Thẻ lệnh chuyến — Layer 1 của ứng dụng lái xe demo (SIL-162, spec §5).
 *
 * Built from vendored Untitled UI base primitives + house utility tokens
 * (consult kết luận trong ticket SIL-162: giờ có mặt text-sm semibold trái,
 * badge CHẠY KẸP purple-50/700 pill xs phải; khung cảnh báo đỏ
 * bg-error-primary/border-error_subtle). Toàn thẻ là một nút — tap mở
 * Layer 2 chi tiết.
 */
import { Fragment } from 'react';
import { ArrowRight, CheckCircle, Link01 } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import type { DemoTrip } from '../data';
import { attendanceTime, financeLines, isTwinLiftTrip, routeStops, type FinanceTone } from './derive';

const FINANCE_DOT: Record<FinanceTone, string> = {
  green: 'bg-utility-green-500',
  orange: 'bg-utility-orange-500',
  yellow: 'bg-utility-yellow-500',
};

/** Badge CHẠY KẸP — pill xs purple-50/700 (consult SIL-162). */
export function TwinLiftBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-utility-purple-50 px-2 py-0.5 text-xs font-medium text-utility-purple-700 ring-1 ring-inset ring-utility-purple-200">
      <Link01 className="size-3" aria-hidden="true" />
      CHẠY KẸP
    </span>
  );
}

function StopChip({ label }: { label: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center truncate rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary">
      {label}
    </span>
  );
}

export interface TripCardProps {
  trip: DemoTrip;
  completed: boolean;
  onOpen: (trip: DemoTrip) => void;
}

export function TripCard({ trip, completed, onOpen }: TripCardProps) {
  const stops = routeStops(trip);
  const finance = financeLines(trip);
  const twin = isTwinLiftTrip(trip);

  return (
    <button
      type="button"
      onClick={() => onOpen(trip)}
      data-testid={`driver-trip-card-${trip.id}`}
      className={cx(
        'flex w-full flex-col gap-2.5 rounded-xl border border-secondary_alt bg-primary p-3 text-left shadow-xs transition-colors hover:border-brand',
        completed && 'opacity-60',
      )}
    >
      {/* Header: giờ có mặt (semibold) + badge kẹp / hoàn thành */}
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold text-primary">{attendanceTime(trip)}</span>
          <span className="truncate text-xs text-tertiary">{trip.code}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {twin && <TwinLiftBadge />}
          {completed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-utility-green-50 px-2 py-0.5 text-xs font-medium text-utility-green-700 ring-1 ring-inset ring-utility-green-200">
              <CheckCircle className="size-3" aria-hidden="true" />
              Đã hoàn thành
            </span>
          )}
        </span>
      </span>

      {/* Lộ trình: chip cảng nâng ➔ nhà máy ➔ cảng hạ */}
      <span className="flex flex-wrap items-center gap-1">
        {stops.map((stop, i) => (
          <Fragment key={`${stop.kind}-${stop.label}-${i}`}>
            {i > 0 && <ArrowRight className="size-3.5 shrink-0 text-quaternary" aria-hidden="true" />}
            <StopChip label={stop.label} />
          </Fragment>
        ))}
      </span>

      {/* Cỡ cont + xuất/nhập + số cont */}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-secondary">
        <span className="font-semibold text-primary">{trip.size}′</span>
        <span aria-hidden="true">·</span>
        <span>{trip.flow === 'export' ? 'Hàng Xuất' : 'Hàng Nhập'}</span>
        <span aria-hidden="true">·</span>
        <span className="font-medium">{trip.contNo}</span>
      </span>

      {/* Khung cảnh báo đỏ — ghi chú hiện trường */}
      {trip.note && (
        <span className="rounded-lg border border-error_subtle bg-error-primary px-2.5 py-2 text-xs leading-relaxed text-error-primary">
          {trip.note}
        </span>
      )}

      {/* Chỉ dẫn tài chính tại cảng */}
      {finance.length > 0 && (
        <span className="flex flex-col gap-1">
          {finance.map((line) => (
            <span key={line.text} className="flex items-start gap-1.5 text-xs leading-relaxed text-secondary">
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', FINANCE_DOT[line.tone])} aria-hidden="true" />
              {line.text}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
