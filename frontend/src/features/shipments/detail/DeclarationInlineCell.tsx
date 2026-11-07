import { useEffect, useRef, useState } from 'react';
import { useToastOptional } from '../../../components/shared/Toast';
import { FloatingCellEditor } from '../../../components/FloatingCellEditor';
import { updateCusShipmentContainerLine } from '../../../api/shipmentClient';

/**
 * The shared inline "Số tờ khai" cell — click the value, edit it in the
 * shared floating editor, Enter commits / Esc reverts.
 *
 * It owns the INTERACTION for the two surfaces that edit a container's
 * declaration number the same way:
 *  - the dispatch detail-plan grid (`DispatchDeclarationCell`);
 *  - the CUS lot page `/shipments/:id` in view mode (SIL-720, id 840 — the
 *    customer asked to edit the declaration INLINE on the lot page instead of
 *    opening "Sửa" (the whole form) or moving to the /shipments-detail grid).
 *
 * (The master-plan container drawer keeps its own click-to-edit text cell: it
 * edits the container NUMBER on the same interaction, so it is a different
 * field set — migrating it is a separate change.)
 *
 * Save = POST /shipments/cus-workspace/:id/containers/:containerId with
 * `{ expectedShipmentVersion, declarationNumber }` + an Idempotency-Key. The
 * FB-109 auto-copy (a number fills the lot's still-empty sibling containers)
 * runs server-side, so the caller refreshes the surface to show it.
 *
 * SIL-594 echo: the save's own confirmation drives the display the moment it
 * lands — the board/workspace refetch may arrive late, arrive stale (a cache
 * replaying pre-save bytes), or not arrive at all, and reload/re-search must
 * never be how a user sees their save. The echo is keyed to BOTH values it
 * supersedes (the prop at save time and the value the cell displayed) and
 * self-clears the moment the prop carries anything else.
 */
export interface DeclarationInlineCellClassNames {
  /** The cell body wrapper (the dimmed value while editing). */
  body?: string;
  /** The value line — shown while editing. */
  value?: string;
  /** The empty-value line — shown while editing. */
  missing?: string;
  /** The click-to-edit trigger (the value at rest). */
  trigger?: string;
  /** The trigger's empty state. */
  triggerEmpty?: string;
  /** The editor panel body. */
  editor?: string;
  /** The text input. */
  input?: string;
  /** The "Enter lưu · Esc thoát" hint. */
  hint?: string;
}

export function DeclarationInlineCell({
  shipmentId,
  containerId,
  expectedShipmentVersion,
  value,
  canEdit,
  disabled = false,
  onSaved,
  emptyLabel = 'Chưa có tờ khai',
  ariaLabel = 'Sửa số tờ khai',
  classNames,
}: {
  /** The lot that owns the container. */
  shipmentId: number;
  /** The container line — the command writes ONE container's declaration. */
  containerId: number;
  /** The lot version the command guards against (409 on a stale write). */
  expectedShipmentVersion: number;
  /** The container's current declaration number ('' = none). */
  value: string;
  /** The writer law: without it the cell reads as plain text (the server
   *  would 403 — SIL-551). */
  canEdit: boolean;
  /** A save in flight (or a frozen surface) blocks the editor. */
  disabled?: boolean;
  /** Called after a successful save — the surface refreshes so the synced
   *  sibling containers show the auto-copied number. */
  onSaved?: () => void;
  emptyLabel?: string;
  /** The trigger's accessible name. */
  ariaLabel?: string;
  /** Per-surface skin — the shared component owns the behaviour, each surface
   *  keeps its own classes. */
  classNames?: DeclarationInlineCellClassNames;
}) {
  const toastCtx = useToastOptional();
  const propBaseline = value.trim();
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
  const rowKey = `${shipmentId}:${containerId}`;
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
    if (!canEdit || disabled || saving) return;
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
      shipmentId,
      containerId,
      { expectedShipmentVersion, declarationNumber: next || null },
      crypto.randomUUID(),
    )
      .then((result) => {
        // saving clears on BOTH exits — the cell instance survives the refetch
        // (stable row keys), so a stale saving=true would silently dead-lock
        // the next click-to-edit on the same cell.
        setSaving(false);
        setEditing(false);
        // SIL-594 — show the just-saved value NOW (authoritative: the server
        // accepted this exact value), before any refetch reconciles the rows.
        // A save resolving after a row swap must never arm the echo onto the
        // NEW row (its prop can coincide with the old row's).
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

  if (editing) {
    // SIL-631 (owner 28/10, GLOBAL): the editor floats OUTSIDE the cell
    // through a body portal — a narrow column (or any `overflow` scroll box)
    // can never clip the typed value. The cell keeps its (dimmed) value while
    // editing.
    return (
      <div className={classNames?.body} ref={anchorRef}>
        <div
          className={baseline ? `${classNames?.value ?? ''} is-editing` : `${classNames?.missing ?? ''} is-editing`}
          title={baseline || undefined}
        >
          {baseline || emptyLabel}
        </div>
        <FloatingCellEditor anchorRef={anchorRef} label={ariaLabel}>
          <div className={classNames?.editor}>
            <input
              ref={inputRef}
              className={classNames?.input}
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
            <span className={classNames?.hint}>Enter lưu · Esc thoát</span>
          </div>
        </FloatingCellEditor>
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className={classNames?.body} ref={anchorRef}>
        <div
          className={baseline ? classNames?.value : classNames?.missing}
          title={baseline || undefined}
        >
          {baseline || emptyLabel}
        </div>
      </div>
    );
  }

  return (
    <div className={classNames?.body} ref={anchorRef}>
      <button
        type="button"
        className={`${classNames?.trigger ?? ''}${baseline ? '' : ' is-empty'}`}
        onClick={openEditor}
        // WCAG 2.5.3 (Label in Name): the visible TEXT is the button's text,
        // so it belongs in the accessible name too — an aria-label alone would
        // drop it from the accessibility tree (the cell's own display line is
        // the value, and it steps aside for this trigger).
        aria-label={baseline ? `${ariaLabel}: ${baseline}` : `${ariaLabel}: ${emptyLabel}`}
        title={baseline ? `Sửa số tờ khai: ${baseline}` : 'Bấm để nhập số tờ khai'}
      >
        {baseline || emptyLabel}
      </button>
    </div>
  );
}
