import { useMemo, useState } from 'react';
import { LoaderCircle, PencilLine, Save, X } from 'lucide-react';
import type {
  ShipmentCusContainerFlatRow,
  ShipmentCusWorkspaceContainerLine,
  ShipmentCusWorkspaceDetail,
} from '@tingting/shared';
import { BadgeWithDot } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { SearchableSelect } from '../../../design-system';
import { formatVietnamDateTimeInput } from '../../../lib/shipment-operations';

type DispatchStatus = ShipmentCusContainerFlatRow['dispatchStatus'];

const DISPATCH_STATUS: Record<DispatchStatus, { label: string; color: 'warning' | 'brand' | 'blue' | 'success' }> = {
  UNASSIGNED: { label: 'Chưa điều xe', color: 'warning' },
  PLANNED: { label: 'Đã phân xe', color: 'brand' },
  CREATED: { label: 'Đã tạo chuyến', color: 'blue' },
  IN_TRANSIT: { label: 'Đang vận chuyển', color: 'blue' },
  COMPLETED: { label: 'Hoàn thành', color: 'success' },
};

function directionLabel(direction: ShipmentCusContainerFlatRow['direction']): string {
  if (direction === 'IMPORT') return 'Nhập';
  if (direction === 'EXPORT') return 'Xuất';
  return 'Chưa xác định';
}

function formatAppointment(value: string | null): { date: string; time: string } | null {
  if (!value) return null;
  const vietnamDateTime = formatVietnamDateTimeInput(value);
  if (!vietnamDateTime) return { date: value, time: '' };
  const [datePart, time] = vietnamDateTime.split('T');
  const [year, month, day] = datePart.split('-');
  return {
    date: `${day}/${month}/${year}`,
    time,
  };
}

function Fallback({ children }: { children: string }) {
  return <span className="shipment-container-ledger__missing">{children}</span>;
}

export interface ShipmentScheduleDraft {
  liftSiteId: number | null;
  dropoffSiteId: number | null;
  customerAppointmentAt: string | null;
}

interface ActiveScheduleEdit {
  detail: ShipmentCusWorkspaceDetail;
  line: ShipmentCusWorkspaceContainerLine;
}

interface ShipmentContainerLedgerProps {
  rows: ShipmentCusContainerFlatRow[];
  totalShipments: number;
  activeEdit: ActiveScheduleEdit | null;
  editLoadingRowId: number | null;
  editError: { rowId: number; message: string } | null;
  onStartEdit: (row: ShipmentCusContainerFlatRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentScheduleDraft) => Promise<void>;
}

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ScheduleInlineEditor({
  edit,
  onCancel,
  onSave,
}: {
  edit: ActiveScheduleEdit;
  onCancel: () => void;
  onSave: (line: ShipmentCusWorkspaceContainerLine, draft: ShipmentScheduleDraft) => Promise<void>;
}) {
  const { detail, line } = edit;
  const [liftSiteId, setLiftSiteId] = useState(line.liftSiteId ? String(line.liftSiteId) : '');
  const [dropoffSiteId, setDropoffSiteId] = useState(line.dropoffSiteId ? String(line.dropoffSiteId) : '');
  const [appointment, setAppointment] = useState(toLocalDateTime(line.customerAppointmentAt));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const options = useMemo(() => detail.selectors.operationalSites.map((site) => ({
    value: String(site.id),
    label: site.label,
    searchText: `${site.code} ${site.name}`,
  })), [detail.selectors.operationalSites]);
  const dirty = liftSiteId !== (line.liftSiteId ? String(line.liftSiteId) : '')
    || dropoffSiteId !== (line.dropoffSiteId ? String(line.dropoffSiteId) : '')
    || appointment !== toLocalDateTime(line.customerAppointmentAt);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(line, {
        liftSiteId: liftSiteId ? Number(liftSiteId) : null,
        dropoffSiteId: dropoffSiteId ? Number(dropoffSiteId) : null,
        customerAppointmentAt: appointment ? new Date(appointment).toISOString() : null,
      });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Không thể lưu lịch trình container.');
    } finally {
      setSaving(false);
    }
  };

  const label = line.containerNumber || `số ${line.ordinal}`;

  return (
    <>
      <td data-label="Hành trình nâng/hạ" className="shipment-container-ledger__editing-cell">
        <div className="shipment-container-ledger__schedule-fields">
          <label htmlFor={`shipment-detail-lift-${line.id}`}>Điểm nâng</label>
          {line.permissions.liftSiteEditable ? (
            <SearchableSelect
              id={`shipment-detail-lift-${line.id}`}
              value={liftSiteId}
              onChange={(value) => { setLiftSiteId(value); setSaveError(null); }}
              options={options}
              placeholder="Chọn điểm nâng"
              searchPlaceholder="Tìm điểm nâng"
              disabled={saving}
            />
          ) : <strong>{line.liftSite || 'Chưa cập nhật'}</strong>}

          <label htmlFor={`shipment-detail-dropoff-${line.id}`}>Điểm hạ</label>
          {line.permissions.dropoffSiteEditable ? (
            <SearchableSelect
              id={`shipment-detail-dropoff-${line.id}`}
              value={dropoffSiteId}
              onChange={(value) => { setDropoffSiteId(value); setSaveError(null); }}
              options={options}
              placeholder="Chọn điểm hạ"
              searchPlaceholder="Tìm điểm hạ"
              disabled={saving}
            />
          ) : <strong>{line.dropoffSite || 'Chưa cập nhật'}</strong>}
        </div>
      </td>
      <td data-label="Lịch hẹn đóng/trả" className="shipment-container-ledger__editing-cell">
        <div className="shipment-container-ledger__appointment-editor">
          <label htmlFor={`shipment-detail-appointment-${line.id}`}>Lịch hẹn đóng/trả</label>
          {line.permissions.customerAppointmentEditable ? (
            <input
              id={`shipment-detail-appointment-${line.id}`}
              aria-label={`Lịch hẹn đóng hoặc trả của container ${label}`}
              type="datetime-local"
              value={appointment}
              disabled={saving}
              onChange={(event) => { setAppointment(event.target.value); setSaveError(null); }}
            />
          ) : <strong>{formatAppointment(line.customerAppointmentAt)?.date || 'Chưa có lịch hẹn'}</strong>}
          <div className="shipment-container-ledger__edit-actions">
            <UUIButton
              size="sm"
              color="primary"
              onPress={() => void save()}
              isDisabled={!dirty || saving}
              isLoading={saving}
              showTextWhileLoading
              iconLeading={!saving ? <Save aria-hidden="true" /> : undefined}
              aria-label={`Lưu lịch trình ${label}`}
            >Lưu</UUIButton>
            <UUIButton
              size="sm"
              color="secondary"
              onPress={onCancel}
              isDisabled={saving}
              iconLeading={<X aria-hidden="true" />}
              aria-label={`Hủy chỉnh sửa lịch trình ${label}`}
            >Hủy</UUIButton>
          </div>
          {saveError && <span className="shipment-container-ledger__edit-error" role="alert">{saveError}</span>}
        </div>
      </td>
    </>
  );
}

export function ShipmentContainerLedger({
  rows,
  totalShipments,
  activeEdit,
  editLoadingRowId,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: ShipmentContainerLedgerProps) {
  const unassignedCount = rows.filter((row) => row.dispatchStatus === 'UNASSIGNED').length;
  const assignedCount = rows.length - unassignedCount;

  return (
    <>
      <dl className="shipment-container-summary" aria-label="Tổng quan trang hiện tại">
        <div>
          <dt>Container trên trang</dt>
          <dd>{rows.length.toLocaleString('vi-VN')}</dd>
        </div>
        <div className={unassignedCount > 0 ? 'shipment-container-summary__attention' : undefined}>
          <dt>Chưa điều xe</dt>
          <dd>{unassignedCount.toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Đã có kế hoạch</dt>
          <dd>{assignedCount.toLocaleString('vi-VN')}</dd>
        </div>
        <div>
          <dt>Lô hàng phù hợp</dt>
          <dd>{totalShipments.toLocaleString('vi-VN')}</dd>
        </div>
      </dl>

      <p id="shipment-container-ledger-instructions" className="sr-only">
        Bảng container của các lô hàng. Mỗi dòng là một container với lô hàng, hành trình, lịch hẹn, phương tiện và trạng thái điều vận.
      </p>
      <div
        className="shipment-container-ledger"
        role="region"
        aria-label="Danh sách chi tiết container"
        aria-describedby="shipment-container-ledger-instructions"
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">Chi tiết container theo lô hàng</caption>
          <colgroup>
            <col className="shipment-container-ledger__col--container" />
            <col className="shipment-container-ledger__col--shipment" />
            <col className="shipment-container-ledger__col--route" />
            <col className="shipment-container-ledger__col--appointment" />
            <col className="shipment-container-ledger__col--vehicle" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Container và điều vận</th>
              <th scope="col">Lô hàng</th>
              <th scope="col">Hành trình nâng/hạ</th>
              <th scope="col">Lịch hẹn đóng/trả</th>
              <th scope="col">Xe vận chuyển</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const appointment = formatAppointment(row.customerAppointmentAt);
              const dispatch = DISPATCH_STATUS[row.dispatchStatus];
              const rowEdit = activeEdit?.line.id === row.id ? activeEdit : null;
              const editBusy = editLoadingRowId === row.id;
              const anotherRowIsEditing = activeEdit != null && rowEdit == null;
              return (
                <tr key={row.id}>
                  <th scope="row" data-label="Container và điều vận">
                    <div className="shipment-container-ledger__identity">
                      <strong className="shipment-container-ledger__code">{row.containerNumber || 'Chưa có số container'}</strong>
                      <span>{row.containerTypeLabel || 'Chưa rõ loại container'}</span>
                      <BadgeWithDot type="color" size="sm" color={dispatch.color}>
                        {dispatch.label}
                      </BadgeWithDot>
                    </div>
                  </th>
                  <td data-label="Lô hàng">
                    <div className="shipment-container-ledger__shipment">
                      <div className="shipment-container-ledger__bill">
                        <strong>{row.billOrBookNumber || 'Chưa có Bill/Booking'}</strong>
                        <span>{directionLabel(row.direction)}</span>
                      </div>
                      <span>{row.customerName || 'Chưa cập nhật khách hàng'}</span>
                      <small>{row.factoryName || 'Chưa cập nhật nhà máy'}</small>
                    </div>
                  </td>
                  {rowEdit ? (
                    <ScheduleInlineEditor edit={rowEdit} onCancel={onCancelEdit} onSave={onSaveEdit} />
                  ) : (
                    <>
                      <td data-label="Hành trình nâng/hạ">
                        <div className="shipment-container-ledger__route">
                          <span><small>Điểm nâng</small>{row.liftSite || <Fallback>Chưa cập nhật</Fallback>}</span>
                          <i aria-hidden="true">→</i>
                          <span><small>Điểm hạ</small>{row.dropoffSite || <Fallback>Chưa cập nhật</Fallback>}</span>
                        </div>
                        {row.scheduleEditable && (
                          <UUIButton
                            size="sm"
                            color="tertiary"
                            className="shipment-container-ledger__edit-trigger"
                            onPress={() => onStartEdit(row)}
                            isDisabled={editBusy || anotherRowIsEditing}
                            iconLeading={editBusy
                              ? <LoaderCircle className="shipment-container-ledger__spinner" aria-hidden="true" />
                              : <PencilLine aria-hidden="true" />}
                            aria-label={`Chỉnh sửa lịch trình ${row.containerNumber || `container số ${row.ordinal}`}`}
                          >{editBusy ? 'Đang mở' : 'Chỉnh sửa'}</UUIButton>
                        )}
                        {editError?.rowId === row.id && (
                          <span className="shipment-container-ledger__edit-error" role="alert">{editError.message}</span>
                        )}
                      </td>
                      <td data-label="Lịch hẹn đóng/trả">
                        {appointment ? (
                          <time className="shipment-container-ledger__appointment" dateTime={row.customerAppointmentAt ?? undefined}>
                            <strong>{appointment.time}</strong>
                            <span>{appointment.date}</span>
                          </time>
                        ) : <Fallback>Chưa có lịch hẹn</Fallback>}
                      </td>
                    </>
                  )}
                  <td data-label="Xe vận chuyển">
                    <div className="shipment-container-ledger__vehicle">
                      <strong>{row.carrierName || 'Chưa có nhà xe'}</strong>
                      {row.plateNumber
                        ? <span className="shipment-container-ledger__plate">{row.plateNumber}</span>
                        : <Fallback>Chưa có biển số</Fallback>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
