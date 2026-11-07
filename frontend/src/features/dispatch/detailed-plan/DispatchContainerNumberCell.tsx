import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { useToastOptional } from '../../../components/shared/Toast';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';

/**
 * SIL-653 (id 760) — the SỐ CONT line of the detailed-plan grid's Container
 * column, on the SIL-591/593 per-container cell model (the SỐ TỜ KHAI cell
 * is the sibling template):
 *
 * - The number shown is `shipment_containers.container_number` — the value
 *   the container-line command writes, and since SIL-653 also the value the
 *   driver app's trip snapshot mirrors back — so the cell shows what the
 *   edit persists, never a stale projection.
 * - Click-to-edit inline (owner ruling: the cell click IS the edit
 *   affordance — card 20261006_537) for CUS/Quản trị/Quản lý/Điều vận —
 *   the same SIL-551 (id 624) writer law as the declaration cell. Everyone
 *   else gets static text with no edit affordance (the server would 403).
 * - Save = POST /shipments/cus-workspace/:id/containers/:lineId with
 *   `{ expectedShipmentVersion, containerNumber }` + an Idempotency-Key.
 *   The bridge in shipment-containers.service pushes the number onto the
 *   trip snapshot rows, so the driver app sees it; `onSaved` refetches the
 *   board so dispatch's own row updates too.
 * - Enter commits, Escape reverts. Format/check-digit and in-lot duplicate
 *   laws are enforced server-side (ISO 6346, same messages as CUS) and
 *   surface verbatim in the toast.
 */
export function DispatchContainerNumberCell({ row, onSaved }: {
  row: DispatchDetailPlanRow;
  /** Called after a successful save — the page refetches the rows. */
  onSaved?: () => void;
}) {
  const toastCtx = useToastOptional();
  const user = useAuth()?.user;
  const canEdit = user != null
    && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.CUS || user.role === Role.DISPATCHER)
    && row.shipmentContainerId != null;

  const propBaseline = (row.container.containerNumber ?? '').trim();
  // SIL-594 echo law — show the just-saved value the moment the save lands;
  // the board refetch may arrive late, stale, or never. Keyed to BOTH values
  // it supersedes and self-clears when a refreshed value differs.
  const [echo, setEcho] = useState<{ propAtSave: string; alsoReplaces: string; fresh: string } | null>(null);
  const baseline = echo != null && (propBaseline === echo.propAtSave || propBaseline === echo.alsoReplaces)
    ? echo.fresh
    : propBaseline;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const rowKey = `${row.shipmentId}:${row.shipmentContainerId ?? 'lcl'}`;
  const rowKeyRef = useRef(rowKey);
  if (rowKeyRef.current !== rowKey) {
    rowKeyRef.current = rowKey;
    setEditing(false);
    setDraft(baseline);
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
    const savedForRow = rowKey;
    const propAtSave = propBaseline;
    const alsoReplaces = baselineRef.current;
    setSaving(true);
    void updateCusShipmentContainerLine(
      row.shipmentId,
      row.shipmentContainerId as number,
      { expectedShipmentVersion: row.shipmentVersion, containerNumber: next || null },
      crypto.randomUUID(),
    )
      .then(() => {
        setSaving(false);
        setEditing(false);
        if (rowKeyRef.current === savedForRow) {
          setEcho({ propAtSave, alsoReplaces, fresh: next });
        }
        toastCtx?.toast({ kind: 'success', message: 'Đã lưu số container — đồng bộ sang điều vận, CUS và app lái xe.' });
        onSaved?.();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error && error.message
          ? error.message
          : 'Không lưu được số container.';
        toastCtx?.toast({ kind: 'error', message });
        setSaving(false);
      });
  };

  if (editing) {
    // SIL-631 — the editor floats OUTSIDE the grid cell through a body
    // portal; the cell keeps its (dimmed) value while editing.
    return (
      <div className="detailed-plan-grid__cell-body" ref={anchorRef}>
        <div
          className={baseline ? 'detailed-plan-grid__line detailed-plan-grid__line--strong ops-container-line is-editing' : 'detailed-plan-grid__line detailed-plan-grid__line--missing is-editing'}
          title={baseline || undefined}
        >
          {baseline || 'Chưa có số cont'}
        </div>
        <FloatingCellEditor anchorRef={anchorRef} label="Sửa số container">
          <div className="detailed-plan-grid__cell-body detailed-plan-grid__decl-editor">
            <input
              ref={inputRef}
              className="detailed-plan-grid__decl-input"
              value={draft}
              maxLength={50}
              disabled={saving}
              aria-label="Số container"
              placeholder="Nhập số container (ISO 6346)"
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
          className={baseline ? 'detailed-plan-grid__line detailed-plan-grid__line--strong ops-container-line' : 'detailed-plan-grid__line detailed-plan-grid__line--missing'}
          title={baseline || undefined}
        >
          {baseline || 'Chưa có số cont'}
        </div>
      </div>
    );
  }

  return (
    <div className="detailed-plan-grid__cell-body" ref={anchorRef}>
      <button
        type="button"
        className={`detailed-plan-grid__line detailed-plan-grid__line--strong ops-container-line detailed-plan-grid__decl-value--action${baseline ? '' : ' is-empty'}`}
        onClick={openEditor}
        aria-label={`Sửa số container${baseline ? ` · ${baseline}` : ''}`}
        title={baseline ? `Sửa số container: ${baseline}` : 'Bấm để nhập số container'}
      >
        {baseline || 'Chưa có số cont'}
      </button>
    </div>
  );
}
