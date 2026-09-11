// Shipment edit boundary — post-park residue. The clerk edit-boundary
// classifiers (classifyClerkShipmentPatch / classifyClerkContainerChange)
// and change-request creation were parked with the approval workflow
// (322fd31f, then removed with the 2026-09-10 phê-duyệt teardown): plan and
// container edits now save directly, and only the review surface for legacy
// pending rows keeps a decision-notification seam here.
import { NotificationType } from '@tingting/shared';

import { persistNotificationInTx } from './notification.service';
import type { Tx } from './trip-shared';

export async function persistChangeRequestDecisionNotification(tx: Tx, input: {
  shipmentId: number;
  shipmentCode: string | null;
  requesterId: number;
  resolution: 'APPLIED' | 'REJECTED';
}): Promise<void> {
  await persistNotificationInTx(tx, {
    type: NotificationType.SHIPMENT_HANDOFF,
    title: input.resolution === 'APPLIED'
      ? 'Yêu cầu thay đổi lô hàng đã được áp dụng'
      : 'Yêu cầu thay đổi lô hàng đã bị từ chối',
    message: input.resolution === 'APPLIED'
      ? `Lô ${input.shipmentCode ?? 'chưa có mã'} đã được cập nhật theo yêu cầu của bạn`
      : `Yêu cầu thay đổi cho lô ${input.shipmentCode ?? 'chưa có mã'} đã bị từ chối`,
    relatedEntityType: 'shipments',
    relatedEntityId: input.shipmentId,
    targetUserId: input.requesterId,
  });
}
