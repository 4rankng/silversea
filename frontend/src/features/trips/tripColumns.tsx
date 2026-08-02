import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router-dom';
import { ArrowRight, AlertCircle, Copy, X as XIcon } from 'lucide-react';
import {
  TripStatus, TRIP_STATUS_LABELS, DATA_COMPLETENESS_COLORS, TRIP_STATUS_COLORS,
  type TripDetail,
} from '@tingting/shared';
import { splitRoute } from '../../lib/route';
import { formatDayMonth } from '../../lib/date';
import { formatCurrency } from '../../lib/format';
import {
  buildTripCode, calcConsumption, getMissingIndicators, getDataCompleteness,
  STATUS_PILL_CLASS, type TripListContainer, type TripListRow,
  getTripDistance, getTripDisplayGrossProfit,
} from './tripHelpers';
import { XeNgoaiBadge } from './XeNgoaiBadge';

const formatMoney = (n: number): string =>
  formatCurrency(n).replace(' ₫', '').replace('₫', '').trim();

export interface TripQuickEditDraft {
  fuelLiters: string;
  roadAllowance: string;
  driverSalary: string;
  revenue: string;
}

export interface TripQuickEditOptions {
  enabled: boolean;
  selectedIds: Set<number>;
  drafts: Record<number, TripQuickEditDraft>;
  errors: Record<number, string>;
  onToggleSelect: (tripId: number) => void;
  onDraftChange: (tripId: number, field: keyof TripQuickEditDraft, value: string) => void;
}

export interface TripRowActions {
  copyingPlanId?: number | null;
  onCopyPlan?: (tripId: number) => void;
}

function isQuickEditable(trip: TripDetail): boolean {
  // O2C: costs stay editable after COMPLETED (no hard-freeze). Only CANCELED
  // trips are non-editable. (The backend marks the AR snapshot dirty on edit.)
  return trip.status !== TripStatus.CANCELED;
}

function moneyCell(value: number, extraClass = '') {
  return (
    <div className={`${value > 0 ? 'money' : 'money-empty'}${extraClass ? ` ${extraClass}` : ''}`}>
      {value > 0 ? (
        <>
          {formatMoney(value)}
          <span className="money-unit"> ₫</span>
        </>
      ) : '—'}
    </div>
  );
}

function QuickMoneyInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <input
      className="quick-money-input"
      type="text"
      inputMode="numeric"
      value={value}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Trip-list column definitions for TanStack React Table.
 *
 * These are extracted from the previous monolithic TripListPage so the
 * table column layout can be:
 *  - Reused by the export pipeline and any future admin views.
 *  - Unit-tested in isolation.
 *  - Trivially overridden per-deployment.
 *
 * Cell renderers use the existing page CSS classes (.trip-col, .plate,
 * .route-cell-flex, etc.) defined in TripListPage.css. The page wires
 * up the `<table>` via `useReactTable({ data, columns })`.
 */
export function buildTripColumns(
  warnThreshold: number,
  quickEdit?: TripQuickEditOptions,
  actions?: TripRowActions,
): ColumnDef<TripDetail>[] {
  const quickColumns: ColumnDef<TripDetail>[] = quickEdit?.enabled ? [
    {
      id: 'select',
      header: '',
      enableSorting: false,
      cell: ({ row }) => {
        const trip = row.original;
        const editable = isQuickEditable(trip);
        return (
          <input
            type="checkbox"
            className="quick-row-check"
            checked={quickEdit.selectedIds.has(trip.id)}
            disabled={!editable}
            onClick={(e) => e.stopPropagation()}
            onChange={() => quickEdit.onToggleSelect(trip.id)}
            aria-label={`Chọn chuyến ${buildTripCode(trip)}`}
          />
        );
      },
    },
  ] : [];

  const columns: ColumnDef<TripDetail>[] = [
    {
      id: 'trip',
      header: 'Chuyến · Mã',
      accessorFn: (row) => row.customer?.name ?? '',
      cell: ({ row }) => {
        const trip = row.original;
        const customerName = trip.customer?.name ?? '—';
        const tripCode = buildTripCode(trip);
        const missingIndicators = getMissingIndicators(trip);
        const copyingThisPlan = actions?.copyingPlanId === trip.id;
        return (
          <div className="trip-col">
            <Link
              to={`/trips/${trip.id}`}
              className="trip-col__link"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="trip-name">
                <span style={{ fontFamily: 'var(--font-mono)' }}>{tripCode}</span>
                <span className="trip-meta-sep">·</span>
                <span className="trip-date">{formatDayMonth(trip.departureDate)}</span>
              </div>
              <div className="trip-customer" title={customerName} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span>{customerName}</span>
                {trip.carrierType === 'EXTERNAL' && <XeNgoaiBadge />}
              </div>
              {missingIndicators.length > 0 && (
                <div className="trip-missing-row">
                  {missingIndicators.map((m, i) => (
                    <span key={i} className="missing-tag" title={m.label} aria-label={m.label}>
                      <m.icon size={10} />
                    </span>
                  ))}
                </div>
              )}
            </Link>
            {actions?.onCopyPlan && !quickEdit?.enabled && (
              <button
                type="button"
                className={`trip-copy-btn${copyingThisPlan ? ' is-copying' : ''}`}
                disabled={copyingThisPlan}
                title="Copy kế hoạch vận chuyển thành chuyến mới"
                aria-label={`Copy kế hoạch vận chuyển từ chuyến ${tripCode}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  actions.onCopyPlan?.(trip.id);
                }}
              >
                <Copy size={13} />
                <span>{copyingThisPlan ? 'Đang copy' : 'Copy'}</span>
              </button>
            )}
          </div>
        );
      },
    },
    {
      id: 'truck',
      header: 'Xe',
      accessorFn: (row) => row.carrierType === 'EXTERNAL' ? (row.externalPlateNumber ?? '') : (row.truck?.licensePlate ?? ''),
      cell: ({ row }) => {
        const trip = row.original;
        const isCreated = trip.status === TripStatus.CREATED;
        const isCanceled = trip.status === TripStatus.CANCELED;
        const isExternal = trip.carrierType === 'EXTERNAL';
        // External trips are flagged by the "Xe ngoài" badge beside the customer
        // name, so the plate cell only shows an actual plate — '—' when absent.
        const plate = isExternal ? (trip.externalPlateNumber || '—') : (trip.truck?.licensePlate ?? '—');
        return (
          <span className={`plate${isCreated || isCanceled ? ' idle' : ''}${isExternal ? ' external' : ''}`}>
            {plate}
          </span>
        );
      },
    },
    {
      id: 'route',
      header: 'Tuyến',
      accessorFn: (row) => row.route?.name ?? '',
      cell: ({ row }) => {
        const trip = row.original;
        const route = splitRoute(trip.route?.name);
        const fullRoute = trip.route?.name ?? '';
        const km = getTripDistance(trip);
        return (
          <div className="route-cell-flex" title={fullRoute}>
            {route ? (
              <>
                <div className="route-origin-row">
                  <span className="route-origin">{route.from}</span>
                  <span className="route-arrow-right"><ArrowRight size={11} /></span>
                </div>
                <div className="route-destination">
                  {route.to}
                  {km > 0 && <span className="route-km-inline"> · {km.toLocaleString('vi-VN')}km</span>}
                </div>
              </>
            ) : (
              <div className="route-destination">{fullRoute || '—'}</div>
            )}
            {(trip.containerCount ?? 1) > 1 && (
              <div className="route-tags-row">
                <span className="container-tag multiplier">×{trip.containerCount ?? 1} cont</span>
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'container',
      header: 'Container',
      enableSorting: false,
      cell: ({ row }) => {
        const trip = row.original;
        const containers: TripListContainer[] = (trip as TripListRow).containers ?? [];
        const codes = Array.from(new Set(containers.map((c) => c.containerTypeCode || c.containerTypeName).filter(Boolean)));
        const allNumbers = containers.map((c) => c.containerNumber).join(', ');
        if (codes.length === 0 && !trip.trailerType) {
          return <div className="km-empty">—</div>;
        }
        return (
          <div className="container-merged-cell" title={allNumbers || undefined}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {codes.map((code, i) => (
                <span key={i} className="container-tag">{code}</span>
              ))}
              {codes.length === 0 && trip.trailerType && (
                <span className="container-tag">{trip.trailerType}</span>
              )}
            </div>
            {containers.length > 0 && (
              <div className="container-numbers-list">
                {containers.slice(0, 2).map((c, i) => (
                  <span key={i}>{c.containerNumber}</span>
                ))}
                {containers.length > 2 && (
                  <span className="container-numbers-more">+{containers.length - 2}</span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'consumption',
      header: 'Tiêu hao',
      enableSorting: false,
      cell: ({ row }) => {
        const trip = row.original;
        const cons = calcConsumption(trip);
        const isCanceled = trip.status === TripStatus.CANCELED;
        if (quickEdit?.enabled) {
          const editable = isQuickEditable(trip);
          const draft = quickEdit.drafts[trip.id];
          return (
            <div className="quick-edit-cell">
              <QuickMoneyInput
                value={draft?.fuelLiters ?? ''}
                disabled={!editable}
                onChange={(value) => quickEdit.onDraftChange(trip.id, 'fuelLiters', value)}
              />
              <span className="quick-unit">L</span>
            </div>
          );
        }
        if (isCanceled) {
          return (
            <div className="cons-cell">
              <div className="cons-empty">
                <span className="empty-icon">
                  <XIcon size={12} />
                  Hủy trước khởi hành
                </span>
              </div>
            </div>
          );
        }
        if (!cons) {
          return (
            <div className="cons-cell">
              <div className="cons-empty">
                <span className="empty-icon">
                  <AlertCircle size={12} />
                  Chờ khai báo
                </span>
              </div>
            </div>
          );
        }
        return (
          <div className="cons-cell" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div className="cons-main">{cons.liters.toFixed(0)} L</div>
            <div className="cons-rate-val">
              {cons.per100.toFixed(1).replace('.', ',')} L/100km
            </div>
            {cons.per100 > warnThreshold ? (
              <div style={{ display: 'flex' }}>
                <span className="cons-rate warn" style={{ marginTop: 0 }}>
                  vượt {Math.round(((cons.per100 - warnThreshold) / warnThreshold) * 100)}%
                </span>
              </div>
            ) : (
              <div style={{ display: 'flex' }}>
                <span className="cons-rate ok" style={{ marginTop: 0 }}>
                  đạt chuẩn
                </span>
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'road',
      header: 'Tổng đi đường',
      accessorFn: (row) => Number(row.totalRoadAllowance ?? 0) + Number(row.tollCost ?? 0),
      cell: ({ row }) => {
        const trip = row.original;
        const road = Number(trip.totalRoadAllowance ?? 0) + Number(trip.tollCost ?? 0);
        if (quickEdit?.enabled) {
          const editable = isQuickEditable(trip);
          const draft = quickEdit.drafts[trip.id];
          return (
            <div className="quick-edit-cell">
              <QuickMoneyInput
                value={draft?.roadAllowance ?? ''}
                disabled={!editable}
                onChange={(value) => quickEdit.onDraftChange(trip.id, 'roadAllowance', value)}
              />
            </div>
          );
        }
        return moneyCell(road);
      },
    },
    {
      id: 'revenue',
      header: 'Doanh thu',
      accessorFn: (row) => Number(row.revenue ?? 0),
      cell: ({ row }) => {
        const trip = row.original;
        const revenue = Number(trip.revenue ?? 0);
        if (quickEdit?.enabled) {
          const editable = isQuickEditable(trip);
          const draft = quickEdit.drafts[trip.id];
          return (
            <div className="quick-edit-cell">
              <QuickMoneyInput
                value={draft?.revenue ?? ''}
                disabled={!editable}
                onChange={(value) => quickEdit.onDraftChange(trip.id, 'revenue', value)}
              />
            </div>
          );
        }
        return moneyCell(revenue);
      },
    },
    ...(quickEdit?.enabled ? [{
      id: 'driverSalary',
      header: 'Lương chuyến',
      accessorFn: (row: TripDetail) => Number(row.driverSalary ?? 0),
      cell: ({ row }) => {
        const trip = row.original;
        const editable = isQuickEditable(trip);
        const draft = quickEdit.drafts[trip.id];
        return (
          <div className="quick-edit-cell">
            <QuickMoneyInput
              value={draft?.driverSalary ?? ''}
              disabled={!editable}
              onChange={(value) => quickEdit.onDraftChange(trip.id, 'driverSalary', value)}
            />
          </div>
        );
      },
    } satisfies ColumnDef<TripDetail>] : []),
    {
      id: 'totalCost',
      header: 'Tổng chi phí',
      accessorFn: (row) => Number(row.totalCost ?? 0),
      cell: ({ row }) => moneyCell(Number(row.original.totalCost ?? 0)),
    },
    {
      id: 'grossProfit',
      header: 'LN gộp',
      accessorFn: (row) => getTripDisplayGrossProfit(row),
      cell: ({ row }) => {
        const grossProfit = getTripDisplayGrossProfit(row.original);
        return moneyCell(grossProfit, grossProfit < 0 ? 'money-loss' : '');
      },
    },
    {
      id: 'status',
      header: 'Trạng thái',
      accessorFn: (row) => row.status,
      cell: ({ row }) => {
        const trip = row.original;
        const pillClass = STATUS_PILL_CLASS[trip.status] ?? 'pill-moi';
        return (
          <div className="status-cell">
            <span className={`status-pill ${pillClass}`}>
              {TRIP_STATUS_LABELS[trip.status]}
            </span>
            {quickEdit?.enabled && quickEdit.errors[trip.id] && (
              <span className="quick-row-error" title={quickEdit.errors[trip.id]}>Lỗi</span>
            )}
          </div>
        );
      },
    },
  ];
  return [...quickColumns, ...columns];
}

/** Computes the per-row CSS variable bag used by the page for stripe colors. */
export function tripRowStyle(trip: TripDetail): Record<string, string> {
  const completeness = getDataCompleteness(trip);
  return {
    '--strip-top': TRIP_STATUS_COLORS[trip.status],
    '--strip-bottom': completeness === 'na'
      ? TRIP_STATUS_COLORS[trip.status]
      : DATA_COMPLETENESS_COLORS[completeness],
  };
}
