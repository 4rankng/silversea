import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Role } from '@tingting/shared';
import type { ShipmentCusContainerLineUpdateResult, ShipmentCusWorkspaceContainerLine, ShipmentCusWorkspaceDetail } from '@tingting/shared';
import {
  getCusShipmentWorkspaceDetail,
  updateCusShipmentContainerLine,
  type ShipmentListItem,
} from '../../../api/shipmentClient';
import { useAuth } from '../../../hooks/useAuth';
import { useToastOptional } from '../../../components/shared/Toast';
import { dispatchStatusLabel } from '../../shipments/cus/cusUtils';
import { formatDateTime24 } from '../../../lib/format';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';
import { Drawer } from '../../../components/UI';
import { billBookingReference } from '../../../lib/business-reference';
import { SearchableSelect } from '../../../design-system';
import './DispatchContainerDetailDrawer.css';

/** Port columns are backfillable once the backend fieldAccess grants DIRECT —
 *  the same grant the Chi tiết workboard ledger already renders (the writer
 *  validates the ids against the active port catalog server-side). */
function portCellEditable(line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId') {
  return line.fieldAccess?.[field]?.mode === 'DIRECT';
}

/** SIL-530 — the SỐ TỜ KHAI cell of the master-plan container drawer, on the
 *  SIL-521 per-container model with the same interaction contract as the
 *  detailed-plan grid's `DispatchDeclarationCell` (SIL-591): the value is the
 *  container's OWN number (`shipment_containers.declaration_number` — what
 *  the per-cont command writes), click-to-edit inline is the only affordance
 *  (owner ruling 20261006_537 — no extra Sửa button), Enter commits, Escape
 *  and blur revert. Writes ride the same container-line command the ports
 *  use, so the writer's role law (card 261013200312 — CUS/Quản trị/Quản lý
 *  only) gates the affordance up front: other roles get static text, the
 *  server would 403. The FB-109 auto-copy runs server-side; the toast names
 *  the synced siblings and a 409 names the clashing lot verbatim. */
function ContainerLineDeclarationCell({ line, canEdit, onSave }: {
  line: ShipmentCusWorkspaceContainerLine;
  canEdit: boolean;
  /** Persists the value through the container-line command; the drawer
   *  refetches its detail and pings the board after a successful save. */
  onSave: (line: ShipmentCusWorkspaceContainerLine, next: string) => Promise<ShipmentCusContainerLineUpdateResult>;
}) {
  const toastCtx = useToastOptional();
  const baseline = (line.declarationNumber ?? '').trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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
    void onSave(line, next)
      .then((result) => {
        // saving clears on BOTH exits — the cell instance survives the
        // post-save refetch (stable row keys), so a stale saving=true would
        // silently dead-lock the next click-to-edit in this drawer session.
        setSaving(false);
        setEditing(false);
        const synced = result.declarationSync?.updatedContainerIds.length ?? 0;
        toastCtx?.toast({
          kind: 'success',
          message: synced > 0
            ? `Đã lưu số tờ khai — tự điền thêm cho ${synced} container còn trống của lô.`
            : 'Đã lưu số tờ khai.',
        });
      })
      .catch((error: unknown) => {
        // Card 20261005_354: surface the backend's precise reason verbatim
        // (409 trùng lô khác, 403 vai trò, 409 version conflict).
        const message = error instanceof Error && error.message
          ? error.message
          : 'Không lưu được số tờ khai.';
        toastCtx?.toast({ kind: 'error', message });
        setSaving(false);
      });
  };

  if (editing) {
    return (
      <div className="dispatch-container-detail__decl-editor">
        <input
          ref={inputRef}
          className="dispatch-container-detail__decl-input"
          value={draft}
          maxLength={50}
          disabled={saving}
          aria-label="Số tờ khai"
          placeholder="Nhập số tờ khai"
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
    );
  }

  if (!canEdit) {
    return (
      <div
        className={baseline ? 'dispatch-container-detail__decl-value' : 'dispatch-container-detail__decl-value is-empty'}
        title={baseline || undefined}
      >
        {baseline || 'Chưa có tờ khai'}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`dispatch-container-detail__decl-value--action${baseline ? '' : ' is-empty'}`}
      onClick={openEditor}
      aria-label={`Sửa số tờ khai · ${line.containerNumber?.trim() || `cont ${line.ordinal}`}`}
      title={baseline ? `Sửa số tờ khai: ${baseline}` : 'Bấm để nhập số tờ khai'}
    >
      {baseline || 'Chưa có tờ khai'}
    </button>
  );
}

function ContainerDetailTable({ detail, savingLineId, canEditDeclarations, onPortChange, onDeclarationSave }: {
  detail: ShipmentCusWorkspaceDetail;
  savingLineId: number | null;
  canEditDeclarations: boolean;
  onPortChange: (line: ShipmentCusWorkspaceContainerLine, field: 'liftSiteId' | 'dropoffSiteId', value: string) => void;
  onDeclarationSave: (line: ShipmentCusWorkspaceContainerLine, next: string) => Promise<ShipmentCusContainerLineUpdateResult>;
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
          </tr>
        </thead>
        <tbody>
          {detail.containers.map((line) => (
            <tr key={line.id} className="dispatch-container-detail__row">
              <td data-label="STT" className="dispatch-container-detail__ordinal-column">{line.ordinal}</td>
              <th scope="row" data-label="Container">
                <span className="dispatch-container-detail__inline-ordinal">#{line.ordinal}</span>
                <strong>{line.containerNumber || 'Chưa có số container'}</strong>
              </th>
              <td data-label="Loại cont">{line.containerTypeLabel || '—'}</td>
              <td data-label="Số tờ khai">
                <ContainerLineDeclarationCell
                  line={line}
                  canEdit={canEditDeclarations}
                  onSave={onDeclarationSave}
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
              <td data-label="Giờ hẹn đóng/trả" className="dispatch-container-detail__appointment-column">{formatDateTime24(formatVietnamDateTimeInput(line.customerAppointmentAt)) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DispatchContainerDetailDrawer({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: ShipmentListItem | null;
  onClose: () => void;
  /** Fired after a port backfill save so the owning page refetches its board —
   *  the CẢNG NÂNG/HẠ columns read the same container port columns. */
  onSaved?: () => void;
}) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingPortLineId, setSavingPortLineId] = useState<number | null>(null);
  const [portSaveError, setPortSaveError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  // Card 261013200312 — tờ khai writes are CUS/Quản trị/Quản lý only; every
  // other role reads static text (the writer would 403).
  const user = useAuth()?.user;
  const canEditDeclarations = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS);

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

  /** SIL-530 declaration commit: the same container-line writer the ports use
   *  with the per-cont field (FB-109 auto-copy runs server-side). The cell
   *  owns its editing state and error toast; this callback persists, resyncs
   *  the drawer detail and pings the owning board. */
  const saveDeclaration = useCallback(async (
    line: ShipmentCusWorkspaceContainerLine,
    next: string,
  ) => {
    if (!shipment) throw new Error('Lô hàng không còn khả dụng.');
    const result = await updateCusShipmentContainerLine(shipment.id, line.id, {
      expectedShipmentVersion: line.shipmentVersion,
      declarationNumber: next || null,
    }, crypto.randomUUID());
    await refreshDetail(shipment.id);
    onSaved?.();
    return result;
  }, [shipment, refreshDetail, onSaved]);

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

  const label = billBookingReference(shipment?.blNumber, shipment?.bookingRef);
  const portEditorsAvailable = (detail?.containers ?? []).some(
    (line) => portCellEditable(line, 'liftSiteId') || portCellEditable(line, 'dropoffSiteId'),
  );
  return (
    <Drawer
      isOpen={shipment != null}
      onClose={close}
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
          <ContainerDetailTable
            detail={detail}
            savingLineId={savingPortLineId}
            canEditDeclarations={canEditDeclarations}
            onPortChange={savePort}
            onDeclarationSave={saveDeclaration}
          />
        ) : null}
      </section>
    </Drawer>
  );
}
