import { Gauge, Fuel, Wrench, Clock, User, MapPin, Signal, RefreshCw } from 'lucide-react';
import type { LiveFleetVehicle, LiveFleetDetails } from '@tingting/shared';
import { LIVE_STATUS_COLOR, LIVE_STATUS_LABEL } from '../../../lib/liveFleet';
import { formatDateTimeVN } from '../../../lib/format';

/**
 * Live GPS telemetry for a trip's assigned truck — everything Bách Khoa exposes
 * for the device (portal endpoint). Rendered on the trip-detail page when the
 * trip is IN_TRANSIT. Fields are nullable: devices vary (no camera, no odometer,
 * no driver-card, etc.).
 */
interface LiveTrackingCardProps {
  vehicle: LiveFleetVehicle;
}

const MONO = "'JetBrains Mono', monospace";

/**
 * Helper to determine if a telemetry field has a valid, non-empty value.
 * Filters out null, undefined, empty strings, and raw dash/placeholder values.
 */
function hasVal(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed !== '' && trimmed !== '—';
  }
  return true;
}

function Num({ value, unit }: { value: number | null | undefined; unit?: string }) {
  if (value === null || value === undefined) return <span style={{ color: '#9CA3AF' }}>—</span>;
  return (
    <span style={{ fontFamily: MONO }}>
      {value.toLocaleString('vi-VN')}
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

function Txt({ value }: { value: string | null | undefined }) {
  if (!value) return <span style={{ color: '#9CA3AF' }}>—</span>;
  return <span>{value}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--border-2, #ECEFF1)' }}>
      <span style={{ color: 'var(--text-2, #6B7280)', fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, textAlign: 'right' }}>{children}</span>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 2px', color: 'var(--text-3, #9CA3AF)', fontSize: 12, lineHeight: 1.35, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {icon} {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function LiveTrackingCard({ vehicle }: LiveTrackingCardProps) {
  const d: LiveFleetDetails | null | undefined = vehicle.details;
  const color = LIVE_STATUS_COLOR[vehicle.status];
  const updated = formatDateTimeVN(vehicle.lastSeenAt);

  // Filter rows dynamically to omit empty / "-" fields
  const motionRows = [
    hasVal(vehicle.licensePlate) && <Row label="Biển số" key="plate"><span style={{ fontWeight: 700 }}>{vehicle.licensePlate}</span></Row>,
    hasVal(vehicle.speed) && <Row label="Tốc độ" key="speed"><Num value={Math.round(vehicle.speed)} unit="km/h" /></Row>,
    hasVal(vehicle.ignitionOn) && <Row label="Động cơ" key="ignition">{vehicle.ignitionOn ? 'Bật' : 'Tắt'}</Row>,
    hasVal(vehicle.angle) && <Row label="Hướng" key="angle"><Num value={vehicle.angle} unit="°" /></Row>,
    hasVal(vehicle.address) && <Row label="Địa điểm" key="addr"><Txt value={vehicle.address} /></Row>,
  ].filter(Boolean);

  const fuelRows = [
    hasVal(vehicle.fuel) && <Row label="Dầu (lít)" key="fuel"><Num value={vehicle.fuel} /></Row>,
    d && hasVal(d.fuelPercent) && <Row label="% dầu" key="fuelPercent"><Num value={d.fuelPercent} unit="%" /></Row>,
  ].filter(Boolean);

  const signalRows = d ? [
    // GPS is always present since vehicle.status exists
    <Row label="GPS" key="gps">{vehicle.status === 'offline' ? 'Mất' : 'Có'}</Row>,
    hasVal(d.signalDb) && <Row label="GSM" key="gsm"><Num value={d.signalDb} unit="dB" /></Row>,
  ].filter(Boolean) : [];

  const odometerRows = d ? [
    hasVal(d.odometerKm) && <Row label="Tổng số km" key="odometer"><Num value={d.odometerKm} unit="km" /></Row>,
    hasVal(d.kmToday) && <Row label="km hôm nay" key="kmToday"><Num value={d.kmToday} unit="km" /></Row>,
    hasVal(d.modelCar) && <Row label="Model xe" key="model"><Txt value={d.modelCar} /></Row>,
  ].filter(Boolean) : [];

  const engineRows = d ? [
    hasVal(d.engineSince) && <Row label="Đề máy từ" key="engineSince"><Txt value={d.engineSince} /></Row>,
    hasVal(d.doorStatus) && <Row label="Cửa" key="door"><Txt value={d.doorStatus} /></Row>,
    hasVal(d.airConditioning) && <Row label="Điều hòa" key="ac"><Txt value={d.airConditioning} /></Row>,
    hasVal(d.batteryV) && <Row label="Ắc quy" key="battery"><Txt value={d.batteryV} /></Row>,
  ].filter(Boolean) : [];

  const drivingRows = d ? [
    hasVal(d.drivingTime) && <Row label="Lái (phiên)" key="drivingTime"><Txt value={d.drivingTime} /></Row>,
    hasVal(d.drivingTimeToday) && <Row label="Lái hôm nay" key="drivingTimeToday"><Txt value={d.drivingTimeToday} /></Row>,
    hasVal(d.stopCount) && <Row label="Số lần dừng" key="stopCount"><Num value={d.stopCount} /></Row>,
    hasVal(d.overSpeedCount) && <Row label="Quá tốc độ" key="overSpeed"><Num value={d.overSpeedCount} /></Row>,
    hasVal(d.parkedTime) && <Row label="Thời gian đỗ" key="parked"><Txt value={d.parkedTime} /></Row>,
  ].filter(Boolean) : [];

  const driverRows = d ? [
    hasVal(d.driverLicense) && <Row label="GPLX" key="license"><Txt value={d.driverLicense} /></Row>,
    hasVal(d.licenseExpiry) && <Row label="Hết hạn GPLX" key="expiry"><Txt value={d.licenseExpiry} /></Row>,
    hasVal(d.driverPhone) && (
      <Row label="SĐT" key="phone">
        <a href={`tel:${d.driverPhone}`} style={{ color: 'var(--brand, #00B14F)' }}>{d.driverPhone}</a>
      </Row>
    ),
  ].filter(Boolean) : [];

  const hasRightColumn = d && (
    odometerRows.length > 0 ||
    engineRows.length > 0 ||
    drivingRows.length > 0 ||
    driverRows.length > 0
  );

  return (
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="hicon" style={{ width: 22, height: 22 }}><MapPin size={14} /></span>
            Giám sát hành trình
          </h2>
          <span style={{ background: `${color}22`, color, padding: '3px 9px', borderRadius: 999, fontSize: 12, lineHeight: 1.35, fontWeight: 700 }}>
            {LIVE_STATUS_LABEL[vehicle.status]}
          </span>
        </div>
        <span title="Cập nhật tự động mỗi 25 giây" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, lineHeight: 1.35, color: 'var(--text-3, #9CA3AF)' }}>
          <RefreshCw size={11} /> {updated}
        </span>
      </div>

      {/* Responsive 2-column layout for detailed telemetry */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: hasRightColumn ? 'repeat(auto-fit, minmax(280px, 1fr))' : '1fr',
        gap: '20px',
        marginTop: '12px'
      }}>
        {/* Left Column: Core motion, fuel, and signals */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {motionRows.length > 0 && (
            <Section icon={<Gauge size={12} />} title="Vị trí & chuyển động">
              {motionRows}
            </Section>
          )}

          {fuelRows.length > 0 && (
            <Section icon={<Fuel size={12} />} title="Nhiên liệu">
              {fuelRows}
            </Section>
          )}

          {d && signalRows.length > 0 && (
            <Section icon={<Signal size={12} />} title="Tín hiệu">
              {signalRows}
            </Section>
          )}
        </div>

        {/* Right Column: Odometer, engine power, driving behavior, and device card */}
        {hasRightColumn && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {odometerRows.length > 0 && (
              <Section icon={<MapPin size={12} />} title="Đồng hồ & xe">
                {odometerRows}
              </Section>
            )}

            {engineRows.length > 0 && (
              <Section icon={<Wrench size={12} />} title="Động cơ & điện">
                {engineRows}
              </Section>
            )}

            {drivingRows.length > 0 && (
              <Section icon={<Clock size={12} />} title="Thời gian lái">
                {drivingRows}
              </Section>
            )}

            {driverRows.length > 0 && (
              <Section icon={<User size={12} />} title="Lái xe (thẻ thiết bị)">
                {driverRows}
              </Section>
            )}
          </div>
        )}
      </div>

      {!d && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface-2, #F5F7F6)', borderRadius: 8, fontSize: 12, color: 'var(--text-2, #6B7280)' }}>
          Chi tiết mở rộng (camera, đồng hồ, thời gian lái…) chỉ khả dụng khi nguồn dữ liệu là cổng portal.
        </div>
      )}
    </section>
  );
}
