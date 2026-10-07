import { Copy, Info, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CatalogData } from '../../../api/tripClient';
import type { OperationalSite } from '../../../api/shipmentClient';
import { formatDateTime24 } from '../../../lib/format';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { UDateTimeField as DateTimeField } from './uui-datetime-field';
import { ShipmentContainerCell } from './ShipmentContainerCell';
import { FactoryDetailPopover } from './FactoryDetailPopover';
import { ContainerTypeCellPicker } from './ContainerTypeCellPicker';
import type { ShipmentContainerDraft } from './shipment-create-model';

type ContainerRow = ShipmentContainerDraft;

function formatContainerWeight(value: string) {
  if (!value.trim()) return '';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(parsed);
}

function formatContainerAppointment(value: string) {
  return formatDateTime24(value) || value;
}

export interface ShipmentCreateContainerRowProps {
  row: ContainerRow;
  index: number;
  containersLength: number;
  catalogs: CatalogData;
  operationalSites: OperationalSite[];
  emptyAppointmentCount: number;
  copyAppointmentToEmpty: (fromKey: string) => void;
  updateContainer: (key: string, field: keyof Omit<ContainerRow, 'key'>, value: string) => void;
  removeContainer: (row: ContainerRow, scope: HTMLTableRowElement | null) => void;
  selectContainerFactory: (key: string, value: string) => void;
  containerFactoryCustomText: (key: string, text: string) => void;
  containerRouteCustomText: (key: string, text: string) => void;
  portCustomText: (key: string, field: 'pickupPortId' | 'dropoffPortId', rawField: 'rawPickupPortName' | 'rawDropoffPortName', text: string) => void;
  setRouteDialogTargetKey: (key: string) => void;
  setRouteDialogInitialName: (name: string) => void;
  setRouteDialogOpen: (open: boolean) => void;
  setPortDialog: (val: { open: boolean; target: { key: string; field: 'pickupPortId' | 'dropoffPortId'; name: string } | null }) => void;
  issueByField: Map<string, string>;
  isAdHoc: boolean;
  customerId: string;
  sitesLoading: boolean;
  saving: boolean;
  routeOptions: { value: string; label: string }[];
  portOptions: { value: string; label: string }[];
}

export function ShipmentCreateContainerRow({
  row,
  index,
  containersLength,
  catalogs,
  operationalSites,
  emptyAppointmentCount,
  copyAppointmentToEmpty,
  updateContainer,
  removeContainer,
  selectContainerFactory,
  containerFactoryCustomText,
  containerRouteCustomText,
  portCustomText,
  setRouteDialogTargetKey,
  setRouteDialogInitialName,
  setRouteDialogOpen,
  setPortDialog,
  issueByField,
  isAdHoc,
  customerId,
  sitesLoading,
  saving,
  routeOptions,
  portOptions,
}: ShipmentCreateContainerRowProps) {
  const containerType = (catalogs.containerTypes ?? []).find((item) => String(item.id) === row.containerTypeId);
  const pickupPort = (catalogs.ports ?? []).find((item) => String(item.id) === row.pickupPortId);
  const dropoffPort = (catalogs.ports ?? []).find((item) => String(item.id) === row.dropoffPortId);
  const factory = operationalSites.find((site) => String(site.id) === row.operationalSiteId);
  const canCopyAppointment = Boolean(row.customerAppointmentAt) && emptyAppointmentCount >= 2;
  // Card 20261002_272: open handle for the paired-field Tab hand-off.
  const typePickerOpenApi = useRef<{ open: () => void } | null>(null);
  // Card 20261002_268: read-only factory detail peek beside the cell value.
  const [factoryDetailOpen, setFactoryDetailOpen] = useState(false);
  const factoryDetailAnchorRef = useRef<HTMLButtonElement | null>(null);
  const factoryName = factory?.shortName || factory?.name || (isAdHoc ? row.rawFactoryName : '');
  const factoryInvoiceGroups = factory ? [{
    label: 'Hóa đơn cẩu phí',
    lines: [
      { label: 'Tên', value: factory.liftFeeInvoiceName ?? '' },
      { label: 'Địa chỉ', value: factory.liftFeeInvoiceAddress ?? '' },
      { label: 'MST', value: factory.liftFeeTaxCode ?? '' },
    ].filter((line) => line.value.trim() !== ''),
  }] : [];

  return (
    <tr key={row.key} className="csc-container-row">
      <th scope="row" className="csc-container-row__index">
        <span className="csc-container-row__desktop-index">{index + 1}</span>
        <span className="csc-container-row__mobile-index">Container {index + 1}</span>
        {canCopyAppointment && (
          <button
            type="button"
            className="csc-container-row__copy"
            onClick={() => copyAppointmentToEmpty(row.key)}
            title={`Copy ngày giờ ${formatContainerAppointment(row.customerAppointmentAt)} sang các container chưa có lịch`}
            aria-label={`Copy ngày giờ đóng trả ${formatContainerAppointment(row.customerAppointmentAt)} sang các container chưa có lịch`}
          >
            <Copy size={15} aria-hidden="true" />
          </button>
        )}
      </th>
      <ShipmentContainerCell
        label="Số container"
        value={row.containerNumber}
        placeholder="Nhập số container"
        fieldId={`container-${row.key}-number`}
        error={issueByField.get(`container-${row.key}-number`)}
        onRevert={(value) => updateContainer(row.key, 'containerNumber', value)}
      >
        <TextField
          id={`container-${row.key}-number`}
          label="Số container"
          hideLabel
          value={row.containerNumber}
          onChange={(event) => updateContainer(row.key, 'containerNumber', event.target.value.toUpperCase())}
          onKeyDown={(event) => {
            // Card 20261002_272 (PM 03/10, option a): Tab LEAVING the paired
            // Số container field opens the Loại container picker's menu
            // exactly once — a deliberate navigation act. Bare focus and
            // pass-through stay closed (the 2026-09-21 ruling stands). The
            // default Tab proceeds: focus lands on the picker, then we open.
            if (event.key === 'Tab' && !event.shiftKey) {
              window.setTimeout(() => typePickerOpenApi.current?.open(), 0);
            }
          }}
          disabled={saving}
          error={issueByField.get(`container-${row.key}-number`)}
        />
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Loại container *"
        value={containerType?.code ?? ''}
        placeholder="Chọn loại"
        displayTitle={containerType ? `${containerType.code} — ${containerType.name}` : undefined}
        fieldId={`container-${row.key}-type`}
        error={issueByField.get(`container-${row.key}-type`)}
      >
        <ContainerTypeCellPicker
          value={row.containerTypeId}
          onChange={(value) => updateContainer(row.key, 'containerTypeId', value)}
          options={catalogs.containerTypes ?? []}
          fieldId={`container-${row.key}-type`}
          saving={saving}
          error={issueByField.get(`container-${row.key}-type`)}
          openApiRef={typePickerOpenApi}
        />
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Nhà máy *"
        value={factoryName}
        placeholder={isAdHoc ? 'Chọn hoặc gõ tên nhà máy' : 'Chọn nhà máy'}
        fieldId={`container-${row.key}-factory`}
        error={issueByField.get(`container-${row.key}-factory`)}
        actions={factory ? (
          <button
            type="button"
            ref={factoryDetailAnchorRef}
            className="csc-container-cell__action"
            aria-label={`Xem chi tiết nhà máy ${factoryName}`}
            aria-haspopup="dialog"
            aria-expanded={factoryDetailOpen}
            onClick={() => setFactoryDetailOpen((open) => !open)}
          >
            <Info size={14} aria-hidden="true" />
          </button>
        ) : undefined}
      >
        <SearchableField
          id={`container-${row.key}-factory`}
          label="Nhà máy"
          hideLabel
          required
          value={row.operationalSiteId}
          onChange={(value) => selectContainerFactory(row.key, value)}
          options={operationalSites.map((site) => ({
            value: String(site.id),
            label: site.shortName || site.name,
            searchText: `${site.code} ${site.name} ${site.address ?? ''}`,
          }))}
          placeholder={isAdHoc ? 'Chọn hoặc gõ tên nhà máy' : 'Chọn nhà máy'}
          disabled={(!customerId && !isAdHoc) || sitesLoading || saving}
          error={issueByField.get(`container-${row.key}-factory`)}
          searchable
          allowsCustomValue={isAdHoc}
          {...(isAdHoc ? { onCustomValue: (text: string) => containerFactoryCustomText(row.key, text) } : {})}
        />
      </ShipmentContainerCell>
      <FactoryDetailPopover
        name={factoryName}
        address={factory?.address ?? ''}
        invoiceGroups={factoryInvoiceGroups}
        anchorRef={factoryDetailAnchorRef}
        open={factoryDetailOpen && factory != null}
        onClose={() => setFactoryDetailOpen(false)}
      />
      <ShipmentContainerCell
        label="Tuyến đường *"
        value={(catalogs.routes ?? []).find((item) => String(item.id) === row.routeId)?.name || (isAdHoc ? row.rawRouteName : '')}
        placeholder={isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Chọn tuyến đường'}
        fieldId={`container-${row.key}-route`}
        error={issueByField.get(`container-${row.key}-route`)}
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-route`}
            label="Tuyến đường"
            hideLabel
            required
            value={row.routeId}
            onChange={(value) => updateContainer(row.key, 'routeId', value)}
            options={routeOptions}
            placeholder={isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Chọn tuyến đường'}
            disabled={saving || factory?.routeId != null}
            error={issueByField.get(`container-${row.key}-route`)}
            searchable
            allowsCustomValue={isAdHoc}
            {...(isAdHoc ? { onCustomValue: (text: string) => containerRouteCustomText(row.key, text) } : {})}
            createOption={{
              label: (typed) => (typed.trim() ? `＋ Thêm tuyến “${typed.trim()}”…` : '＋ Thêm tuyến mới…'),
              onSelect: (typed) => {
                const name = typed.trim();
                if (!name) return;
                setRouteDialogTargetKey(row.key);
                setRouteDialogInitialName(name);
                setRouteDialogOpen(true);
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Cảng nâng"
        value={pickupPort?.name ?? ''}
        placeholder="Chọn cảng nâng"
        fieldId={`container-${row.key}-pickup-port`}
        error={issueByField.get(`container-${row.key}-pickup-port`)}
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-pickup-port`}
            label="Cảng nâng"
            hideLabel
            value={row.pickupPortId}
            onChange={(value) => updateContainer(row.key, 'pickupPortId', value)}
            allowsCustomValue={isAdHoc}
            options={portOptions}
            placeholder={isAdHoc ? 'Chọn hoặc gõ tên cảng' : 'Chọn cảng nâng'}
            disabled={saving}
            error={issueByField.get(`container-${row.key}-pickup-port`)}
            searchable
            {...(isAdHoc ? { onCustomValue: (text: string) => portCustomText(row.key, 'pickupPortId', 'rawPickupPortName', text) } : {})}
            createOption={{
              label: (typed) => (typed.trim() ? `＋ Thêm cảng “${typed.trim()}”…` : '＋ Thêm cảng mới…'),
              onSelect: (typed) => {
                const name = typed.trim();
                if (!name) return;
                setPortDialog({ open: true, target: { key: row.key, field: 'pickupPortId', name } });
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Cảng hạ"
        value={dropoffPort?.name ?? ''}
        placeholder="Chọn cảng hạ"
        fieldId={`container-${row.key}-dropoff-port`}
        error={issueByField.get(`container-${row.key}-dropoff-port`)}
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-dropoff-port`}
            label="Cảng hạ"
            hideLabel
            value={row.dropoffPortId}
            onChange={(value) => updateContainer(row.key, 'dropoffPortId', value)}
            options={portOptions}
            placeholder={isAdHoc ? 'Chọn hoặc gõ tên cảng' : 'Chọn cảng hạ'}
            disabled={saving}
            error={issueByField.get(`container-${row.key}-dropoff-port`)}
            searchable
            {...(isAdHoc ? { onCustomValue: (text: string) => portCustomText(row.key, 'dropoffPortId', 'rawDropoffPortName', text) } : {})}
            createOption={{
              label: (typed) => (typed.trim() ? `＋ Thêm cảng “${typed.trim()}”…` : '＋ Thêm cảng mới…'),
              onSelect: (typed) => {
                const name = typed.trim();
                if (!name) return;
                setPortDialog({ open: true, target: { key: row.key, field: 'dropoffPortId', name } });
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Trọng lượng (kg)"
        value={formatContainerWeight(row.cargoWeightKg)}
        placeholder="Nhập kg"
        className="csc-container-cell--numeric csc-container-cell--weight"
        onRevert={(value) => updateContainer(row.key, 'cargoWeightKg', value)}
      >
        <TextField
          label="Trọng lượng (kg)"
          hideLabel
          type="number"
          min="0"
          step="0.01"
          value={row.cargoWeightKg}
          onChange={(event) => updateContainer(row.key, 'cargoWeightKg', event.target.value)}
          disabled={saving}
        />
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label="Ngày giờ đóng trả"
        alwaysVisible
        className="csc-container-cell--appointment"
        value={formatContainerAppointment(row.customerAppointmentAt)}
        placeholder="Chọn ngày giờ"
        fieldId={`container-${row.key}-customer-appointment`}
        error={issueByField.get(`container-${row.key}-customer-appointment`)}
        onRevert={(value) => updateContainer(row.key, 'customerAppointmentAt', value)}
      >
        <DateTimeField
          id={`container-${row.key}-customer-appointment`}
          label="Ngày giờ đóng trả"
          hideLabel
          value={row.customerAppointmentAt}
          onChange={(event) => updateContainer(row.key, 'customerAppointmentAt', event.target.value)}
          disabled={saving}
          error={issueByField.get(`container-${row.key}-customer-appointment`)}
          combinedPicker
        />
      </ShipmentContainerCell>
      <td className="csc-container-row__actions">
        {containersLength > 1 && (
          <button
            type="button"
            className="csc-icon-button csc-icon-button--danger"
            aria-label={`Xóa container ${index + 1}`}
            onClick={(event) => removeContainer(row, event.currentTarget.closest('tr'))}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}
