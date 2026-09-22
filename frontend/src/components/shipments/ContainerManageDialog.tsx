// Card 20260922_41 — "Quản lý container" dialog: LOT-level container
// composition (add / remove) opened from the /shipments FCL "Tổng quan hàng
// hóa" cell. Container-level operation (schedule, vehicle, per-row params)
// stays on /shipments-detail; add/remove lives here and only here.
//
// The 409 trip guard is reused verbatim server-side (removeCusShipmentContainer
// rejects tripped rows) — this dialog only moves the trigger forward: a row
// with a live trip shows a disabled delete with the guard's client-side
// presentation instead of failing after the click.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
  ShipmentCusWorkspaceListItem,
} from '@tingting/shared';
import {
  addCusShipmentContainerRow,
  getCusShipmentWorkspaceDetail,
  removeCusShipmentContainerRow,
} from '../../api/shipmentClient';
import { formatDateTimeShort } from '../../lib/format';
import { localDateTimeToIso } from '../../lib/shipment-operations';
import {
  dispatchStatusLabel,
  formatQuantity,
  safeError,
} from '../../features/shipments/cus/cusUtils';
import { Modal } from '../UI';
import { Button as UUIButton } from '../untitled-ui/base/buttons/button';
import { UuiSelectField } from '../../design-system';
import './ContainerManageDialog.css';

export interface ContainerManageDialogProps {
  /** The lot being managed; null closes the dialog. */
  shipment: ShipmentCusWorkspaceListItem | null;
  onClose: () => void;
  /** Called after a successful add/remove so the host row summary (2x40HC ·
   *  5.000 kg) updates immediately without closing the dialog. */
  onChanged: () => void;
}

export function ContainerManageDialog({ shipment, onClose, onChanged }: ContainerManageDialogProps) {
  const [detail, setDetail] = useState<ShipmentCusWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [typeId, setTypeId] = useState('');
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [formError, setFormError] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!shipment) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const workspace = await getCusShipmentWorkspaceDetail(shipment.id);
      if (requestId === requestIdRef.current) setDetail(workspace);
    } catch (error) {
      if (requestId === requestIdRef.current) setLoadError(safeError(error, 'Không thể tải danh sách container.'));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [shipment]);

  useEffect(() => {
    requestIdRef.current += 1;
    setDetail(null);
    setWriteError(null);
    setBusy(false);
    setAddOpen(false);
    setNumber('');
    setTypeId('');
    setWeight('');
    setDate('');
    setTime('');
    setFormError('');
    if (shipment) void load();
    return () => { requestIdRef.current += 1; };
  }, [shipment, load]);

  async function removeLine(line: ShipmentCusWorkspaceContainerLine) {
    if (!shipment || !detail || busy || line.tripId != null) return;
    setBusy(true);
    setWriteError(null);
    try {
      await removeCusShipmentContainerRow(shipment.id, line.id, {
        expectedShipmentVersion: line.shipmentVersion,
      });
      await load();
      onChanged();
    } catch (error) {
      setWriteError(safeError(error, 'Không thể xóa container. Vui lòng thử lại.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (!shipment || !detail || busy) return;
    if (!number.trim()) {
      setFormError('Số container là bắt buộc.');
      return;
    }
    if ((date ? 1 : 0) !== (time ? 1 : 0)) {
      setFormError('Vui lòng nhập đầy đủ cả Ngày và Giờ đóng/trả.');
      return;
    }
    setBusy(true);
    setFormError('');
    setWriteError(null);
    try {
      await addCusShipmentContainerRow(shipment.id, {
        expectedShipmentVersion: detail.summary.version,
        containerNumber: number.trim().toUpperCase(),
        ...(typeId ? { containerTypeId: Number(typeId) } : {}),
        ...(weight.trim() ? { cargoWeightKg: weight.trim() } : {}),
        ...(date && time ? { customerAppointmentAt: localDateTimeToIso(`${date}T${time}`) } : {}),
      });
      setNumber('');
      setTypeId('');
      setWeight('');
      setDate('');
      setTime('');
      setAddOpen(false);
      await load();
      onChanged();
    } catch (error) {
      setFormError(safeError(error, 'Không thể thêm container. Vui lòng thử lại.'));
    } finally {
      setBusy(false);
    }
  }

  const reference = shipment
    ? shipment.billOrBookNumber || shipment.declarationNumber || shipment.customerName || 'Lô hàng'
    : 'Lô hàng';
  const lines = detail?.containers ?? [];

  return (
    <Modal
      isOpen={shipment != null}
      title={`Quản lý container — Lô ${reference}`}
      onClose={onClose}
      maxWidth={760}
    >
      <div className="cus-container-manage" aria-busy={loading || busy || undefined}>
        {loading && <p className="cus-container-manage__notice">Đang tải danh sách container…</p>}
        {loadError && (
          <p className="cus-container-manage__error" role="alert">
            {loadError}{' '}
            <UUIButton size="xs" color="secondary" onPress={() => void load()}>Thử lại</UUIButton>
          </p>
        )}
        {writeError && <p className="cus-container-manage__error" role="alert">{writeError}</p>}
        {detail && (
          <>
            {lines.length === 0 ? (
              <p className="cus-container-manage__notice">Chưa có container trong lô này.</p>
            ) : (
              <table className="cus-container-manage__table">
                <caption className="sr-only">Danh sách container của lô hàng</caption>
                <colgroup>
                  <col className="cus-container-manage__col--stt" />
                  <col className="cus-container-manage__col--number" />
                  <col className="cus-container-manage__col--type" />
                  <col className="cus-container-manage__col--weight" />
                  <col className="cus-container-manage__col--schedule" />
                  <col className="cus-container-manage__col--dispatch" />
                  <col className="cus-container-manage__col--actions" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">STT</th>
                    <th scope="col">Số container</th>
                    <th scope="col">Loại cont</th>
                    <th scope="col">Trọng lượng</th>
                    <th scope="col">Lịch hẹn</th>
                    <th scope="col">Trạng thái điều xe</th>
                    <th scope="col">Xóa</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const containerNumber = line.raw.containerNumber ?? line.containerNumber;
                    // tripId != null = a live dispatch trip holds this row —
                    // exactly the trigger of the backend 409 removal guard.
                    const attached = line.tripId != null;
                    return (
                      <tr key={line.id}>
                        <th scope="row" data-label="STT">{line.ordinal}</th>
                        <td data-label="Số container">
                          <span className="cus-container-manage__code">{containerNumber || 'Chưa có số container'}</span>
                        </td>
                        <td data-label="Loại cont">{line.containerTypeLabel || 'Chưa có loại cont'}</td>
                        <td data-label="Trọng lượng">
                          {line.raw.cargoWeightKg ? `${formatQuantity(line.raw.cargoWeightKg)} kg` : 'Chưa có trọng lượng'}
                        </td>
                        <td data-label="Lịch hẹn">
                          {line.customerAppointmentAt ? formatDateTimeShort(line.customerAppointmentAt) : 'Chưa có lịch hẹn'}
                        </td>
                        <td data-label="Trạng thái điều xe">{dispatchStatusLabel(line.dispatchStatus)}</td>
                        <td data-label="Xóa" className="cus-container-manage__cell--actions">
                          <button
                            type="button"
                            className="cus-container-manage__remove"
                            aria-label={`Xóa container ${containerNumber || line.ordinal}`}
                            title={attached ? 'Không thể xóa container đã gắn chuyến xe' : undefined}
                            disabled={attached || busy}
                            onClick={() => void removeLine(line)}
                          >
                            <Trash2 size={15} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {!addOpen ? (
              <UUIButton
                size="sm"
                color="secondary"
                className="cus-container-manage__add-toggle"
                onPress={() => setAddOpen(true)}
                isDisabled={busy}
                iconLeading={<Plus size={15} aria-hidden="true" />}
              >
                + Thêm container
              </UUIButton>
            ) : (
              <form
                className="cus-container-manage__quick-add"
                aria-label="Thêm container nhanh"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAdd();
                }}
              >
                <label>
                  <span>Số container</span>
                  <input value={number} onChange={(event) => setNumber(event.target.value.toUpperCase())} maxLength={50} disabled={busy} />
                </label>
                <UuiSelectField
                  label="Loại container"
                  value={typeId}
                  onChange={(event) => setTypeId(event.target.value)}
                  disabled={busy}
                  options={[
                    { value: '', label: 'Chưa chọn loại cont' },
                    ...detail.selectors.containerTypes.map((type) => ({ value: String(type.id), label: type.label })),
                  ]}
                  wrapperClassName="cus-container-manage__field"
                />
                <label>
                  <span>Trọng lượng (kg)</span>
                  <input type="number" min="0" step="0.01" value={weight} onChange={(event) => setWeight(event.target.value)} disabled={busy} />
                </label>
                <label>
                  <span>Ngày đóng/trả</span>
                  <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={busy} />
                </label>
                <label>
                  <span>Giờ đóng/trả</span>
                  <input type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={busy} />
                </label>
                <div className="cus-container-manage__quick-add-actions">
                  <UUIButton size="sm" color="primary" type="submit" isDisabled={busy} isLoading={busy}>Lưu dòng mới</UUIButton>
                  <UUIButton size="sm" color="secondary" type="button" onPress={() => { setAddOpen(false); setFormError(''); }} isDisabled={busy}>Hủy</UUIButton>
                </div>
                {formError && <span className="cus-container-manage__error" role="alert">{formError}</span>}
              </form>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
