import { useState } from 'react';
import { Building2, CalendarClock, ChevronDown, FileCheck2, FileText, MapPinned, Package2, Phone, Route } from 'lucide-react';
import { valueOrDash, formatDateTime } from '../../features/driver/driver-trip-model';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * 2a618442 (structure-guard split): the THÔNG TIN LỆNH fact grid + the
 * THÔNG TIN XUẤT HÓA ĐƠN block, extracted from DriverTripDetailPage.
 *
 * Field order (20260911_3 BUG 5, superseding the 365943ea/wave-20260911
 * order): Nhà máy (SHORT name, full-name fallback) → Container / lô hàng →
 * Cảng nâng | Cảng hạ → Tuyến (factory address, demoted below the ports) →
 * SĐT kho (graceful hide) → Ngày giờ kế hoạch → Người liên hệ | Số điện
 * thoại. ĐẦU KÉO and RƠ MOÓC are both OFF this surface ("Bỏ đầu kéo -
 * moóc"): the wire fields stay, only the rows are dropped.
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
  const dropPoint = fulfillment?.dropPortName ?? fulfillment?.dropWarehouseName ?? fulfillment?.lclWarehouseName ?? '—';
  // Spec A4: container number, type and seal share one line (same idiom as
  // the journey-board card).
  const containerLine = trip.containers.length > 0
    ? trip.containers.map((container) => [
        container.containerNumber,
        container.containerTypeName,
        container.sealNumber ? `Seal ${container.sealNumber}` : null,
      ].filter(Boolean).join(' · ') || '—').join(' · ')
    : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName);
  const contactName = fulfillment?.contactName ?? trip.instructions?.contactName ?? null;
  const contactPhone = fulfillment?.contactPhone ?? trip.instructions?.contactPhone ?? null;

  const invoiceInfo = fulfillment?.invoiceInfo ?? null;

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
          {/* BUG 5: the grid leads with the SHORT factory name (tên viết
              tắt) — full name only when no short name exists. The collapsed
              header summary keeps the short name too. */}
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={valueOrDash(fulfillment?.factoryShortName || fulfillment?.factoryName)} fullWidth />
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} fullWidth />
          <TaskFact icon={<MapPinned size={16} />} label="Cảng nâng" value={pickupPoint} />
          <TaskFact icon={<MapPinned size={16} />} label="Cảng hạ" value={dropPoint} />
          {/* TC-DA-002: the Tuyến row carries the factory site STREET ADDRESS
              (not the name) — parity with the dispatcher ledger. Falls back to
              the route summary / route name when the site has no address.
              BUG 5 demotes it below the ports (tuyến đường xuống dưới). */}
          <TaskFact
            icon={<Route size={16} />}
            label="Tuyến"
            value={valueOrDash(fulfillment?.factoryAddress ?? fulfillment?.routeSummary ?? trip.routeName)}
            fullWidth
          />
          {/* TC-DA-003: kho site phone — rendered ONLY when present; no dash
              placeholder (graceful hide per spec). Pairs with Ngày giờ. */}
          {fulfillment?.khoPhone ? (
            <TaskFact
              icon={<Phone size={16} />}
              label="SĐT kho"
              value={<a href={`tel:${fulfillment.khoPhone}`} className="driver-task-link">{fulfillment.khoPhone}</a>}
            />
          ) : null}
          <TaskFact icon={<CalendarClock size={16} />} label="Ngày giờ kế hoạch" value={formatDateTime(fulfillment?.plannedAt ?? trip.departureDate)} />
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
      {(invoiceInfo || trip.invoiceMaster) && (
        <section className={`driver-task-section${invoiceOpen ? '' : ' driver-task-section--collapsed'}`}>
          <CollapsibleSectionHead
            id="driver-task-invoice-grid"
            label="Thông tin xuất hóa đơn"
            open={invoiceOpen}
            onToggle={() => setInvoiceOpen((v) => !v)}
          />
          <div className="driver-task-grid" id="driver-task-invoice-grid" hidden={!invoiceOpen}>
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
            {invoiceInfo?.liftFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí nâng" value={`${invoiceInfo?.liftFeeInvoiceName}${invoiceInfo.liftFeeTaxCode ? ` · MST ${invoiceInfo.liftFeeTaxCode}` : ''}`} fullWidth />
            )}
            {invoiceInfo?.dropFeeInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí hạ" value={`${invoiceInfo?.dropFeeInvoiceName}${invoiceInfo.dropFeeTaxCode ? ` · MST ${invoiceInfo.dropFeeTaxCode}` : ''}`} fullWidth />
            )}
            {invoiceInfo?.cleaningInvoiceName && (
              <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn vệ sinh cont" value={`${invoiceInfo?.cleaningInvoiceName}${invoiceInfo.cleaningTaxCode ? ` · MST ${invoiceInfo.cleaningTaxCode}` : ''}`} fullWidth />
            )}
          </div>
        </section>
      )}
    </>
  );
}
