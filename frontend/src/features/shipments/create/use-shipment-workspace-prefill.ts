import { useEffect, useRef, useState } from 'react';
import { getShipmentDetail } from '../../../api/shipmentClient';
import type { ShipmentContainerDraft, ShipmentCreateFormState } from './shipment-create-model';
import { buildShipmentEditPrefill, type ShipmentEditSeed } from './shipment-edit-prefill';

interface UseShipmentWorkspacePrefillArgs {
  /** The pinned lot — undefined in plain create mode (no fetch at all). */
  pinnedShipmentId: number | undefined;
  /** SIL-481 view mode: a locked lot still READS; the lock is reported
   *  through `viewLocked` instead of refusing the surface like edit mode. */
  viewMode: boolean;
  /** Stable useState setters — the effect owns the prefill commit. */
  setForm: (form: ShipmentCreateFormState) => void;
  setContainers: (containers: ShipmentContainerDraft[]) => void;
  setCustomerNotes: (notes: string) => void;
}

/**
 * SIL-171 (FB-147): load the pinned lot ONCE per shipmentId and prefill the
 * whole create form — same fields, same layout as "Tạo lô hàng", including
 * the Hình thức XNK radio. SIL-481 view mode rides the SAME fetch/prefill.
 *
 * Extracted from ShipmentCreateWorkspace so the worksheet keeps its frozen
 * structure-guard ceiling (split debt tracked on the D1 note since
 * 20260920_13); the mapping itself stays in shipment-edit-prefill.ts.
 *
 * A stale-response guard keeps a rapid id change from overwriting the newer
 * prefill. The dependency is the SCALAR id (not the target object) so a
 * re-render with a fresh prop literal cannot re-run the fetch and wipe
 * in-progress edits.
 */
export function useShipmentWorkspacePrefill({
  pinnedShipmentId,
  viewMode,
  setForm,
  setContainers,
  setCustomerNotes,
}: UseShipmentWorkspacePrefillArgs) {
  const [editSeed, setEditSeed] = useState<ShipmentEditSeed | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  // SIL-481 view mode: a locked lot still READS fine — the lock only disables
  // "Sửa" (edit mode refuses to open at all, see the fetch below).
  const [viewLocked, setViewLocked] = useState(false);
  // The pristine baseline the leave-confirm dirty diff reads (edit + view).
  const editBaselineRef = useRef<string | null>(null);
  const editRequestRef = useRef(0);

  useEffect(() => {
    if (pinnedShipmentId == null) return;
    const reqId = ++editRequestRef.current;
    setEditLoadError(null);
    setViewLocked(false);
    setEditSeed(null);
    getShipmentDetail(pinnedShipmentId)
      .then((detail) => {
        if (editRequestRef.current !== reqId) return;
        const prefill = buildShipmentEditPrefill(detail);
        // Server refuses every non-notes write on a locked lot (ruling
        // 2026-09-20 carve-out aside) — arming a full editable form would
        // waste the whole edit on a guaranteed 409, so the lock stops edit
        // mode here. The read-only view keeps reading; its edit button
        // disables instead (viewLocked).
        if (detail.accountingLock) {
          if (!viewMode) {
            setEditLoadError('Lô hàng đã bị khóa kế toán nên không thể sửa thông tin. Ghi chú vẫn sửa được ở Tổng quan.');
            return;
          }
          setViewLocked(true);
        }
        setForm(prefill.form);
        setContainers(prefill.containers);
        setCustomerNotes(prefill.customerNotes);
        editBaselineRef.current = JSON.stringify([prefill.form, prefill.containers, prefill.customerNotes]);
        setEditSeed(prefill.seed);
      })
      .catch(() => {
        if (editRequestRef.current !== reqId) return;
        setEditLoadError(viewMode
          ? 'Không thể tải thông tin lô hàng. Vui lòng thử lại.'
          : 'Không thể tải thông tin lô hàng để sửa. Vui lòng thử lại.');
      });
    // The setters are stable useState fns; pinnedShipmentId is the scalar the
    // comment above describes.
  }, [pinnedShipmentId, setContainers, setCustomerNotes, setForm, viewMode]);

  return { editSeed, editLoadError, viewLocked, editBaselineRef };
}
