import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { useToastOptional } from '../../../components/shared/Toast';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';

/**
 * SIL-591/593 — the SỐ TỜ KHAI cell of the detailed-plan grid, on the
 * SIL-521 per-container model:
 *
 * - FCL row: the container's OWN number (`shipment_containers.declaration_
 *   number` — the value the per-cont command writes, so the cell shows what
 *   the edit persists, never a stale lot-level projection). Click-to-edit
 *   inline (owner ruling: the cell click IS the edit affordance — no extra
 *   Sửa button, card 20261006_537) for CUS/Quản trị/Quản lý/Điều vận — the
 *   SIL-551 (id 624) writer law for the container-line command (supersedes
 *   the role sentence of card 261013200312 per-cont; the LOT-level
 *   declarationNumber law is untouched); ACCOUNTANT and the rest get static
 *   text with no edit affordance (the server would 403).
 * - LCL row: no container — the lot's declaration list reads out as text.
 *   Lot-level editing keeps its existing homes (CusLotView / ledger /
 *   quick-edit modal); this surface stays read-only there.
 *
 * Save = POST /shipments/cus-workspace/:id/containers/:lineId with
 * `{ expectedShipmentVersion, declarationNumber }` + an Idempotency-Key (the
 * FB-109 auto-copy runs server-side; a 409 duplicate names the other lot
 * verbatim per card 20261005_354). Enter commits, Escape reverts; the cell
 * refreshes through `onSaved` so the whole board re-reads (a synced sibling
 * changes other rows too).
 */
export function DispatchDeclarationCell({ row, onSaved }: {
  row: DispatchDetailPlanRow;
  /** Called after a successful save — the page refetches the rows. */
  onSaved?: () => void;
}) {
  const toastCtx = useToastOptional();
  const user = useAuth()?.user;
  // SIL-551 (id 624) — per-cont tờ khai writes: CUS/Quản trị/Quản lý/Điều
  // vận (the container-line writer law; lot-level stays FB-005).
  const canEdit = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER)
    && row.shipmentContainerId != null;

  const propBaseline = row.cargoMode === 'FCL'
    ? (row.container.declarationNumber ?? '').trim()
    : '';
  // SIL-594 (id 694) — the save's own confirmation drives the display the
  // moment it lands: the board refetch may arrive late, arrive stale (a cache
  // replaying pre-save bytes), or not arrive at all, and reload/re-search must
  // never be how a user sees their save. The echo is keyed to BOTH values it
  // supersedes — the row prop at save time and the value the cell displayed
  // (a rapid re-save supersedes an earlier save's echo before any refetch
  // lands; the echo must still mask that value) — and self-clears the moment
  // the row prop carries anything else: a refreshed or external server value
  // always wins.
  const [echo, setEcho] = useState<{ propAtSave: string; alsoReplaces: string; fresh: string } | null>(null);
  const baseline = echo != null && (propBaseline === echo.propAtSave || propBaseline === echo.alsoReplaces)
    ? echo.fresh
    : propBaseline;
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

  // A row key change (sort/refetch) must not leak a stale draft into the new
  // row's editor state.
  const rowKey = `${row.shipmentId}:${row.shipmentContainerId ?? 'lcl'}`;
  const rowKeyRef = useRef(rowKey);
  if (rowKeyRef.current !== rowKey) {
    rowKeyRef.current = rowKey;
    setEditing(false);
    setDraft(baseline);
    // The echo belongs to the row it was saved on — never leak it onto
    // another row that happens to carry the same pre-save value (SIL-594).
    setEcho(null);
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
    // SIL-594 — the echo's identity: the row it belongs to plus BOTH values it
    // supersedes — the row prop at save time AND the value the cell displayed
    // (a rapid re-save can supersede an earlier save's echo before any refetch
    // lands; the echo must mask that value too — review finding 1).
    const savedForRow = rowKey;
    const propAtSave = propBaseline;
    const alsoReplaces = baselineRef.current;
    setSaving(true);
    void updateCusShipmentContainerLine(
      row.shipmentId,
      row.shipmentContainerId as number,
      { expectedShipmentVersion: row.shipmentVersion, declarationNumber: next || null },
      crypto.randomUUID(),
    )
      .then((result) => {
        // saving clears on BOTH exits — the cell instance survives the board
        // refetch (stable row keys), so a stale saving=true would silently
        // dead-lock the next click-to-edit on the same cell.
        setSaving(false);
        setEditing(false);
        // SIL-594 — show the just-saved value NOW (authoritative: the server
        // accepted this exact value), before any refetch reconciles the rows.
        // A save resolving after a row swap must never arm the echo onto the
        // NEW row (its prop can coincide with the old row's — review finding 2).
        if (rowKeyRef.current === savedForRow) {
          setEcho({ propAtSave, alsoReplaces, fresh: next });
        }
        const synced = result.declarationSync?.updatedContainerIds.length ?? 0;
        toastCtx?.toast({
          kind: 'success',
          message: synced > 0
            ? `Đã lưu số tờ khai — tự điền thêm cho ${synced} container còn trống của lô.`
            : 'Đã lưu số tờ khai.',
        });
        onSaved?.();
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

  // LCL rows (and any row without a container line) read the lot's list.
  if (row.cargoMode !== 'FCL') {
    const lotNumbers = (row.docs.declarationNumbers ?? []).filter((value) => value.trim());
    return (
      <div className="detailed-plan-grid__cell-body">
        <div
          className={lotNumbers.length === 0 ? 'detailed-plan-grid__line detailed-plan-grid__line--missing' : 'detailed-plan-grid__line'}
          title={lotNumbers.join(', ') || undefined}
        >
          {lotNumbers.length > 0 ? lotNumbers.join(', ') : 'Chưa có tờ khai'}
        </div>
      </div>
    );
  }

  if (editing) {
    // SIL-631 (owner 28/10, GLOBAL): the editor floats OUTSIDE the grid cell
    // through a body portal — the grid's horizontal rail can no longer clip
    // the typed value. The cell keeps its (dimmed) value while editing.
    return (
      <div className="detailed-plan-grid__cell-body" ref={anchorRef}>
        <div
          className={baseline ? 'detailed-plan-grid__line detailed-plan-grid__decl-value is-editing' : 'detailed-plan-grid__line detailed-plan-grid__line--missing is-editing'}
          title={baseline || undefined}
        >
          {baseline || 'Chưa có tờ khai'}
        </div>
        <FloatingCellEditor anchorRef={anchorRef} label="Sửa số tờ khai">
          <div className="detailed-plan-grid__cell-body detailed-plan-grid__decl-editor">
            <input
              ref={inputRef}
              className="detailed-plan-grid__decl-input"
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
            <span className="detailed-plan-grid__decl-hint">Enter lưu · Esc thoát</span>
          </div>
        </FloatingCellEditor>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="detailed-plan-grid__cell-body" ref={anchorRef}>
        <div
          className={baseline ? 'detailed-plan-grid__line detailed-plan-grid__decl-value' : 'detailed-plan-grid__line detailed-plan-grid__line--missing'}
          title={baseline || undefined}
        >
          {baseline || 'Chưa có tờ khai'}
        </div>
      </div>
    );
  }

  return (
    <div className="detailed-plan-grid__cell-body" ref={anchorRef}>
      <button
        type="button"
        className={`detailed-plan-grid__decl-value--action${baseline ? '' : ' is-empty'}`}
        onClick={openEditor}
        aria-label={`Sửa số tờ khai · ${row.container.containerNumber?.trim() || 'lô hàng lẻ'}`}
        title={baseline ? `Sửa số tờ khai: ${baseline}` : 'Bấm để nhập số tờ khai'}
      >
        {baseline || 'Chưa có tờ khai'}
      </button>
    </div>
  );
}
