import { useState, type ReactNode } from 'react';
import { Building2, CalendarClock, ChevronDown, FileCheck2, FileText, MapPinned, Phone, PhoneCall } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, Building02, Pin02, RefreshCcw02 } from '@untitledui/icons';
import { valueOrDash, formatDateTime } from '../../features/driver/driver-trip-model';
import type { DriverTaskDetail } from '../../api/driverClient';
import { CopyCodeButton } from '../../components/trip/CopyCodeButton';
import { driverLocationLabels } from '../../features/driver/driver-display';

/**
 * 2a618442 (structure-guard split): the THÔNG TIN LỆNH fact grid + the
 * THÔNG TIN XUẤT HÓA ĐƠN block, extracted from DriverTripDetailPage.
 *
 * Field order (card 20260926_26/_27): NGÀY GIỜ KẾ HOẠCH → TÊN NHÀ MÁY →
 * ĐỊA CHỈ NHÀ MÁY → SĐT kho → (SĐT liên hệ — only when it carries a number
 * DIFFERENT from the kho row; identical numbers never render twice)
 * → CẢNG NÂNG → CẢNG HẠ
 * (direction-aware: IMPORT swaps Cảng hạ to the empty-container return depot)
 * → Trả cont rỗng / Địa chỉ giao hàng (when applicable).
 *
 * Card 20260926_27 dedup decisions (documented on the card):
 * - ITEM 5: the "Nhà máy" abbrev row is gone — the factory name renders in
 *   the header (line-2 location); Tên nhà máy + Địa chỉ nhà máy stay. The
 *   full-name row falls back to factoryName, so the old dash-dedup against
 *   the removed abbrev neighbor is retired with it.
 * - ITEM 6: container + seal info has ONE home — the Số cont & seal card
 *   (the editable one). The read-only "Container / lô hàng" and "Seal" grid
 *   rows are removed; the FCL/LCL mode label leaves this screen with them.
 * - ITEM 7: khoPhone and contactPhone are independent fields, so they CAN
 *   differ: identical numbers render ONE row; differing numbers render both
 *   rows with their own labels so the driver can call the right one.
 */
function TaskFact({ icon, label, value, fullWidth, action }: { icon: React.ReactNode; label: string; value: React.ReactNode; fullWidth?: boolean; action?: React.ReactNode }) {
  return (
    <div className={`driver-task-fact${fullWidth ? ' driver-task-fact--full' : ''}`}>
      <span className="driver-task-fact__icon">{icon}</span>
      <span className="driver-task-fact__label">{label}</span>
      <div className="driver-task-fact__value">{value}</div>
      {action ? <div className="driver-task-fact__action">{action}</div> : null}
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
  const fulfillment = trip.fulfillment ?? null;
  const plannedAt = fulfillment?.plannedAt ?? trip.plannedStartAt;
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

  // Card 20260926_27 item 7: khoPhone and contactPhone are independent
  // fields and CAN differ. Identical numbers never render twice — the
  // contact row appears only when it carries a DIFFERENT trimmed number.
  const khoPhone = fulfillment?.khoPhone?.trim() || null;
  const contactPhone = fulfillment?.contactPhone?.trim() || null;
  const showContactPhoneRow = Boolean(contactPhone) && contactPhone !== khoPhone;

  // Card 20260926_27 item 5: the abbrev "Nhà máy" row is gone (the factory
  // name renders in the header), so the full-name row falls back to the
  // free-text factory name instead of dashing against the removed neighbor.
  const fullFactoryName = valueOrDash(fulfillment?.factoryFullName || fulfillment?.factoryName);

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
          {/* Card 20260926_26 item 4: the bill/booking code (internal-ids law:
              the driver's display key) moved into the header title — one
              place, not two. */}
          <TaskFact icon={<CalendarClock size={16} />} label="Ngày giờ kế hoạch" value={plannedAt ? formatDateTime(plannedAt) : 'Chưa chốt lịch'} />
          {/* Card 20260926_27 item 5: no abbrev "Nhà máy" row — the factory
              name renders in the header; Tên nhà máy + Địa chỉ stay. */}
          <TaskFact icon={<Building2 size={16} />} label="Tên nhà máy" value={fullFactoryName} />
          {/* The customer's order-info row is the factory street address. */}
          <TaskFact icon={<Building02 size={16} />} label="Địa chỉ nhà máy" value={valueOrDash(fulfillment?.factoryAddress)} />
          {/* Card 20260926_25/_27: the kho phone always renders (KP-010);
              the call affordance is the row's leading phone icon. */}
          {/* Card 20260926_41 V2 (CHIEF): the info card is pure data — the
              call affordance lives in the action bar beneath the card. */}
          <TaskFact icon={<Phone size={16} aria-hidden="true" />} label="SĐT kho" value={khoPhone ?? '—'} />
          {/* Card 20260926_27 item 7: the named-contact number renders only
              when it DIFFERS from the kho number — identical numbers never
              render twice. */}
          {showContactPhoneRow ? (
            <TaskFact icon={<Phone size={16} aria-hidden="true" />} label="SĐT liên hệ" value={contactPhone} />
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

      {/* Card 20260926_41 V2 (CHIEF): the call affordance lives OUTSIDE the
          info card — one green Gọi kho button, tel: the site phone. */}
      {khoPhone ? (
        <div className="driver-task-call-bar">
          <a href={`tel:${khoPhone}`} className="driver-task-call-bar__btn">
            <PhoneCall size={16} aria-hidden="true" /> Gọi kho
          </a>
        </div>
      ) : null}

      {/* Operational instructions precede billing details and remain outside
          both independently collapsible sections. */}
      {children}
    </>
  );
}

/**
 * Card 20260926_30 items 15+17: the invoice block is back-office material —
 * it leaves the driver's critical path by rendering LAST on the screen and
 * starting collapsed; the driver expands it on demand.
 */
export function DriverInvoiceSection({ trip }: { trip: DriverTaskDetail }) {
  // Card 20260926_30 item 17: default-collapsed — the section head is the
  // toggle; the driver expands on demand.
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const fulfillment = trip.fulfillment ?? null;
  const invoiceInfo = fulfillment?.invoiceInfo ?? null;
  const missingFactoryInvoiceFields = trip.invoiceFactory ? [
    !trip.invoiceFactory.name && 'tên pháp lý',
    !trip.invoiceFactory.address && 'địa chỉ xuất hóa đơn',
    !trip.invoiceFactory.taxCode && 'mã số thuế',
  ].filter(Boolean) : [];

  return (
    <>
      {/* 2a618442 / paper-form spec: "THÔNG TIN XUẤT HÓA ĐƠN" is a STRUCTURAL
          section — it always renders (collapsed by default); rows show their
          values or the unconfigured empty states below. */}
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
          {/* Card _28 item 9: MST values are copyable (factory + customer). */}
          {trip.invoiceFactory?.taxCode ? (
            <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceFactory.taxCode} fullWidth action={<CopyCodeButton value={trip.invoiceFactory.taxCode} label="MST nhà máy" />} />
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
                <TaskFact icon={<FileText size={16} />} label="MST" value={trip.invoiceMaster.taxCode} fullWidth action={<CopyCodeButton value={trip.invoiceMaster.taxCode} label="MST khách hàng" />} />
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