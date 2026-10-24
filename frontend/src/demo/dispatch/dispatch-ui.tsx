/**
 * Shared micro-primitives for the demo dispatch surface (SIL-156/157/158).
 * Visual language locked by the Gemini consult 24/10 (brief demo24):
 * badge pill = py-0.5 px-2 text-xs medium trên nền soft 50 / chữ 700 của
 * cùng ramp utility; grid cell = 3 dòng 14px medium / 12px / 12px.
 * Token-only: mọi màu qua ramp `utility-*` của theme.css, không hex thô.
 */
import type { ReactNode } from 'react';
import { cx } from '@/utils/cx';
import type { FeeSignal, TripStatus } from './dispatch-model';

export type PillTone = 'success' | 'warning' | 'error' | 'neutral' | 'purple' | 'orange' | 'blue' | 'brand';

const PILL_TONES: Record<PillTone, string> = {
  success: 'bg-utility-green-50 text-utility-green-700',
  warning: 'bg-utility-yellow-50 text-utility-yellow-700',
  error: 'bg-utility-red-50 text-utility-red-700',
  neutral: 'bg-secondary text-tertiary',
  purple: 'bg-utility-purple-50 text-utility-purple-700',
  orange: 'bg-utility-orange-50 text-utility-orange-700',
  blue: 'bg-utility-blue-50 text-utility-blue-700',
  brand: 'bg-brand-primary text-brand-700',
};

export function SoftPill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full py-0.5 px-2 text-xs font-medium',
        PILL_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Tín hiệu phí nâng/hạ (ô 6, dòng 2) ──────────────────────────────── */

export const FEE_SIGNAL_TONES: Record<FeeSignal, PillTone> = {
  'unc-paid': 'success',
  'unc-pending': 'warning',
  'driver-cash': 'neutral',
};

export function FeeSignalBadge({ signal, kind }: { signal: FeeSignal; kind: 'Nâng' | 'Hạ' }) {
  const labels: Record<FeeSignal, string> = {
    'unc-paid': 'Đã UNC',
    'unc-pending': 'Chờ KT UNC',
    'driver-cash': 'LX Chi',
  };
  return (
    <SoftPill tone={FEE_SIGNAL_TONES[signal]}>
      <span aria-hidden="true">
        {signal === 'unc-paid' ? '✅' : signal === 'unc-pending' ? '⏳' : '⚪'}
      </span>
      {kind}: {labels[signal]}
    </SoftPill>
  );
}

/* ── Trạng thái hành trình (ô 6, dòng 1 — text tĩnh, không thành nút) ── */

const STATUS_META: Record<TripStatus, { dot: string; label: string }> = {
  new: { dot: 'bg-utility-slate-400', label: 'Mới tạo' },
  assigned: { dot: 'bg-utility-blue-500', label: 'Đã phân xe' },
  running: { dot: 'bg-brand-solid', label: 'Đang chạy' },
  done: { dot: 'bg-utility-green-500', label: 'Hoàn thành' },
};

export function StatusLine({ status }: { status: TripStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
      <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

/* ── Nguồn xe (ô 1, dòng 2) ──────────────────────────────────────────── */

export function VehicleSourceBadge({
  source,
  children,
}: {
  source: 'inhouse' | 'vendor';
  children: ReactNode;
}) {
  return (
    <SoftPill tone={source === 'inhouse' ? 'success' : 'orange'}>
      <span
        aria-hidden="true"
        className={cx(
          'size-1.5 rounded-full',
          source === 'inhouse' ? 'bg-utility-green-500' : 'bg-utility-orange-500',
        )}
      />
      {children}
    </SoftPill>
  );
}
