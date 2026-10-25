import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { Check, ChevronDown, Copy, Trash2 } from 'lucide-react';
import {
  type ShipmentCusWorkspaceContainerLine,
  type ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { formatDateTime24, formatWeight } from '../../../lib/format';
import { formatTimeShortDate, formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { SearchableSelect } from '../../../design-system';
import { CopyCodeButton } from '../../../components/trip/CopyCodeButton';
import { externalVendorPlateOptions } from '../external-plate-options';
import { CusAppointmentPopover } from './CusAppointmentPopover';
import {
  dispatchStatusLabel,
  type ContainerLineDraft,
} from './cusUtils';

/** SIL-483: the drawer ledger is the grouped multi-line spreadsheet the owner
 *  specced — every cell is one or two 28px ghost lines (line 1 ink/500, line 2
 *  ink-2/400), hairline row dividers only, chevron + soft hover fill as the
 *  only edit chrome. The 12-column outlined grid and its ShipmentContainerCell
 *  reveal shells are gone (anti-nesting: no input wrapped in its own frame). */

const chevronHint = <ChevronDown size={12} aria-hidden="true" className="cus-line__chevron" />;

/** SIL-483 grouped-cell text line: click the ghost line to edit IN PLACE
 *  (container number, tờ khai), Enter commits an immediate per-row save,
 *  Esc/outside dismisses and reverts (_34 contract). A commit resolving false
 *  keeps the editor open (the error rode the host toast). The accessible name
 *  is the value itself — the row's aria-labelledby target can point here. */
function InlineTextCell({
  value,
  placeholder,
  emptyText = '—',
  ariaLabel,
  title,
  editable,
  maxLength,
  onCommit,
  wrapperId,
  editorClassName = 'cus-inline-editor',
  missingAttr,
  /** Notifies the host when the in-place editor opens/closes — the tờ khai
   *  cell hides its Copy affordance while the draft editor is up (clicking
   *  Copy outside the editor's blur containment would revert the draft). */
  onOpenChange,
}: {
  value: string;
  /** Trigger text while the line is empty in edit mode (e.g. "Nhập tờ khai"). */
  placeholder: string;
  /** Static fallback when the line renders read-only and empty. */
  emptyText?: string;
  ariaLabel: string;
  title: string;
  editable: boolean;
  maxLength: number;
  onCommit?: (value: string) => Promise<boolean>;
  /** Element carrying the value text in every state — hosts point their
   *  aria-labelledby (the container row's name) here. */
  wrapperId?: string;
  editorClassName?: string;
  /** Mirrors the old data-missing-container marker for CSS hooks. */
  missingAttr?: boolean;
  /** See the prop doc above. */
  onOpenChange?: (open: boolean) => void;
}) {
  const persisted = value;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(persisted);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => { onOpenChangeRef.current = onOpenChange; }, [onOpenChange]);
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setDraft(persisted);
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === persisted) { close(); return; }
    if (!onCommit) { close(); return; }
    setBusy(true);
    let ok = false;
    try {
      ok = await onCommit(next);
    } finally {
      setBusy(false);
    }
    if (ok) close();
  };

  if (!editable || !onCommit) {
    return (
      // Read-only: the title carries the VALUE, never an edit hint — a line
      // the save path would refuse must not advertise "press to edit".
      <span className="cus-line__value" data-missing-container={missingAttr && !persisted ? 'true' : undefined} title={persisted || undefined}>
        <span id={wrapperId}>{persisted || emptyText}</span>
      </span>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        className={`cus-line cus-line--trigger${persisted ? '' : ' cus-line--empty'}`}
        onClick={() => { setDraft(persisted); setOpen(true); }}
        disabled={busy}
        aria-label={ariaLabel}
        title={title}
      >
        {/* The id + missing marker live on the value span itself so hosts
            pointing aria-labelledby here (the container row's name) and CSS
            hooks reading [data-missing-container] resolve the text node. */}
        <span id={wrapperId} className="cus-line__value" data-missing-container={missingAttr && !persisted ? 'true' : undefined}>{persisted || placeholder}</span>
        {chevronHint}
      </button>
    );
  }
  return (
    <span
      id={wrapperId}
      className={editorClassName}
      onBlur={(event) => {
        // Outside blur dismisses (revert) unless the click landed on the
        // commit controls inside this editor. Never while a commit is in
        // flight — disabling a focused input moves focus to <body> and the
        // resulting blur must not discard the in-flight draft.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>{ariaLabel}</label>
      <input
        id={inputId}
        value={draft}
        maxLength={maxLength}
        readOnly={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          if (event.key === 'Enter') { event.preventDefault(); void commit(); }
        }}
        autoFocus
      />
      <button
        type="button"
        className="btn btn--primary btn--sm"
        disabled={busy || draft.trim() === persisted}
        onClick={() => void commit()}
      >
        {busy ? 'Đang lưu…' : 'Lưu'}
      </button>
    </span>
  );
}

/** Card 261022095235a (CUS-05): the per-container tờ khai cell — click the
 *  value to edit it IN PLACE (no tab/section switch). Enter commits an
 *  immediate per-row save (the server's FB-109 auto-copy law fills the lot's
 *  still-empty siblings in the same transaction); Esc/outside dismisses and
 *  reverts, matching the appointment popover's dismissal contract (_34). */
function DeclarationCell({
  line,
  editable,
  onCommit,
  showCopy,
  onCopy,
  copying,
}: {
  line: ShipmentCusWorkspaceContainerLine;
  editable: boolean;
  /** Enter/✓: persist this row's number. Resolves false to keep the editor
   *  open (commit failed — the error rides the host toast). */
  onCommit: (value: string) => Promise<boolean>;
  /** Explicit copy affordance (card 261013200312 "(hoặc nút copy)"): shown
   *  only when the PERSISTED number is non-empty and the lot still has
   *  empty siblings — a retyped-but-unsaved value is never copyable. */
  showCopy: boolean;
  onCopy: () => void;
  copying: boolean;
}) {
  const persisted = (line.declarationNumber ?? '').trim();
  const [editorOpen, setEditorOpen] = useState(false);
  const identity = line.containerNumber || `container số ${line.ordinal}`;
  return (
    <td data-label="Số tờ khai" className="cus-container-cell cus-container-cell--declaration">
      <div className="cus-group">
        <div className="cus-line cus-line--primary">
          <InlineTextCell
            value={persisted}
            placeholder="Nhập tờ khai"
            emptyText="—"
            ariaLabel={`Số tờ khai của container ${identity}: ${persisted || 'Chưa có'}. Nhấn để sửa.`}
            title="Nhấn để sửa số tờ khai của container này"
            editable={editable}
            maxLength={50}
            onCommit={onCommit}
            editorClassName="cus-declaration-editor"
            onOpenChange={setEditorOpen}
          />
          {/* Old card law restored: the Copy affordance hides while the draft
              editor is open — it sits outside the editor's blur containment,
              so clicking it would revert the in-progress draft. */}
          {showCopy && !editorOpen && (
            <button
              type="button"
              className="cus-declaration-copy"
              onClick={onCopy}
              disabled={copying}
              title="Copy số tờ khai này sang các container còn trống của lô"
              aria-label={`Copy số tờ khai ${persisted} sang các container chưa có số của lô`}
            >
              <Copy size={13} aria-hidden="true" />
              Copy
            </button>
          )}
        </div>
      </div>
    </td>
  );
}

export function ContainerLineRow({
  detail,
  line,
  draft,
  dirty,
  onDraftChange,
  idPrefix,
  editing,
  onCompleteExternalTrip,
  completing,
  onAppointmentCommit,
  onAppointmentCancel,
  showCopyAppointment,
  onCopyAppointmentToEmpty,
  onAppointmentCopied,
  declarationEditable,
  onDeclarationCommit,
  showCopyDeclaration,
  onCopyDeclaration,
  copyingDeclaration,
  numberEditable,
  onNumberCommit,
  onRemove,
  removing,
}: {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
  draft: ContainerLineDraft;
  dirty: boolean;
  onDraftChange: (patch: Partial<ContainerLineDraft>) => void;
  idPrefix: string;
  editing: boolean;
  /** SIL-483: the container number edits in place through the same line
   *  update API (writer-gated by the host); absent for read-only viewers. */
  numberEditable?: boolean;
  onNumberCommit?: (value: string) => Promise<boolean>;
  /** Card 20260923_1: lot-level remove — the drawer manages container
   *  composition; absent when no refetch path is wired or the viewer lacks
   *  the remove permission (CUS-10). SIL-483: the affordance is the specced
   *  32×32 ghost trash; the confirm dialog still stands between the click
   *  and the delete. */
  onRemove?: () => void;
  removing?: boolean;
  /** Staff close for external-carrier trips (external drivers don't use the
   *  app) — absent when the line has no completable external trip. */
  onCompleteExternalTrip?: (line: ShipmentCusWorkspaceContainerLine) => void;
  completing?: boolean;
  /** Enter inside the appointment popover: validate and persist the value.
   *  Return false to keep the popover open on failure. */
  onAppointmentCommit?: (val: string) => Promise<boolean> | boolean | void;
  onAppointmentCancel?: () => void;
  /** Bulk entry: this row's appointment can be copied to every line whose
   *  appointment is still empty (shown while hovering set rows when the
   *  table still has empties to fill). */
  showCopyAppointment?: boolean;
  onCopyAppointmentToEmpty?: () => void;
  /** FB-009: the row's giờ hẹn itself lands in the OS clipboard; the
   *  mounting surface raises the "Đã copy" toast with this callback. */
  onAppointmentCopied?: (formatted: string) => void;
  /** Card 261022095235a (CUS-05): per-container tờ khai inline edit. The
   *  cell renders click-to-edit when `declarationEditable` and a commit
   *  handler are both present; the commit is an immediate per-row save that
   *  carries the server's auto-copy-to-empty-siblings law. */
  declarationEditable?: boolean;
  onDeclarationCommit?: (value: string) => Promise<boolean>;
  /** Explicit copy affordance — only when the PERSISTED number is non-empty
   *  and the lot still has an empty sibling (host computes the count). */
  showCopyDeclaration?: boolean;
  onCopyDeclaration?: () => void;
  copyingDeclaration?: boolean;
}) {
  const [, setSelectOpen] = useState(false);

  // Card 20260925_6 sweep: the plate datalist follows the picked vendor — an
  // existing carrier offers its own plates; a typed NEW_EXTERNAL name matches
  // that vendor's used plates; nothing picked keeps the full list.
  const plateOptions = useMemo<Array<{ id: number | string; licensePlate: string; label: string }>>(() => {
    const vehicles = detail.selectors.carrierVehicles;
    if (draft.carrierKey === 'NEW_EXTERNAL') {
      return externalVendorPlateOptions(detail.selectors.externalCarriers, vehicles, draft.newCarrierName)
        .map((option) => ({ id: option.value, licensePlate: option.value, label: option.label }));
    }
    if (draft.carrierKey === 'OWN') return [];
    if (draft.carrierKey) {
      const raw = draft.carrierKey.startsWith('EXTERNAL:') ? draft.carrierKey.slice('EXTERNAL:'.length) : draft.carrierKey;
      const id = Number(raw);
      if (!Number.isFinite(id)) return [];
      return vehicles.filter((vehicle) => vehicle.carrierId === id);
    }
    return vehicles;
  }, [detail.selectors.carrierVehicles, detail.selectors.externalCarriers, draft.carrierKey, draft.newCarrierName]);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const appointmentTriggerRef = useRef<HTMLButtonElement>(null);
  const p = line.permissions;
  const carrierEditable = editing && p.carrierEditable, plateEditable = editing && p.plateEditable;
  const containerTypeEditable = editing && p.containerTypeEditable;
  const routeEditable = editing && p.routeEditable;
  const liftSiteEditable = editing && p.liftSiteEditable, dropoffSiteEditable = editing && p.dropoffSiteEditable;
  const customerAppointmentEditable = editing && p.customerAppointmentEditable;
  // Mirrors the backend's findActiveTripForContainer: a trip on THIS row blocks
  // its removal unless it was CANCELED. The 409 stays authoritative — this only
  // keeps the affordance from inviting a doomed click.
  const activeTrip = line.tripId != null && line.tripStatus !== 'CANCELED';
  // SIL-177 (QA verdict 24/10): a row carrying a tờ khai must not delete —
  // mirrors the backend guard 409 "Cont có tờ khai <số> — gỡ tờ khai trước
  // khi xóa" at the affordance level: the button disables with the guard's
  // own reason instead of the FE clearing the number behind the operator's
  // back (the warn-and-allow flow QA repro'd). Gỡ tờ khai stays the inline
  // editor's explicit job.
  const declaredNumber = line.declarationNumber?.trim() ?? '';
  const rowName = line.containerNumber || line.ordinal;

  const carrierOptions = [
    { value: 'OWN', label: 'Đội xe nội bộ SilverSea' },
    ...detail.selectors.externalCarriers.map((carrier) => ({
      value: `EXTERNAL:${carrier.id}`,
      label: carrier.label,
      searchText: carrier.shortName ?? undefined,
    })),
  ];
  const selectedContainerType = detail.selectors.containerTypes.find((option) => String(option.id) === draft.containerTypeId);
  const selectedLiftPort = detail.selectors.ports.find((option) => String(option.id) === draft.liftSiteId);
  const selectedDropoffPort = detail.selectors.ports.find((option) => String(option.id) === draft.dropoffSiteId);
  // The mask reads the DRAFT while the line is editable (the popover writes
  // naive "YYYY-MM-DDTHH:mm") and the LINE (Vietnam law) once read-only —
  // both are naive strings the pure formatters parse without a zone shift
  // (formatVietnamDateTimeInput on an already-naive draft would re-interpret
  // it through the host zone and drift an hour).
  const appointmentValue = customerAppointmentEditable
    ? draft.customerAppointmentAt
    : formatVietnamDateTimeInput(line.customerAppointmentAt);
  const appointmentFull = appointmentValue ? formatDateTime24(appointmentValue) : '';
  const appointmentMask = appointmentValue ? formatTimeShortDate(appointmentValue) : '';

  return (
    <tr
      className={`cus-container-row${dirty ? ' cus-container-row--dirty' : ''}`}
      aria-labelledby={`${idPrefix}-container-${line.id}`}
    >
      {/* ── 1/8 · Số tờ khai ─────────────────────────────────────────────── */}
      <DeclarationCell
        line={line}
        editable={Boolean(declarationEditable && onDeclarationCommit)}
        onCommit={onDeclarationCommit ?? (async () => false)}
        showCopy={Boolean(showCopyDeclaration && onCopyDeclaration)}
        onCopy={onCopyDeclaration ?? (() => {})}
        copying={Boolean(copyingDeclaration)}
      />
      {/* ── 2/8 · Container (dòng 1: số cont — click-edit; dòng 2: loại) ── */}
      <th scope="row" data-label="Container" className="cus-container-cell cus-container-cell--identity">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            <span className="cus-container-row__ordinal">{line.ordinal}</span>
            <InlineTextCell
              wrapperId={`${idPrefix}-container-${line.id}`}
              value={line.containerNumber?.trim() ?? ''}
              placeholder="Chưa có số container"
              emptyText="Chưa có số container"
              ariaLabel={`Số container ${rowName}. Nhấn để sửa.`}
              title={line.containerNumber || 'Nhấn để sửa số container'}
              editable={Boolean(numberEditable && onNumberCommit)}
              maxLength={50}
              onCommit={onNumberCommit}
              editorClassName="cus-inline-editor"
              missingAttr
            />
            <span className={`cus-container-dispatch cus-container-dispatch--${line.dispatchStatus.toLowerCase()}`}>{dispatchStatusLabel(line.dispatchStatus)}</span>
            {showCopyAppointment && (
              <button
                type="button"
                className="cus-container-row__copy"
                onClick={onCopyAppointmentToEmpty}
                title={`Copy giờ hẹn ${formatDateTime24(appointmentValue)} sang các cont chưa có lịch`}
                aria-label={`Copy giờ hẹn ${formatDateTime24(appointmentValue)} sang các container chưa có lịch`}
              >
                <Copy size={13} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="cus-line cus-line--secondary">
            {containerTypeEditable ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-container-type-${line.id}`}>Loại container {rowName}</label>
                <SearchableSelect id={`${idPrefix}-container-type-${line.id}`} size="sm" value={draft.containerTypeId} onChange={(value) => onDraftChange({ containerTypeId: value })} onOpenChange={setSelectOpen} options={detail.selectors.containerTypes.map((option) => ({ value: String(option.id), label: option.code, searchText: `${option.code} ${option.name}` }))} placeholder="—" />
              </>
            ) : (
              <span className="cus-line__value" title={selectedContainerType ? `${selectedContainerType.code} — ${selectedContainerType.name}` : undefined}>{line.containerTypeLabel || '—'}</span>
            )}
          </div>
        </div>
      </th>
      {/* ── 3/8 · Tuyến ──────────────────────────────────────────────────── */}
      <td data-label="Tuyến" className="cus-container-cell">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            {routeEditable ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-route-${line.id}`}>Tuyến đường của container {rowName}</label>
                <SearchableSelect id={`${idPrefix}-route-${line.id}`} size="sm" value={draft.routeId} onChange={(value) => onDraftChange({ routeId: value })} onOpenChange={setSelectOpen} options={detail.selectors.routes.map((option) => ({ value: String(option.id), label: option.label, searchText: option.name }))} placeholder="—" />
              </>
            ) : (
              <strong className="cus-line__value" title={line.routeName || undefined}>{line.routeName || '—'}</strong>
            )}
          </div>
        </div>
      </td>
      {/* ── 4/8 · Nhà xe/BKS (dòng 1: nhà xe; dòng 2: BKS; cột XE cũ gộp) ── */}
      <td data-label="Nhà xe/BKS" className="cus-container-cell cus-container-cell--carrier">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            {carrierEditable && draft.carrierKey !== 'NEW_EXTERNAL' && (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-carrier-${line.id}`}>Nhà xe của container {rowName}</label>
                <SearchableSelect id={`${idPrefix}-carrier-${line.id}`} size="sm" value={draft.carrierKey} onChange={(value) => onDraftChange({ carrierKey: value, newCarrierName: '' })} onOpenChange={setSelectOpen} options={carrierOptions} placeholder="—" searchPlaceholder="Tìm nhà xe" />
              </>
            )}
            {carrierEditable && draft.carrierKey === 'NEW_EXTERNAL' && (
              <input
                id={`${idPrefix}-new-carrier-${line.id}`}
                value={draft.newCarrierName}
                maxLength={255}
                placeholder="Tên nhà xe mới"
                aria-label="Tên nhà xe mới"
                onChange={(event) => onDraftChange({ newCarrierName: event.target.value })}
              />
            )}
            {!carrierEditable && (
              <strong className="cus-line__value" title={line.carrierName || undefined}>{line.carrierName || '—'}</strong>
            )}
          </div>
          <div className="cus-line cus-line--secondary">
            {plateEditable ? (
              <>
                <input
                  id={`${idPrefix}-plate-${line.id}`}
                  value={draft.plateNumber}
                  list={`${idPrefix}-plates-${line.id}`}
                  maxLength={20}
                  placeholder="—"
                  aria-label={`Biển số xe của container ${rowName}`}
                  title={line.plateNumber || 'Gán BKS'}
                  onChange={(event) => onDraftChange({ plateNumber: event.target.value })}
                />
                <datalist id={`${idPrefix}-plates-${line.id}`}>{plateOptions.map((vehicle) => <option value={vehicle.licensePlate} key={vehicle.id}>{vehicle.label}</option>)}</datalist>
              </>
            ) : (
              <span className="cus-line__value" title={line.plateNumber || undefined}>{line.plateNumber || '—'}</span>
            )}
          </div>
          {carrierEditable && plateEditable && (
            <div className="cus-line cus-line--aux">
              {draft.carrierKey === 'NEW_EXTERNAL' ? (
                <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ carrierKey: '', newCarrierName: '', plateNumber: '' })}>Chọn sẵn có</button>
              ) : (
                <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ carrierKey: 'NEW_EXTERNAL', newCarrierName: '', plateNumber: '' })}>Thêm nhà xe</button>
              )}
              {line.plateNumber && (
                <button type="button" className="cus-carrier-editor__switch" onClick={() => onDraftChange({ plateNumber: '' })}>Xóa biển số</button>
              )}
            </div>
          )}
        </div>
      </td>
      {/* ── 5/8 · Nâng/Hạ (dòng 1: cảng nâng; dòng 2: cảng hạ) ──────────── */}
      <td data-label="Nâng/Hạ" className="cus-container-cell cus-container-cell--num">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            {liftSiteEditable ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-lift-site-${line.id}`}>Cảng nâng của container {rowName}</label>
                <SearchableSelect id={`${idPrefix}-lift-site-${line.id}`} size="sm" value={draft.liftSiteId} onChange={(value) => onDraftChange({ liftSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="—" />
              </>
            ) : (
              <strong className="cus-line__value" title={selectedLiftPort ? `${selectedLiftPort.code ?? ''} — ${selectedLiftPort.name}` : undefined}>{line.liftSite || '—'}</strong>
            )}
          </div>
          <div className="cus-line cus-line--secondary">
            {dropoffSiteEditable ? (
              <>
                <label className="sr-only" htmlFor={`${idPrefix}-dropoff-site-${line.id}`}>Cảng hạ của container {rowName}</label>
                <SearchableSelect id={`${idPrefix}-dropoff-site-${line.id}`} size="sm" value={draft.dropoffSiteId} onChange={(value) => onDraftChange({ dropoffSiteId: value })} onOpenChange={setSelectOpen} options={detail.selectors.ports.map((option) => ({ value: String(option.id), label: option.label, searchText: `${option.code ?? ''} ${option.name}` }))} placeholder="—" />
              </>
            ) : (
              <span className="cus-line__value" title={selectedDropoffPort ? `${selectedDropoffPort.code ?? ''} — ${selectedDropoffPort.name}` : undefined}>{line.dropoffSite || '—'}</span>
            )}
          </div>
        </div>
      </td>
      {/* ── 6/8 · Trọng lượng ────────────────────────────────────────────── */}
      <td data-label="Trọng lượng" className="cus-container-cell cus-container-cell--num">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            {/* The read cells render tấn (formatWeight, CUS-08); the add-row
                input at the foot of this column keeps its kg entry unit. */}
            <strong>{formatWeight(line.raw.cargoWeightKg)}</strong>
          </div>
        </div>
      </td>
      {/* ── 7/8 · Giờ đóng/trả — 1 ô ghost mask HH:mm DD/MM (năm ở title) ──
          The picker is gated on the row's appointment permission exactly like
          the pre-SIL-483 cell: read-only rows (trip assigned / accounting
          lock) render the static mask + copy and never open the popover —
          an offered edit the save path would refuse is the defect class the
          ledger bans. */}
      <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell cus-appointment-cell">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            {customerAppointmentEditable ? (
              <>
                <button
                  ref={appointmentTriggerRef}
                  id={`${idPrefix}-customer-appointment-${line.id}`}
                  type="button"
                  className={`cus-appointment-trigger${appointmentOpen ? ' cus-appointment-trigger--active' : ''}${appointmentMask ? '' : ' cus-line--empty'}`}
                  onClick={() => setAppointmentOpen((current) => !current)}
                  aria-haspopup="dialog"
                  aria-expanded={appointmentOpen}
                  aria-label={`Giờ hẹn đóng hoặc trả tại nhà máy của container ${rowName}: ${appointmentFull || 'Chưa có'}`}
                  title={appointmentFull || 'Gán giờ'}
                >
                  <span className="cus-appointment-trigger__text">{appointmentMask || '—'}</span>
                  {chevronHint}
                </button>
                <CusAppointmentPopover
                  isOpen={appointmentOpen}
                  value={draft.customerAppointmentAt}
                  containerLabel={line.containerNumber || `Cont ${line.ordinal}`}
                  onClose={() => setAppointmentOpen(false)}
                  onChange={(val) => onDraftChange({ customerAppointmentAt: val })}
                  onCommit={onAppointmentCommit}
                  onCancel={onAppointmentCancel}
                  idPrefix={`${idPrefix}-apt-${line.id}`}
                  triggerRef={appointmentTriggerRef}
                />
              </>
            ) : (
              <span
                id={`${idPrefix}-customer-appointment-${line.id}`}
                className={`cus-appointment-trigger cus-appointment-trigger--static${appointmentMask ? '' : ' cus-line--empty'}`}
                aria-label={`Giờ hẹn đóng hoặc trả tại nhà máy của container ${rowName}: ${appointmentFull || 'Chưa có'}`}
                title={appointmentFull || undefined}
              >
                <span className="cus-appointment-trigger__text">{appointmentMask || '—'}</span>
              </span>
            )}
            {appointmentValue && (
              <CopyCodeButton
                className="cus-appointment-cell__copy"
                value={appointmentFull}
                label="Giờ hẹn đóng trả"
                onCopied={() => onAppointmentCopied?.(appointmentFull)}
              />
            )}
          </div>
        </div>
      </td>
      {/* ── 8/8 · Thao tác — ghost trash 32×32; hoàn-thành xe ngoài ghép đè ── */}
      <td data-label="Thao tác" className="cus-container-cell cus-container-cell--actions">
        <div className="cus-container-row__action-stack">
          {onCompleteExternalTrip && (
            <button
              type="button"
              className="cus-container-row__complete"
              onClick={() => onCompleteExternalTrip(line)}
              disabled={completing}
              aria-label={`Hoàn thành chuyến xe ngoài của container ${rowName}`}
              title="Hoàn thành chuyến với xe ngoài — xe ngoài không dùng app nên CS/điều vận chốt thay"
            >
              <Check size={16} aria-hidden="true" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              className="cus-container-row__remove"
              onClick={onRemove}
              disabled={removing || activeTrip || declaredNumber !== ''}
              title={declaredNumber !== ''
                ? `Cont có tờ khai ${declaredNumber} — gỡ tờ khai trước khi xóa`
                : activeTrip ? 'Không thể xóa container đã gắn chuyến xe' : 'Xóa container khỏi lô'}
              aria-label={`Xóa container ${rowName}`}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
