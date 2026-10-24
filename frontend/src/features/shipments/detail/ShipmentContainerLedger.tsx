import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button as AriaButton } from 'react-aria-components';
import { CalendarOff, ChevronDown } from 'lucide-react';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { displayNote } from '../cus/cusUtils';
import { checkContainerNumber } from '../../../components/trip/container-instance-helpers';
import { StatusStrip } from '../../../components/shared/StatusStrip';
import { Badge, BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { TextArea as UUITextArea } from '../../../components/untitled-ui/base/textarea/textarea';
import { SearchableSelect, SummaryRail } from '../../../design-system';
import { UuiSelectField } from '../../../design-system/forms/UuiSelectField';
import { USearchableField } from '../create/uui-fields';
import { externalVendorPlateOptions } from '../external-plate-options';
import { normalizePlate } from '../../dispatch/detailed-plan/DispatchPlanCellValues';
import { updateLclTruck } from '../../../api/dispatchPlanningClient';
import { EditActions } from './ShipmentContainerEditActions';
import { ScheduleEditorBody } from './ShipmentContainerScheduleEditor';
import { directionLabel, fallback, formatScheduleTime } from './shipment-container-ledger-utils';
import { ShipmentMissingFieldsSummary } from './ShipmentMissingFieldsSummary';
import { ShipmentIdentityEditor } from './ShipmentIdentityEditor';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import type { TableSortState } from '../../../lib/table-sort';
import { SortHeader } from '../../../components/shared/SortHeader';
import { NameCell } from '../../../components/shared/NameCell';
import { formatISODate, stripDecimalTrailingZeros } from '../../../lib/format';
import '../../../styles/table-sort.css';
import type { LedgerColumn } from '../../../lib/column-visibility';
import { modeLabelForTrigger, type ShipmentDetailEditMode } from './edit-mode';

export interface ActiveShipmentDetailEdit {
  row: ShipmentCusContainerFlatRow;
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  mode: ShipmentDetailEditMode;
  recoveryMessage?: string;
}

export interface ShipmentRouteDraft {
  routeId: number | null;
  liftSiteId: number | null;
  dropoffSiteId: number | null;
}

export interface ShipmentIdentityDraft {
  operationalSiteId?: number | null;
  factoryName: string | null;
  routeId: number | null;
  deliveryLocation: string | null;
}

export interface ShipmentDocumentsDraft {
  blNumber: string | null;
  bookingRef: string | null;
  tradeDirection: 'IMPORT' | 'EXPORT' | null;
  shippingLineName: string | null;
  /** Card 261013200312: this CONTAINER's tờ khai number — per-cont entry per
   *  the dev-lead ruling. Rides the container-line command on save, never the
   *  shipment PATCH. */
  declarationNumber: string | null;
}

/** Result of a documents save, reported to the hosting page so it can toast.
 *  `sync` is present only when the save carried a non-empty tờ khai update
 *  and the container-line command wrote the number onto at least one OTHER
 *  still-empty container of the lot in the same transaction (card
 *  171026122100 FB-109 — the save IS the auto-copy; there is no second
 *  fan-out call to fail after the fact, and a filled container is never
 *  overwritten). Absent on a clear, a single-container lot, a lot with no
 *  empty sibling, or an identical echo. */
export type ShipmentDocumentsSaveOutcome = {
  sync?: { written: number };
};

export interface ShipmentContainerDraft {
  containerNumber: string | null;
  containerTypeId: number | null;
  cargoWeightKg: string | null;
  cargoVolumeCbm: string | null;
}

export interface ShipmentVehicleDraft {
  carrierType: 'OWN' | 'EXTERNAL';
  externalCarrierId: number | null;
  externalCarrierVehicleId: number | null;
  plateNumber: string | null;
  newExternalCarrier: { name: string; plateNumber: string } | null;
  /** Explicit removal: an emptied plate alone is NOT a clear on EXTERNAL
   *  rows (the service falls back to the carrier vehicle's stored plate). */
  clearVehicle?: boolean;
}

export interface ShipmentScheduleDraft {
  transportDate: string | null;
  customerAppointmentAt: string | null;
}

export interface ShipmentNotesDraft {
  customerNotes: string | null;
  operationalNotes: string | null;
}

type DispatchStatus = ShipmentCusContainerFlatRow['dispatchStatus'];
 
export const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'indigo' | 'purple' | 'success' }> = {
  AWAITING_VEHICLE: { label: 'Chờ phân xe', color: 'warning' },
  PLANNED: { label: 'Đã điều xe', color: 'blue' },
  CREATED: { label: 'Đã tạo chuyến', color: 'indigo' },
  IN_TRANSIT: { label: 'Đang chạy', color: 'purple' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

/* Row markers follow the status-signal contract: semantic tones only, mirroring
   the workboard's StatusStrip lane — the badge column carries the precise
   five-state label. */
const DISPATCH_STRIP_COLORS: Record<DispatchStatus, string> = {
  AWAITING_VEHICLE: 'var(--warning)',
  PLANNED: 'var(--info)',
  CREATED: 'var(--info)',
  IN_TRANSIT: 'var(--info)',
  COMPLETED: 'var(--success)',
};

/* ── Card 161026232339 (DEV SPEC Hàng lẻ §II.3.1) ─────────────────────────
 * A lot-level row (a container-less LCL lot) has no container line, so its
 * THÔNG SỐ CONTAINER and PHÂN XE cells carry the LOT's own billing facts:
 * the chosen cước classes and the two plates Điều vận bills under. Both
 * helpers answer from the row alone — the read model already resolved the
 * class CODES (one batched lookup per page), so no fetch happens here.
 */

/** Bit 1: "Lô hàng lẻ | Thu: Xe 3.5T | Trả: Xe 10T" — the settlement strip's
 *  exact line (DebitLotLclFacts), in the spec's Thu → Trả order. Only the
 *  classes the lot actually bills into appear; a lot with none keeps its own
 *  label rather than echoing a container-less string. */
function lotSpecLine(row: ShipmentCusContainerFlatRow): string {
  const parts = ['Lô hàng lẻ'];
  if (row.revVehicleClassCode) parts.push(`Thu: Xe ${row.revVehicleClassCode}`);
  if (row.costVehicleClassCode) parts.push(`Trả: Xe ${row.costVehicleClassCode}`);
  return parts.join(' | ');
}

function InlineEditor({
  id,
  edit,
  variant,
  onCancel,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
  onSaveIdentity,
  onSaveDocuments,
  onSaveContainer,
  onCopyDeclaration,
  routeOptions,
}: {
  id: string;
  edit: ActiveShipmentDetailEdit;
  /** Card 20261009_3: `sheet` docks the editor to the viewport bottom on
   *  phones (≤640px) — same element, same chrome, only the geometry moves. */
  variant?: 'sheet';
  onCancel: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
  onSaveIdentity: (row: ShipmentCusContainerFlatRow, draft: ShipmentIdentityDraft) => Promise<void>;
  onSaveDocuments: (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => Promise<ShipmentDocumentsSaveOutcome | void>;
  onSaveContainer: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentContainerDraft) => Promise<void>;
  /** Card 261013200312: copy this row's tờ khai number onto the lot's
   *  still-empty containers — returns how many containers were written. */
  onCopyDeclaration: (row: ShipmentCusContainerFlatRow) => Promise<number>;
  routeOptions: Array<{ value: string; label: string; searchText?: string }>;
}) {
  const { detail, line, mode, row } = edit;
  // 2026-09-10: the container/route edit approval flow (REQUEST mode +
  // "gửi yêu cầu để Điều vận xem xét") is removed — edits save directly.
  const [liftSiteId, setLiftSiteId] = useState(line.liftSiteId ? String(line.liftSiteId) : '');
  const [dropoffSiteId, setDropoffSiteId] = useState(line.dropoffSiteId ? String(line.dropoffSiteId) : '');
  const [containerRouteId, setContainerRouteId] = useState(line.routeId ? String(line.routeId) : '');
  const initialCarrier = line.carrierType === 'OWN'
    ? 'OWN'
    : line.externalCarrierId ? String(line.externalCarrierId) : '';
  const [carrierId, setCarrierId] = useState(initialCarrier);
  const [newCarrierName, setNewCarrierName] = useState('');
  const [plateNumber, setPlateNumber] = useState(line.plateNumber ?? '');
  // 20260916_6: an explicit clear action — an emptied plate alone is NOT a
  // clear on EXTERNAL rows (the service falls back to the carrier vehicle's
  // stored plate), so the save must carry the clearVehicle flag.
  const [clearVehicleRequested, setClearVehicleRequested] = useState(false);
  const appointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
  const [appointmentDate, setAppointmentDate] = useState(appointmentInput?.slice(0, 10) ?? '');
  const [scheduleTime, setScheduleTime] = useState(formatScheduleTime(row) ?? '');
  // Non-FCL transport date (shipments.expectedDeliveryDate) — the lot-level
  // schedule field the schedule editor also owns; FCL never edits it (its
  // transport date derives from the container appointments).
  const [transportDate, setTransportDate] = useState(row.transportDate ?? '');
  const [customerNotes, setCustomerNotes] = useState(row.customerNotes ?? '');
  const [operationalNotes, setOperationalNotes] = useState(row.operationalNotes ?? '');
  const [factoryName, setFactoryName] = useState(detail.summary.raw.factoryName ?? '');
  const [operationalSiteId, setOperationalSiteId] = useState(line.operationalSiteId ? String(line.operationalSiteId) : '');
  const [routeId, setRouteId] = useState(detail.summary.raw.routeId ? String(detail.summary.raw.routeId) : '');
  const [deliveryLocation, setDeliveryLocation] = useState(detail.summary.raw.deliveryLocation ?? '');
  const [blNumber, setBlNumber] = useState(detail.summary.raw.blNumber ?? '');
  const [bookingRef, setBookingRef] = useState(detail.summary.raw.bookingRef ?? '');
  const [tradeDirection, setTradeDirection] = useState(detail.summary.raw.tradeDirection ?? '');
  const [shippingLineName, setShippingLineName] = useState(detail.summary.raw.shippingLineName ?? '');
  // Card 261013200312: THIS container's tờ khai (per-cont entry; the flat row
  // carries the container's own number). The version-keyed remount reseeds
  // after a conflict recovery.
  const [declarationNumber, setDeclarationNumber] = useState(row.declarationNumber ?? '');
  const declarationAccess = detail.summary.fieldAccess.declarationNumber;
  // Copy affordance targets: siblings of the same lot still without a number.
  const emptyDeclarationSiblingCount = detail.containers.filter((candidate) => (
    candidate.id !== line.id && !(candidate.declarationNumber ?? '').trim()
  )).length;
  const [copyingDeclaration, setCopyingDeclaration] = useState(false);
  const [containerNumber, setContainerNumber] = useState(line.raw.containerNumber ?? '');
  // Card 261022095235b: live ISO 6346 pre-check for the số cont editor — the
  // same shared hint + one-tap correction the drawer's add row shows.
  const containerNumberHint = checkContainerNumber(containerNumber);
  const [containerTypeId, setContainerTypeId] = useState(line.raw.containerTypeId ? String(line.raw.containerTypeId) : '');
  const [cargoWeightKg, setCargoWeightKg] = useState(stripDecimalTrailingZeros(line.raw.cargoWeightKg));
  const [cargoVolumeCbm, setCargoVolumeCbm] = useState(line.raw.cargoVolumeCbm ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  // Outside pointerdown / global Escape dismisses the editor, matching the CUS
  // appointment popover; paused while a portaled select popover (SearchableSelect
  // / UuiSelectField) is open so picking an option never cancels the draft.
  useClickOutside(editorRef, () => {
    if (!saving) onCancel();
  }, {
    escapeKey: true,
    ignoreSelector: '.searchable-select__popover, .searchable-select__backdrop, .react-aria-Popover, [data-time-picker-overlay], .time-picker__popup, [data-date-picker]',
  });
  const siteOptions = useMemo(() => detail.selectors.ports.map((port) => ({
    value: String(port.id), label: port.label, searchText: `${port.code ?? ''} ${port.name}`,
  })), [detail.selectors.ports]);
  const carrierOptions = useMemo(() => [
    { value: 'OWN', label: 'Đội xe SilverSea', searchText: 'đội xe nội bộ silversea' },
    ...detail.selectors.externalCarriers.map((carrier) => ({
      value: String(carrier.id), label: carrier.label, searchText: `${carrier.name} ${carrier.shortName ?? ''}`,
    })),
    { value: 'NEW_EXTERNAL', label: 'Nhập nhà xe mới', searchText: 'nhà xe mới' },
  ], [detail.selectors.externalCarriers]);
  const vehicleOptions = useMemo(() => detail.selectors.carrierVehicles
    .filter((vehicle) => vehicle.carrierId === Number(carrierId))
    .map((vehicle) => ({ value: String(vehicle.id), label: vehicle.label, searchText: vehicle.licensePlate })),
  [carrierId, detail.selectors.carrierVehicles]);
  // Card 20260925_6: on the new-external-vendor path the typed name selects
  // the quick-select source — plates already used with THAT vendor (matched
  // by name or short name), restored after 16fc0d89 dropped the field.
  const newVendorPlateOptions = useMemo(
    () => externalVendorPlateOptions(detail.selectors.externalCarriers, detail.selectors.carrierVehicles, newCarrierName),
    [detail.selectors.externalCarriers, detail.selectors.carrierVehicles, newCarrierName],
  );
  const matchedVehicle = detail.selectors.carrierVehicles.find((vehicle) => (
    vehicle.carrierId === Number(carrierId)
    && vehicle.licensePlate.localeCompare(plateNumber.trim(), 'vi', { sensitivity: 'base' }) === 0
  ));
  const appointmentScheduleDirty = appointmentDate !== (appointmentInput?.slice(0, 10) ?? '')
    || scheduleTime !== (formatScheduleTime(row) ?? '');
  const dirty = mode === 'identity'
    ? detail.summary.cargoMode === 'FCL'
      ? operationalSiteId !== (line.operationalSiteId ? String(line.operationalSiteId) : '')
      : factoryName.trim() !== (detail.summary.raw.factoryName ?? '')
      || routeId !== (detail.summary.raw.routeId ? String(detail.summary.raw.routeId) : '')
      || deliveryLocation.trim() !== (detail.summary.raw.deliveryLocation ?? '')
    : mode === 'documents'
      ? blNumber.trim() !== (detail.summary.raw.blNumber ?? '')
        || bookingRef.trim() !== (detail.summary.raw.bookingRef ?? '')
        || tradeDirection !== (detail.summary.raw.tradeDirection ?? '')
        || shippingLineName.trim() !== (detail.summary.raw.shippingLineName ?? '')
        || declarationNumber.trim() !== (row.declarationNumber ?? '').trim()
    : mode === 'container'
      ? containerNumber.trim() !== (line.raw.containerNumber ?? '')
        || containerTypeId !== (line.raw.containerTypeId ? String(line.raw.containerTypeId) : '')
        || cargoWeightKg.trim() !== (line.raw.cargoWeightKg ?? '')
        || cargoVolumeCbm.trim() !== (line.raw.cargoVolumeCbm ?? '')
    : mode === 'route'
    ? containerRouteId !== (line.routeId ? String(line.routeId) : '')
      || liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')
      || dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')
    : mode === 'vehicle'
      ? carrierId !== initialCarrier || plateNumber.trim() !== (line.plateNumber ?? '') || newCarrierName.trim() !== ''
    : mode === 'schedule'
        ? appointmentScheduleDirty || transportDate !== (row.transportDate ?? '')
        : customerNotes.trim() !== (row.customerNotes ?? '').trim()
          || operationalNotes.trim() !== (row.operationalNotes ?? '').trim();
  const modeLabel = mode === 'identity' ? 'khách hàng và lộ trình'
    : mode === 'documents' ? 'chứng từ và hãng tàu'
      : mode === 'container' ? 'thông số container'
        : mode === 'route' ? 'hành trình'
          : mode === 'vehicle' ? 'phân xe'
            : mode === 'schedule' ? 'lịch trình'
              : 'ghi chú';
  const label = `${modeLabel} ${row.containerNumber || `container số ${row.ordinal}`}`;

  // Focus silently on mount: the browser's focusing steps would otherwise
  // scroll the expanded editor (330–400px tall) fully into view and yank the
  // tapped cell away from the user's finger (report 2026-09-19). The editor
  // opens directly under the tapped cell, so its leading edge is already in
  // view; anything past the fold is reached by natural scrolling.
  useEffect(() => {
    editorRef.current?.focus({ preventScroll: true });
  }, []);

  const save = async () => {
    const invalidInput = Array.from(editorRef.current?.querySelectorAll<HTMLInputElement>('input') ?? [])
      .find((input) => !input.validity.valid);
    if (invalidInput) {
      setSaveError(invalidInput.validationMessage || 'Kiểm tra thông tin chưa hợp lệ trước khi lưu.');
      invalidInput.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (mode === 'identity') {
        await onSaveIdentity(row, {
          operationalSiteId: operationalSiteId ? Number(operationalSiteId) : null,
          factoryName: factoryName.trim() || null,
          routeId: routeId ? Number(routeId) : null,
          deliveryLocation: deliveryLocation.trim() || null,
        });
      } else if (mode === 'documents') {
        await onSaveDocuments(row, {
          blNumber: tradeDirection === 'EXPORT' ? null : blNumber.trim() || null,
          bookingRef: tradeDirection === 'IMPORT' ? null : bookingRef.trim() || null,
          tradeDirection: tradeDirection === 'IMPORT' || tradeDirection === 'EXPORT' ? tradeDirection : null,
          shippingLineName: shippingLineName.trim() || null,
          declarationNumber: declarationNumber.trim() || null,
        });
      } else if (mode === 'container') {
        await onSaveContainer(line, {
          containerNumber: containerNumber.trim().toUpperCase() || null,
          containerTypeId: containerTypeId ? Number(containerTypeId) : null,
          cargoWeightKg: cargoWeightKg.trim() || null,
          cargoVolumeCbm: cargoVolumeCbm.trim() || null,
        });
      } else if (mode === 'route') {
        await onSaveRoute(line, {
          routeId: containerRouteId ? Number(containerRouteId) : null,
          liftSiteId: liftSiteId ? Number(liftSiteId) : null,
          dropoffSiteId: dropoffSiteId ? Number(dropoffSiteId) : null,
        });
      } else if (mode === 'vehicle') {
        if (carrierId === 'OWN') {
          await onSaveVehicle(line, {
            carrierType: 'OWN',
            externalCarrierId: null,
            externalCarrierVehicleId: null,
            plateNumber: plateNumber.trim() || null,
            newExternalCarrier: null,
          });
          return;
        }
        if (carrierId === 'NEW_EXTERNAL' && (!newCarrierName.trim() || !plateNumber.trim())) {
          throw new Error('Nhập đủ tên nhà xe mới và biển số xe.');
        }
        if (!carrierId) throw new Error('Chọn nhà xe trước khi lưu.');
        if (clearVehicleRequested) {
          // The explicit clear beats any draft plate text: the user asked to
          // remove the assignment, so drop the vehicle selection too.
          await onSaveVehicle(line, {
            carrierType: 'EXTERNAL',
            externalCarrierId: carrierId === 'NEW_EXTERNAL' ? null : Number(carrierId),
            externalCarrierVehicleId: null,
            plateNumber: null,
            newExternalCarrier: null,
            clearVehicle: true,
          });
          return;
        }
        await onSaveVehicle(line, {
          carrierType: 'EXTERNAL',
          externalCarrierId: carrierId === 'NEW_EXTERNAL' ? null : Number(carrierId),
          externalCarrierVehicleId: matchedVehicle?.id ?? null,
          plateNumber: plateNumber.trim() || null,
          newExternalCarrier: carrierId === 'NEW_EXTERNAL'
            ? { name: newCarrierName.trim(), plateNumber: plateNumber.trim() }
            : null,
        });
      } else if (mode === 'schedule') {
        if (scheduleTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) throw new Error('Nhập giờ từ 00:00 đến 23:59 (HH:mm).');
        if (scheduleTime && !appointmentDate) throw new Error('Chọn ngày đóng/trả trước khi nhập giờ.');
        if (appointmentDate && !scheduleTime) throw new Error('Vui lòng nhập đầy đủ cả Ngày và Giờ giao hàng.');
        await onSaveSchedule(line, row, {
          transportDate: transportDate || null,
          customerAppointmentAt: appointmentDate ? `${appointmentDate}T${scheduleTime || '12:00'}` : null,
        });
      } else {
        await onSaveNotes(row, {
          customerNotes: customerNotes.trim() || null,
          operationalNotes: operationalNotes.trim() || null,
        });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Không thể lưu thay đổi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      id={id}
      ref={editorRef}
      className={`shipment-container-ledger__inline-editor${variant === 'sheet' ? ' shipment-container-ledger__inline-editor--sheet' : ''}`}
      data-mode={mode}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if ((event.target as HTMLElement).closest('[data-date-picker], .time-picker__popup, [data-time-picker-overlay]')) return;
        if (event.key === 'Escape' && !saving) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !dirty || saving) return;
        const target = event.target as HTMLElement;
        if (target.isContentEditable || target.tagName === 'SELECT' || target.tagName === 'BUTTON' || target.closest('.searchable-select, [role="listbox"], [role="option"]')) return;
        // Multiline notes: bare Enter inserts a newline; the modified
        // Enter combo (Ctrl+Enter / Cmd+Enter) is what saves instead.
        if (target.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
        if (event.shiftKey) return;
        event.preventDefault();
        void save();
      }}
    >
      {mode === 'schedule' ? (
        <ScheduleEditorBody
          row={row}
          appointmentDate={appointmentDate}
          scheduleTime={scheduleTime}
          saving={saving}
          canEdit={line.permissions.customerAppointmentEditable}
          onAppointmentDateChange={setAppointmentDate}
          onScheduleTimeChange={setScheduleTime}
          onClose={onCancel}
          cargoMode={detail.summary.cargoMode}
          transportDate={transportDate}
          canEditTransport={row.shipmentScheduleEditable}
          onTransportDateChange={setTransportDate}
        />
      ) : (
        <div className="shipment-container-ledger__editor-heading">
          <strong>Chỉnh sửa {modeLabel}</strong>
          <span>{row.containerNumber || `Container số ${row.ordinal}`}</span>
        </div>
      )}
      {mode === 'identity' && (
        <ShipmentIdentityEditor detail={detail} line={line} customerName={row.customerName} currentFactoryName={row.factoryName} saving={saving}
          factoryName={factoryName} setFactoryName={setFactoryName} operationalSiteId={operationalSiteId} setOperationalSiteId={setOperationalSiteId}
          routeId={routeId} setRouteId={setRouteId} deliveryLocation={deliveryLocation} setDeliveryLocation={setDeliveryLocation} routeOptions={routeOptions} />
      )}
      {mode === 'documents' && (
        <div className="shipment-container-ledger__editor-grid">
          {/* Card 171026122140 (FB-113): the operator asked for the four
              document fields in the order Số Bill/Số Booking → Số tờ khai →
              Nhập/Xuất → Hãng tàu, so the reference number now leads and the
              direction select moved below the declaration. */}
          {tradeDirection === 'IMPORT' && <label><span>Số Bill</span><input value={blNumber} onChange={(event) => setBlNumber(event.target.value)} maxLength={100} disabled={saving || detail.summary.fieldAccess.blNumber.mode === 'READ_ONLY'} /></label>}
          {tradeDirection === 'EXPORT' && <label><span>Số Booking</span><input value={bookingRef} onChange={(event) => setBookingRef(event.target.value)} maxLength={100} disabled={saving || detail.summary.fieldAccess.bookingRef.mode === 'READ_ONLY'} /></label>}
          {!tradeDirection && <small>Chọn Nhập hoặc Xuất trước khi cập nhật số chứng từ.</small>}
          {/* Card 261013200312 (dev-lead ruling): số tờ khai nhập theo TỪNG
              CONT — entered and edited right here, no tab-out to another
              surface. Entering the lot's FIRST declaration auto-copies it
              onto the still-empty siblings (tickets 141026201700 / FB-085 /
              131026200630), and the explicit copy button (the ruling's
              "(hoặc nút copy)" option) repeats the same one-call fan-out on
              demand; never overwrites, so divergence stays possible
              afterwards. Mirrors the reviewed appointment-copy affordance on
              the sibling CUS drawer. */}
          <label><span>Số tờ khai</span><input value={declarationNumber} onChange={(event) => setDeclarationNumber(event.target.value)} maxLength={50} disabled={saving || declarationAccess.mode === 'READ_ONLY'} title={declarationAccess.mode === 'READ_ONLY' ? declarationAccess.reason : undefined} /></label>
          {/* Review M2 (card 261013200312): the server copies the PERSISTED
              number, so the button only shows when the input still matches it
              — a retyped-but-unsaved value must never look copyable (the copy
              would silently fan out the old number). */}
          {declarationNumber.trim() === (row.declarationNumber ?? '').trim() && declarationNumber.trim() && emptyDeclarationSiblingCount > 0 && declarationAccess.mode !== 'READ_ONLY' && (
            <div className="shipment-container-ledger__declaration-copy">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving || copyingDeclaration}
                onClick={() => {
                  setCopyingDeclaration(true);
                  void onCopyDeclaration(row).finally(() => setCopyingDeclaration(false));
                }}
              >
                {copyingDeclaration ? 'Đang copy…' : `Copy số tờ khai sang ${emptyDeclarationSiblingCount} cont chưa có số`}
              </button>
            </div>
          )}
          <small>Số tờ khai lưu theo từng container của lô; nhập số trên một container sẽ tự copy sang các container còn trống của lô — container đã có số không bị ghi đè; xóa số chỉ áp cho container đang sửa.</small>
          {/* Card 171026122140 (FB-113): positions 3 and 4 of the requested
              order. The direction select keeps its handler verbatim — it still
              owns the Bill-vs-Booking switch and clears the other side. */}
          <label><span>Nhập / Xuất</span><UuiSelectField
            label="Nhập / Xuất"
            hideLabel
            value={tradeDirection}
            onChange={(event) => {
              const direction = event.target.value;
              setTradeDirection(direction);
              if (direction === 'IMPORT') setBookingRef('');
              if (direction === 'EXPORT') setBlNumber('');
            }}
            disabled={saving || detail.summary.fieldAccess.tradeDirection.mode === 'READ_ONLY'}
            options={[
              { value: '', label: 'Chưa xác định' },
              { value: 'IMPORT', label: 'Nhập' },
              { value: 'EXPORT', label: 'Xuất' },
            ]}
          /></label>
          <label><span>Hãng tàu</span><input value={shippingLineName} onChange={(event) => setShippingLineName(event.target.value)} maxLength={255} disabled={saving || detail.summary.fieldAccess.shippingLineName.mode === 'READ_ONLY'} /></label>
        </div>
      )}
      {mode === 'container' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Số container</span><input value={containerNumber} onChange={(event) => setContainerNumber(event.target.value.toUpperCase())} maxLength={20} disabled={saving || line.fieldAccess.containerNumber.mode === 'READ_ONLY'} /></label>
          {/* Card 261022095235b: the SAME live ISO 6346 pre-check + one-tap
              correction the drawer's add row shows (card 191026100000) — a
              mistyped "đổi số cont" used to dead-end at the server's 400 with
              no way to fix the check digit. Informational only; the save
              still rides the server's strict gate. */}
          {containerNumberHint.warning && (
            <div className="shipment-container-ledger__number-hint" role="note">
              <span>{containerNumberHint.warning}</span>
              {containerNumberHint.suggestion && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => setContainerNumber(containerNumberHint.suggestion!)}
                >
                  Đổi thành {containerNumberHint.suggestion}
                </button>
              )}
            </div>
          )}
          <label><span>Loại container</span><SearchableSelect id={`shipment-detail-container-type-${line.id}`} value={containerTypeId} onChange={setContainerTypeId} options={detail.selectors.containerTypes.map((item) => ({ value: String(item.id), label: item.label, searchText: `${item.code} ${item.name}` }))} placeholder="Chọn loại container" searchPlaceholder="Tìm loại container" disabled={saving || line.fieldAccess.containerTypeId.mode === 'READ_ONLY'} /></label>
          <label><span>Trọng lượng (kg)</span><input type="number" min="0" step="0.01" value={cargoWeightKg} onChange={(event) => setCargoWeightKg(event.target.value)} disabled={saving || line.fieldAccess.cargoWeightKg.mode === 'READ_ONLY'} /></label>
          <label><span>Thể tích (CBM)</span><input type="number" min="0" step="0.001" value={cargoVolumeCbm} onChange={(event) => setCargoVolumeCbm(event.target.value)} disabled={saving || line.fieldAccess.cargoVolumeCbm.mode === 'READ_ONLY'} /></label>
        </div>
      )}
      {mode === 'route' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Tuyến đường</span><SearchableSelect id={`shipment-detail-container-route-${line.id}`} value={containerRouteId} onChange={setContainerRouteId} options={routeOptions} placeholder="Chọn tuyến đường" searchPlaceholder="Tìm tuyến đường" disabled={saving || line.fieldAccess.routeId.mode === 'READ_ONLY'} /></label>
          <label><span>Cảng nâng</span><SearchableSelect id={`shipment-detail-lift-${line.id}`} value={liftSiteId} onChange={setLiftSiteId} options={siteOptions} placeholder="Chọn cảng nâng" searchPlaceholder="Tìm cảng nâng" disabled={saving || line.fieldAccess.liftSiteId.mode === 'READ_ONLY'} /></label>
          <label><span>Cảng hạ</span><SearchableSelect id={`shipment-detail-dropoff-${line.id}`} value={dropoffSiteId} onChange={setDropoffSiteId} options={siteOptions} placeholder="Chọn cảng hạ" searchPlaceholder="Tìm cảng hạ" disabled={saving || line.fieldAccess.dropoffSiteId.mode === 'READ_ONLY'} /></label>
        </div>
      )}
      {mode === 'vehicle' && (
        <div className="shipment-container-ledger__editor-grid">
          <label><span>Nhà xe</span><SearchableSelect id={`shipment-detail-carrier-${line.id}`} value={carrierId} onChange={(value) => { setCarrierId(value); setPlateNumber(''); }} options={carrierOptions} placeholder="Chọn nhà xe" searchPlaceholder="Tìm nhà xe" disabled={saving || !line.permissions.carrierEditable} /></label>
          {carrierId === 'NEW_EXTERNAL' && <label><span>Tên nhà xe mới</span><input value={newCarrierName} onChange={(event) => setNewCarrierName(event.target.value)} maxLength={255} disabled={saving} /></label>}
          {carrierId && carrierId !== 'NEW_EXTERNAL' && <label><span>Biển số xe</span><USearchableField id={`shipment-detail-vehicle-${line.id}`} label="Biển số xe" hideLabel value={plateNumber} onChange={(plate) => setPlateNumber(plate.toUpperCase())} onCustomValue={(text) => setPlateNumber(text.toUpperCase().slice(0, 20))} options={vehicleOptions.map((vehicle) => ({ value: vehicle.label, label: vehicle.label, searchText: vehicle.searchText }))} placeholder="Chọn hoặc nhập biển số" disabled={saving || !line.permissions.plateEditable} allowsCustomValue searchable /></label>}
          {carrierId === 'NEW_EXTERNAL' && <label><span>Biển số xe</span><USearchableField id={`shipment-detail-vehicle-new-${line.id}`} label="Biển số xe" hideLabel value={plateNumber} onChange={(plate) => setPlateNumber(plate.toUpperCase())} onCustomValue={(text) => setPlateNumber(text.toUpperCase().slice(0, 20))} options={newVendorPlateOptions} placeholder="Chọn hoặc nhập biển số" disabled={saving || !line.permissions.plateEditable} allowsCustomValue searchable /></label>}
          {carrierId && carrierId !== 'NEW_EXTERNAL' && line.plateNumber && line.permissions.plateEditable && (
            <small className="shipment-container-ledger__plate-clear">
              <button type="button" disabled={saving} onClick={() => { setPlateNumber(''); setClearVehicleRequested(true); }}>Xóa biển số</button>
            </small>
          )}
          {carrierId === 'OWN' && <small data-testid="plate-plan-note">Biển số ở đây là kế hoạch; lệnh điều xe là nguồn xác nhận cuối.</small>}
          {carrierId !== 'OWN' && carrierId && <small>Biển số ở đây là kế hoạch; lệnh điều xe là nguồn xác nhận cuối.</small>}
        </div>
      )}
      {mode === 'notes' && (
        <div className="shipment-container-ledger__editor-grid">
          <UUITextArea label="Ghi chú cho khách hàng" size="sm" rows={2} maxLength={2000} value={customerNotes} onChange={setCustomerNotes} isDisabled={saving} />
          <UUITextArea label="Ghi chú cho lái xe" size="sm" rows={2} maxLength={2000} value={operationalNotes} onChange={setOperationalNotes} isDisabled={saving} />
          <small>Thay đổi áp dụng cho toàn bộ container trong lô hàng này.</small>
        </div>
      )}
      <div className="shipment-container-ledger__editor-footer">
        {mode === 'schedule' ? (
          (appointmentDate || scheduleTime) ? (
            <button
              type="button"
              className="shipment-container-ledger__schedule-clear"
              onClick={() => {
                setAppointmentDate('');
                setScheduleTime('');
              }}
              title="Xóa giờ hẹn đã chọn, nhấn Lưu để áp dụng"
            >
              Xóa hẹn
            </button>
          ) : <span aria-hidden="true" />
        ) : (
          <span className="shipment-container-ledger__keyboard-hint">Enter để lưu · Esc để hủy</span>
        )}
        <EditActions saving={saving} saveDisabled={!dirty || (mode === 'schedule' && appointmentScheduleDirty && ((!!appointmentDate && !scheduleTime) || (!appointmentDate && !!scheduleTime)))} label={label} onSave={() => void save()} onCancel={onCancel} />
      </div>
      {edit.recoveryMessage && <span className="shipment-container-ledger__recovery" role="status">{edit.recoveryMessage}</span>}
      {saveError && <span className="shipment-container-ledger__edit-error" role="alert">{saveError}</span>}
    </div>
  );
}

/**
 * The ledger's columns in table order (card 20260928_193). The ledger owns the
 * keys because it owns the cells they name; the page reads this list to build the
 * picker, so the two can never disagree about what exists.
 *
 * Pins follow card 20260917_4's own contract — the THREE identity columns
 * (khách hàng, chứng từ, thông số container) cannot hide, because a container row
 * scrolled out of its own context is unreadable. `notes` carries the same
 * auto-hide rule as the workboard: hidden by default only while every rendered
 * row's note cell is empty.
 */
export const LEDGER_COLUMNS: readonly LedgerColumn[] = [
  { key: 'customer', label: 'Khách hàng & lộ trình', pinned: true },
  { key: 'documents', label: 'Chứng từ & hãng tàu', pinned: true },
  { key: 'container', label: 'Thông số container', pinned: true },
  { key: 'route', label: 'Nâng / hạ' },
  { key: 'schedule', label: 'Lịch trình' },
  { key: 'vehicle', label: 'Phân xe' },
  { key: 'notes', label: 'Ghi chú', autoHideWhenEmpty: true },
  { key: 'status', label: 'Trạng thái' },
];

interface ShipmentContainerLedgerProps {
  rows: ShipmentCusContainerFlatRow[];
  totalContainers: number;
  today: string;
  footer?: ReactNode;
  sort: TableSortState | null;
  onSortChange: (key: string) => void;
  activeEdit: ActiveShipmentDetailEdit | null;
  editLoadingRowId: number | null;
  editError: { rowId: number; message: string } | null;
  onStartEdit: (row: ShipmentCusContainerFlatRow, mode: ShipmentDetailEditMode, triggerId: string) => void;
  onCancelEdit: () => void;
  onSaveRoute: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentRouteDraft) => Promise<void>;
  onSaveVehicle: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentVehicleDraft) => Promise<void>;
  onSaveSchedule: (line: ShipmentCusWorkspaceContainerLine, row: ShipmentCusContainerFlatRow, draft: ShipmentScheduleDraft) => Promise<void>;
  onSaveNotes: (row: ShipmentCusContainerFlatRow, draft: ShipmentNotesDraft) => Promise<void>;
  onSaveIdentity: (row: ShipmentCusContainerFlatRow, draft: ShipmentIdentityDraft) => Promise<void>;
  onSaveDocuments: (row: ShipmentCusContainerFlatRow, draft: ShipmentDocumentsDraft) => Promise<ShipmentDocumentsSaveOutcome | void>;
  onSaveContainer: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentContainerDraft) => Promise<void>;
  /**
   * Copy this row's appointment onto every container line of ITS OWN lot that
   * is still without one — one server call for the whole lot, never a per-row
   * write loop. Resolves with the number of lines actually written.
   */
  onCopyAppointment?: (row: ShipmentCusContainerFlatRow) => Promise<number>;
  /** Card 261013200312: copy this row's tờ khai number onto the lot's
   *  still-empty containers — one server call, never overwrites; resolves with
   *  the number of containers actually written. */
  onCopyDeclaration?: (row: ShipmentCusContainerFlatRow) => Promise<number>;
  /**
   * Column keys the picker on the page's filter bar is hiding (card
   * 20260928_193, restoring 20260917_4). The ledger renders `col`/`th`/`td`
   * conditionally so a `table-layout: fixed` table never shows ghost columns.
   * Pinned columns are enforced upstream, at the resolver — a hidden key for an
   * identity column is dropped before it reaches here.
   */
  hiddenColumns?: readonly string[];
}

export function ShipmentContainerLedger({
  rows,
  totalContainers,
  today,
  footer,
  sort,
  onSortChange,
  activeEdit,
  editLoadingRowId,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveRoute,
  onSaveVehicle,
  onSaveSchedule,
  onSaveNotes,
  onSaveIdentity,
  onSaveDocuments,
  onSaveContainer,
  onCopyAppointment,
  onCopyDeclaration,
  hiddenColumns = [],
}: ShipmentContainerLedgerProps) {
  const isHidden = (key: string) => hiddenColumns.includes(key);
  const missingDateCount = rows.filter((row) => row.transportDate == null).length;
  const [copyingRowId, setCopyingRowId] = useState<number | null>(null);
  // SIL-149 phase 2 (consultation tie-breaker 24/10): phone rows collapse the
  // four low-frequency cells behind a per-row expander. Default COLLAPSED;
  // expanded ids ride component state keyed by row id, so pagination/filter
  // rerenders never leak one row's expansion into another.
  const [expandedRowIds, setExpandedRowIds] = useState<ReadonlySet<number>>(() => new Set());
  const toggleRowDetails = (rowId: number) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  // The workboard is MULTI-LOT, so "still empty" is counted PER LOT: a copy on
  // one row only ever fills its own lot's rows and can never touch a
  // neighbouring lot sharing the page. Counted over the LOADED page (this
  // ledger is paginated) — a lot whose empty rows sit on another page offers
  // no affordance, the honest limit of a page-scoped read; the write itself is
  // whole-lot and reports the real number back.
  const emptyByLot = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.customerAppointmentAt == null) counts.set(row.shipmentId, (counts.get(row.shipmentId) ?? 0) + 1);
    }
    return counts;
  }, [rows]);
  const canCopyFrom = (row: ShipmentCusContainerFlatRow) => (
    row.customerAppointmentAt != null && (emptyByLot.get(row.shipmentId) ?? 0) > 0
  );
  // Card 171026182554: thêm/xóa container rời khỏi màn Chi tiết (chỉ còn ở
  // drawer Tổng quan), nên cột Thao tác chỉ còn lý do tồn tại khi có dòng
  // đủ điều Copy giờ hẹn.
  const hasRowActions = onCopyAppointment != null && activeEdit == null && rows.some(canCopyFrom);

  // ── Card 161026232339 — the lot rows' BKS báo khách quick edit. ──────────
  // A lot-level row owns no container line, so no edit mode can carry this
  // write: the ledger calls the same endpoint the settlement strip uses
  // (`updateLclTruck`) and holds the saved plate as an optimistic overlay until
  // the page refetches its rows. The overlay is self-healing — the moment the
  // row carries a different value the server is authoritative again.
  const [billingEditorForRowId, setBillingEditorForRowId] = useState<number | null>(null);
  const [billingDraft, setBillingDraft] = useState('');
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingOverrides, setBillingOverrides] = useState<Record<number, { base: string; saved: string }>>({});
  /** Override-aware BKS báo khách — the three call sites (cell render, editor
   *  seed, save baseline) must agree, so the resolution lives here once. */
  function billingPlateFor(row: ShipmentCusContainerFlatRow): string {
    const server = row.billingTruckNo?.trim() ?? '';
    const override = billingOverrides[row.shipmentId];
    return override && server === override.base ? override.saved : server;
  }
  const plateSuggestions = useMemo(() => {
    const plates = new Set<string>();
    for (const row of rows) {
      for (const plate of [row.plateNumber, row.actualTruckNo, row.billingTruckNo]) {
        if (plate?.trim()) plates.add(plate.trim());
      }
    }
    for (const override of Object.values(billingOverrides)) plates.add(override.saved);
    return [...plates].map((plate) => ({ value: plate, label: plate, searchText: plate }));
  }, [rows, billingOverrides]);

  function openBillingEditor(row: ShipmentCusContainerFlatRow) {
    setBillingEditorForRowId(row.id);
    setBillingDraft(billingPlateFor(row));
    setBillingError(null);
  }

  async function saveBillingPlate(row: ShipmentCusContainerFlatRow) {
    const base = billingPlateFor(row);
    const next = billingDraft.trim();
    // The wire contract forbids an empty plate (`truckNo` = trim().min(1)) —
    // clearing the ảo plate is a settlement-screen action, never a row edit.
    if (next === '' || next === base) {
      setBillingEditorForRowId(null);
      return;
    }
    setBillingSaving(true);
    setBillingError(null);
    try {
      await updateLclTruck({ shipmentId: row.shipmentId, billingTruckNo: next });
      setBillingOverrides((prev) => ({ ...prev, [row.shipmentId]: { base, saved: next } }));
      setBillingEditorForRowId(null);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : 'Cập nhật BKS báo khách thất bại');
    } finally {
      setBillingSaving(false);
    }
  }

  // Card 171026000407 §II.3.1: the BKS báo khách quick edit renders from one
  // place for BOTH branches (Hàng lẻ always, container rows when the ảo plate
  // differs from BKS thực), so the two can never drift.
  function billingPlateEditor(row: ShipmentCusContainerFlatRow) {
    return (
      <div className="shipment-container-ledger__inline-editor">
        <div className="shipment-container-ledger__editor-grid">
          <USearchableField
            label="BKS báo khách (Ảo)"
            value={billingDraft}
            onChange={setBillingDraft}
            onCustomValue={setBillingDraft}
            options={plateSuggestions}
            placeholder="Chọn hoặc nhập BKS"
            allowsCustomValue
            searchable
            disabled={billingSaving}
          />
        </div>
        <div className="shipment-container-ledger__editor-footer">
          {billingError
            ? <span className="shipment-container-ledger__edit-error" role="alert">{billingError}</span>
            : <small>BKS báo khách là biển số in cho khách (xe ảo).</small>}
          <EditActions
            saving={billingSaving}
            saveDisabled={billingDraft.trim() === ''}
            label="BKS báo khách"
            onCancel={() => setBillingEditorForRowId(null)}
            onSave={() => void saveBillingPlate(row)}
          />
        </div>
      </div>
    );
  }

  function billingPlateTrigger(row: ShipmentCusContainerFlatRow, plate: string) {
    return (
      <button
        type="button"
        className="shipment-container-ledger__plate"
        title="Sửa BKS báo khách"
        onClick={() => openBillingEditor(row)}
      >{`BKS Báo khách (Ảo): ${plate}`}</button>
    );
  }

  // The parent owns feedback (it owns the toast surface for this page); the
  // ledger owns only the busy state, so it stays presentational.
  async function submitCopyAppointment(row: ShipmentCusContainerFlatRow) {
    if (!onCopyAppointment || copyingRowId != null) return;
    setCopyingRowId(row.id);
    try {
      await onCopyAppointment(row);
    } finally {
      setCopyingRowId(null);
    }
  }

  /* FB-109 v2 (QA 18/10): the ledger's documents cells were click-to-edit
   * only, which QA could not discover — "không có nút sửa inline". Every
   * container row now carries an always-visible Sửa button in the Số tờ khai
   * column that opens the SAME documents editor the cell click opens. It is
   * rendered by `editableCell` as a sibling of the trigger (nested buttons
   * are invalid HTML) and shares the row's canonical documents trigger id so
   * the post-save focus restore lands back on this cell. */
  const declarationEditAction = (row: ShipmentCusContainerFlatRow) => (
    <button
      type="button"
      className="btn btn--secondary btn--sm shipment-container-ledger__declaration-edit"
      aria-label={`Sửa tờ khai container ${row.containerNumber || `số ${row.ordinal}`}`}
      title="Sửa chứng từ và hãng tàu của container này"
      disabled={editLoadingRowId === row.id || activeEdit != null}
      onClick={() => onStartEdit(row, 'documents', `shipment-detail-edit-documents-${row.id}`)}
    >Sửa</button>
  );

  const missingVehicleTodayCount = rows.filter((row) => row.transportDate === today && (!row.carrierName || !row.plateNumber)).length;
  // Card 20261009_3: at ≤640px every inline editor docks to the viewport as a
  // bottom sheet over a dimmed scrim. It must portal out of the page — the
  // page's `container-type: inline-size` makes `.shipments-detail-page` the
  // containing block for position:fixed descendants, so an in-tree sheet
  // would anchor to the scrolling page box instead of the viewport. Outside
  // the phone band the editor stays anchored under its cell (unchanged).
  const isPhoneSheet = useMediaQuery('(max-width: 640px)');
  const renderInlineEditor = (edit: ActiveShipmentDetailEdit, editorId: string) => {
    const editor = (
      <InlineEditor
        key={`${edit.mode}-${edit.detail.summary.version}-${edit.line.shipmentVersion}`}
        id={editorId}
        edit={edit}
        variant={isPhoneSheet ? 'sheet' : undefined}
        onCancel={onCancelEdit}
        onSaveIdentity={onSaveIdentity}
        onSaveDocuments={onSaveDocuments}
        onSaveContainer={onSaveContainer}
        onSaveRoute={onSaveRoute}
        onSaveVehicle={onSaveVehicle}
        onSaveSchedule={onSaveSchedule}
        onSaveNotes={onSaveNotes}
        onCopyDeclaration={onCopyDeclaration ?? (async () => 0)}
        routeOptions={edit.detail.selectors.routes.map((item) => ({ value: String(item.id), label: item.label, searchText: item.name }))}
      />
    );
    if (!isPhoneSheet) return editor;
    return createPortal(
      <>
        <div className="shipment-container-ledger__sheet-backdrop" aria-hidden="true" />
        {editor}
      </>,
      document.body,
    );
  };
  const editableCell = (
    row: ShipmentCusContainerFlatRow,
    mode: ShipmentDetailEditMode,
    enabled: boolean,
    children: ReactNode,
    options: {
      /** FB-113 v2: the documents group renders as four headed columns that
       *  all open the ONE documents editor — only the anchor (Số tờ khai)
       *  mounts it, so a single expansion can never render four copies. */
      rendersEditor?: boolean;
      /** Disambiguates the trigger id when one mode owns several cells
       *  (duplicate DOM ids are invalid and break the focus restore). */
      triggerKey?: string;
      /** Mobile card label override — the physical column's own header. */
      cellLabel?: string;
      /** FB-109 v2: an always-visible row action rendered as a SIBLING of
       *  the cell trigger (never nested inside the button). */
      trailing?: ReactNode;
    } = {},
  ) => {
    const { rendersEditor = true, triggerKey, cellLabel, trailing } = options;
    // Lot-level rows (card 365 — container-less LCL lots) are display-only on
    // this workboard: there is no container line behind them to open an edit
    // session against, so every cell renders read-only regardless of the
    // field's authority (shipment-level edits happen on Tổng quan lô hàng).
    const canEdit = enabled && row.isLotLevel !== true;
    const triggerId = `shipment-detail-edit-${mode}${triggerKey ? `-${triggerKey}` : ''}-${row.id}`;
    const editorId = `${triggerId}-editor`;
    const busy = editLoadingRowId === row.id;
    const expanded = activeEdit?.row.id === row.id && activeEdit.mode === mode;
    const className = `shipment-container-ledger__cell-trigger${canEdit ? '' : ' shipment-container-ledger__cell-trigger--read-only'}`;
    if (!canEdit) return <div className={className}>{children}</div>;
    return (
      <div
        className={`shipment-container-ledger__cell-editor${expanded ? ' shipment-container-ledger__cell-editor--expanded' : ''}${trailing ? ' shipment-container-ledger__cell-editor--with-action' : ''}`}
        data-mode={mode}
      >
        <AriaButton
          id={triggerId}
          className={`${className}${expanded ? ' shipment-container-ledger__cell-trigger--expanded' : ''}`}
          onPress={() => onStartEdit(row, mode, triggerId)}
          isDisabled={busy || activeEdit != null}
          aria-busy={busy || undefined}
          aria-controls={expanded && rendersEditor ? editorId : undefined}
          aria-expanded={expanded}
          data-cell-label={cellLabel ?? modeLabelForTrigger(mode)}
        >
          <span className="shipment-container-ledger__edit-purpose">Chỉnh sửa {mode === 'identity' || mode === 'documents' || mode === 'container' ? 'ô ' : ''}{modeLabelForTrigger(mode)} {row.containerNumber || `container số ${row.ordinal}`}: </span>
          {children}
        </AriaButton>
        {trailing}
        {expanded && activeEdit && rendersEditor && renderInlineEditor(activeEdit, editorId)}
      </div>
    );
  };

  return (
    <>
      <SummaryRail
        ariaLabel="Tóm tắt container trên trang"
        items={[
          { label: 'Container trên trang', value: rows.length },
          { label: 'Tổng container phù hợp', value: totalContainers },
          { label: 'Thiếu ngày vận chuyển', value: missingDateCount, tone: missingDateCount > 0 ? 'warning' : undefined },
          { label: 'Hôm nay chờ phân xe', value: missingVehicleTodayCount, tone: missingVehicleTodayCount > 0 ? 'warning' : undefined },
        ]}
      />
      <div className="shipment-container-ledger" role="region" aria-label="Bảng chi tiết container theo lô hàng" tabIndex={0}>
        <table>
          <caption>Chi tiết container theo tám nhóm thông tin nghiệp vụ</caption>
          <colgroup>
            <col className="shipment-container-ledger__col--customer" />
            {/* FB-113 v2: the documents group renders as four headed columns —
                Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu, the QA
                order — sharing the pinned `documents` visibility key. */}
            <col className="shipment-container-ledger__col--billbook" />
            <col className="shipment-container-ledger__col--declaration" />
            <col className="shipment-container-ledger__col--direction" />
            <col className="shipment-container-ledger__col--shippingline" />
            <col className="shipment-container-ledger__col--container" />
            {!isHidden('route') && <col className="shipment-container-ledger__col--route" />}
            {!isHidden('schedule') && <col className="shipment-container-ledger__col--schedule" />}
            {!isHidden('vehicle') && <col className="shipment-container-ledger__col--vehicle" />}
            {!isHidden('notes') && <col className="shipment-container-ledger__col--notes" />}
            {!isHidden('status') && <col className="shipment-container-ledger__col--status" />}
            {hasRowActions && <col className="shipment-container-ledger__col--actions" />}
          </colgroup>
          <thead><tr>
            <SortHeader label="Khách hàng &amp; lộ trình" sortKey="customerName" sort={sort} onSortChange={onSortChange} />
            <SortHeader label="Bill/Booking" sortKey="billOrBookNumber" sort={sort} onSortChange={onSortChange} />
            <th scope="col">Số tờ khai</th>
            <th scope="col">Nhập/Xuất</th>
            <th scope="col">Hãng tàu</th>
            <SortHeader label="Thông số container" sortKey="containerNumber" sort={sort} onSortChange={onSortChange} />
            {!isHidden('route') && <SortHeader label="Nâng / hạ" sortKey="liftSite" sort={sort} onSortChange={onSortChange} />}
            {!isHidden('schedule') && <SortHeader label="Lịch trình" sortKey="transportDate" sort={sort} onSortChange={onSortChange} />}
            {!isHidden('vehicle') && <SortHeader label="Phân xe" sortKey="carrierName" sort={sort} onSortChange={onSortChange} />}
            {!isHidden('notes') && <SortHeader label="Ghi chú" sortKey="customerNotes" sort={sort} onSortChange={onSortChange} />}
            {!isHidden('status') && <SortHeader label="Trạng thái" sortKey="dispatchStatus" sort={sort} onSortChange={onSortChange} />}
            {hasRowActions && <th scope="col">Thao tác</th>}
          </tr></thead>
          <tbody>
            {rows.map((row) => {
              const edit = activeEdit?.row.id === row.id ? activeEdit : null;
              const missingDate = row.transportDate == null;
              const missingVehicleToday = row.transportDate === today && (!row.carrierName || !row.plateNumber);
              const appointmentInput = formatVietnamDateTimeInput(row.customerAppointmentAt);
              const scheduleTime = formatScheduleTime(row);
              // Card 191026181942 (TRUTH WINS): a lot-level LCL row carries its
              // schedule in transportDate (expectedDeliveryDate) — the backend
              // always nulls customerAppointmentAt there (buildLotFlatRow), so
              // the appointment-only predicate printed "Chưa có lịch hẹn" over
              // a real ngày vận chuyển. Derive the schedule by OBJECT
              // EXISTENCE first; the placeholder wins only when neither the
              // container appointment nor the lot schedule exists.
              const lotScheduleDate = row.isLotLevel ? row.transportDate : null;
              const hasAppointment = Boolean(appointmentInput);
              const hasLotSchedule = Boolean(lotScheduleDate);
              const hasSchedule = hasAppointment || hasLotSchedule;
              const identityEditable = row.fieldAccess.operationalSiteId?.mode === 'DIRECT';
              const documentsEditable = ['blNumber', 'bookingRef', 'tradeDirection', 'shippingLineName', 'declarationNumber'].some((field) => row.shipmentFieldAccess[field as 'blNumber'].mode !== 'READ_ONLY');
              const containerEditable = row.fieldAccess.containerNumber.mode !== 'READ_ONLY' || row.fieldAccess.containerTypeId.mode !== 'READ_ONLY' || row.fieldAccess.cargoWeightKg.mode !== 'READ_ONLY' || row.fieldAccess.cargoVolumeCbm.mode !== 'READ_ONLY';
              const routeEditable = row.fieldAccess.routeId.mode !== 'READ_ONLY' || row.fieldAccess.liftSiteId.mode !== 'READ_ONLY' || row.fieldAccess.dropoffSiteId.mode !== 'READ_ONLY';
              const vehicleEditable = row.carrierEditable || row.plateEditable;
              // Card 161026232339 — the lot row's two-line phân xe cell. The
              // Ảo line is printed only when the billing plate actually differs
              // from BKS thực (spec §II.3.1); the edit stays reachable either
              // way through the small quick-edit trigger below.
              const lotActualPlate = row.actualTruckNo?.trim() || row.plateNumber?.trim() || '—';
              const lotBillingPlate = billingPlateFor(row);
              const lotBillingDiffers = lotBillingPlate !== '' && normalizePlate(lotBillingPlate) !== normalizePlate(lotActualPlate);
              const lotBillingEditing = billingEditorForRowId === row.id;
              const detailsExpanded = expandedRowIds.has(row.id);
              // Card 191026181942 (empty allocation = pending label): with
              // NOTHING allocated — no carrier, no plate, not even a hand-typed
              // BKS thực — the cell prints ONE muted "Chưa phân xe" label. The
              // composite read "Chưa phân nhà xe - BKS Thực: —" beside
              // "BKS Báo khách (Ảo): — sửa": three N/A facts dressed as data.
              const hasLotAllocation = Boolean(row.carrierName?.trim() || row.plateNumber?.trim() || row.actualTruckNo?.trim());
              const cellClassName = (editable: boolean, mode: ShipmentDetailEditMode, extraClassName?: string) => [
                extraClassName,
                editable && 'shipment-container-ledger__editable-cell',
                edit?.mode === mode && 'shipment-container-ledger__editing-cell',
              ].filter(Boolean).join(' ') || undefined;
              return (
                <tr
                  key={row.id}
                  id={`shipment-row-details-${row.id}`}
                  data-expanded={detailsExpanded ? 'true' : 'false'}
                  className={`${missingDate ? 'shipment-container-ledger__row--missing-date' : ''}${edit ? ' shipment-container-ledger__row--editing' : ''}`.trim() || undefined}
                >
                  <th scope="row" data-label="Khách hàng & lộ trình" className={cellClassName(identityEditable, 'identity')}>
                    <StatusStrip color={DISPATCH_STRIP_COLORS[row.dispatchStatus]} />
                    {editableCell(row, 'identity', identityEditable, <div className="shipment-container-ledger__multiline">
                      {/* Card 191026181942: names ride the shared NameCell —
                          wrap-never-clip plus the accessible full-name layer. */}
                      {row.customerName ? <NameCell as="strong" name={row.customerName} /> : fallback(null, 'Chưa có khách hàng')}
                      {row.factoryName ? <NameCell name={row.factoryName} /> : fallback(null, 'Chưa có nhà máy')}
                      {row.routeName ? <NameCell as="em" name={row.routeName} /> : fallback(null, 'Chưa có tuyến đường')}
                    </div>)}
                    {/* SIL-149 phase 2 (consultation tie-breaker 24/10): a
                        SIBLING of the cell trigger, never nested inside it —
                        phones collapse the four secondary cells behind this
                        expander; desktop hides it outright. */}
                    <button
                      type="button"
                      className="shipment-container-ledger__row-toggle"
                      aria-expanded={detailsExpanded}
                      aria-controls={`shipment-row-details-${row.id}`}
                      aria-label={`${detailsExpanded ? 'Thu gọn' : 'Xem thêm'} thông tin phụ của ${row.containerNumber || row.billOrBookNumber || `container số ${row.ordinal}`}`}
                      onClick={() => toggleRowDetails(row.id)}
                    >
                      <ChevronDown aria-hidden="true" />
                    </button>
                  </th>
                  {/* FB-113 v2: the documents group, one headed column per
                      field in the QA order. All four open the ONE documents
                      editor; only the Số tờ khai cell mounts it and carries
                      the always-visible Sửa button (FB-109 v2). */}
                  <td data-label="Bill/Booking" className={cellClassName(documentsEditable, 'documents')}>
                    {editableCell(row, 'documents', documentsEditable,
                      <div className="shipment-container-ledger__multiline">
                        <strong className="shipment-container-ledger__code">{fallback(row.billOrBookNumber, 'Chưa có Bill/Booking')}</strong>
                      </div>,
                      { rendersEditor: false, triggerKey: 'bill', cellLabel: 'Bill/Booking' })}
                  </td>
                  <td data-label="Số tờ khai" className={cellClassName(documentsEditable, 'documents')}>
                    {editableCell(row, 'documents', documentsEditable,
                      <div className="shipment-container-ledger__multiline">
                        <span className="shipment-container-ledger__code">{fallback(row.declarationNumber, 'Chưa có tờ khai')}</span>
                      </div>,
                      { cellLabel: 'Số tờ khai', trailing: declarationEditAction(row) })}
                  </td>
                  <td data-label="Nhập/Xuất" className={cellClassName(documentsEditable, 'documents')}>
                    {editableCell(row, 'documents', documentsEditable,
                      <div className="shipment-container-ledger__multiline">
                        <b className={`shipment-container-ledger__direction shipment-container-ledger__direction--${row.direction?.toLowerCase() ?? 'unknown'}`}>{directionLabel(row.direction, Boolean(row.isLotLevel))}</b>
                      </div>,
                      { rendersEditor: false, triggerKey: 'direction', cellLabel: 'Nhập/Xuất' })}
                  </td>
                  <td data-label="Hãng tàu" className={cellClassName(documentsEditable, 'documents')}>
                    {editableCell(row, 'documents', documentsEditable,
                      <div className="shipment-container-ledger__multiline">
                        <span>{fallback(row.shippingLineName, 'Chưa có hãng tàu')}</span>
                      </div>,
                      { rendersEditor: false, triggerKey: 'shipping-line', cellLabel: 'Hãng tàu' })}
                  </td>
                  <td data-label="Thông số container" className={cellClassName(containerEditable, 'container')}>
                    {editableCell(row, 'container', containerEditable, <div className="shipment-container-ledger__multiline">
                      {/* Card 161026232339 §II.3.1: a lot-level row prints the
                          chosen cước classes ("Lô hàng lẻ | Thu: Xe 3.5T |
                          Trả: Xe 10T") instead of the retired hard-coded
                          "Không có container" — the lot HAS no container, but
                          that string said nothing about how it bills. */}
                      <strong className="shipment-container-ledger__code">{row.isLotLevel ? lotSpecLine(row) : fallback(row.containerNumber, `Container số ${row.ordinal}`)}</strong>
                      {row.isLotLevel
                        ? (row.revVehicleClassCode == null && row.costVehicleClassCode == null
                          && <span className="shipment-container-ledger__missing">Chưa chọn loại xe tính cước</span>)
                        : <span>{fallback(row.containerTypeLabel, 'Chưa rõ loại container')}</span>}
                      <span className="shipment-container-ledger__container-classification">{DISPATCH_CLASSIFICATION_LABELS[row.classification]}</span>
                      {row.isCombined && <span className="shipment-container-ledger__combined">Đóng kết hợp</span>}
                    </div>)}
                  </td>
{!isHidden('route') && (<td data-label="Nâng / hạ" className={cellClassName(routeEditable, 'route')}>
                    {/* Card 261022093846 (Zalo 22/10): an LCL lot has NO
                        nâng/hạ concept — its real operating points are Điểm
                        đóng hàng / Điểm trả hàng, resolved server-side from
                        the lot's own intake data (kho CFS + nhà máy,
                        direction-swapped). The lot row prints them under
                        Đóng/Trả labels with the law in a tooltip — never the
                        container rows' "Chưa cập nhật" placeholder, which
                        read like data that would never arrive. Container
                        rows keep the Nâng/Hạ pair untouched. */}
                    {editableCell(row, 'route', routeEditable, row.isLotLevel
                      ? (
                        <div
                          className="shipment-container-ledger__route shipment-container-ledger__route--lot"
                          title={`Lô lẻ: không nâng/hạ — đóng tại ${row.liftSite ?? 'chưa rõ'}, trả tại ${row.dropoffSite ?? 'chưa rõ'}`}
                        >
                          <span><small>Đóng</small>{fallback(row.liftSite, '—')}</span>
                          <span><small>Trả</small>{fallback(row.dropoffSite, '—')}</span>
                        </div>
                      )
                      : <div className="shipment-container-ledger__route"><span><small>Nâng</small>{fallback(row.liftSite, 'Chưa cập nhật')}</span><span><small>Hạ</small>{fallback(row.dropoffSite, 'Chưa cập nhật')}</span></div>)}
                    {editError?.rowId === row.id && <span className="shipment-container-ledger__edit-error" role="alert">{editError.message}</span>}
                  </td>)}
{!isHidden('schedule') && (<td data-label="Lịch trình" className={cellClassName(row.customerAppointmentEditable, 'schedule')}>
                    {editableCell(row, 'schedule', row.customerAppointmentEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__schedule ops-schedule">
                      {missingDate && <Badge size="sm" color="warning" className="shipment-container-ledger__schedule-gap"><CalendarOff aria-hidden="true" />Thiếu ngày vận chuyển</Badge>}
                      <strong className={hasSchedule ? 'ops-schedule__datetime' : undefined}>{hasAppointment
                        ? [scheduleTime, formatISODate(appointmentInput.slice(0, 10), { empty: 'Chưa có ngày' })].filter(Boolean).join(' ')
                        : hasLotSchedule
                          ? formatISODate(lotScheduleDate, { empty: '—' })
                          : 'Chưa có lịch hẹn'}</strong><span>{hasAppointment
                        ? (row.direction === 'IMPORT' ? 'trả hàng' : 'đóng hàng')
                        : hasLotSchedule
                          ? 'Ngày vận chuyển'
                          : row.isLotLevel ? 'Chốt trên Tổng quan lô hàng' : 'Cập nhật theo từng container'}</span></div>)}
                  </td>)}
{!isHidden('vehicle') && (<td data-label="Phân xe" className={cellClassName(vehicleEditable, 'vehicle', missingVehicleToday ? 'shipment-container-ledger__vehicle-pending' : undefined)}>
                    {editableCell(row, 'vehicle', vehicleEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__vehicle">
                      {/* Card 20260922_24: the dispatch state ("Chờ phân xe") lives
                          in the Trạng thái cell; repeating it here as a badge made
                          one row read the same status twice. The amber cell tint
                          (__vehicle-pending) keeps the attention cue without the
                          duplicate label. */}
                      {row.isLotLevel ? (
                        !hasLotAllocation ? (
                          <span className="shipment-container-ledger__missing">Chưa phân xe</span>
                        ) : (
                        <>
                          {/* Card 161026232339 §II.3.1 — two lines for Hàng lẻ:
                              BKS thực (display) then BKS báo khách (Ảo), which
                              is click-to-edit. Card 191026181942: the name slot
                              of the composite is "—" (en dash) when N/A — the
                              unallocated case never reaches this branch. */}
                          <strong>{`${row.carrierName?.trim() || '—'} - BKS Thực: ${lotActualPlate}`}</strong>
                          {lotBillingEditing
                            ? billingPlateEditor(row)
                            : lotBillingDiffers
                              ? billingPlateTrigger(row, lotBillingPlate)
                              : (
                            <button
                              type="button"
                              className="shipment-container-ledger__missing-fields-toggle"
                              aria-label={`Sửa BKS báo khách cho lô ${row.billOrBookNumber ?? row.shipmentId}`}
                              onClick={() => openBillingEditor(row)}
                            >{lotBillingPlate ? `BKS Báo khách (Ảo): ${lotBillingPlate} — sửa` : 'BKS Báo khách (Ảo): — sửa'}</button>
                          )}
                        </>
                        )
                      ) : lotBillingDiffers ? (
                        <>
                          {/* Card 171026000407 §II.3.1: "hoặc khi có gán Xe ảo
                              khác Xe thực tế" — a container row whose BKS báo
                              khách differs from BKS thực prints the same two
                              lines as the lot-level branch, the Ảo line
                              click-to-edit. Equal or absent keeps the
                              single-plate cell below byte-for-byte. */}
                          <strong>{`${row.carrierName?.trim() || '—'} - BKS Thực: ${lotActualPlate}`}</strong>
                          {lotBillingEditing
                            ? billingPlateEditor(row)
                            : billingPlateTrigger(row, lotBillingPlate)}
                        </>
                      ) : (
                        <>
                          {row.carrierName
                            ? <NameCell as="strong" name={row.carrierName} />
                            : <span className="shipment-container-ledger__missing">Chưa phân nhà xe</span>}
                          {row.plateNumber
                            ? <span className="shipment-container-ledger__plate">{row.plateNumber}</span>
                            : <BadgeWithDot size="sm" color="warning" className="shipment-container-ledger__plate--missing">{row.carrierType === 'EXTERNAL' ? 'CUS sẽ bổ sung' : 'Chưa gán biển số'}</BadgeWithDot>}
                        </>
                      )}
                    </div>)}
                  </td>)}
{!isHidden('notes') && (<td data-label="Ghi chú" className={cellClassName(row.shipmentNotesEditable, 'notes')}>
                    {editableCell(row, 'notes', row.shipmentNotesEditable, <div className="shipment-container-ledger__multiline shipment-container-ledger__notes">
                      {row.customerNotes && <strong>{displayNote(row.customerNotes)}</strong>}
                      {row.operationalNotes && <span>{displayNote(row.operationalNotes)}</span>}
                      {!row.customerNotes && !row.operationalNotes && <span className="shipment-container-ledger__missing">—</span>}
                    </div>)}
                  </td>)}
{!isHidden('status') && (<td data-label="Trạng thái" className="shipment-container-ledger__cell--status">
                    <div className="shipment-container-ledger__multiline">
                      <span className={`shipment-container-ledger__dispatch-badge shipment-container-ledger__dispatch-badge--${row.dispatchStatus.toLowerCase()}`}>{DISPATCH_STATUS[row.dispatchStatus].label}</span>
                      {row.informationStatus === 'MISSING' && (
                        <ShipmentMissingFieldsSummary
                          row={row}
                          missingFields={row.missingFields}
                          editableModes={{
                            documents: documentsEditable,
                            container: containerEditable,
                            route: routeEditable,
                            schedule: row.customerAppointmentEditable,
                            vehicle: vehicleEditable,
                          }}
                          editLocked={activeEdit != null || editLoadingRowId === row.id}
                          onStartEdit={onStartEdit}
                        />
                      )}
                    </div>
                  </td>)}
                  {hasRowActions && (
                    <td data-label="Thao tác" className="shipment-container-ledger__cell--actions">
                      {/* Bulk appointment copy: this row's giờ hẹn lands on
                          every row of ITS OWN lot that is still without one,
                          in one server call. Only the rows that can actually
                          source a copy carry it, so the affordance never
                          appears where it would do nothing. */}
                      {canCopyFrom(row) && (
                        <div className="shipment-container-ledger__multiline">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm shipment-container-ledger__copy"
                            aria-label={`Copy giờ hẹn của container ${row.containerNumber || row.ordinal} sang các container chưa có lịch`}
                            title="Copy giờ hẹn của dòng này sang mọi container trong lô chưa có lịch"
                            disabled={copyingRowId != null || activeEdit != null}
                            onClick={() => void submitCopyAppointment(row)}
                          >Copy giờ hẹn</button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {footer}
      </div>
    </>
  );
}
