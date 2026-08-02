import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Shuffle, FilePen, X } from 'lucide-react';
import { api } from '../lib/api';
import { useLiveFleet } from '../hooks/useTripQueries';
import { LiveTrackingCard } from '../features/trip-detail/components/LiveTrackingCard';
import { Modal, Drawer } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { Spinner } from '../components/shared/Spinner';
import { Money } from '../components/shared/Money';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import { TripStatus } from '@tingting/shared';

// Feature: logic (.ts) + UI (.tsx)
import { useTripDetailPage } from '../features/trip-detail';
import {
  TripHeader, KpiStrip, BasicInfoCard, ContainersCard, FinancialCard,
  FuelCard, ServiceCostsCard, JourneyCard,
  ExternalCarrierCard, PhotosCard,
} from '../features/trip-detail';

import './TripDetailPage.css';

export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const page = useTripDetailPage(id);
  const { rootRef } = usePageAnimations({ ready: !page.loading });
  const [governanceIntent, setGovernanceIntent] = useState<'complete' | 'cancel' | null>(null);
  const [governanceReason, setGovernanceReason] = useState('');
  // Only poll live GPS when this trip is actually in transit — a completed /
  // cancelled trip never has a live vehicle, so avoid polling the cache forever.
  const { data: liveFleet } = useLiveFleet({ enabled: page.trip?.status === TripStatus.IN_TRANSIT });

  const handleBack = () => navigate('/trips');
  useBackShortcut(handleBack);

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
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{page.error}</p>
          <button className="btn btn--secondary btn--sm" style={{ marginTop: 12 }} onClick={() => page.refetchTrip()}>
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  if (!page.trip) return null;

  const { trip, derived, permissions, ui, fuelPriceConfig, adjustments } = page;
  const liveVehicle = liveFleet?.vehicles.find((v) => v.tripId === trip.id) ?? null;
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
          <a onClick={() => navigate(to)} style={{ cursor: 'pointer' }}>{children}</a>
        )}
      />
      <TripHeader
        trip={trip}
        permissions={permissions}
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

      <Modal
        isOpen={governanceIntent !== null}
        title={governanceIntent === 'complete' ? 'Đề nghị hoàn thành chuyến' : 'Đề nghị hủy chuyến'}
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
              {governanceIntent === 'complete' ? 'Gửi đề nghị hoàn thành' : 'Gửi đề nghị hủy'}
            </button>
          </>
        }
      >
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Lý do <span style={{ color: 'var(--danger)' }}>*</span>
          </span>
          <textarea
            aria-label="Lý do đề nghị"
            className="input"
            rows={4}
            value={governanceReason}
            onChange={(event) => setGovernanceReason(event.target.value)}
            placeholder="Nêu căn cứ và nội dung đề nghị"
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
          {trip.legs && trip.legs.length > 0 && (
            <div className="anim d3 tdp-card tdp-m1">
              <JourneyCard trip={trip} derived={derived} liveVehicle={liveVehicle} />
            </div>
          )}

          {liveVehicle && (
            <div className="anim d3 tdp-card">
              <LiveTrackingCard vehicle={liveVehicle} />
            </div>
          )}

          <div className="anim d3 tdp-card tdp-m2">
            <ServiceCostsCard tripId={trip.id} readOnly={permissions.readOnly} />
          </div>

          <div className="anim d3 tdp-card tdp-m3">
            <BasicInfoCard trip={trip} />
          </div>

          <div className="anim d4 tdp-card tdp-m4">
            <ContainersCard tripId={trip.id} />
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
                  <p className="tdp-notes-body" style={{ marginTop: 8 }}>{trip.instructions.notes}</p>
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
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => page.setReassignCarrierType('OWN')}
            aria-pressed={ui.reassignCarrierType === 'OWN'}
            style={{ flex: 1, padding: '6px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)', background: ui.reassignCarrierType === 'OWN' ? 'var(--brand-soft)' : '#fff', color: ui.reassignCarrierType === 'OWN' ? 'var(--brand-dark)' : 'var(--text-2)' }}
          >
            Xe nhà
          </button>
          <button
            type="button"
            onClick={() => page.setReassignCarrierType('EXTERNAL')}
            aria-pressed={ui.reassignCarrierType === 'EXTERNAL'}
            style={{ flex: 1, padding: '6px', fontSize: 13, borderRadius: 4, border: '1px solid var(--border)', background: ui.reassignCarrierType === 'EXTERNAL' ? 'var(--brand-soft)' : '#fff', color: ui.reassignCarrierType === 'EXTERNAL' ? 'var(--brand-dark)' : 'var(--text-2)' }}
          >
            Xe ngoài
          </button>
        </div>

        {ui.reassignCarrierType === 'OWN' ? (
          <>
            <div className="field">
              <label htmlFor="reassignTruckId">Xe đầu kéo</label>
              <select id="reassignTruckId" name="reassignTruckId" className="input" value={ui.reassignTruckId} onChange={e => page.setReassignTruckId(e.target.value)}>
                <option value="">-- Chọn xe --</option>
                {page.reassignTrucks.map(t => <option key={t.id} value={t.id}>{t.licensePlate}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reassignDriverId">Lái xe</label>
              <select id="reassignDriverId" name="reassignDriverId" className="input" value={ui.reassignDriverId} onChange={e => page.setReassignDriverId(e.target.value)}>
                <option value="">-- Chọn lái xe --</option>
                {page.reassignDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="reassignExternalCarrierId">Đối tác xe ngoài</label>
              <select id="reassignExternalCarrierId" name="reassignExternalCarrierId" className="input" value={ui.reassignExternalCarrierId} onChange={e => page.setReassignExternalCarrierId(e.target.value)}>
                <option value="">-- Chọn đối tác --</option>
                {page.carrierCustomers.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="reassignExternalPlateNumber">Biển số xe</label>
              <input id="reassignExternalPlateNumber" name="reassignExternalPlateNumber" type="text" className="input" placeholder="VD: 15C-12345" value={ui.reassignExternalPlateNumber} onChange={e => page.setReassignExternalPlateNumber(e.target.value)} />
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
          <input id="adjustAmount" name="adjustAmount" className="input" type="number" placeholder="VD: -500000 hoặc 300000"
            value={ui.adjustAmount} onChange={e => page.setAdjustAmount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="adjustNote">Lý do điều chỉnh *</label>
          <textarea id="adjustNote" name="adjustNote" className="input tdp-drawer-textarea" rows={3} placeholder="Mô tả lý do…"
            value={ui.adjustNote} onChange={e => page.setAdjustNote(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="adjustRef">Mã biên bản thỏa thuận *</label>
          <input id="adjustRef" name="adjustRef" className="input" placeholder="VD: BB-2026-001"
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
            {(adjustments as Array<{ note: string; amount: string | number }>).map((a, i) => {
              const amount = Number(a.amount);
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
      {page.confirmDialog}
    </div>
  );
}
