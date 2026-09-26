import { useState, type ReactNode } from 'react';
import { Building2, CalendarClock, ChevronDown, FileCheck2, FileText, MapPinned, Package2, Phone } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Building02, Pin02, RefreshCcw02 } from '@untitledui/icons';
import { valueOrDash, formatDateTime } from '../../features/driver/driver-trip-model';
import type { DriverTaskDetail } from '../../api/driverClient';
import { driverLocationLabels } from '../../features/driver/driver-display';

/**
 * 2a618442 (structure-guard split): the THÔNG TIN LỆNH fact grid + the
 * THÔNG TIN XUẤT HÓA ĐƠN block, extracted from DriverTripDetailPage.
 *
 * Field order (mobile target sketch, card _4): NGÀY GIỜ KẾ HOẠCH | NHÀ MÁY
 * (short) → TÊN NHÀ MÁY (full) → ĐỊA CHỈ NHÀ MÁY (full) → Số điện thoại
 * liên hệ (one contact name + phone row beneath the factory address)
 * → Container / lô hàng
 * (each container number paired with its type code) → CẢNG NÂNG | CẢNG HẠ
 * (direction-aware: IMPORT swaps Cảng hạ to the empty-container return depot)
 * → Trả cont rỗng / Địa chỉ giao hàng (when applicable). Route text belongs
 * to the task header, not a second fact row. ĐẦU KÉO and RƠ MOÓC are OFF this surface: the wire fields
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
function feeInvoiceValue(name: string | null | undefined, address: string | null | undefined, taxCode: string | null | undefined): string {
  return `${name?.trim() || 'Chưa có tên đơn vị'}${address?.trim() ? ` · ${address.trim()}` : ''}${taxCode?.trim() ? ` · MST ${taxCode.trim()}` : ''}`;
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

export function DriverTaskInfoSections({ trip, children }: { trip: DriverTaskDetail; children?: ReactNode }) {
  // Both sections start expanded (the driver should see everything on
  // arrival); collapsing is an explicit per-visit space-saving choice.
  const [infoOpen, setInfoOpen] = useState(true);
  const [invoiceOpen, setInvoiceOpen] = useState(true);
  const fulfillment = trip.fulfillment ?? null;
  const plannedAt = fulfillment?.plannedAt ?? trip.plannedStartAt;
  const containers = trip.containers ?? [];
  const pickupPoint = fulfillment?.pickupPortName ?? fulfillment?.pickupWarehouseName ?? fulfillment?.lclWarehouseName ?? '—';

  // KP-063: direction-aware destination mapping. For IMPORT the required
  // Cảng hạ is the empty-container return depot (where the driver returns
  // the empty container); for EXPORT it is the conventional drop port.
  const rawDropPoint = fulfillment?.dropPortName ?? fulfillment?.dropWarehouseName ?? '—';
  const locations = driverLocationLabels(trip.tradeDirection, rawDropPoint === '—' ? null : rawDropPoint, fulfillment?.returnDepotName);
  const cangHa = locations.drop ?? (trip.tradeDirection === 'IMPORT' ? 'Chưa có nơi trả rỗng' : '—');

  // For IMPORT: always show the delivery address when it exists, even when
  // it matches the return depot (the driver needs to see where to deliver).
  // For EXPORT: show the empty-container return depot when it differs from
  // the drop point (existing behaviour).
  const showDeliveryLocationRow = Boolean(locations.delivery);
  const showReturnDepotRow = Boolean(locations.returnDepot);

  // KP-191: each container number paired with its own type code
  // (e.g. "MNBU12345543 · 40DC"). Seals render on their own row below.
  const containerLine = containers.length > 0
    ? containers
        .map((c) => [c.containerNumber, c.containerTypeCode || c.containerTypeName].filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(' · ') || '—'
    : valueOrDash(fulfillment?.modeLabel ?? trip.cargoTypeName);
  const sealLine = containers.length > 0
    ? containers.map((c) => c.sealNumber ? `Seal ${c.sealNumber}` : null).filter(Boolean).join(' · ') || null
    : null;

  // KP-010 contact row REMOVED (card 20260926_25, CHIEF 26/09): it read the
  // same site phone as the kho row (driver.service feeds both from
  // siteContactPhone) — two identical numbers stacked read as a bug.

  // Cards 20260926_12/_13 (CHIEF): the warehouse phone always renders —
  // callable, with a ≥44px phone-icon affordance, or as a dash when unentered.
  const khoPhone = fulfillment?.khoPhone?.trim() || null;

  const invoiceInfo = fulfillment?.invoiceInfo ?? null;
  const missingFactoryInvoiceFields = trip.invoiceFactory ? [
    !trip.invoiceFactory.name && 'tên pháp lý',
    !trip.invoiceFactory.address && 'địa chỉ xuất hóa đơn',
    !trip.invoiceFactory.taxCode && 'mã số thuế',
  ].filter(Boolean) : [];

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
          {/* CHIEF 26/09 (internal-ids law): the bill/booking code leads the
              detail the same way it leads the journey card. */}
          <TaskFact icon={<FileText size={16} />} label="Số Bill / Booking" value={valueOrDash(fulfillment?.code)} fullWidth />
          {/* Row 1 — NGÀY GIỜ KẾ HOẠCH | NHÀ MÁY (short name), per the
              mobile target sketch: the plan time pairs with the destination
              the driver scans for first. */}
          <TaskFact icon={<CalendarClock size={16} />} label="Ngày giờ kế hoạch" value={plannedAt ? formatDateTime(plannedAt) : 'Chưa chốt lịch'} />
          <TaskFact icon={<Building2 size={16} />} label="Nhà máy" value={factoryRowValue} />
          {/* Full factory name: canonical site name from the container
              factory join; dashes when missing OR when it would duplicate
              the abbrev row above. */}
          <TaskFact icon={<Building2 size={16} />} label="Tên nhà máy" value={distinctFullFactoryName} />
          {/* The customer's order-info row is the factory street address;
              route text remains visible in the task header. */}
          <TaskFact icon={<Building02 size={16} />} label="Địa chỉ nhà máy" value={valueOrDash(fulfillment?.factoryAddress)} />
          {/* Card 20260926_25 (CHIEF): one phone row, one label — the call
              affordance is a round phone-icon button, not a boxed Gọi. */}
          <TaskFact
            /* Card 20260926_25 amendment (CHIEF): the leading icon IS the call
               button — one phone glyph, spanning label + value, tap to call.
               The number stays plain text (selectable/copyable). */
            icon={khoPhone
              ? (
                <a
                  href={`tel:${khoPhone}`}
                  className="driver-task-fact__call"
                  aria-label={`Gọi điện thoại kho ${khoPhone}`}
                >
                  <Phone size={18} aria-hidden="true" />
                </a>
              )
              : <Phone size={16} aria-hidden="true" />}
            label="SĐT kho"
            value={khoPhone ?? '—'}
          />
          {/* KP-191: each container number paired with its own type code. */}
          <TaskFact icon={<Package2 size={16} />} label="Container / lô hàng" value={containerLine} />
          {sealLine ? (
            <TaskFact icon={<Package2 size={16} />} label="Seal" value={sealLine} fullWidth />
          ) : null}
          <TaskFact icon={<ArrowUpRight size={16} />} label="Cảng nâng" value={pickupPoint} />
          {/* KP-063: direction-aware Cảng hạ. For IMPORT this is the
              empty-container return depot; for EXPORT the drop port. */}
          <TaskFact icon={<ArrowDownRight size={16} />} label="Cảng hạ" value={cangHa} />
          {/* For IMPORT: actual delivery location when it differs from
              the return depot. For EXPORT: empty-container return depot
              when it differs from the drop point. */}
          {showDeliveryLocationRow ? (
            <TaskFact icon={<Pin02 size={16} />} label="Địa chỉ giao hàng" value={locations.delivery} />
          ) : null}
          {showReturnDepotRow ? (
            <TaskFact icon={<RefreshCcw02 size={16} />} label="Trả cont rỗng" value={locations.returnDepot} />
          ) : null}
        </div>
      </section>

      {/* Operational instructions precede billing details and remain outside
          both independently collapsible sections. */}
      {children}

      {/* 2a618442 / paper-form spec: "THÔNG TIN XUẤT HÓA ĐƠN" is a STRUCTURAL
          section — it always renders; rows show their values or the
          unconfigured empty states below. */}
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
          ) : !trip.invoiceFactory ? (
            <p className="driver-task-invoice-empty">Nhà máy chưa cấu hình thông tin xuất hóa đơn.</p>
          ) : null}
          {trip.invoiceFactory?.address ? (
            <TaskFact icon={<MapPinned size={16} />} label="Địa chỉ" value={trip.invoiceFactory.address} fullWidth />
          ) : null}
          {trip.invoiceFactory?.taxCode ? (
            <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceFactory.taxCode} fullWidth />
          ) : null}
          {missingFactoryInvoiceFields.length > 0 ? <p className="driver-task-invoice-empty">Nhà máy chưa cấu hình: {missingFactoryInvoiceFields.join(', ')}.</p> : null}
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
          {(invoiceInfo?.liftFeeInvoiceName?.trim() || invoiceInfo?.liftFeeInvoiceAddress?.trim() || invoiceInfo?.liftFeeTaxCode?.trim()) && (
            <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí nâng" value={feeInvoiceValue(invoiceInfo.liftFeeInvoiceName, invoiceInfo.liftFeeInvoiceAddress, invoiceInfo.liftFeeTaxCode)} fullWidth />
          )}
          {(invoiceInfo?.dropFeeInvoiceName?.trim() || invoiceInfo?.dropFeeInvoiceAddress?.trim() || invoiceInfo?.dropFeeTaxCode?.trim()) && (
            <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn phí hạ" value={feeInvoiceValue(invoiceInfo.dropFeeInvoiceName, invoiceInfo.dropFeeInvoiceAddress, invoiceInfo.dropFeeTaxCode)} fullWidth />
          )}
          {(invoiceInfo?.cleaningInvoiceName?.trim() || invoiceInfo?.cleaningInvoiceAddress?.trim() || invoiceInfo?.cleaningTaxCode?.trim()) && (
            <TaskFact icon={<FileCheck2 size={16} />} label="Hóa đơn vệ sinh cont" value={feeInvoiceValue(invoiceInfo.cleaningInvoiceName, invoiceInfo.cleaningInvoiceAddress, invoiceInfo.cleaningTaxCode)} fullWidth />
          )}
        </div>
      </section>
    </>
  );
}
