import { Copy, Info, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CatalogData } from '../../../api/tripClient';
import type { OperationalSite } from '../../../api/shipmentClient';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { usePopoverPosition } from '../../../hooks/usePopoverPosition';
import { formatDateTime24 } from '../../../lib/format';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { UDateTimeField as DateTimeField } from './uui-datetime-field';
import { ShipmentContainerCell } from './ShipmentContainerCell';
import { buildFactoryOptionSearchText } from './ShipmentCreateContainerRow.factorySearch';
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
  /** SIL-513: the STT hover copy duplicates the row right below itself. */
  onDuplicate: (fromKey: string) => void;
  /** FB-009: surfaces the copied text for the workspace's "Đã copy" toast. */
  onAppointmentCopied?: (formatted: string) => void;
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
  onDuplicate,
  onAppointmentCopied,
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
  // Card 20261002_272: open handle for the paired-field Tab hand-off.
  const typePickerOpenApi = useRef<{ open: () => void } | null>(null);
  // Card 20261002_268: read-only factory detail peek beside the cell value.
  const [factoryDetailOpen, setFactoryDetailOpen] = useState(false);
  const factoryDetailAnchorRef = useRef<HTMLButtonElement | null>(null);
  // SIL-552 (QA 29/10) — the LOẠI / TRỌNG LƯỢNG group lines are ghost lines
  // (label + value only): clicking a line opens the shared floating editor
  // (FloatingCellEditor, SIL-631) instead of editing inside the cell — the
  // same owner decision the drawer's SỐ CONTAINER cell already runs. One
  // line edits at a time; the draft is row-local (the create form commits
  // into the draft row, no API call per line).
  const [openLine, setOpenLine] = useState<'type' | 'weight' | null>(null);
  const [weightDraft, setWeightDraft] = useState('');
  const typeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const weightTriggerRef = useRef<HTMLButtonElement | null>(null);
  const typePanelRef = useRef<HTMLDivElement | null>(null);
  const weightPanelRef = useRef<HTMLDivElement | null>(null);
  // The 20261002_272 hand-off asks the LOẠI menu to be open the moment its
  // line opens (Tab leaving SỐ): the picker mounts inside the panel, so the
  // open() call waits for the mount effect below.
  const typeMenuOnOpenRef = useRef(false);
  const panelIdBase = useId();
  const typePanelId = `${panelIdBase}-type-editor`;
  const weightPanelId = `${panelIdBase}-weight-editor`;
  const typeError = issueByField.get(`container-${row.key}-type`);
  const weightSeed = row.cargoWeightKg;

  const openGroupLine = (line: 'type' | 'weight', openMenu = false) => {
    typeMenuOnOpenRef.current = line === 'type' && openMenu;
    setWeightDraft(line === 'weight' ? weightSeed : '');
    setOpenLine((current) => (current === line ? null : line));
  };
  const closeGroupLine = (line: 'type' | 'weight', restoreFocus: boolean) => {
    setOpenLine((current) => (current === line ? null : current));
    if (restoreFocus) {
      (line === 'type' ? typeTriggerRef : weightTriggerRef).current?.focus();
    }
  };
  const commitWeight = () => {
    const next = weightDraft.trim();
    if (next === weightSeed.trim()) {
      closeGroupLine('weight', true);
      return;
    }
    updateContainer(row.key, 'cargoWeightKg', next);
    closeGroupLine('weight', true);
  };
  const commitType = (value: string) => {
    updateContainer(row.key, 'containerTypeId', value);
    closeGroupLine('type', true);
  };

  // Focus lands ONCE per panel opening; the Tab hand-off additionally opens
  // the picker menu after the combobox exists (the 272 contract: leaving SỐ
  // opens the LOẠI menu exactly once — bare focus alone stays closed).
  useEffect(() => {
    if (openLine !== 'type') return;
    const frame = requestAnimationFrame(() => {
      const input = typePanelRef.current?.querySelector<HTMLElement>('input, [role="combobox"]');
      input?.focus();
      if (typeMenuOnOpenRef.current) {
        typeMenuOnOpenRef.current = false;
        typePickerOpenApi.current?.open();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [openLine]);
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
        {/* SIL-513 (owner 26/10): the copy affordance lives HERE — a small
            icon BESIDE the ordinal on row hover. Click duplicates the row
            (full-value clone right below); the old appointment-copy-down
            behavior moved out with the STT swap. The ordinal stays visible:
            the icon sits next to it, it no longer replaces it. */}
        <span className="csc-container-row__index-row">
          <span className="csc-container-row__desktop-index">{index + 1}</span>
          {!saving && (
            <button
              type="button"
              className="csc-container-row__copy"
              onClick={() => onDuplicate(row.key)}
              title={`Nhân bản dòng ${index + 1} — tạo dòng mới copy toàn bộ giá trị (cont, loại, nhà máy, tuyến, cảng, kg, giờ đóng/trả)`}
              aria-label={`Nhân bản container ${index + 1}`}
            >
              <Copy size={14} aria-hidden="true" />
            </button>
          )}
        </span>
        <span className="csc-container-row__mobile-index">Container {index + 1}</span>
      </th>
      {/* Mobile UX consult 16/10: the stacked phone record groups its fields
          into three labelled sub-sections. Desktop hides these bands
          (.csc-container-row__group below + thead owns the column labels);
          the ≤620px container rules turn them into uppercase dividers. */}
      <td className="csc-container-row__group" aria-hidden="true">Thông tin container</td>
      {/* SIL-508 (owner 26/10) — the drawer's merged SỐ CONTAINER group lands
          on the create form: the cell stacks SỐ / LOẠI / TRỌNG LƯỢNG as three
          micro-labelled, click-to-edit lines (the same value-first per-line
          editors as the standalone cells they replace — SIL-483 ghost-line
          law). The standalone LOẠI CONTAINER / TRỌNG LƯỢNG (KG) columns die
          with the merge. The 20261002_272 Tab hand-off (SỐ → open the LOẠI
          picker) survives: both lines share this cell, in tab order. */}
      <td className="csc-contgroup-cell" data-label="Số container">
        <div className="csc-contgroup">
          <ShipmentContainerCell
            as="div"
            microLabel
            microLabelText="Số"
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
                // Số container field opens the Loại container editor's menu
                // exactly once — a deliberate navigation act. Bare focus and
                // pass-through stay closed (the 2026-09-21 ruling stands). The
                // default Tab proceeds: focus lands on the line trigger's
                // floating editor (SIL-552), then we open its menu.
                if (event.key === 'Tab' && !event.shiftKey) {
                  window.setTimeout(() => openGroupLine('type', true), 0);
                }
              }}
              disabled={saving}
              error={issueByField.get(`container-${row.key}-number`)}
            />
          </ShipmentContainerCell>
          {/* SIL-552 (QA 29/10) — LOẠI + TRỌNG LƯỢNG are ghost lines: label +
              value trigger; activating a line floats its editor outside the
              table (the drawer's SỐ CONTAINER pattern, owner 28/10). The
              editors stay MOUNTED in the line at rest (invisible — the
              value-first law): the react-aria constraint walk and the
              field order keep treating LOẠI as the first container control,
              exactly as before. The combobox keeps its "+ Thêm" create flow
              inside the floating card (TC-CUS-CREATE-020). */}
          <GroupFloatingLine
            anchorRef={typeTriggerRef}
            cardRef={typePanelRef}
            panelId={typePanelId}
            microLabelText="Loại"
            contractLabel="Loại container *"
            fieldId={`container-${row.key}-type`}
            error={typeError}
            value={containerType?.code ?? ''}
            emptyText="Chọn loại"
            displayTitle={containerType ? `${containerType.code} — ${containerType.name}` : undefined}
            triggerAriaLabel={`Chỉnh sửa loại container — dòng ${index + 1}`}
            panelLabel={`Chỉnh sửa loại container — dòng ${index + 1}`}
            open={openLine === 'type'}
            disabled={saving}
            onToggle={() => openGroupLine('type')}
            onOpen={() => openGroupLine('type')}
            onClose={() => closeGroupLine('type', false)}
            onCancel={() => closeGroupLine('type', true)}
          >
            <ContainerTypeCellPicker
              value={row.containerTypeId}
              onChange={commitType}
              options={catalogs.containerTypes ?? []}
              fieldId={`container-${row.key}-type`}
              saving={saving}
              error={typeError}
              openApiRef={typePickerOpenApi}
            />
          </GroupFloatingLine>
          <GroupFloatingLine
            anchorRef={weightTriggerRef}
            cardRef={weightPanelRef}
            panelId={weightPanelId}
            microLabelText="Trọng lượng"
            contractLabel="Trọng lượng (kg)"
            fieldId={`container-${row.key}-weight`}
            value={formatContainerWeight(row.cargoWeightKg)}
            emptyText="Nhập kg"
            numeric
            triggerAriaLabel={`Chỉnh sửa trọng lượng — dòng ${index + 1}`}
            panelLabel={`Chỉnh sửa trọng lượng — dòng ${index + 1}`}
            open={openLine === 'weight'}
            disabled={saving}
            onToggle={() => openGroupLine('weight')}
            onOpen={() => openGroupLine('weight')}
            onClose={() => closeGroupLine('weight', false)}
            onCancel={() => closeGroupLine('weight', true)}
          >
            <div className="csc-fline__editor">
              <input
                className="csc-fline__input"
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                autoComplete="off"
                aria-label={`Trọng lượng (kg) — dòng ${index + 1}`}
                disabled={saving}
                value={weightDraft}
                onChange={(event) => setWeightDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Escape') { event.preventDefault(); closeGroupLine('weight', true); }
                  if (event.key === 'Enter') { event.preventDefault(); commitWeight(); }
                }}
              />
              <span className="csc-fline__unit" aria-hidden="true">kg</span>
              <button
                type="button"
                className="csc-fline__save"
                // The button and Enter share ONE guard: a draft equal to the
                // persisted value is nothing to save; an emptied draft IS a
                // real change (the operator cleared the field).
                disabled={weightDraft.trim() === weightSeed.trim()}
                onClick={commitWeight}
              >
                Lưu
              </button>
            </div>
          </GroupFloatingLine>
        </div>
      </td>
      {/* SIL-600 (owner ruling 30/10): số tờ khai entered per container right
          on the create form — a plain always-editable text cell (the number is
          typed, never picked), column placed after the container identity
          group (the CUS Thông tin hàng sheet's order). Duplicates across rows
          stay allowed (SIL-521); the field is optional. */}
      <ShipmentContainerCell
        label="Số tờ khai"
        value={row.declarationNumber}
        placeholder="Nhập số tờ khai"
        fieldId={`container-${row.key}-declaration`}
        onRevert={(value) => updateContainer(row.key, 'declarationNumber', value)}
        mobileFieldChrome
      >
        <TextField
          id={`container-${row.key}-declaration`}
          label="Số tờ khai"
          hideLabel
          value={row.declarationNumber}
          onChange={(event) => updateContainer(row.key, 'declarationNumber', event.target.value)}
          maxLength={50}
          disabled={saving}
        />
      </ShipmentContainerCell>
      <td className="csc-container-row__group" aria-hidden="true">Lộ trình</td>
      <ShipmentContainerCell
        label={isAdHoc ? 'Nhà máy' : 'Nhà máy *'}
        value={factoryName}
        placeholder={isAdHoc ? 'Chọn hoặc gõ tên nhà máy' : 'Chọn nhà máy'}
        fieldId={`container-${row.key}-factory`}
        error={issueByField.get(`container-${row.key}-factory`)}
        picker
        // Card 171026113500 (FB-006 round 17): a chosen factory must leave the
        // cell as the name + the detail magnifier — the full combobox and its
        // "Xoá" button must not sit in the DOM beside them. Lệnh chạy ngoài
        // keeps its free-text behaviour (the operator types into the field, so
        // the editor stays put).
        collapsePickedEditor={!isAdHoc}
        mobileFieldChrome
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
          required={!isAdHoc}
          value={row.operationalSiteId}
          onChange={(value) => selectContainerFactory(row.key, value)}
          options={operationalSites.map((site) => ({
            value: String(site.id),
            label: site.shortName || site.name,
            searchText: buildFactoryOptionSearchText(site),
            // FB-007 round 16: the phone is visible in the option (same
            // contact_phone the detail popover reads); blank stays blank —
            // no "undefined" line for phone-less factories.
            supportingText: site.contactPhone?.trim() || undefined,
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
        phone={factory?.contactPhone ?? ''}
        invoiceGroups={factoryInvoiceGroups}
        anchorRef={factoryDetailAnchorRef}
        open={factoryDetailOpen && factory != null}
        onClose={() => setFactoryDetailOpen(false)}
      />
      <ShipmentContainerCell
        label={isAdHoc ? 'Tuyến đường' : 'Tuyến đường *'}
        value={(catalogs.routes ?? []).find((item) => String(item.id) === row.routeId)?.name || (isAdHoc ? row.rawRouteName : '')}
        placeholder={isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Chọn tuyến đường'}
        fieldId={`container-${row.key}-route`}
        error={issueByField.get(`container-${row.key}-route`)}
        picker
        mobileFieldChrome
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-route`}
            label="Tuyến đường"
            hideLabel
            required={!isAdHoc}
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
              label: () => '+ Thêm',
              onSelect: (typed) => {
                const name = typed.trim();
                setRouteDialogTargetKey(row.key);
                setRouteDialogInitialName(name);
                setRouteDialogOpen(true);
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label={isAdHoc ? 'Cảng nâng' : 'Cảng nâng *'}
        value={pickupPort?.name ?? ''}
        placeholder="Chọn cảng nâng"
        fieldId={`container-${row.key}-pickup-port`}
        error={issueByField.get(`container-${row.key}-pickup-port`)}
        picker
        mobileFieldChrome
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-pickup-port`}
            label="Cảng nâng"
            hideLabel
            required={!isAdHoc}
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
              label: () => '+ Thêm',
              onSelect: (typed) => {
                const name = typed.trim();
                setPortDialog({ open: true, target: { key: row.key, field: 'pickupPortId', name } });
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <ShipmentContainerCell
        label={isAdHoc ? 'Cảng hạ' : 'Cảng hạ *'}
        value={dropoffPort?.name ?? ''}
        placeholder="Chọn cảng hạ"
        fieldId={`container-${row.key}-dropoff-port`}
        error={issueByField.get(`container-${row.key}-dropoff-port`)}
        picker
        mobileFieldChrome
      >
        <div className="csc-route-picker">
          <SearchableField
            id={`container-${row.key}-dropoff-port`}
            label="Cảng hạ"
            hideLabel
            required={!isAdHoc}
            value={row.dropoffPortId}
            onChange={(value) => updateContainer(row.key, 'dropoffPortId', value)}
            // TiepVu22Oct-3 sweep: the EXACT twin of Cảng nâng above — the
            // ad-hoc dropoff port accepts typed free text through
            // onCustomValue (rawDropoffPortName), so it needs the same
            // allowsCustomValue flag or every non-matching keystroke flips
            // dropoffPortId → '' outside the typing-session guard and the
            // sync effect eats the character (the GLC bug class).
            allowsCustomValue={isAdHoc}
            options={portOptions}
            placeholder={isAdHoc ? 'Chọn hoặc gõ tên cảng' : 'Chọn cảng hạ'}
            disabled={saving}
            error={issueByField.get(`container-${row.key}-dropoff-port`)}
            searchable
            {...(isAdHoc ? { onCustomValue: (text: string) => portCustomText(row.key, 'dropoffPortId', 'rawDropoffPortName', text) } : {})}
            createOption={{
              label: () => '+ Thêm',
              onSelect: (typed) => {
                const name = typed.trim();
                setPortDialog({ open: true, target: { key: row.key, field: 'dropoffPortId', name } });
              },
            }}
          />
        </div>
      </ShipmentContainerCell>
      <td className="csc-container-row__group" aria-hidden="true">Thời gian</td>
      <ShipmentContainerCell
        label="Ngày giờ đóng trả *"
        alwaysVisible
        className="csc-container-cell--appointment"
        value={formatContainerAppointment(row.customerAppointmentAt)}
        placeholder="Chọn ngày giờ"
        fieldId={`container-${row.key}-customer-appointment`}
        error={issueByField.get(`container-${row.key}-customer-appointment`)}
        onRevert={(value) => updateContainer(row.key, 'customerAppointmentAt', value)}
        mobileFieldChrome
      >
        <DateTimeField
          id={`container-${row.key}-customer-appointment`}
          label="Ngày giờ đóng trả"
          hideLabel
          value={row.customerAppointmentAt}
          onChange={(event) => updateContainer(row.key, 'customerAppointmentAt', event.target.value)}
          disabled={saving}
          error={issueByField.get(`container-${row.key}-customer-appointment`)}
          onCopied={onAppointmentCopied}
          combinedPicker
        />
      </ShipmentContainerCell>
      <td className="csc-container-row__actions">
        {/* SIL-481: hidden while `saving` (the view mode's channel) — the
            delete confirm reaches discardContainer → setContainers, a
            mutation the read-only review must not offer. */}
        {containersLength > 1 && !saving && (
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

/** SIL-552 (QA 29/10) — one SỐ CONTAINER group line on the create form: a
 *  ghost line (micro-label + value trigger) whose activation floats its
 *  editor OUTSIDE the table on the SIL-631 position law (bottom-start under
 *  the line, viewport-clamped, `role="dialog"` card with the accent arrow —
 *  the same chrome the drawer's cell editor renders).
 *
 *  Unlike the shared FloatingCellEditor host this card does NOT portal: the
 *  editor control stays mounted INSIDE the line at every moment. Two house
 *  laws demand that:
 *  - the react-aria constraint walk (submit focuses the first invalid
 *    control) must still meet LOẠI as the row's first container control — an
 *    unmounted combobox silently shifts that focus to the FACTORY field,
 *    whose focus-trigger menu then paints the whole page aria-hidden
 *    (reproduced 29/10: the footer-actions save raced a leaked
 *    `ariaHideOutside`);
 *  - the cursor-advance/Tab order reaches the line's control the same way it
 *    does today — arriving focus REVEALS the floating card (the value-first
 *    reveal, relocated), bare pass-through commits nothing.
 *
 *  At rest the card rides invisible inside the line (`opacity: 0`,
 *  `pointer-events: none` — the value-first law the cell already runs);
 *  open it switches to `position: fixed` coordinates from the shared
 *  `usePopoverPosition` (hidden until measured), so the sheet's
 *  `overflow-x` scroll box can never clip the editor. */
function GroupFloatingLine({
  anchorRef,
  cardRef,
  panelId,
  microLabelText,
  contractLabel,
  fieldId,
  error,
  value,
  emptyText,
  displayTitle,
  numeric,
  triggerAriaLabel,
  panelLabel,
  open,
  disabled,
  onToggle,
  onOpen,
  onClose,
  onCancel,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  cardRef: RefObject<HTMLDivElement | null>;
  panelId: string;
  /** Short display label beside the value (LOẠI / TRỌNG LƯỢNG). */
  microLabelText: string;
  /** Full data-label contract string (QA1-007 asterisk contract). */
  contractLabel: string;
  fieldId: string;
  error?: string;
  value: string;
  emptyText: string;
  displayTitle?: string;
  /** Numeric values right-align in the lane (the old numeric cell law). */
  numeric?: boolean;
  triggerAriaLabel: string;
  panelLabel: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  /** Arriving focus (keyboard walk / validation) reveals the card. */
  onOpen: () => void;
  /** Outside press — the draft is discarded, the focus is NOT stolen. */
  onClose: () => void;
  /** Escape — the draft is discarded and the focus returns to the trigger. */
  onCancel: () => void;
  children: ReactNode;
}) {
  const position = usePopoverPosition(cardRef, anchorRef, open, 300, 120, 'start');
  // The dismiss layer must ignore portalled react-aria popovers (the
  // combobox listbox) and the type-create dialog: a press there is neither
  // inside the card nor on the trigger — the editor must not close under
  // the operator's finger (the drawer's S2 law).
  const additionalRefs = useMemo(() => [anchorRef as RefObject<HTMLElement | null>], [anchorRef]);
  useClickOutside(cardRef, onClose, {
    enabled: open,
    escapeKey: true,
    onEscape: onCancel,
    additionalRefs,
    ignoreSelector: '.react-aria-Popover, [role="listbox"], [role="dialog"], [role="alertdialog"]',
  });

  const cardStyle = open
    ? (position
      ? { top: position.top, left: position.left, ...(position.maxHeight != null ? { maxHeight: position.maxHeight } : {}) }
      // Hidden until measured — the hook returns null for an unmeasured
      // anchor so the card never paints at the padding corner first.
      : { opacity: 0, pointerEvents: 'none' as const })
    : undefined;

  return (
    <div
      className={`csc-fline${numeric ? ' csc-fline--numeric' : ''}${error ? ' csc-fline--error' : ''}${open ? ' is-open' : ''}`}
      data-field-id={fieldId}
      data-label={contractLabel}
    >
      <span className="csc-fline__microlabel" aria-hidden="true">{microLabelText}</span>
      <button
        type="button"
        ref={anchorRef}
        className={`csc-fline__trigger${value.trim() ? '' : ' csc-fline__trigger--empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={triggerAriaLabel}
        data-invalid={error ? 'true' : undefined}
        disabled={disabled}
        title={displayTitle}
        onClick={onToggle}
      >
        <span className="csc-fline__value">{value.trim() ? value : emptyText}</span>
      </button>
      {error ? <span className="csc-fline__error">{error}</span> : null}
      <div
        ref={cardRef}
        id={panelId}
        role="dialog"
        aria-label={panelLabel}
        className={`csc-fline__card${open ? ' is-open' : ''}`}
        style={cardStyle}
        onFocusCapture={() => {
          // Arriving focus reveals the card (Tab walk, validation focus).
          // Bare pass-through commits nothing — the 2026-09-21 ruling only
          // ever banned focus-OPENED listbox MENUS, not the editor itself.
          if (!open && !disabled) onOpen();
        }}
      >
        <span className="csc-fline__arrow" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
