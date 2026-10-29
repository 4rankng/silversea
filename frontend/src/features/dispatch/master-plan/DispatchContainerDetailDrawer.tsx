import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Role } from '@tingting/shared';
import type {
  ShipmentCusContainerLineUpdateInput,
  ShipmentCusContainerLineUpdateResult,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import {
  addCusShipmentContainerRow,
  getCusShipmentWorkspaceDetail,
  removeCusShipmentContainerRow,
  updateCusShipmentContainerLine,
  type ShipmentListItem,
} from '../../../api/shipmentClient';
import { useAuth } from '../../../hooks/useAuth';
import { useToastOptional } from '../../../components/shared/Toast';
import { dispatchStatusLabel } from '../../shipments/cus/cusUtils';
import { formatDateTime24 } from '../../../lib/format';
import { formatVietnamDateTimeInput, localDateTimeToIso } from '../../../lib/shipment-operations';
import { ConfirmDialog, Drawer } from '../../../components/UI';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import { billBookingReference } from '../../../lib/business-reference';
import { SearchableSelect } from '../../../design-system';
import './DispatchContainerDetailDrawer.css';

/** Port columns are backfillable once the backend fieldAccess grants DIRECT —
 *  the same grant the Chi tiết workboard ledger already renders (the writer
 *  validates the ids against the active port catalog server-side). */
function portCellEditable(line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId') {
  return line.fieldAccess?.[field]?.mode === 'DIRECT';
}

/** SIL-550 — the drawer's own cell writers (Số cont, Giờ hẹn đóng/trả) open
 *  exactly when the backend fieldAccess publishes DIRECT: the container-line
 *  command's role + accounting-lock + trip law, per field. A line the save
 *  path would refuse never advertises "press to edit" (SIL-483 law). */
function lineCellEditable(line: ShipmentCusWorkspaceContainerLine, field: 'containerNumber' | 'customerAppointmentAt') {
  return line.fieldAccess?.[field]?.mode === 'DIRECT';
}

function lineIdentity(line: ShipmentCusWorkspaceContainerLine): string {
  return line.containerNumber?.trim() || `cont ${line.ordinal}`;
}

type LineTextField = 'containerNumber' | 'declarationNumber';

/** Per-field copy for the shared click-to-edit text cell. */
const lineTextFieldSpec = {
  containerNumber: {
    emptyLabel: 'Chưa có số container',
    inputLabel: 'Số container',
    inputPlaceholder: 'Nhập số container',
    editVerb: 'Sửa số container',
    typeVerb: 'số container',
    savedToast: () => 'Đã lưu số container.',
    failedToast: 'Không lưu được số container.',
    strongValue: true,
  },
  declarationNumber: {
    emptyLabel: 'Chưa có tờ khai',
    inputLabel: 'Số tờ khai',
    inputPlaceholder: 'Nhập số tờ khai',
    editVerb: 'Sửa số tờ khai',
    typeVerb: 'số tờ khai',
    savedToast: (synced: number) => (synced > 0
      ? `Đã lưu số tờ khai — tự điền thêm cho ${synced} container còn trống của lô.`
      : 'Đã lưu số tờ khai.'),
    failedToast: 'Không lưu được số tờ khai.',
    strongValue: false,
  },
} as const;

/** SIL-530 + SIL-550 gap 2 — the drawer's shared click-to-edit text cell
 *  (Số tờ khai on the SIL-521 per-container model, Số container as identity
 *  entry), on the same interaction contract as the detailed-plan grid's
 *  `DispatchDeclarationCell` (SIL-591): the value is the container's OWN
 *  field on `shipment_containers` (what the per-cont command writes),
 *  click-to-edit inline is the only affordance (owner ruling 20261006_537 —
 *  no extra Sửa button), Enter commits, Escape and blur revert. The caller
 *  gates the affordance (role law for tờ khai — SIL-551 per-cont writer law;
 *  fieldAccess for số cont) so a save the writer would refuse is never
 *  advertised. The
 *  FB-109 auto-copy runs server-side; the toast names the synced siblings and
 *  a 409 names the clashing lot verbatim. */
function ContainerLineTextField({ line, field, canEdit, onSave }: {
  line: ShipmentCusWorkspaceContainerLine;
  field: LineTextField;
  canEdit: boolean;
  /** Persists the value through the container-line command; the drawer
   *  refetches its detail and pings the board after a successful save. */
  onSave: (line: ShipmentCusWorkspaceContainerLine, field: LineTextField, next: string) => Promise<ShipmentCusContainerLineUpdateResult>;
}) {
  const spec = lineTextFieldSpec[field];
  const toastCtx = useToastOptional();
  const baseline = (line[field] ?? '').trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // SIL-631: the editing cell's stable anchor for the floating editor host.
  const anchorRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  // A refetch swaps in fresh line objects; a changed identity must not leak a
  // stale draft into the new line's editor state.
  const lineKey = `${line.id}`;
  const lineKeyRef = useRef(lineKey);
  if (lineKeyRef.current !== lineKey) {
    lineKeyRef.current = lineKey;
    setEditing(false);
    setDraft(baseline);
  }

  const openEditor = () => {
    if (!canEdit || saving) return;
    setDraft(baselineRef.current);
    setEditing(true);
  };

  const revert = () => {
    setDraft(baselineRef.current);
    setEditing(false);
  };

  const commit = () => {
    if (!canEdit || saving) return;
    const next = draft.trim();
    if (next === baselineRef.current) {
      revert();
      return;
    }
    setSaving(true);
    void onSave(line, field, next)
      .then((result) => {
        // saving clears on BOTH exits — the cell instance survives the
        // post-save refetch (stable row keys), so a stale saving=true would
        // silently dead-lock the next click-to-edit in this drawer session.
        setSaving(false);
        setEditing(false);
        const synced = result.declarationSync?.updatedContainerIds.length ?? 0;
        toastCtx?.toast({ kind: 'success', message: spec.savedToast(synced) });
      })
      .catch((error: unknown) => {
        // Card 20261005_354: surface the backend's precise reason verbatim
        // (409 trùng lô khác, 403 vai trò, 409 version conflict).
        const message = error instanceof Error && error.message
          ? error.message
          : spec.failedToast;
        toastCtx?.toast({ kind: 'error', message });
        setSaving(false);
      });
  };

  const displayValue = baseline || spec.emptyLabel;
  const valueNode = spec.strongValue ? <strong>{displayValue}</strong> : displayValue;

  // SIL-631 (owner 28/10, GLOBAL): the editor floats OUTSIDE the cell through
  // a body portal — the table's `.dispatch-container-detail__table-scroll`
  // (overflow-x: auto) can no longer clip the typed value. The cell keeps its
  // (dimmed) value while editing so the row context survives the edit.
  return (
    <div className="dispatch-container-detail__decl-cell" ref={anchorRef}>
      {editing ? (
        <>
          <div
            className={`dispatch-container-detail__decl-value is-editing${baseline ? '' : ' is-empty'}`}
            title={baseline || undefined}
          >
            {valueNode}
          </div>
          <FloatingCellEditor anchorRef={anchorRef} label={`${spec.inputLabel} · ${lineIdentity(line)}`}>
            <div className="dispatch-container-detail__decl-editor">
              <input
                ref={inputRef}
                className="dispatch-container-detail__decl-input"
                value={draft}
                maxLength={50}
                disabled={saving}
                aria-label={spec.inputLabel}
                placeholder={spec.inputPlaceholder}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    revert();
                  }
                }}
                onBlur={revert}
              />
              <span className="dispatch-container-detail__decl-hint">Enter lưu · Esc thoát</span>
            </div>
          </FloatingCellEditor>
        </>
      ) : !canEdit ? (
        <div
          className={baseline ? 'dispatch-container-detail__decl-value' : 'dispatch-container-detail__decl-value is-empty'}
          title={baseline || undefined}
        >
          {valueNode}
        </div>
      ) : (
        <button
          type="button"
          className={`dispatch-container-detail__decl-value--action${baseline ? '' : ' is-empty'}`}
          onClick={openEditor}
          aria-label={`${spec.editVerb} · ${lineIdentity(line)}`}
          title={baseline ? `${spec.editVerb}: ${baseline}` : `Bấm để nhập ${spec.typeVerb}`}
        >
          {valueNode}
        </button>
      )}
    </div>
  );
}

/** SIL-550 gap 3 — the GIỜ HẸN ĐÓNG/TRẢ cell's click-to-edit schedule editor:
 *  date + time inputs (both-or-neither), Escape and blur-out revert. The
 *  commit rides the container-line command's `customerAppointmentAt` in the
 *  Vietnam wire contract (`localDateTimeToIso` → `…+07:00`; both blank =
 *  clear). The caller gates on fieldAccess.customerAppointmentAt DIRECT —
 *  pre-lock, pre-trip: a tripped container's schedule rides the trip-adjust
 *  flow instead. */
function ContainerLineAppointmentCell({ line, canEdit, onSave }: {
  line: ShipmentCusWorkspaceContainerLine;
  canEdit: boolean;
  onSave: (line: ShipmentCusWorkspaceContainerLine, next: string | null) => Promise<unknown>;
}) {
  const toastCtx = useToastOptional();
  const baseline = formatVietnamDateTimeInput(line.customerAppointmentAt);
  const [editing, setEditing] = useState(false);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // SIL-631: the editing cell's stable anchor for the floating editor host.
  const anchorRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  // Same refetch-identity guard as the shared text cell.
  const lineKey = `${line.id}`;
  const lineKeyRef = useRef(lineKey);
  if (lineKeyRef.current !== lineKey) {
    lineKeyRef.current = lineKey;
    setEditing(false);
    setDateDraft('');
    setTimeDraft('');
  }

  const openEditor = () => {
    if (!canEdit || saving) return;
    setDateDraft(baselineRef.current.slice(0, 10));
    setTimeDraft(baselineRef.current.slice(11, 16));
    setEditing(true);
  };

  const revert = () => {
    setDateDraft(baselineRef.current.slice(0, 10));
    setTimeDraft(baselineRef.current.slice(11, 16));
    setEditing(false);
  };

  const commit = () => {
    if (!canEdit || saving) return;
    const hasDate = dateDraft.trim() !== '';
    const hasTime = timeDraft.trim() !== '';
    if (hasDate !== hasTime) {
      toastCtx?.toast({ kind: 'error', message: 'Vui lòng nhập đầy đủ cả ngày và giờ hẹn.' });
      return;
    }
    const nextLocal = hasDate ? `${dateDraft.trim()}T${timeDraft.trim()}` : '';
    if (nextLocal === baselineRef.current) {
      revert();
      return;
    }
    let nextIso: string | null = null;
    try {
      nextIso = nextLocal ? localDateTimeToIso(nextLocal) : null;
    } catch {
      toastCtx?.toast({ kind: 'error', message: 'Ngày giờ đóng/trả không hợp lệ.' });
      return;
    }
    setSaving(true);
    void onSave(line, nextIso)
      .then(() => {
        setSaving(false);
        setEditing(false);
        toastCtx?.toast({ kind: 'success', message: 'Đã lưu giờ hẹn đóng/trả.' });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Không lưu được giờ hẹn đóng/trả.';
        toastCtx?.toast({ kind: 'error', message });
        setSaving(false);
      });
  };

  const display = formatDateTime24(baseline) || '—';

  // SIL-631 (owner 28/10, GLOBAL): the date + time editor floats OUTSIDE the
  // cell through a body portal — same host and law as the shared text cell
  // above. The blur-out revert still guards on the editor container (the
  // portal root) so focus moving between the two inputs never reverts.
  return (
    <div className="dispatch-container-detail__decl-cell" ref={anchorRef}>
      {editing ? (
        <>
          <div className="dispatch-container-detail__decl-value is-editing">{display}</div>
          <FloatingCellEditor anchorRef={anchorRef} label={`Chỉnh sửa lịch hẹn đóng/trả · ${lineIdentity(line)}`}>
            <div
              className="dispatch-container-detail__decl-editor"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) revert();
              }}
            >
              <div className="dispatch-container-detail__appointment-inputs">
                <label className="sr-only" htmlFor={`dispatch-detail-appt-date-${line.id}`}>Ngày hẹn đóng/trả của container {lineIdentity(line)}</label>
                <input
                  id={`dispatch-detail-appt-date-${line.id}`}
                  className="dispatch-container-detail__decl-input"
                  type="date"
                  value={dateDraft}
                  disabled={saving}
                  onChange={(event) => setDateDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      revert();
                    }
                  }}
                />
                <label className="sr-only" htmlFor={`dispatch-detail-appt-time-${line.id}`}>Giờ hẹn đóng/trả của container {lineIdentity(line)}</label>
                <input
                  id={`dispatch-detail-appt-time-${line.id}`}
                  className="dispatch-container-detail__decl-input"
                  type="time"
                  value={timeDraft}
                  disabled={saving}
                  onChange={(event) => setTimeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commit();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      revert();
                    }
                  }}
                />
              </div>
              <span className="dispatch-container-detail__decl-hint">Enter lưu · Esc thoát</span>
            </div>
          </FloatingCellEditor>
        </>
      ) : !canEdit ? (
        <div className="dispatch-container-detail__decl-value">{display}</div>
      ) : (
        <button
          type="button"
          className="dispatch-container-detail__decl-value--action"
          onClick={openEditor}
          aria-label={`Sửa giờ hẹn đóng/trả · ${lineIdentity(line)}`}
          title={baseline ? `Sửa giờ hẹn đóng/trả: ${display}` : 'Bấm để nhập giờ hẹn đóng/trả'}
        >
          {display}
        </button>
      )}
    </div>
  );
}

/** SIL-550 gap 1 — "Thêm container" (drawer footer): appends a container row
 *  to the lot through the shared container-add command
 *  (`POST /shipments/cus-workspace/:id/containers` — the single add owner of
 *  every entry point). Số container is the operator's own entry (the wire's
 *  required field); loại cont / tuyến / cảng / site / giờ hẹn / tờ khai
 *  inherit the lot's existing rows server-side (FB-086 r19 +
 *  card 181026185900). */
function AddContainerLineForm({ shipmentId, expectedVersion, onAdded, onResync }: {
  shipmentId: number;
  expectedVersion: number;
  /** Persisted-add resync: refetch the drawer detail AND ping the board. */
  onAdded: () => Promise<void>;
  /** Failure resync: refetch the drawer detail only (the version may have
   *  moved; the error toast already carried the reason). */
  onResync: () => Promise<void>;
}) {
  const toastCtx = useToastOptional();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const number = draft.trim();

  const submit = () => {
    if (saving || !number) return;
    setSaving(true);
    void addCusShipmentContainerRow(shipmentId, {
      expectedShipmentVersion: expectedVersion,
      containerNumber: number,
    }, crypto.randomUUID())
      .then(async () => {
        await onAdded();
        setSaving(false);
        setOpen(false);
        setDraft('');
        toastCtx?.toast({ kind: 'success', message: 'Đã thêm container vào lô.' });
      })
      .catch(async (error: unknown) => {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Không thể thêm container.';
        toastCtx?.toast({ kind: 'error', message });
        await onResync();
        setSaving(false);
      });
  };

  if (!open) {
    return (
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden="true" /> Thêm container
      </button>
    );
  }

  return (
    <form
      className="dispatch-container-detail__add-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="dispatch-detail-add-number">Số container</label>
      <input
        id="dispatch-detail-add-number"
        className="dispatch-container-detail__decl-input"
        value={draft}
        maxLength={50}
        placeholder="Nhập số container"
        disabled={saving}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            setDraft('');
          }
        }}
      />
      <div className="dispatch-container-detail__add-actions">
        <button type="submit" className="btn btn--primary btn--sm" disabled={saving || !number}>
          {saving ? 'Đang lưu…' : 'Thêm'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={saving} onClick={() => { setOpen(false); setDraft(''); }}>
          Hủy
        </button>
      </div>
    </form>
  );
}

/** SIL-555 (id 629) — the deleted row's name, in lockstep across three
 *  call sites that must name the SAME row: the Xóa button's aria-label, the
 *  confirm message, and the success toast. A row carrying a tờ khai never
 *  reaches the dialog — its Xóa button is disabled at the row (SIL-177 QA
 *  verdict 24/10: the FE must not warn-and-allow past the BE 409 guard;
 *  gỡ tờ khai is the operator's own separate step). */
function removeTargetName(line: ShipmentCusWorkspaceContainerLine): string {
  return line.containerNumber?.trim() || String(line.ordinal);
}

function ContainerDetailTable({ detail, savingLineId, canEditDeclarations, canRemoveContainer, removingLineId, onPortChange, onTextFieldSave, onAppointmentSave, onRemove }: {
  detail: ShipmentCusWorkspaceDetail;
  savingLineId: number | null;
  canEditDeclarations: boolean;
  /** SIL-555 — the per-row Xóa container gate (role + lock law, see the
   *  drawer's `canRemoveContainer`): when false the Thao tác column is gone,
   *  exactly like the Chi tiết lô table stays button-free (SIL-334). */
  canRemoveContainer: boolean;
  removingLineId: number | null;
  onPortChange: (line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId', value: string) => void;
  onTextFieldSave: (line: ShipmentCusWorkspaceContainerLine, field: LineTextField, next: string) => Promise<ShipmentCusContainerLineUpdateResult>;
  onAppointmentSave: (line: ShipmentCusWorkspaceContainerLine, next: string | null) => Promise<unknown>;
  onRemove: (line: ShipmentCusWorkspaceContainerLine) => void;
}) {
  if (detail.containers.length === 0) {
    return <p className="dispatch-container-detail__empty">Lô hàng chưa có dữ liệu container.</p>;
  }

  const portOptions = (detail.selectors?.ports ?? []).map((port) => ({
    value: String(port.id),
    label: port.label,
    searchText: `${port.code ?? ''} ${port.name}`,
  }));

  return (
    <div className="dispatch-container-detail__table-scroll">
      <table className="dispatch-container-detail__table">
        <caption className="sr-only">Danh sách container và điều vận</caption>
        <thead>
          <tr>
            <th scope="col" className="dispatch-container-detail__ordinal-column">STT</th>
            <th scope="col">Container</th>
            <th scope="col">Loại cont</th>
            <th scope="col">Số tờ khai</th>
            <th scope="col">Điều vận</th>
            <th scope="col">Nhà xe</th>
            <th scope="col">Biển số</th>
            <th scope="col" className="dispatch-container-detail__port-column">Nâng</th>
            <th scope="col" className="dispatch-container-detail__port-column">Hạ</th>
            <th scope="col" className="dispatch-container-detail__appointment-column">Giờ hẹn đóng/trả</th>
            {canRemoveContainer && <th scope="col" className="dispatch-container-detail__actions-column">Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {detail.containers.map((line) => {
            // SIL-555 per-row guards (mirror the remove API's own 409s at the
            // affordance level — a doomed click is never advertised): a row
            // carrying a tờ khai (SIL-177) or an active trip refuses deletion.
            // Each lock names its OWN reason — both present, both stated.
            const declaredNumber = line.declarationNumber?.trim() ?? '';
            const activeTrip = line.tripId != null && line.tripStatus !== 'CANCELED';
            const removeLockReasons = [
              ...(declaredNumber !== '' ? [`Cont có tờ khai ${declaredNumber} — gỡ tờ khai trước khi xóa`] : []),
              ...(activeTrip ? ['Container đã gắn chuyến xe — hủy hoặc thay thế lệnh điều xe trước khi xóa'] : []),
            ];
            return (
            <tr key={line.id} className="dispatch-container-detail__row">
              <td data-label="STT" className="dispatch-container-detail__ordinal-column">{line.ordinal}</td>
              <th scope="row" data-label="Container">
                <span className="dispatch-container-detail__inline-ordinal">#{line.ordinal}</span>
                <ContainerLineTextField
                  line={line}
                  field="containerNumber"
                  canEdit={lineCellEditable(line, 'containerNumber')}
                  onSave={onTextFieldSave}
                />
              </th>
              <td data-label="Loại cont">{line.containerTypeLabel || '—'}</td>
              <td data-label="Số tờ khai">
                <ContainerLineTextField
                  line={line}
                  field="declarationNumber"
                  canEdit={canEditDeclarations}
                  onSave={onTextFieldSave}
                />
              </td>
              <td data-label="Điều vận">
                <span className={`dispatch-container-detail__status dispatch-container-detail__status--${line.dispatchStatus.toLowerCase()}`}>
                  {dispatchStatusLabel(line.dispatchStatus)}
                </span>
              </td>
              <td data-label="Nhà xe">{line.carrierName || '—'}</td>
              <td data-label="Biển số">{line.plateNumber || '—'}</td>
              <td data-label="Nâng" className="dispatch-container-detail__port-column">
                {portCellEditable(line, 'liftSiteId') ? (
                  <>
                    <label className="sr-only" htmlFor={`dispatch-detail-lift-${line.id}`}>Cảng nâng của container {line.containerNumber || line.ordinal}</label>
                    <SearchableSelect
                      id={`dispatch-detail-lift-${line.id}`}
                      size="sm"
                      className="dispatch-container-detail__port-select"
                      value={line.liftSiteId ? String(line.liftSiteId) : ''}
                      onChange={(value) => onPortChange(line, 'liftSiteId', value)}
                      options={portOptions}
                      placeholder="Chọn cảng nâng"
                      searchPlaceholder="Tìm cảng nâng"
                      disabled={savingLineId != null}
                    />
                  </>
                ) : line.liftSite || '—'}
              </td>
              <td data-label="Hạ" className="dispatch-container-detail__port-column">
                {portCellEditable(line, 'dropoffSiteId') ? (
                  <>
                    <label className="sr-only" htmlFor={`dispatch-detail-drop-${line.id}`}>Cảng hạ của container {line.containerNumber || line.ordinal}</label>
                    <SearchableSelect
                      id={`dispatch-detail-drop-${line.id}`}
                      size="sm"
                      className="dispatch-container-detail__port-select"
                      value={line.dropoffSiteId ? String(line.dropoffSiteId) : ''}
                      onChange={(value) => onPortChange(line, 'dropoffSiteId', value)}
                      options={portOptions}
                      placeholder="Chọn cảng hạ"
                      searchPlaceholder="Tìm cảng hạ"
                      disabled={savingLineId != null}
                    />
                  </>
                ) : line.dropoffSite || '—'}
              </td>
              <td data-label="Giờ hẹn đóng/trả" className="dispatch-container-detail__appointment-column">
                <ContainerLineAppointmentCell
                  line={line}
                  canEdit={lineCellEditable(line, 'customerAppointmentAt')}
                  onSave={onAppointmentSave}
                />
              </td>
              {canRemoveContainer && (
                <td data-label="Thao tác" className="dispatch-container-detail__actions-column">
                  <button
                    type="button"
                    className="btn btn--danger-outline btn--sm dispatch-container-detail__remove"
                    onClick={() => onRemove(line)}
                    disabled={removingLineId != null || activeTrip || declaredNumber !== ''}
                    // SIL-555 (QA 29/10): the two locks state their reasons
                    // INDEPENDENTLY — a row carrying both must name both, so
                    // the trip-only lock is verifiable on its own terms (QA
                    // could not attribute a disabled state that only ever
                    // showed the declaration reason).
                    title={removingLineId === line.id
                      ? 'Đang xóa…'
                      : removeLockReasons.length > 0 ? removeLockReasons.join('. ') : 'Xóa container khỏi lô'}
                    aria-label={`Xóa container ${removeTargetName(line)}`}
                  >
                    Xóa container
                  </button>
                </td>
              )}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DispatchContainerDetailDrawer({
  shipment,
  onClose,
  openerRef,
  onSaved,
}: {
  shipment: ShipmentListItem | null;
  onClose: () => void;
  /** SIL-577: opener captured at interaction time — focus returns here on
   *  close. */
  openerRef?: { current: HTMLElement | null };
  /** Fired after any container-line save (ports / số cont / giờ hẹn / tờ
   *  khai) or an added container so the owning page refetches its board —
   *  the CẢNG NÂNG/HẠ and CONTAINER columns read the same container rows. */
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPortLineId, setSavingPortLineId] = useState<number | null>(null);
  const [portSaveError, setPortSaveError] = useState<string | null>(null);
  // SIL-555 (id 629): single-flight per-row remove + the confirm's target.
  // The target is a line ID (not a line object) so a resync refetch can never
  // leave the dialog confirming a stale expectedShipmentVersion.
  const [removingLineId, setRemovingLineId] = useState<number | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
  const requestIdRef = useRef(0);
  const user = useAuth()?.user;
  const toastCtx = useToastOptional();
  // SIL-551 (id 624): per-cont tờ khai writes open to Điều vận (the ticket's
  // Expected supersedes the role sentence of card 261013200312 for the
  // container-line command); every other role reads static text (the writer
  // would 403). The LOT-level declarationNumber law is untouched.
  const canEditDeclarations = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER);

  useEffect(() => {
    if (!shipment) return;
    const requestId = ++requestIdRef.current;
    setDetail(null);
    setLoading(true);
    setError(null);
    void getCusShipmentWorkspaceDetail(shipment.id)
      .then((response) => {
        if (requestId === requestIdRef.current) setDetail(response);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Không thể tải chi tiết container. Vui lòng thử lại.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [shipment]);

  /** Post-save/post-error resync: refetch without the full loading skeleton so
   *  the table (and the saved select) re-reads persisted values in place. */
  const refreshDetail = useCallback(async (shipmentId: number) => {
    const requestId = ++requestIdRef.current;
    try {
      const refreshed = await getCusShipmentWorkspaceDetail(shipmentId);
      if (requestId === requestIdRef.current) setDetail(refreshed);
    } catch {
      // The table keeps its last good data; the save error already surfaced.
    }
  }, []);

  const close = () => {
    // Focus return on close is Drawer-owned (useAnimatedOverlay captures the
    // opener when the sheet opens) — the bespoke returnFocusTarget plumbing
    // was a second implementation of the same contract (card 20261001_251).
    onClose();
  };

  /** Single-field port commit: the writer is value-aware and accepts only the
   *  changed port, so a pick sends exactly one nullable field. On failure the
   *  persisted detail refetches so the select snaps back to the stored value. */
  const savePort = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    field: 'liftSiteId' | 'dropoffSiteId',
    rawValue: string,
  ) => {
    if (!shipment || savingPortLineId != null) return;
    const portId = rawValue ? Number(rawValue) : null;
    const current = field === 'liftSiteId' ? line.liftSiteId : line.dropoffSiteId;
    if (portId === current) return;
    const shipmentId = shipment.id;
    setSavingPortLineId(line.id);
    setPortSaveError(null);
    try {
      await updateCusShipmentContainerLine(shipmentId, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
        ...(field === 'liftSiteId' ? { liftSiteId: portId } : { dropoffSiteId: portId }),
      });
      await refreshDetail(shipmentId);
      onSaved?.();
    } catch (saveError) {
      setPortSaveError(saveError instanceof Error && saveError.message
        ? saveError.message
        : 'Không thể lưu cảng nâng/hạ. Vui lòng thử lại.');
      await refreshDetail(shipmentId);
    } finally {
      setSavingPortLineId(null);
    }
  }, [shipment, savingPortLineId, refreshDetail, onSaved]);

  /** SIL-550/530 text-field commit (Số cont / Số tờ khai): the shared
   *  container-line writer, one nullable field per save. The cell owns its
   *  editing state and error toast; this callback persists, resyncs the
   *  drawer detail and pings the owning board. */
  const saveTextField = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    field: LineTextField,
    next: string,
  ) => {
    if (!shipment) throw new Error('Lô hàng không còn khả dụng.');
    const payload: ShipmentCusContainerLineUpdateInput = {
      expectedShipmentVersion: line.shipmentVersion,
      ...(field === 'containerNumber' ? { containerNumber: next || null } : { declarationNumber: next || null }),
    };
    const result = await updateCusShipmentContainerLine(shipment.id, line.id, payload, crypto.randomUUID());
    await refreshDetail(shipment.id);
    onSaved?.();
    return result;
  }, [shipment, refreshDetail, onSaved]);

  /** SIL-550 gap 3 — giờ hẹn commit, same envelope as the text fields. */
  const saveAppointment = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    next: string | null,
  ) => {
    if (!shipment) throw new Error('Lô hàng không còn khả dụng.');
    await updateCusShipmentContainerLine(shipment.id, line.id, {
      expectedShipmentVersion: line.shipmentVersion,
      customerAppointmentAt: next,
    }, crypto.randomUUID());
    await refreshDetail(shipment.id);
    onSaved?.();
  }, [shipment, refreshDetail, onSaved]);

  const handleContainerAdded = useCallback(async () => {
    if (!shipment) return;
    await refreshDetail(shipment.id);
    onSaved?.();
  }, [shipment, refreshDetail, onSaved]);

  /** SIL-555 (id 629) — the confirmed remove: the shared container-remove
   *  command (`POST /shipments/cus-workspace/:id/containers/:containerId/remove`
   *  — the CUS-10/SIL-177 owner of this verb, guards and all), then the same
   *  resync the add path owns: drawer detail refetch + board ping. A refused
   *  remove (tờ khai / chuyến xe / hết cont cuối / version) keeps the dialog
   *  open with the API reason as a toast (Hủy stays reachable) and refetches
   *  so a retry carries the fresh expectedShipmentVersion. */
  const removeContainer = useCallback(async (line: ShipmentCusWorkspaceContainerLine) => {
    if (!shipment || removingLineId != null) return;
    setRemovingLineId(line.id);
    try {
      await removeCusShipmentContainerRow(shipment.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
      }, crypto.randomUUID());
      toastCtx?.toast({ kind: 'success', message: `Đã xóa container ${removeTargetName(line)}.` });
      setPendingRemoveId(null);
      await refreshDetail(shipment.id);
      onSaved?.();
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : 'Không xóa được container.';
      toastCtx?.toast({ kind: 'error', message });
      await refreshDetail(shipment.id);
    } finally {
      setRemovingLineId(null);
    }
  }, [shipment, removingLineId, refreshDetail, onSaved, toastCtx]);

  const handleResync = useCallback(async () => {
    if (!shipment) return;
    await refreshDetail(shipment.id);
  }, [shipment, refreshDetail]);

  const retry = () => {
    if (!shipment) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    void getCusShipmentWorkspaceDetail(shipment.id)
      .then((response) => {
        if (requestId === requestIdRef.current) setDetail(response);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Không thể tải chi tiết container. Vui lòng thử lại.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  };

  /** SIL-550 gap 1 — the add control's gate mirrors the container-add
   *  endpoint: ADMIN/Quản trị, Quản lý, CUS, Điều vận; FCL (or legacy
   *  unset) lots only; no accounting lock. */
  const canAddContainer = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER)
    && detail != null
    && shipment != null
    && detail.summary.activeLock == null
    && detail.summary.cargoMode !== 'LCL';
  /** SIL-555 (id 629) — the Xóa container gate mirrors the remove endpoint's
   *  own writer law (requireWorkspaceWriter: ADMIN/MANAGER/CUS/DISPATCHER —
   *  ACCOUNTANT/DRIVER never see the button) plus the accounting lock the
   *  container-set writer refuses. Row-level guards (tờ khai / chuyến xe)
   *  live on the button itself. */
  const canRemoveContainer = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER)
    && detail != null
    && detail.summary.activeLock == null;
  const pendingRemoveLine = detail?.containers.find((line) => line.id === pendingRemoveId) ?? null;
  const addForm = canAddContainer && detail != null && shipment != null ? (
    <div className="dispatch-container-detail__add">
      <AddContainerLineForm
        shipmentId={shipment.id}
        expectedVersion={detail.summary.version}
        onAdded={handleContainerAdded}
        onResync={handleResync}
      />
    </div>
  ) : null;

  const label = billBookingReference(shipment?.blNumber, shipment?.bookingRef);
  const portEditorsAvailable = (detail?.containers ?? []).some(
    (line) => portCellEditable(line, 'liftSiteId') || portCellEditable(line, 'dropoffSiteId'),
  );
  const fieldEditorsAvailable = (detail?.containers ?? []).some(
    (line) => lineCellEditable(line, 'containerNumber') || lineCellEditable(line, 'customerAppointmentAt'),
  );
  const anyEditorAvailable = portEditorsAvailable || fieldEditorsAvailable || addForm != null;
  return (
    <Drawer
      isOpen={shipment != null}
      onClose={close}
      openerRef={openerRef}
      title="Chi tiết container"
      subtitle={shipment ? `${label}${shipment.customerName ? ` · ${shipment.customerName}` : ''}` : undefined}
      className="dispatch-container-detail-drawer"
    >
      <section className="dispatch-container-detail" aria-label="Chi tiết container">
        <header className="dispatch-container-detail__head">
          <div>
            <strong>Chi tiết container</strong>
            {detail && <span>{detail.containers.length} cont</span>}
          </div>
          <p>
            {portEditorsAvailable
              ? 'Cảng nâng/hạ bổ sung trực tiếp trong bảng; lịch giao và điều xe thuộc từng container.'
              : anyEditorAvailable
                ? 'Cập nhật container trực tiếp trong bảng; lịch giao và điều xe thuộc từng container.'
                : 'Chỉ xem tại đây; lịch giao và điều xe thuộc từng container.'}
          </p>
        </header>
        {portSaveError && <p className="dispatch-container-detail__save-error" role="alert">{portSaveError}</p>}
        {loading && !detail ? (
          <div className="dispatch-container-detail__loading"><Loader2 className="spin" aria-hidden="true" /> Đang tải dữ liệu container…</div>
        ) : error ? (
          <div className="dispatch-container-detail__error" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>Thử lại</button>
          </div>
        ) : detail ? (
          <>
            <ContainerDetailTable
              detail={detail}
              savingLineId={savingPortLineId}
              canEditDeclarations={canEditDeclarations}
              canRemoveContainer={canRemoveContainer}
              removingLineId={removingLineId}
              onPortChange={savePort}
              onTextFieldSave={saveTextField}
              onAppointmentSave={saveAppointment}
              onRemove={(line) => setPendingRemoveId(line.id)}
            />
            {addForm}
            {/* SIL-555 (id 629): the delete sits behind this danger confirm
                naming the number (SIL-472 contract — the confirm must really
                delete the row). A guard rejection keeps it open so the API
                reason (toast) and Hủy both stay reachable. */}
            <ConfirmDialog
              isOpen={pendingRemoveLine != null}
              message={pendingRemoveLine ? `Xóa container ${removeTargetName(pendingRemoveLine)}?` : ''}
              confirmLabel={removingLineId != null ? 'Đang xóa…' : 'Xóa container'}
              variant="danger"
              onConfirm={() => { if (pendingRemoveLine) void removeContainer(pendingRemoveLine); }}
              onCancel={() => { if (removingLineId == null) setPendingRemoveId(null); }}
            />
          </>
        ) : null}
      </section>
    </Drawer>
  );
}
