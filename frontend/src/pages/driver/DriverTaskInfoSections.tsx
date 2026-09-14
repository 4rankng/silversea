import { useState } from 'react';
import { Building2, CalendarClock, ChevronDown, FileCheck2, FileText, MapPinned, Package2, Phone, Route } from 'lucide-react';
import { valueOrDash, formatDateTime } from '../../features/driver/driver-trip-model';
import type { DriverTaskDetail } from '../../api/driverClient';

/**
 * 2a618442 (structure-guard split): the THÔNG TIN LỆNH fact grid + the
 * THÔNG TIN XUẤT HÓA ĐƠN block, extracted from DriverTripDetailPage.
 *
 * Field order (mobile target sketch, card _4): NGÀY GIỜ KẾ HOẠCH | NHÀ MÁY
 * (short) → TÊN NHÀ MÁY (full) → ĐỊA CHỈ NHÀ MÁY (full) → Số điện thoại
 * liên hệ (contact name + phone, grouped beneath factory address) → SĐT kho
 * (always visible, "—" when the site has no phone) → Container / lô hàng
 * (each container number paired with its type code) → CẢNG NÂNG | CẢNG HẠ
 * (direction-aware: IMPORT swaps Cảng hạ to the empty-container return depot)
 * → Trả cont rỗng / Địa chỉ giao hàng (when distinct) → TUYẾN (route text
 * only). ĐẦU KÉO and RƠ MOÓC are both OFF this surface: the wire fields
 * stay, only the rows are dropped.
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

  // KP-063: direction-aware destination mapping. For IMPORT the required
  // Cảng hạ is the empty-container return depot (where the driver returns
  // the empty container); for EXPORT it is the conventional drop port.
  const rawDropPoint = fulfillment?.dropPortName ?? fulfillment?.dropWarehouseName ?? '—';
  const isImport = trip.tradeDirection === 'IMPORT';
  const cangHa = isImport
    ? (fulfillment?.returnDepotName ?? rawDropPoint)
    : rawDropPoint;

  // For IMPORT: when the actual delivery location differs from the return
  // depot, render it as its own "Địa chỉ giao hàng" row so the driver can
  // see both the delivery site and the return depot.
  // For EXPORT: show the empty-container return depot when it differs from
  // the drop point (existing behaviour).
  const showDeliveryLocationRow = isImport && fulfillment?.returnDepotName && rawDropPoint !== '—' && rawDropPoint !== fulfillment.returnDepotName;
  const showReturnDepotRow = !isImport && fulfillment?.returnDepotName && fulfillment.returnDepotName !== cangHa;

  // KP-191: each container number paired with its own type code
  // (e.g. "MNBU12345543 · 40DC"). Seals render on their own row below.
  const containerLine = trip.containers.length > 0
    ? trip.containers
        .map((c) => [c.containerNumber, c.containerTypeCode || c.containerTypeName].filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(' · ') || '—'
    : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName);
  const sealLine = trip.containers.length > 0
    ? trip.containers.map((c) => c.sealNumber ? `Seal ${c.sealNumber}` : null).filter(Boolean).join(' · ') || null
    : null;

  // KP-010: contact name and callable phone grouped together beneath the
  // factory address, labeled "Số điện thoại liên hệ".
  const contactName = fulfillment?.contactName ?? trip.instructions?.contactName ?? null;
  const contactPhone = fulfillment?.contactPhone ?? trip.instructions?.contactPhone ?? null;
  const contactFieldValue = contactName && contactPhone
    ? <>{contactName} · <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a></>
    : contactPhone
      ? <a href={`tel:${contactPhone}`} className="driver-task-link">{contactPhone}</a>
      : contactName || '—';

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
          {/* KP-010: contact name + callable phone grouped together
              beneath the factory address. */}
          <TaskFact
            icon={<Phone size={16} />}
            label="Số điện thoại liên hệ"
            value={contactFieldValue}
            fullWidth
          />
          {/* Warehouse direct phone — always visible, "—" when the site
              has no phone. */}
          <TaskFact
            icon={<Phone size={16} />}
            label="SĐT liên hệ"
            value={fulfillment?.khoPhone
              ? <a href={`tel:${fulfillment.khoPhone}`} className="driver-task-link">{fulfillment.khoPhone}</a>
              : '—'}
          />
          {/* KP-191: each container number paired with its own type code. */}
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} fullWidth />
          {sealLine ? (
            <TaskFact icon={<Package2 size={16} />} label="Seal" value={sealLine} fullWidth />
          ) : null}
          <TaskFact icon={<MapPinned size={16} />} label="Cảng nâng" value={pickupPoint} />
          {/* KP-063: direction-aware Cảng hạ. For IMPORT this is the
              empty-container return depot; for EXPORT the drop port. */}
          <TaskFact icon={<MapPinned size={16} />} label="Cảng hạ" value={cangHa} />
          {/* For IMPORT: actual delivery location when it differs from
              the return depot. For EXPORT: empty-container return depot
              when it differs from the drop point. */}
          {showDeliveryLocationRow ? (
            <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ giao hàng" value={rawDropPoint} />
          ) : null}
          {showReturnDepotRow ? (
            <TaskFact icon={<MapPinned size={16} />} label="Trả cont rỗng" value={fulfillment!.returnDepotName!} />
          ) : null}
          {/* Route text only — the factory address renders in its own row
              above; falls back through route summary → route name. */}
          <TaskFact
            icon={<Route size={16} />}
            label="Tuyến"
            value={valueOrDash(fulfillment?.routeSummary ?? trip.routeName)}
            fullWidth
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
            {/* KP-191: each party heading precedes that party's data. */}
            {/* Factory invoice profile — the site billing the
                lift/drop/cleaning fees. */}
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
            {/* Customer master-data invoice block — heading precedes data. */}
            {trip.invoiceMaster && (trip.invoiceMaster.companyName || trip.invoiceMaster.address || trip.invoiceMaster.taxCode) ? (
              <>
                <p className="driver-task-invoice-party">Khách hàng</p>
                {trip.invoiceMaster.companyName ? (
                  <TaskFact icon={<Building2 size={16} />} label="Tên công ty" value={trip.invoiceMaster.companyName} fullWidth />
                ) : null}
                {trip.invoiceMaster.address ? (
                  <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ" value={trip.invoiceMaster.address} fullWidth />
                ) : null}
                {trip.invoiceMaster.taxCode ? (
                  <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceMaster.taxCode} fullWidth />
                ) : null}
              </>
            ) : null}
            {/* Fee-invoice rows carry their own explicit per-fee labels. */}
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
