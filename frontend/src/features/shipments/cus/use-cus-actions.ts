// Governed bucket actions + document-custody updates for the CUS workboard.
//
// Extracted verbatim from pages/ShipmentsPage.tsx in the 2026-09-01 structural
// split: the confirm/lock/reopen/delete modal state machine, signature-keyed
// idempotency, and the optimistic-version guards each action must carry.

import { useCallback, useState } from 'react';
import type { ShipmentCusWorkspaceListItem, ShipmentDocumentCustody } from '@tingting/shared';
import {
  confirmCusShipmentFinance,
  lockCusShipment,
  requestCusShipmentReopen,
  deleteCusShipment,
  updateCusShipmentDocumentCustody,
} from '../../../api/shipmentClient';
import { idempotencySignature, safeError } from './cusUtils';

export interface UseCusActionsDeps {
  dirtyDetailIds: Set<number>;
  drawerId: number | null;
  setDrawerId: (id: number | null) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
  loadList: () => Promise<void>;
  loadDetail: (shipmentId: number, force?: boolean) => Promise<void>;
  invalidateDetail: (shipmentId: number) => void;
  getIdempotencyKey: (signature: string) => string;
  clearIdempotencyKey: (signature: string) => void;
}

export function useCusActions(deps: UseCusActionsDeps) {
  const {
    dirtyDetailIds, drawerId, setDrawerId, setError, setNotice,
    loadList, loadDetail, invalidateDetail, getIdempotencyKey, clearIdempotencyKey,
  } = deps;
  const [actionItem, setActionItem] = useState<ShipmentCusWorkspaceListItem | null>(null);
  const [actionMode, setActionMode] = useState<'confirm' | 'lock' | 'reopen' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateCustody = useCallback(async (item: ShipmentCusWorkspaceListItem, status: ShipmentDocumentCustody) => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi cập nhật phơi phiếu.');
      return;
    }
    setNotice(null);
    try {
      const signature = idempotencySignature('custody', item.id, item.version, status);
      await updateCusShipmentDocumentCustody(
        item.id,
        { expectedShipmentVersion: item.version, status },
        getIdempotencyKey(signature),
      );
      clearIdempotencyKey(signature);
      setNotice('Đã cập nhật trạng thái phơi phiếu.');
      await Promise.all([loadList(), loadDetail(item.id, true)]);
    } catch (custodyError) {
      setError(safeError(custodyError, 'Không thể cập nhật trạng thái phơi phiếu.'));
    }
  }, [clearIdempotencyKey, dirtyDetailIds, getIdempotencyKey, loadDetail, loadList, setError, setNotice]);

  const openAction = useCallback((item: ShipmentCusWorkspaceListItem, mode: 'confirm' | 'lock' | 'reopen' | 'delete') => {
    if (dirtyDetailIds.has(item.id)) {
      setError('Hãy lưu hoặc bỏ thay đổi container trước khi thực hiện thao tác này.');
      return;
    }
    setActionItem(item);
    setActionMode(mode);
    setDrawerId(null);
    setReason(
      mode === 'confirm'
        ? 'Kế toán xác nhận nguồn chi phí hiện hành của lô.'
        : mode === 'lock'
          ? 'CUS khóa dữ liệu đã đối soát của lô.'
          : mode === 'delete'
            ? ''
            : '',
    );
  }, [dirtyDetailIds, setDrawerId, setError]);

  const closeAction = useCallback(() => {
    if (submitting) return;
    setActionItem(null);
    setActionMode(null);
    setReason('');
  }, [submitting]);

  const submitAction = useCallback(async () => {
    if (!actionItem || !actionMode || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const signature = idempotencySignature('action', actionItem.id, actionMode, actionItem.version);
      const idempotencyKey = getIdempotencyKey(signature);
      if (actionMode === 'confirm') {
        if (!actionItem.debitNote.billingDocumentId) {
          throw new Error(actionItem.debitNote.disabledReason || 'Chưa có Debit Note đủ điều kiện để xác nhận.');
        }
        await confirmCusShipmentFinance(actionItem.id, {
          expectedVersion: actionItem.version,
          billingDocumentId: actionItem.debitNote.billingDocumentId,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã xác nhận nguồn chi phí của lô hàng.');
      } else if (actionMode === 'lock') {
        const confirmation = actionItem.accountingConfirmation;
        if (!confirmation.confirmationId || !confirmation.checksum) {
          throw new Error('Xác nhận Kế toán không còn hợp lệ. Vui lòng tải lại dữ liệu.');
        }
        await lockCusShipment(actionItem.id, {
          expectedVersion: actionItem.version,
          confirmationId: confirmation.confirmationId,
          confirmationChecksum: confirmation.checksum,
          reason: reason.trim(),
          acknowledged: true,
        }, idempotencyKey);
        setNotice('Đã khóa lô hàng. Mọi trường nhập và tệp tải lên hiện ở chế độ chỉ đọc.');
      } else if (actionMode === 'delete') {
        await deleteCusShipment(actionItem.id, actionItem.version, reason.trim(), idempotencyKey);
        setNotice('Đã xóa lô hàng.');
      } else {
        if (!actionItem.activeLock?.id) {
          throw new Error('Không tìm thấy khóa lô hiện hành. Vui lòng tải lại dữ liệu.');
        }
        await requestCusShipmentReopen(actionItem.id, {
          expectedShipmentVersion: actionItem.version,
          activeLockId: actionItem.activeLock.id,
          reason: reason.trim(),
        }, idempotencyKey);
        setNotice('Đã mở lại lô hàng. Debit Note cần đối soát lại trước lần chốt tiếp theo.');
      }
      clearIdempotencyKey(signature);
      setActionItem(null);
      setActionMode(null);
      setReason('');
      invalidateDetail(actionItem.id);
      if (drawerId === actionItem.id) void loadDetail(actionItem.id, true);
      await loadList();
    } catch (actionError) {
      setError(safeError(actionError, 'Không thể hoàn tất thao tác.'));
    } finally {
      setSubmitting(false);
    }
  }, [actionItem, actionMode, clearIdempotencyKey, drawerId, getIdempotencyKey, invalidateDetail, loadDetail, loadList, reason, setError, setNotice]);

  return {
    actionItem, actionMode, reason, setReason, submitting,
    openAction, closeAction, submitAction, updateCustody,
  };
}
