// Lot-action confirmation dialog (xác nhận nguồn chi phí / khóa lô / xóa lô /
// gửi điều chỉnh) split out of pages/ShipmentsPage.tsx so the page stays under
// its frozen structure-guard ceiling — behavior is verbatim from that file.

import { Loader2 } from 'lucide-react';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { Modal } from '../UI';

/** Contract of the lot-action controller this dialog consumes; the
 *  useCusActions return satisfies it structurally. */
export interface ShipmentActionController {
  actionItem: ShipmentCusWorkspaceListItem | null;
  actionMode: 'confirm' | 'lock' | 'reopen' | 'delete' | null;
  reason: string;
  setReason: (reason: string) => void;
  submitting: boolean;
  closeAction: () => void;
  submitAction: () => void | Promise<void>;
}

export function ShipmentActionModal({ actions }: { actions: ShipmentActionController }) {
  return (
    <Modal
      isOpen={Boolean(actions.actionItem && actions.actionMode)}
      title={actions.actionMode === 'confirm' ? 'Xác nhận nguồn chi phí' : actions.actionMode === 'lock' ? 'Xác nhận khóa lô' : actions.actionMode === 'delete' ? 'Xóa lô hàng' : 'Điều chỉnh lô hàng'}
      onClose={actions.closeAction}
      onConfirm={() => void actions.submitAction()}
      footer={(
        <>
          <button type="button" className="btn btn--ghost" onClick={actions.closeAction} disabled={actions.submitting}>Hủy</button>
          <button type="button" className="btn btn--primary" onClick={() => void actions.submitAction()} disabled={actions.submitting || !actions.reason.trim()}>
            {actions.submitting ? <Loader2 className="spin" size={17} aria-hidden="true" /> : null}
            {actions.actionMode === 'confirm' ? 'Xác nhận chi phí' : actions.actionMode === 'lock' ? 'Khóa lô' : actions.actionMode === 'delete' ? 'Xóa lô hàng' : 'Gửi điều chỉnh'}
          </button>
        </>
      )}
    >
      {actions.actionMode === 'confirm' ? (
        <p>Xác nhận này chụp lại phiên bản Debit Note, chuyến xe và chi phí hiện hành. Nếu nguồn thay đổi, xác nhận sẽ hết hiệu lực.</p>
      ) : actions.actionMode === 'lock' ? (
        <p>Khóa lô sẽ chuyển toàn bộ trường nhập và tệp tải lên sang chế độ chỉ đọc. Chỉ người có quyền mở khóa mới có thể mở lại dữ liệu.</p>
      ) : actions.actionMode === 'delete' ? (
        <p>Xóa lô hàng sẽ loại bỏ hoàn toàn dữ liệu. Thao tác không thể hoàn tác.</p>
      ) : (
        <p>Ghi rõ lý do điều chỉnh.</p>
      )}
      <label className="cus-action-reason">
        <span>{actions.actionMode === 'confirm' ? 'Lý do xác nhận' : actions.actionMode === 'lock' ? 'Lý do khóa' : actions.actionMode === 'delete' ? 'Lý do xóa' : 'Lý do điều chỉnh'}</span>
        <textarea value={actions.reason} onChange={(event) => actions.setReason(event.target.value)} rows={4} maxLength={500} required autoFocus />
        <small>{actions.reason.length}/500 ký tự</small>
      </label>
    </Modal>
  );
}
