import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Shuffle, FilePen, X } from 'lucide-react';
import { api } from '../lib/api';
import { Modal, Drawer } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Spinner } from '../components/shared/Spinner';
import { Money } from '../components/shared/Money';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { AccountingLockBanner } from '../components/shipment/AccountingLockBanner';
import { UuiSelectField } from '../design-system';

// Feature: logic (.ts) + UI (.tsx)
import { useTripDetailPage } from '../features/trip-detail';
import {
  TripHeader, KpiStrip, BasicInfoCard, ContainersCard, FinancialCard,
  FuelCard, ServiceCostsCard,
  ExternalCarrierCard, PhotosCard,
} from '../features/trip-detail';

import './TripDetailPage.css';

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = useTripDetailPage(id);
  const { rootRef } = usePageAnimations({ ready: !page.loading });
  const [governanceIntent, setGovernanceIntent] = useState<'complete' | 'cancel' | null>(null);
  const [governanceReason, setGovernanceReason] = useState('');

  const handleBack = () => navigate('/trips');
  useBackShortcut(handleBack);

  useEffect(() => {
    if (searchParams.get('reassign') !== '1'
      || !page.trip
      || !page.permissions.canReassign
      || page.trip.accountingLock != null) return;
    page.openReassign();
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete('reassign');
    setSearchParams(nextSearchParams, { replace: true });
  }, [page.openReassign, page.permissions.canReassign, page.trip, searchParams, setSearchParams]);

  /* ── Loading / Error / Empty guards ────────────────────────────────── */
  if (page.loading) {
    return (
      <div className="tdp-loading">
        <Spinner size={20} />
        <span>Đang tải dữ liệu…</span>
      </div>
    );
  }

  if (page.error && !page.trip) {
    return (
      <div className="fade-up">
        <div className="card tdp-error-card">
          <p className="tdp-error-text">{page.error}</p>
          <button className="btn btn--secondary btn--sm tdp-error-retry" onClick={() => page.refetchTrip()}>
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (!page.trip) return null;

  const { trip, derived, permissions, ui, fuelPriceConfig, adjustments } = page;
  const accountingLock = trip.accountingLock ?? null;
  const effectivePermissions = accountingLock
    ? {
        ...permissions,
        canEdit: false,
        canEditActuals: false,
        canCancel: false,
        canDispatch: false,
        canComplete: false,
        canReassign: false,
        canAdjust: false,
        canChangeDate: false,
        needsPhotos: false,
        readOnly: true,
      }
    : permissions;
  const displayError = ui.actionError || page.error;

  /* ── Main render ───────────────────────────────────────────────────── */
  return (
    <div ref={rootRef}>
      <Breadcrumbs
        className="trip-detail__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Sổ chuyến đi', to: '/trips' },
          { label: trip.tripCode || 'Chuyến chưa có mã' },
        ]}
        renderLink={(to, children) => (
          <a onClick={() => navigate(to)} className="tdp-crumb-link">{children}</a>
        )}
      />
      <TripHeader
        trip={trip}
        permissions={effectivePermissions}
        actionLoading={ui.actionLoading}
        onBack={handleBack}
        onEdit={() => navigate(`/trips/${trip.id}/edit`)}
        onDispatch={() => page.handleAction('dispatch', () => api.post(`/trips/${trip.id}/dispatch`, {}))}
        onComplete={() => {
          setGovernanceReason('');
          setGovernanceIntent('complete');
        }}
        onCancel={() => {
          setGovernanceReason('');
          setGovernanceIntent('cancel');
        }}
        onReassign={page.openReassign}
        onAdjust={page.openAdjust}
      />

      {accountingLock && <AccountingLockBanner lock={accountingLock} />}

      <fieldset disabled={Boolean(accountingLock)} className="tdp-fieldset-reset">

      <Modal
        isOpen={governanceIntent !== null}
        title={governanceIntent === 'complete' ? 'Hoàn thành chuyến' : 'Hủy chuyến'}
        onClose={() => setGovernanceIntent(null)}
        maxWidth={480}
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setGovernanceIntent(null)}>
              Hủy
            </button>
            <button
              type="button"
              className={`btn ${governanceIntent === 'cancel' ? 'btn--danger' : 'btn--primary'}`}
              disabled={!governanceReason.trim() || ui.actionLoading}
              onClick={() => {
                const intent = governanceIntent;
                if (!intent || !governanceReason.trim()) return;
                setGovernanceIntent(null);
                void page.handleAction(intent, () => api.post(
                  `/trips/${trip.id}/${intent}`,
                  {
                    expectedVersion: trip.version,
                    reason: governanceReason.trim(),
                  },
                ));
              }}
            >
              {governanceIntent === 'complete' ? 'Hoàn thành chuyến' : 'Hủy chuyến'}
            </button>
          </>
        }
      >
        <label className="tdp-governance-label">
          <span className="tdp-governance-label-text">
            Lý do <span className="tdp-governance-asterisk">*</span>
          </span>
          <textarea
            aria-label="Lý do thay đổi"
            className="input"
            rows={4}
            value={governanceReason}
            onChange={(event) => setGovernanceReason(event.target.value)}
            placeholder="Nêu căn cứ và nội dung thay đổi"
            autoFocus
          />
        </label>
      </Modal>

      {displayError && (
        <div className="tdp-error-banner">
          {displayError}
        </div>
      )}

      {/* ── 2-column body: main (operational) | rail (financial) ────────── */}
      <div className="trip-body anim d2">
        {/* ── Main column — operational story ─────────────────────────── */}
        <div className="trip-col trip-col--main">

          <div className="anim d3 tdp-card tdp-m3">
            <BasicInfoCard trip={trip} />
          </div>

          <div className="anim d4 tdp-card tdp-m4">
            <ContainersCard tripId={trip.id} />
          </div>

          <div className="anim d4 tdp-card tdp-m2">
            <ServiceCostsCard tripId={trip.id} readOnly={effectivePermissions.readOnly} />
          </div>

          {trip.notes && (
            <section className="tdp-notes-card anim d4 tdp-card tdp-m6">
              <h3 className="tdp-notes-title">Ghi chú</h3>
              <p className="tdp-notes-body">{trip.notes}</p>
            </section>
          )}

          {trip.instructions && (trip.instructions.contactName || trip.instructions.contactPhone || trip.instructions.notes) && (
            <section className="tdp-notes-card anim d4 tdp-card tdp-m7">
              <h3 className="tdp-notes-title">Liên hệ & hướng dẫn</h3>
              <div className="tdp-instructions-body">
                {trip.instructions.contactName && (
                  <div className="tdp-instructions-row">
                    <span className="tdp-instructions-label">Liên hệ</span>
                    <span className="tdp-instructions-value">{trip.instructions.contactName}</span>
                  </div>
                )}
                {trip.instructions.contactPhone && (
                  <div className="tdp-instructions-row">
                    <span className="tdp-instructions-label">SĐT</span>
                    <a className="tdp-instructions-value" href={`tel:${trip.instructions.contactPhone}`}>{trip.instructions.contactPhone}</a>
                  </div>
                )}
                {trip.instructions.notes && (
                  <p className="tdp-notes-body tdp-instructions-notes">{trip.instructions.notes}</p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ── Right rail — financial summary (sticky on desktop) ──────── */}
        <div className="trip-col trip-col--rail trip-rail-bg">
          <div className="anim d3 tdp-card tdp-r1">
            <KpiStrip
              variant="rail"
              revenue={derived.revenue}
              totalCost={derived.totalCost}
              grossProfit={derived.grossProfit}
              marginPct={derived.marginPct}
            />
          </div>

          <div className="anim d3 tdp-card tdp-r2">
            <FinancialCard derived={derived} customerCommission={Number(trip.customerCommission) || 0} />
          </div>

          <div className="anim d4 tdp-card tdp-r3">
            <FuelCard trip={trip} derived={derived} fuelPriceConfig={fuelPriceConfig} />
          </div>

          {trip.carrierType === 'EXTERNAL' && (
            <div className="anim d4 tdp-card tdp-r4">
              <ExternalCarrierCard
                derived={derived}
                carrierName={derived.externalCarrierName}
                plateNumber={trip.externalPlateNumber}
                driverName={trip.externalDriverName}
                driverPhone={trip.externalDriverPhone}
                freightCost={trip.externalFreightCost != null ? Number(trip.externalFreightCost) : null}
              />
            </div>
          )}

          {(trip.photoUrls?.length ?? 0) > 0 && (
            <div className="anim d4 tdp-card tdp-r5">
              <PhotosCard photoUrls={trip.photoUrls} />
            </div>
          )}
        </div>
      </div>

      {/* ── Reassign Modal ──────────────────────────────────────────────── */}
      <Modal
        isOpen={ui.showReassign}
        title="Phân xe lại"
        onClose={() => page.setShowReassign(false)}
        onConfirm={page.handleReassign}
        maxWidth={440}
        footer={
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => page.setShowReassign(false)}>
              <X size={14} /> Hủy
            </button>
            <button
              className="btn btn--primary btn--sm"
              disabled={ui.reassignLoading || (ui.reassignCarrierType === 'OWN' ? (!ui.reassignTruckId || !ui.reassignDriverId) : (!ui.reassignExternalCarrierId && !ui.reassignExternalPlateNumber))}
              onClick={page.handleReassign}
            >
              {ui.reassignLoading ? <Loader2 size={14} className="spin" /> : <Shuffle size={14} />}
              Xác nhận phân xe lại
            </button>
          </>
        }
      >
        {ui.reassignError && (
          <div className="tdp-modal-error">
            {ui.reassignError}
          </div>
        )}
        <div className="tdp-reassign-toggle-group">
          <button
            type="button"
            onClick={() => page.setReassignCarrierType('OWN')}
            aria-pressed={ui.reassignCarrierType === 'OWN'}
            className="tdp-reassign-toggle-btn"
          >
            Xe nhà
          </button>
          <button
            type="button"
            onClick={() => page.setReassignCarrierType('EXTERNAL')}
            aria-pressed={ui.reassignCarrierType === 'EXTERNAL'}
            className="tdp-reassign-toggle-btn"
          >
            Xe ngoài
          </button>
        </div>

        {ui.reassignCarrierType === 'OWN' ? (
          <>
            <UuiSelectField
              id="reassignTruckId"
              label="Xe đầu kéo"
              value={ui.reassignTruckId}
              onChange={e => page.setReassignTruckId(e.target.value)}
              options={[{ value: '', label: '-- Chọn xe --' }, ...page.reassignTrucks.map(t => ({ value: String(t.id), label: t.licensePlate }))]}
              wrapperClassName="field"
            />
            <UuiSelectField
              id="reassignDriverId"
              label="Lái xe"
              value={ui.reassignDriverId}
              onChange={e => page.setReassignDriverId(e.target.value)}
              options={[{ value: '', label: '-- Chọn lái xe --' }, ...page.reassignDrivers.map(d => ({ value: String(d.id), label: d.name }))]}
              wrapperClassName="field"
            />
          </>
        ) : (
          <>
            <UuiSelectField
              id="reassignExternalCarrierId"
              label="Đối tác xe ngoài"
              value={ui.reassignExternalCarrierId}
              onChange={e => page.setReassignExternalCarrierId(e.target.value)}
              options={[{ value: '', label: '-- Chọn đối tác --' }, ...page.carrierCustomers.map(c => ({ value: String(c.id), label: c.label }))]}
              wrapperClassName="field"
            />
            <div className="field">
              <label htmlFor="reassignExternalPlateNumber">Biển số xe</label>
              <input id="reassignExternalPlateNumber" name="reassignExternalPlateNumber" type="text" className="input" placeholder="Ví dụ: 15C-12345" value={ui.reassignExternalPlateNumber} onChange={e => page.setReassignExternalPlateNumber(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="reassignExternalDriverName">Tên lái xe</label>
              <input id="reassignExternalDriverName" name="reassignExternalDriverName" type="text" className="input" placeholder="Tên lái xe ngoài" value={ui.reassignExternalDriverName} onChange={e => page.setReassignExternalDriverName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="reassignExternalDriverPhone">SĐT lái xe</label>
              <input id="reassignExternalDriverPhone" name="reassignExternalDriverPhone" type="tel" autoComplete="tel" className="input" placeholder="SĐT lái xe" value={ui.reassignExternalDriverPhone} onChange={e => page.setReassignExternalDriverPhone(e.target.value)} />
            </div>
          </>
        )}
      </Modal>

      {/* ── Adjustment Drawer ───────────────────────────────────────────── */}
      <Drawer isOpen={ui.showAdjust} onClose={() => page.setShowAdjust(false)} title="Hóa đơn điều chỉnh">
        <p className="tdp-drawer-hint">
          Số âm = Giảm doanh thu · Số dương = Tăng doanh thu
        </p>
        {ui.adjustError && (
          <div className="tdp-modal-error">
            {ui.adjustError}
          </div>
        )}
        <div className="field">
          <label htmlFor="adjustAmount">Số tiền điều chỉnh (đ) *</label>
          <input id="adjustAmount" name="adjustAmount" className="input" type="number" placeholder="Ví dụ: -500000 hoặc 300000"
            value={ui.adjustAmount} onChange={e => page.setAdjustAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="adjustNote">Lý do điều chỉnh *</label>
          <textarea id="adjustNote" name="adjustNote" className="input tdp-drawer-textarea" rows={3} placeholder="Mô tả lý do…"
            value={ui.adjustNote} onChange={e => page.setAdjustNote(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="adjustRef">Mã biên bản thỏa thuận *</label>
          <input id="adjustRef" name="adjustRef" className="input" placeholder="Ví dụ: BB-2026-001"
            value={ui.adjustRef} onChange={e => page.setAdjustRef(e.target.value)} />
        </div>
        <button
          className="btn btn--primary tdp-drawer-submit"
          disabled={ui.adjustSubmitting || !ui.adjustNote.trim() || !ui.adjustRef.trim() || ui.adjustAmount === ''}
          onClick={page.handleAdjustSubmit}
        >
          {ui.adjustSubmitting ? <Loader2 size={14} className="spin" /> : <FilePen size={14} />}
          Xác nhận phát hành
        </button>
        {adjustments.length > 0 && (
          <div>
            <div className="tdp-adjustments-title">
              Đã phát hành
            </div>
            {(adjustments as Array<{ note: string; debit: string | number | null; credit: string | number | null }>).map((a, i) => {
              // The API returns ledger columns only — derive the signed amount
              // from debit − credit instead of a missing `amount` field.
              const amount = Number(a.debit ?? 0) - Number(a.credit ?? 0);
              const isPos = amount >= 0;
              return (
                <div key={i} className="tdp-adjustment-row">
                  <span className="tdp-adjustment-note">{a.note}</span>
                  <span className={`tdp-adjustment-amount ${isPos ? 'tdp-adjustment-amount--pos' : 'tdp-adjustment-amount--neg'}`}>
                    <Money value={Math.abs(amount)} sign={isPos && amount > 0 ? '+' : '−'} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
      </fieldset>
      {page.confirmDialog}
    </div>
  );
}
