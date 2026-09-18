// Bulk appointment copy for the detail workboard (2026-09-18 customer request).
//
// This workboard has no shared draft session — every container saves on its
// own — so a multi-container lot delivering on one day meant one popover plus
// one save per container. A row that already has an appointment writes that
// same datetime to every container of ITS LOT still empty and writable.
//
// The target set comes from the lot's own detail read, not from the page: the
// customer asked for "all containers of the lot", and the page can filter or
// paginate a lot's containers apart. Writes are sequential and thread the
// shipment version each response hands back, so a lot-wide batch cannot 409
// against itself; a mid-batch conflict stops, reloads, and reports how far it
// got instead of overwriting blind.
//
// Split out of use-cus-detail.ts (structure-guard ratchet); the hook owns the
// session, this owns the batch.

import { useCallback, useState, type RefObject } from 'react';
import type { ShipmentCusContainerFlatRow } from '@tingting/shared';
import { getCusShipmentWorkspaceDetail, updateCusShipmentContainerLine } from '../../../api/shipmentClient';
import { isOptimisticShipmentConflict } from './cusDetailModel';
import { safeError } from './cusUtils';

export interface AppointmentCopyDeps {
  /** An inline edit session is open — it wins over a competing batch. */
  isEditing: boolean;
  /** Refetch the workboard rows after the batch so the page matches the server. */
  reload: () => Promise<void>;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  keys: RefObject<Record<string, string>>;
}

export function useAppointmentCopy({ isEditing, reload, setError, setNotice, keys }: AppointmentCopyDeps) {
  const [copyingAppointment, setCopyingAppointment] = useState(false);

  const copyAppointmentToEmpty = useCallback(async (source: ShipmentCusContainerFlatRow): Promise<number> => {
    const appointmentAt = source.customerAppointmentAt;
    if (!appointmentAt || copyingAppointment) return 0;
    if (isEditing) throw new Error('Đang mở một dòng chỉnh sửa. Lưu hoặc hủy dòng đó trước khi copy.');
    setCopyingAppointment(true);
    setError(null);
    setNotice(null);
    let copied = 0;
    let total = 0;
    try {
      const detail = await getCusShipmentWorkspaceDetail(source.shipmentId);
      const targets = detail.containers.filter((container) => (
        container.id !== source.id
        && container.customerAppointmentAt == null
        && container.permissions.customerAppointmentEditable
      ));
      total = targets.length;
      if (total === 0) {
        await reload();
        setNotice('Lô này không còn container nào cần copy giờ hẹn.');
        return 0;
      }
      let expectedShipmentVersion = detail.summary.version;
      for (const target of targets) {
        const signature = JSON.stringify(['appointment-copy', source.shipmentId, target.id, expectedShipmentVersion, appointmentAt]);
        const key = keys.current[signature] ?? crypto.randomUUID();
        keys.current[signature] = key;
        try {
          const result = await updateCusShipmentContainerLine(source.shipmentId, target.id, {
            expectedShipmentVersion,
            customerAppointmentAt: appointmentAt,
          }, key);
          delete keys.current[signature];
          expectedShipmentVersion = result.line.shipmentVersion;
          copied += 1;
        } catch (error) {
          delete keys.current[signature];
          throw error;
        }
      }
      await reload();
      setNotice(`Đã copy ngày giờ đóng trả sang ${copied} container chưa có lịch.`);
      return copied;
    } catch (error) {
      await reload();
      setError(isOptimisticShipmentConflict(error)
        ? `Dữ liệu lô hàng vừa thay đổi nên copy đã dừng${copied > 0 ? ` sau ${copied}/${total} container` : ''}. Đã tải bản mới nhất — vui lòng thử lại.`
        : safeError(error, 'Không thể copy ngày giờ đóng trả.'));
      return copied;
    } finally {
      setCopyingAppointment(false);
    }
  }, [copyingAppointment, isEditing, keys, reload, setError, setNotice]);

  return { copyingAppointment, copyAppointmentToEmpty };
}
