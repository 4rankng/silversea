import type { RefObject } from 'react';
import { Eye, Plus } from 'lucide-react';
import type { OperationalSite } from '../../../api/shipmentClient';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { ShipmentCreateSection, shipmentCreateGridStyle } from './ShipmentCreateSections';
import type { ShipmentCreateFormState } from './shipment-create-model';

type FormState = ShipmentCreateFormState;

export interface ShipmentCreateLclRouteSectionProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  routeOptions: { value: string; label: string }[];
  operationalSites: OperationalSite[];
  selectedOperationalSite: OperationalSite | null;
  selectOperationalSite: (value: string) => void;
  routeCustomText?: (text: string) => void;
  factoryCustomText?: (text: string) => void;
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
  selectedOperationalSite,
  selectOperationalSite,
  routeCustomText,
  factoryCustomText,
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
            required
            value={form.routeId}
            onChange={(value) => update('routeId', value)}
            options={routeOptions}
            placeholder={form.isAdHoc ? 'Chọn hoặc gõ tên tuyến' : 'Gõ chọn'}
            disabled={saving || (!form.isAdHoc && selectedOperationalSite?.routeId != null)}
            error={issueByField.get('shipment-route')}
            searchable
            allowsCustomValue={form.isAdHoc}
            {...(form.isAdHoc && routeCustomText ? { onCustomValue: routeCustomText } : {})}
            popoverPlacement="top"
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
        <div className="csc-site-picker">
          <SearchableField
            id="shipment-operational-site"
            label="Nhà máy"
            value={form.operationalSiteId}
            onChange={selectOperationalSite}
            options={operationalSites.map((site) => ({
              value: String(site.id),
              label: site.shortName || site.name,
              searchText: `${site.code} ${site.name} ${site.address ?? ''}`,
            }))}
            placeholder={
              sitesLoading
                ? 'Đang tải…'
                : !form.customerId && !form.isAdHoc
                ? 'Chọn khách hàng trước'
                : form.isAdHoc
                ? 'Chọn hoặc gõ tên nhà máy'
                : 'Gõ chọn'
            }
            disabled={(!form.customerId && !form.isAdHoc) || sitesLoading || saving}
            error={issueByField.get('shipment-operational-site')}
            allowsCustomValue={form.isAdHoc}
            {...(form.isAdHoc && factoryCustomText ? { onCustomValue: factoryCustomText } : {})}
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
                      color: 'var(--accent, #2563eb)',
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
            popoverPlacement="top"
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
