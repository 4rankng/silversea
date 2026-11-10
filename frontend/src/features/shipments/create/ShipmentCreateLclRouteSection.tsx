import type { RefObject } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import type { OperationalSite } from '../../../api/shipmentClient';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { ShipmentCreateSection, shipmentCreateGridStyle } from './ShipmentCreateSections';
// SIL-691 (FB-007): shared with the FCL container-row picker — the same
// code + name + shortName + address + phone search-text recipe.
import { buildFactoryOptionSearchText } from './ShipmentCreateContainerRow.factorySearch';
import type { ShipmentCreateFormState } from './shipment-create-model';

type FormState = ShipmentCreateFormState;

export interface ShipmentCreateLclRouteSectionProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  routeOptions: { value: string; label: string }[];
  operationalSites: OperationalSite[];
  /** FB-105 §2: the Kho (CFS/Cảng) picker now lives in this card. */
  warehouseSites: OperationalSite[];
  /** Card 261022093245: the shared catalog's own load state — distinct from
   *  the customer-scoped sites fetch behind the Nhà máy picker. */
  warehouseSitesLoading: boolean;
  selectedOperationalSite: OperationalSite | null;
  selectOperationalSite: (value: string) => void;
  routeCustomText?: (text: string) => void;
  factoryCustomText?: (text: string) => void;
  warehouseCustomText?: (text: string) => void;
  routeAddButtonRef: RefObject<HTMLButtonElement | null>;
  setRouteDialogOpen: (open: boolean) => void;
  openCreateSiteDialog: (siteType: 'FACTORY' | 'WAREHOUSE') => void;
  setDetailSite: (site: OperationalSite | null) => void;
  saving: boolean;
  sitesLoading: boolean;
  issueByField: Map<string, string>;
}

export function ShipmentCreateLclRouteSection({
  form,
  update,
  routeOptions,
  operationalSites,
  warehouseSites,
  warehouseSitesLoading,
  selectedOperationalSite,
  selectOperationalSite,
  routeCustomText,
  factoryCustomText,
  warehouseCustomText,
  routeAddButtonRef,
  setRouteDialogOpen,
  openCreateSiteDialog,
  setDetailSite,
  saving,
  sitesLoading,
  issueByField,
}: ShipmentCreateLclRouteSectionProps) {
  return (
    <ShipmentCreateSection
      id="route"
      title="Điểm vận hành & tuyến"
      description="Chọn tuyến và điểm giao hoặc lấy hàng theo hình thức lô."
    >
      <div style={shipmentCreateGridStyle}>
        <div className="csc-route-picker" data-field-id="shipment-route">
          <SearchableField
            id="shipment-route"
            label="Tuyến đường"
            // QA1-007: the asterisk must match the validation — ad-hoc lots
            // waive the catalog route (MasterDataNhaMay §4.1), so the mark
            // only stands for catalog lots.
            required={!form.isAdHoc}
            value={form.routeId}
            onChange={(value) => update('routeId', value)}
            options={routeOptions}
            placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Gõ chọn'}
            disabled={saving || (!form.isAdHoc && selectedOperationalSite?.routeId != null)}
            error={issueByField.get('shipment-route')}
            searchable
            allowsCustomValue={form.isAdHoc}
            {...(form.isAdHoc && routeCustomText ? { onCustomValue: routeCustomText } : {})}
          />
          {selectedOperationalSite?.routeId == null && (
            <button
              ref={routeAddButtonRef as RefObject<HTMLButtonElement>}
              type="button"
              onClick={() => setRouteDialogOpen(true)}
              disabled={saving}
              className="csc-utility-button csc-utility-button--dashed csc-route-picker__add"
            >
              <Plus size={15} aria-hidden="true" />Thêm tuyến đường
            </button>
          )}
        </div>
        <div className="csc-site-picker" data-field-id="shipment-operational-site">
          <SearchableField
            id="shipment-operational-site"
            // FB-105 (spec §2): the Nhà máy is the delivery point for hàng Nhập
            // and the pickup point for hàng Xuất and is REQUIRED for hàng lẻ
            // (waived by Lệnh chạy ngoài, like every catalog prerequisite).
            label={form.tradeDirection === 'EXPORT'
              ? 'Nhà máy (Điểm lấy hàng)'
              : form.tradeDirection === 'IMPORT'
                ? 'Nhà máy (Điểm trả hàng)'
                : 'Nhà máy'}
            required={!form.isAdHoc}
            value={form.operationalSiteId}
            onChange={selectOperationalSite}
            options={operationalSites.map((site) => ({
              value: String(site.id),
              label: site.shortName || site.name,
              // SIL-691 (FB-007, id 803 — QA 06/11): the hàng-lẻ picker must
              // match its FCL sibling (FB-007 round 16): the contact phone is
              // VISIBLE as the option's secondary line (supportingText, same
              // operational_sites.contact_phone the detail dialog reads) and
              // searchable (code + name + address + phone), so a dispatcher
              // can find the factory by its number. Phone-less sites render
              // no stray line.
              searchText: buildFactoryOptionSearchText(site),
              supportingText: site.contactPhone?.trim() || undefined,
            }))}
            placeholder={
              sitesLoading
                ? 'Đang tải…'
                : !form.customerId && !form.isAdHoc
                ? 'Chọn khách hàng trước'
                : form.isAdHoc
                ? 'Chọn hoặc gõ tên nhà máy'
                : 'Chọn hoặc nhập nhà máy'
            }
            disabled={(!form.customerId && !form.isAdHoc) || sitesLoading || saving}
            error={issueByField.get('shipment-operational-site')}
            allowsCustomValue
            {...(factoryCustomText ? { onCustomValue: factoryCustomText } : {})}
            hint={
              form.customerId && !sitesLoading && operationalSites.length === 0 ? (
                <>
                  Chưa có nhà máy.{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      openCreateSiteDialog('FACTORY');
                    }}
                    disabled={saving}
                    style={{
                      border: 0,
                      background: 'none',
                      padding: 0,
                      color: 'var(--accent-ink, #00361B)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 'var(--text-control-size)',
                    }}
                  >
                    Thêm mới
                  </button>
                </>
              ) : undefined
            }
            searchable
          />
          <div className="csc-site-picker__actions">
            {form.operationalSiteId && (
              <button
                type="button"
                onClick={() => setDetailSite(selectedOperationalSite)}
                className="csc-utility-button"
              >
                <Eye size={15} aria-hidden="true" />Xem chi tiết
              </button>
            )}
            <button
              type="button"
              onClick={() => openCreateSiteDialog('FACTORY')}
              disabled={saving}
              className="csc-utility-button csc-utility-button--dashed"
            >
              <Plus size={15} aria-hidden="true" />Thêm nhà máy
            </button>
          </div>
        </div>
        {selectedOperationalSite && (
          <div data-field-id="shipment-site-address">
            <TextField
              id="shipment-site-address"
              label="Vị trí đóng/trả hàng"
              value={selectedOperationalSite.address}
              disabled
              onChange={() => {}}
            />
          </div>
        )}
        {/* FB-105 (spec §2): the Kho (CFS/Cảng) picker shares this card with
            Tuyến đường / Nhà máy so every địa điểm lives in one place; "Thông
            tin hàng" keeps only the cargo fields.
            Card 261022093245 (Zalo 22/10): the options are the SHARED
            warehouse catalog — every active kho across ALL customers, never
            filtered to the lot's customer. A CFS/depot is hạ tầng dùng chung:
            a customer without its own kho still picks from the danh mục. */}
        <div data-field-id="shipment-pickup-warehouse" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
          <SearchableField
            id="shipment-pickup-warehouse"
            label={form.tradeDirection === 'EXPORT'
              ? 'Kho trả hàng (CFS/Cảng)'
              : form.tradeDirection === 'IMPORT'
                ? 'Kho lấy hàng (CFS/Cảng)'
                : 'Kho lấy hàng'}
            required={!form.isAdHoc}
            value={form.pickupWarehouseSiteId}
            onChange={(value) => update('pickupWarehouseSiteId', value)}
            options={warehouseSites.map((site) => ({
              value: String(site.id),
              label: site.shortName || site.name,
              searchText: `${site.code} ${site.name} ${site.address ?? ''}`,
            }))}
            placeholder={
              warehouseSitesLoading
                ? 'Đang tải…'
                : !form.customerId
                  ? (form.isAdHoc ? 'Không áp dụng cho lệnh chạy ngoài' : 'Chọn khách hàng trước')
                  : form.tradeDirection === 'EXPORT'
                    ? 'Chọn hoặc nhập kho CFS hạ/giao hàng...'
                    : 'Chọn hoặc nhập kho CFS lấy hàng...'
            }
            disabled={!form.customerId || sitesLoading || warehouseSitesLoading || saving}
            error={issueByField.get('shipment-pickup-warehouse')}
            allowsCustomValue
            {...(warehouseCustomText ? { onCustomValue: warehouseCustomText } : {})}
            hint={
              form.customerId && !sitesLoading && !warehouseSitesLoading && warehouseSites.length === 0 ? (
                <>
                  Chưa có kho trong danh mục.{' '}
                  <button
                    type="button"
                    onClick={() => openCreateSiteDialog('WAREHOUSE')}
                    disabled={saving}
                    style={{
                      border: 0,
                      background: 'none',
                      padding: 0,
                      color: 'var(--accent-ink, #00361B)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: 'var(--text-control-size)',
                    }}
                  >
                    Thêm kho
                  </button>
                </>
              ) : undefined
            }
            searchable
          />
          {/* Card 211026130115: always visible — the quick-add opens before a
              customer is chosen (the dialog collects it), never hidden behind
              the "chọn khách hàng trước" step. */}
          <button
            type="button"
            onClick={() => openCreateSiteDialog('WAREHOUSE')}
            disabled={saving}
            // Card 181026143000 §1c: the SAME shared dashed utility button
            // as the sibling "+ Thêm nhà máy" — one pattern, one class. The
            // old inline palette (incl. a blue #2563eb fallback) is gone;
            // alignment is the only button-local concern.
            className="csc-utility-button csc-utility-button--dashed"
            style={{ alignSelf: 'start' }}
          >
            <Plus size={15} aria-hidden="true" />Thêm kho
          </button>
        </div>
        {/* SIL-765 (Phần VI Epic 5.2) — additional "Kho lấy hàng" rows: one lô
            lẻ may lift at MORE than one kho. Each row is the SAME hybrid pick
            as the primary field (danh mục dùng chung hoặc gõ tay) with its own
            delete button; [+ Thêm kho lấy hàng] appends a row and is a
            DIFFERENT control from the "+ Thêm kho" quick-add above (which adds
            a kho into the shared catalog and stays untouched). */}
        {form.extraPickupWarehouses.map((row, index) => {
          const fieldId = `shipment-pickup-warehouse-extra-${index}`;
          return (
            <div key={fieldId} data-field-id={fieldId} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'stretch' }}>
              <SearchableField
                id={fieldId}
                label={form.tradeDirection === 'EXPORT'
                  ? 'Kho trả hàng (CFS/Cảng)'
                  : form.tradeDirection === 'IMPORT'
                    ? 'Kho lấy hàng (CFS/Cảng)'
                    : 'Kho lấy hàng'}
                value={row.siteId}
                onChange={(value) => update('extraPickupWarehouses', form.extraPickupWarehouses.map((item, i) => (i === index ? { ...item, siteId: value, name: '' } : item)))}
                options={warehouseSites.map((site) => ({
                  value: String(site.id),
                  label: site.shortName || site.name,
                  searchText: `${site.code} ${site.name} ${site.address ?? ''}`,
                }))}
                placeholder={
                  warehouseSitesLoading
                    ? 'Đang tải…'
                    : !form.customerId
                      ? 'Chọn khách hàng trước'
                      : 'Chọn hoặc nhập kho CFS lấy hàng...'
                }
                disabled={!form.customerId || sitesLoading || warehouseSitesLoading || saving}
                error={issueByField.get(fieldId)}
                allowsCustomValue
                onCustomValue={(text) => update('extraPickupWarehouses', form.extraPickupWarehouses.map((item, i) => (i === index ? { ...item, siteId: '', name: text } : item)))}
                searchable
              />
              <button
                type="button"
                onClick={() => update('extraPickupWarehouses', form.extraPickupWarehouses.filter((_, i) => i !== index))}
                disabled={saving}
                className="csc-utility-button"
                style={{ alignSelf: 'start' }}
                aria-label={`Xóa kho lấy hàng ${index + 2}`}
                title="Xóa kho lấy hàng"
              >
                <Trash2 size={15} aria-hidden="true" />Xóa kho
              </button>
            </div>
          );
        })}
        <div data-field-id="shipment-pickup-warehouse-extra-add">
          <button
            type="button"
            onClick={() => update('extraPickupWarehouses', [...form.extraPickupWarehouses, { siteId: '', name: '' }])}
            disabled={saving}
            className="csc-utility-button csc-utility-button--dashed"
            style={{ alignSelf: 'start' }}
          >
            <Plus size={15} aria-hidden="true" />Thêm kho lấy hàng
          </button>
        </div>
      </div>

      {selectedOperationalSite?.strictRules && (
        <aside className="csc-site-guidance" role="note">
          <strong>Lưu ý tại nhà máy</strong>
          <p>{selectedOperationalSite.strictRules}</p>
        </aside>
      )}
    </ShipmentCreateSection>
  );
}
