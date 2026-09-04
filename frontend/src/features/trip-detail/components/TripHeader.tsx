import React from 'react';
import {
  ArrowLeft, Play, Pencil, Check, XCircle, Shuffle, FilePen,
  Building2, Loader2, MoreHorizontal,
} from 'lucide-react';
import { TRIP_STATUS_LABELS, TripStatus, type TripDetail } from '@tingting/shared';
import { Tooltip } from '../../../components/shared/Tooltip';
import type { TripPermissions } from '../types';

interface TripHeaderProps {
  trip: TripDetail;
  permissions: TripPermissions;
  actionLoading: boolean;
  onBack: () => void;
  onEdit: () => void;
  onDispatch: () => void;
  onComplete: () => void;
  onCancel: () => void;
  onReassign: () => void;
  onAdjust: () => void;
}

export function TripHeader({
  trip, permissions, actionLoading,
  onBack, onEdit, onDispatch, onComplete, onCancel, onReassign, onAdjust,
}: TripHeaderProps) {
  const { canEdit, canEditActuals, canCancel, canDispatch, canComplete, canReassign, canAdjust } = permissions;
  const statusClass = trip.status === TripStatus.IN_TRANSIT
    ? 'in-transit'
    : trip.status === TripStatus.COMPLETED
      ? 'completed'
      : trip.status === TripStatus.CANCELED
        ? 'canceled'
        : 'draft';
  const statusLabel = TRIP_STATUS_LABELS[trip.status] ?? trip.status;
  const hasOverflowActions = canReassign || canCancel || canAdjust;

  return (
    <header className="tc-page-head td-page-head anim d1">
      <div className="header-left">
        <Tooltip label="Quay lại" side="right">
          <button className="tc-back-btn" onClick={onBack} aria-label="Quay lại">
            <ArrowLeft size={18} />
          </button>
        </Tooltip>
        <div className="tc-title-wrap">
          <h1 className="tc-page-title">
            {trip.tripCode || 'Lệnh vận chuyển'}
            <span
              className={`tc-status-pill tc-status-pill--${statusClass}`}
              aria-label={`Trạng thái: ${statusLabel}`}
            >
              {statusLabel}
            </span>
          </h1>
          <p className="tc-page-sub company">
            <Building2 size={15} />
            {trip.customer?.name ?? '—'}
          </p>
        </div>
      </div>

      <div className="header-actions" data-tour-id="trip-detail-financials">
        {canEdit && (
          <button className="btn tdp-edit-btn" onClick={onEdit}>
            <Pencil size={15} />Chỉnh sửa
          </button>
        )}
        {canDispatch && (
          <button className="btn btn--primary" onClick={onDispatch} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
            Xuất phát
          </button>
        )}
        {canComplete && (
          <button className="btn btn--primary" onClick={onComplete} disabled={actionLoading}>
            {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            Hoàn thành
          </button>
        )}
        {/*
          Accountant + manager may both enter financial figures (fuel, road
          allowance, tiền đi đường, vé, driver salary, etc.) on IN_TRANSIT +
          COMPLETED trips. `canEdit` already shows the manager-only "Chỉnh
          sửa" button on COMPLETED, so the "Nhập số liệu" variant is
          suppressed there to avoid showing two buttons that lead to the
          same place. This is the fix for the bug where accountant had no
          entry point to the actuals form on completed trips.
        */}
        {canEditActuals && !canEdit && (
          <button className="btn btn--secondary" onClick={onEdit}>
            <Pencil size={14} />Nhập số liệu
          </button>
        )}
        {hasOverflowActions && (
          <details className="header-overflow" data-dropdown>
            <summary className="btn btn--ghost" aria-label="Mở các thao tác khác">
              <MoreHorizontal size={18} />
            </summary>
            <div className="header-overflow__menu" role="menu">
              {canReassign && (
                <button type="button" role="menuitem" onClick={onReassign}>
                  <Shuffle size={15} />Phân xe lại
                </button>
              )}
              {canAdjust && (
                <button type="button" role="menuitem" onClick={onAdjust}>
                  <FilePen size={15} />Điều chỉnh
                </button>
              )}
              {canCancel && (
                <button type="button" role="menuitem" className="is-danger" onClick={onCancel}>
                  <XCircle size={15} />Hủy chuyến
                </button>
              )}
            </div>
          </details>
        )}
      </div>
    </header>
  );
}
