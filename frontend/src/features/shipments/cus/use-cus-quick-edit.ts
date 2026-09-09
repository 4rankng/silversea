// Inline cell-editor state machine for the CUS workboard.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split: draft lifecycle (open/close/focus-restore), the single-flight save
// guard (latest save wins), and the save orchestration — shipment PATCH with
// access-gated payload, declaration upsert alongside, 409 self-healing that
// drops the draft and refetches instead of overwriting newer data.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import {
  createShipmentDeclaration,
  updateShipment,
  updateShipmentDeclaration,
} from '../../../api/shipmentClient';
import {
  buildQuickEditDeclarationBody,
  buildQuickEditDraft,
  buildQuickEditPayload,
  isQuickEditUnchanged,
  quickEditAccessKeys,
  quickEditDeclarationChanged,
  quickEditSaveIdentity,
} from './cusQuickEditModel';
import { safeError, type ShipmentQuickEditDraft } from './cusUtils';

export interface UseCusQuickEditDeps {
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  loadList: () => Promise<void>;
  invalidateDetail: (shipmentId: number) => void;
}

export function useCusQuickEdit(deps: UseCusQuickEditDeps) {
  const { setError, setNotice, loadList, invalidateDetail } = deps;
  const [quickEditDraft, setQuickEditDraft] = useState<ShipmentQuickEditDraft | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const [quickEditError, setQuickEditError] = useState<string | null>(null);
  const quickEditSaveRef = useRef<string | null>(null);
  const quickEditFocusTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (quickEditDraft || !quickEditFocusTargetRef.current) return;
    const targetId = quickEditFocusTargetRef.current;
    const target = document.getElementById(targetId);
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    quickEditFocusTargetRef.current = null;
    target.focus();
  }, [quickEditDraft, savingQuickEdit]);

  const startQuickEdit = useCallback((item: ShipmentCusWorkspaceListItem, field: ShipmentQuickEditDraft['field']) => {
    if (field === 'schedule' && item.cargoMode === 'FCL') {
      setError('Lịch FCL được cập nhật theo từng container.');
      return;
    }
    if (quickEditSaveRef.current || quickEditDraft) return;
    const accessKeys = quickEditAccessKeys(field);
    if (!accessKeys.some((key) => item.fieldAccess[key].mode !== 'READ_ONLY')) {
      setError(item.fieldAccess[accessKeys[0]].reason);
      return;
    }
    setError(null);
    setQuickEditError(null);
    setQuickEditDraft(buildQuickEditDraft(item, field));
  }, [quickEditDraft, setError]);

  const closeQuickEdit = useCallback(() => {
    if (!quickEditDraft || quickEditSaveRef.current) return;
    quickEditFocusTargetRef.current = `cus-inline-${quickEditDraft.field}-${quickEditDraft.shipmentId}`;
    setQuickEditError(null);
    setQuickEditDraft(null);
  }, [quickEditDraft]);

  const saveQuickEdit = useCallback(async (
    item: ShipmentCusWorkspaceListItem,
    { restoreFocus = true }: { restoreFocus?: boolean } = {},
  ) => {
    const draft = quickEditDraft;
    if (!draft || draft.shipmentId !== item.id || quickEditSaveRef.current) return;
    if (draft.field === 'schedule' && draft.time && !draft.date) {
      setQuickEditError('Chọn ngày đóng/trả trước khi nhập giờ.');
      return;
    }
    const unchanged = isQuickEditUnchanged(draft, item);
    if (unchanged) {
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditError(null);
      setQuickEditDraft(null);
      return;
    }
    const saveIdentity = quickEditSaveIdentity(draft, item);
    quickEditSaveRef.current = saveIdentity;
    setSavingQuickEdit(true);
    setError(null);
    setQuickEditError(null);
    try {
      const payload = buildQuickEditPayload(draft, item);
      const declarationChanged = quickEditDeclarationChanged(draft, item);
      // When only the declaration changed (bill/booking read-only), skip the
      // shipment PATCH entirely — an empty body would still bump the version
      // and fire change-request bookkeeping for nothing.
      const shipmentKeys = Object.keys(payload).filter((key) => key !== 'expectedVersion');
      if (shipmentKeys.length > 0) {
        await updateShipment(item.id, payload);
      }
      if (declarationChanged) {
        const declarationBody = buildQuickEditDeclarationBody(draft);
        if (draft.declarationId != null) {
          await updateShipmentDeclaration(item.id, draft.declarationId, declarationBody);
        } else {
          await createShipmentDeclaration(item.id, declarationBody);
        }
      }
      if (restoreFocus) {
        quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
      }
      setQuickEditDraft((current) => current?.shipmentId === draft.shipmentId && current.field === draft.field ? null : current);
      setNotice(draft.field === 'schedule' ? 'Đã cập nhật lịch đóng/trả.'
        : draft.field === 'notes' ? 'Đã cập nhật ghi chú lô hàng.'
          : draft.field === 'documents' && declarationChanged ? 'Đã cập nhật chứng từ lô hàng.'
            : 'Đã lưu ô dữ liệu lô hàng.');
      invalidateDetail(item.id);
      await loadList();
    } catch (quickEditError) {
      if (quickEditSaveRef.current === saveIdentity) {
        if (quickEditError instanceof ApiError && quickEditError.status === 409) {
          quickEditFocusTargetRef.current = `cus-inline-${draft.field}-${draft.shipmentId}`;
          setQuickEditDraft(null);
          setQuickEditError(null);
          setNotice('Dữ liệu hoặc quyền chỉnh sửa vừa thay đổi. Đã tải bản mới nhất và bỏ bản nháp cũ để tránh ghi đè.');
          await loadList();
        } else {
          setQuickEditError(safeError(quickEditError, 'Không thể lưu ô đang chỉnh sửa.'));
        }
      }
    } finally {
      if (quickEditSaveRef.current === saveIdentity) {
        quickEditSaveRef.current = null;
        setSavingQuickEdit(false);
      }
    }
  }, [invalidateDetail, loadList, quickEditDraft, setError, setNotice]);

  return {
    quickEditDraft, setQuickEditDraft, savingQuickEdit,
    quickEditError, setQuickEditError, startQuickEdit, closeQuickEdit, saveQuickEdit,
  };
}
