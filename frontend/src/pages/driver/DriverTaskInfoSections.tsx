import { useState } from 'react';
import { Building2, CalendarClock, ChevronDown, FileCheck2, FileText, MapPinned, Package2, Phone, Route } from 'lucide-react';
import { valueOrDash, formatDateTime } from '../../features/driver/driver-trip-model';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * 2a618442 (structure-guard split): the THÔNG TIN LỆNH fact grid + the
 * THÔNG TIN XUẤT HÓA ĐƠN block, extracted from DriverTripDetailPage.
 *
 * Field order (mobile target sketch, card _4): NGÀY GIỜ KẾ HOẠCH | NHÀ MÁY
 * (short) → TÊN NHÀ MÁY (full) → ĐỊA CHỈ NHÀ MÁY (full) → SĐT kho (always
 * visible, "—" when the site has no phone) → Container / lô hàng (booking
 * quantity idiom "1 x 20 DC") → CẢNG NÂNG | CẢNG HẠ → Trả cont rỗng (when
 * distinct) → TUYẾN (route text only) → Người liên hệ | Số điện thoại.
 * ĐẦU KÉO and RƠ MOÓC are both OFF this surface: the wire fields stay, only
 * the rows are dropped.
 */
function TaskFact({ icon, label, value, fullWidth }: { icon: React.ReactNode; label: string; value: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`driver-task-fact${fullWidth ? ' driver-task-fact--full' : ''}`}>
      <span className="driver-task-fact__icon">{icon}</span>
      <div className="driver-task-fact__body">
        <div className="driver-task-fact__label">{label}</div>
        <div className="driver-task-fact__value">{value}</div>
      </div>
    </div>
  );
}

/** One fee-invoice row reads "name · address · MST x" — each segment hides
 *  itself when its field is missing. */
function feeInvoiceValue(name: string, address: string | null | undefined, taxCode: string | null | undefined): string {
  return `${name}${address ? ` · ${address}` : ''}${taxCode ? ` · MST ${taxCode}` : ''}`;
}

/**
 * Collapsible section head (20260911_2 BUG 1 — "có thể thu nhỏ vào đỡ chiếm
 * diện tích"): the whole head row is the toggle. While collapsed, `summary`
 * carries the one fact the driver still needs to recognize the trip (the
 * factory short name, per the mockup "TÊN NHÀ MÁY (ASKEY)").
 */
function CollapsibleSectionHead({ id, label, summary, open, onToggle }: {
  id: string;
  label: string;
  summary?: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="driver-task-section__head">
      <button
        type="button"
        className="driver-task-section__toggle"
        aria-expanded={open}
        aria-controls={id}
        data-testid={`task-section-toggle-${id}`}
        onClick={onToggle}
      >
        <span>{label}</span>
        {!open && summary ? (
          <span className="driver-task-section__summary" data-testid={`task-section-summary-${id}`}>{summary}</span>
        ) : null}
        <ChevronDown size={14} className="driver-task-section__chev" aria-hidden="true" />
      </button>
    </div>
  );
}

export function DriverTaskInfoSections({ trip }: { trip: DriverTaskDetail }) {
  // Both sections start expanded (the driver should see everything on
  // arrival); collapsing is an explicit per-visit space-saving choice.
  const [infoOpen, setInfoOpen] = useState(true);
  const [invoiceOpen, setInvoiceOpen] = useState(true);
  const fulfillment = trip.fulfillment ?? null;
  const pickupPoint = fulfillment?.pickupPortName ?? fulfillment?.pickupWarehouseName ?? fulfillment?.lclWarehouseName ?? '—';
  // The delivery point mirrors the pickup coalesce: prefer the port name,
  // fall back to warehouse, then dash — matching the pickup-side idiom.
  const dropPoint = fulfillment?.dropPortName ?? fulfillment?.dropWarehouseName ?? '—';
  // Spec A4: container number, type and seal share one line (same idiom as
  // the journey-board card). Quantity format follows the booking idiom
  // ("1 x 20 DC"): counts per container type, joined with "+".
  const containerLine = trip.containers.length > 0
    ? [
        trip.containers.map((container) => container.containerNumber).filter(Boolean).join(' · '),
        Array.from(trip.containers.reduce((counts, container) => {
          const code = container.containerTypeCode || container.containerTypeName;
          if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
          return counts;
        }, new Map<string, number>())).map(([code, count]) => `${count} x ${code}`).join(' + '),
        trip.containers.map((container) => container.sealNumber ? `Seal ${container.sealNumber}` : null).filter(Boolean).join(' · ') || null,
      ].filter(Boolean).join(' · ') || '—'
    : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName);
  const contactName = fulfillment?.contactName ?? trip.instructions?.contactName ?? null;
  const contactPhone = fulfillment?.contactPhone ?? trip.instructions?.contactPhone ?? null;

  const invoiceInfo = fulfillment?.invoiceInfo ?? null;

  // No adjacent duplicate rows in the factory block: the abbrev row keeps its
  // full-name fallback, so when the canonical full name resolves to the SAME
  // string (site-miss or blank site short name), the full-name row dashes
  // instead of echoing its neighbor.
  const factoryRowValue = valueOrDash(fulfillment?.factoryShortName || fulfillment?.factoryName);
  const fullFactoryName = valueOrDash(fulfillment?.factoryFullName);
  const distinctFullFactoryName = fullFactoryName !== '—' && fullFactoryName !== factoryRowValue
    ? fullFactoryName
    : '—';

  return (
    <>
      <section className={`driver-task-section${infoOpen ? '' : ' driver-task-section--collapsed'}`}>
        <CollapsibleSectionHead
          id="driver-task-info-grid"
          label="Thông tin lệnh"
          summary={fulfillment?.factoryShortName ?? null}
          open={infoOpen}
          onToggle={() => setInfoOpen((v) => !v)}
        />
        <div className="driver-task-grid" id="driver-task-info-grid" hidden={!infoOpen}>
          {/* Row 1 — NGÀY GIỜ KẾ HOẠCH | NHÀ MÁY (short name), per the
              mobile target sketch: the plan time pairs with the destination
              the driver scans for first. */}
          <TaskFact icon={<CalendarClock size={16} />} label="Ngày giờ kế hoạch" value={formatDateTime(fulfillment?.plannedAt ?? trip.departureDate)} />
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={factoryRowValue} />
          {/* Full factory name: canonical site name from the container
              factory join; dashes when missing OR when it would duplicate
              the abbrev row above. */}
          <TaskFact icon={<Building2 size={16} />} label="Tên nhà máy" value={distinctFullFactoryName} fullWidth />
          {/* Factory site street address in its own row — the Tuyến row
              below stays route text only. */}
          <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ nhà máy" value={valueOrDash(fulfillment?.factoryAddress)} fullWidth />
          {/* SĐT kho sits directly under the factory address (sketch row 4). */}
          <TaskFact
            icon={<Phone size={16} />}
            label="SĐT kho"
            value={fulfillment?.khoPhone
              ? <a href={`tel:${fulfillment.khoPhone}`} className="driver-task-link">{fulfillment.khoPhone}</a>
              : '—'}
          />
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} fullWidth />
          <TaskFact icon={<MapPinned size={16} />} label="Cảng nâng" value={pickupPoint} />
          <TaskFact icon={<MapPinned size={16} />} label="Cảng hạ" value={dropPoint} />
          {/* Stage-2 empty-container return depot — its own labeled row only
              when the dropoff port names a DIFFERENT place than the delivery
              point above; hidden when they agree or the port is absent. */}
          {fulfillment?.returnDepotName ? (
            <TaskFact icon={<MapPinned size={16} />} label="Trả cont rỗng" value={fulfillment.returnDepotName} />
          ) : null}
          {/* Route text only — the factory address renders in its own row
              above; falls back through route summary → route name. */}
          <TaskFact
            icon={<Route size={16} />}
            label="Tuyến"
            value={valueOrDash(fulfillment?.routeSummary ?? trip.routeName)}
            fullWidth
          />
          <TaskFact icon={<Phone size={16} />} label="Người liên hệ" value={valueOrDash(contactName)} />
          <TaskFact
            icon={<Phone size={16} />}
            label="Số điện thoại"
            value={contactPhone ? <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a> : '—'}
          />
        </div>
      </section>

      {/* 2a618442: customer wording — "THÔNG TIN XUẤT HÓA ĐƠN". Block hides
          when there is nothing to show (per-row graceful hide; fee-invoice
          rows may still surface alone). */}
      {(invoiceInfo || trip.invoiceMaster || trip.invoiceFactory) && (
        <section className={`driver-task-section${invoiceOpen ? '' : ' driver-task-section--collapsed'}`}>
          <CollapsibleSectionHead
            id="driver-task-invoice-grid"
            label="Thông tin xuất hóa đơn"
            open={invoiceOpen}
            onToggle={() => setInvoiceOpen((v) => !v)}
          />
          <div className="driver-task-grid" id="driver-task-invoice-grid" hidden={!invoiceOpen}>
            {/* Party attribution: the factory's own invoice profile leads —
                the site billing the lift/drop/cleaning fees — under an
                explicit party label. An unconfigured factory renders the
                honest empty note; the customer block is never a fallback. */}
            <p className="driver-task-invoice-party">Nhà máy</p>
            {trip.invoiceFactory?.name ? (
              <TaskFact icon={<Building2 size={16} />} label="Tên công ty" value={trip.invoiceFactory.name} fullWidth />
            ) : (
              <p className="driver-task-invoice-empty">Nhà máy chưa cấu hình thông tin xuất hóa đơn.</p>
            )}
            {trip.invoiceFactory?.address ? (
              <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ" value={trip.invoiceFactory.address} fullWidth />
            ) : null}
            {trip.invoiceFactory?.taxCode ? (
              <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceFactory.taxCode} fullWidth />
            ) : null}
            {/* TC-DA-005: customer master-data invoice rows. Row order:
                company name → address → MST (mockup). Source: customers via
                shipments.customerId. Per-row graceful hide on sparse data. */}
            {trip.invoiceMaster?.companyName ? (
              <TaskFact icon={<Building2 size={16} />} label="Tên công ty" value={trip.invoiceMaster.companyName} fullWidth />
            ) : null}
            {trip.invoiceMaster?.address ? (
              <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ" value={trip.invoiceMaster.address} fullWidth />
            ) : null}
            {trip.invoiceMaster?.taxCode ? (
              <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceMaster.taxCode} fullWidth />
            ) : null}
            {/* Party labels only render when customer rows exist — the fee
                rows below carry their own explicit per-fee labels. */}
            {trip.invoiceMaster && (trip.invoiceMaster.companyName || trip.invoiceMaster.address || trip.invoiceMaster.taxCode) ? (
              <p className="driver-task-invoice-party">Khách hàng</p>
            ) : null}
            {invoiceInfo?.liftFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí nâng" value={feeInvoiceValue(invoiceInfo.liftFeeInvoiceName, invoiceInfo.liftFeeInvoiceAddress, invoiceInfo.liftFeeTaxCode)} fullWidth />
            )}
            {invoiceInfo?.dropFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí hạ" value={feeInvoiceValue(invoiceInfo.dropFeeInvoiceName, invoiceInfo.dropFeeInvoiceAddress, invoiceInfo.dropFeeTaxCode)} fullWidth />
            )}
            {invoiceInfo?.cleaningInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn vệ sinh cont" value={feeInvoiceValue(invoiceInfo.cleaningInvoiceName, invoiceInfo.cleaningInvoiceAddress, invoiceInfo.cleaningTaxCode)} fullWidth />
            )}
          </div>
        </section>
      )}
    </>
  );
}
