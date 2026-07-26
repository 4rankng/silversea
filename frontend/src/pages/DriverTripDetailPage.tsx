import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Truck, Calendar, MapPin, Fuel, DollarSign, Navigation, AlertCircle, Loader2, Phone, MessageSquare } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/format';
import { TRIP_STATUS_LABELS, type TripStatus } from '@tingting/shared';
import { StatusPill } from '../components/UI';
import TripLegsPanel from '../components/trip/TripLegsPanel';
import { DriverContainerCard } from '../components/trip/DriverContainerCard';
import { DriverProgressCard } from '../components/trip/DriverProgressCard';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import './DriverTripDetailPage.css';

interface TripLeg {
  id: number;
  sequence: number;
  origin: string;
  destination: string;
  km: number;
  loadingType: string;
}

interface DriverContainer {
  id: number;
  containerNumber: string;
  sealNumber: string | null;
  containerTypeId: number | null;
  containerTypeName: string | null;
  containerTypeCode: string | null;
  cargoWeightKg: string | null;
}

interface DriverTripDetail {
  id: number;
  status: TripStatus;
  departureDate: string;
  routeName: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  trailerType: string | null;
  customerName: string | null;
  cargoTypeName: string | null;
  fuelLiters: string | null;
  fuelMode: string | null;
  fuelSupplierName: string | null;
  totalRoadAllowance: string | null;
  driverSalary: string | null;
  hasReturnCargo: boolean | null;
  legs: TripLeg[];
  containers: DriverContainer[];
  contPhotoKey: string | null;
  sealPhotoKey: string | null;
  notes: string | null;
  customerReference: string | null;
  /** Manager-authored contact + guidance (N2 / B1.3). Null when none set. */
  instructions?: {
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
  } | null;
}

function tripStatusVariant(status: TripStatus): 'neutral' | 'info' | 'warn' | 'success' | 'danger' {
  switch (status) {
    case 'IN_TRANSIT': return 'info';      // blue
    case 'COMPLETED': return 'success';    // green
    case 'LOCKED': return 'neutral';       // slate gray
    case 'CANCELED': return 'danger';      // red
    default: return 'neutral';             // CREATED — slate gray
  }
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-row__icon">{icon}</span>
      <div className="info-row__body">
        <div className="info-row__label">{label}</div>
        <div className="info-row__value">{value || '—'}</div>
      </div>
    </div>
  );
}

export default function DriverTripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<DriverTripDetail | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { rootRef } = usePageAnimations({ ready: !initialLoad });

  const loadTrip = useCallback((isBackground = false) => {
    if (!id) return;
    if (!isBackground) setInitialLoad(true);
    api.get<DriverTripDetail>(`/driver/me/trips/${id}`)
      .then(setTrip)
      .catch(() => setError('Không thể tải thông tin lệnh vận chuyển'))
      .finally(() => { if (!isBackground) setInitialLoad(false); });
  }, [id]);

  useEffect(() => {
    loadTrip(false);
  }, [loadTrip]);

  const handleBack = () => navigate('/my-trips');
  useBackShortcut(handleBack);

  if (initialLoad) return (
    <div className="dt-loader-container">
      <Loader2 size={24} className="spin" style={{ display: 'inline-block' }} />
      <p className="dt-loader-text">Đang tải…</p>
    </div>
  );

  if (error || !trip) return (
    <div className="dt-error-container">
      <button className="dt-back-btn" onClick={handleBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} /> Quay lại
      </button>
      <div className="panel dt-error-card">
        <AlertCircle size={32} style={{ marginBottom: 12, display: 'inline-block' }} />
        <p className="dt-error-text">{error || 'Không tìm thấy lệnh vận chuyển'}</p>
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="driver-trip-detail-page">
        {/* Back button + Header */}
        <div className="dt-header">
          <button
            className="dt-back-btn"
            onClick={handleBack}
            aria-label="Quay lại"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="dt-header-title-block">
            <h1 className="dt-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/assets/icons/03-trip-log-so-chuyen-chuyen-xe.png" alt="" style={{ width: 32, height: 32, flexShrink: 0 }} />
              {trip.routeName || 'Lệnh vận chuyển'}
            </h1>
            <div className="dt-meta">
              <StatusPill variant={tripStatusVariant(trip.status)}>
                {TRIP_STATUS_LABELS[trip.status] || trip.status}
              </StatusPill>
              {trip.customerName && (
                <span className="dt-subtitle">{trip.customerName}</span>
              )}
            </div>
          </div>
        </div>

        {/* Trip Info — flat section */}
        <section className={`dt-section dt-section--status-${trip.status}`}>
          <div className="dt-section__head">
            <span className="dt-section__title">Thông tin chuyến</span>
          </div>
          <div className="dt-section__body">
            <InfoRow icon={<Truck size={16} />} label="Xe đầu kéo" value={trip.truckPlate} />
            <InfoRow icon={<Truck size={16} />} label="Rơ moóc" value={
              trip.trailerPlate ? `${trip.trailerPlate}${trip.trailerType ? ` (${trip.trailerType})` : ''}` : null
            } />
            <InfoRow icon={<Calendar size={16} />} label="Ngày khởi hành" value={formatDate(trip.departureDate)} />
            {trip.cargoTypeName && (
              <InfoRow icon={<Navigation size={16} />} label="Loại hàng" value={trip.cargoTypeName} />
            )}
            {trip.customerReference && (
              <InfoRow icon={<Navigation size={16} />} label="Mã tham chiếu" value={trip.customerReference} />
            )}
          </div>
        </section>

        <DriverContainerCard
          tripId={trip.id}
          containers={trip.containers ?? []}
          contPhotoKey={trip.contPhotoKey ?? null}
          sealPhotoKey={trip.sealPhotoKey ?? null}
          onSaved={() => loadTrip(true)}
        />

        {/* Fuel Allocation Card — prominent for drivers */}
        <div className="fuel-alloc-card">
          <div className="fuel-alloc-card__header">
            <Fuel size={20} className="fuel-alloc-card__icon" />
            <div className="fuel-alloc-card__title-wrap">
              <div className="fuel-alloc-card__label">
                Số dầu được cấp
              </div>
              <div className="fuel-alloc-card__value">
                {trip.fuelLiters ? `${parseFloat(trip.fuelLiters).toFixed(0)} lít` : '— lít'}
              </div>
            </div>
          </div>
          <div className="fuel-alloc-card__body">
            {trip.fuelMode && (
              <div>
                Chế độ: <strong>{trip.fuelMode === 'AUTO' ? 'Tự động (định mức × km)' : trip.fuelMode === 'FLAT_RATE' ? 'Khoán' : trip.fuelMode}</strong>
              </div>
            )}
            {trip.fuelSupplierName && (
              <div>
                Nhà cung cấp: <strong style={{ color: 'var(--accent)' }}>{trip.fuelSupplierName}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Earnings — flat section */}
        <section className="dt-section">
          <div className="dt-section__head">
            <span className="dt-section__title">Thu nhập &amp; chi phí</span>
          </div>
          <div className="dt-section__body">
            <div className="dt-earnings-grid">
              <InfoRow
                icon={<DollarSign size={16} />}
                label="Lương phân bổ chuyến"
                value={
                  <span className="earnings-highlight">
                    {trip.driverSalary ? formatCurrency(trip.driverSalary) : '—'}
                  </span>
                }
              />
              <InfoRow
                icon={<MapPin size={16} />}
                label="Tiền đi đường"
                value={trip.totalRoadAllowance ? formatCurrency(trip.totalRoadAllowance) : '—'}
              />
            </div>
            {trip.hasReturnCargo && (
              <div className="return-cargo-badge">
                <span>✓</span> Chuyến về có hàng (+300.000 đ)
              </div>
            )}
          </div>
        </section>

        <TripLegsPanel legs={trip.legs || []} />

        {/* Contact & guidance (N2 / B1.3) — read-only. Always shown so the
            driver sees the section exists even before a manager fills it
            (feedback202606 B1:60 — previously hidden when blank, which read as
            "missing" in UAT). */}
        <section className="dt-section dt-section--instructions">
          <div className="dt-section__head">
            <span className="dt-section__title">Liên hệ &amp; hướng dẫn</span>
          </div>
          <div className="dt-section__body">
            {trip.instructions && (trip.instructions.contactName || trip.instructions.contactPhone || trip.instructions.notes) ? (
              <>
                {trip.instructions.contactName && (
                  <InfoRow icon={<Navigation size={16} />} label="Người liên hệ" value={trip.instructions.contactName} />
                )}
                {trip.instructions.contactPhone && (
                  <InfoRow
                    icon={<Phone size={16} />}
                    label="SĐT liên hệ"
                    value={
                      <a href={`tel:${trip.instructions.contactPhone}`} className="dt-tel-link">
                        {trip.instructions.contactPhone}
                      </a>
                    }
                  />
                )}
                {trip.instructions.notes && (
                  <div className="dt-instructions-notes">
                    <div className="dt-instructions-notes__title">
                      <MessageSquare size={14} /> Ghi chú hướng dẫn
                    </div>
                    <p className="dt-instructions-notes__text">{trip.instructions.notes}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="dt-instructions-notes__text">Chưa có hướng dẫn liên hệ cho chuyến này.</p>
            )}
          </div>
        </section>

        {/* Notes */}
        {trip.notes && (
          <section className="dt-section">
            <div className="dt-section__body">
              <div className="notes-title">Ghi chú</div>
              <p className="notes-text">{trip.notes}</p>
            </div>
          </section>
        )}

        {/* M8.4 — driver progress-event form + timeline (offline-safe). */}
        <DriverProgressCard tripId={trip.id} />
    </div>
  );
}
